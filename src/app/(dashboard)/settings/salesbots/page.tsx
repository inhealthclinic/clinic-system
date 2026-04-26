'use client'

/**
 * Объединённая страница «Salesbot и шаблоны».
 *
 * Две вкладки (как в amoCRM «Чаты и мессенджеры»):
 *   • Salesbot         — диалоговые flow-боты (полные сценарии) и одиночные
 *                        текстовые шаблоны kind='salesbot' (для триггеров).
 *   • Шаблоны ответов  — заготовки для ручной отправки оператором из чата
 *                        сделки (kind='quick_reply').
 *
 * Активная вкладка управляется query-параметром ?tab= — это позволяет
 * редиректу со старого `/settings/message-templates` приземлять
 * пользователя сразу в нужный раздел.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface Bot {
  id: string
  clinic_id: string
  title: string
  body: string
  key: string | null
  sort_order: number
  is_active: boolean
}

interface QuickReply {
  id: string
  clinic_id: string
  title: string
  body: string
  is_favorite: boolean
  sort_order: number
  is_active: boolean
}

interface TriggerRow {
  config: { template_key?: string | null } | null
  stage: { name: string | null; pipeline: { name: string | null } | null } | null
}

interface FlowRow {
  id: string
  name: string
  start_step: number
  is_active: boolean
  is_default: boolean
  trigger_event: string
  created_at: string
  steps: Record<string, unknown>
}

const SYSTEM_KEYS = new Set(['bot_greeting', 'bot_followup_no_answer'])

function slugifyKey(t: string): string {
  const map: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',
    к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
    х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  }
  let s = t.toLowerCase().trim()
  s = s.split('').map(ch => map[ch] ?? ch).join('')
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return s.slice(0, 60) || `bot_${Date.now()}`
}

type Tab = 'salesbots' | 'quick_replies'

export default function SalesbotsAndTemplatesPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? null
  const router = useRouter()
  const sp = useSearchParams()
  const initialTab: Tab = sp.get('tab') === 'quick_replies' ? 'quick_replies' : 'salesbots'
  const [tab, setTab] = useState<Tab>(initialTab)

  function switchTab(t: Tab) {
    setTab(t)
    const url = t === 'salesbots' ? '/settings/salesbots' : '/settings/salesbots?tab=quick_replies'
    router.replace(url)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Salesbot и шаблоны</h1>
        <p className="text-sm text-gray-500 mt-1">
          Раздел объединяет диалоговых ботов и заготовки для оператора —
          как «Чаты и мессенджеры» в amoCRM.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1">
        <TabButton active={tab === 'salesbots'} onClick={() => switchTab('salesbots')}>
          🤖 Salesbot
        </TabButton>
        <TabButton active={tab === 'quick_replies'} onClick={() => switchTab('quick_replies')}>
          💬 Шаблоны ответов
        </TabButton>
      </div>

      {tab === 'salesbots' && clinicId && <SalesbotsTab supabase={supabase} clinicId={clinicId} />}
      {tab === 'quick_replies' && clinicId && <QuickRepliesTab supabase={supabase} clinicId={clinicId} />}
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
        props.active
          ? 'border-blue-500 text-blue-700 font-medium'
          : 'border-transparent text-gray-500 hover:text-gray-900',
      ].join(' ')}
    >
      {props.children}
    </button>
  )
}

// ─── Tab: Salesbot (flow + одиночные шаблоны kind='salesbot') ──────────────────

type SupaClient = ReturnType<typeof createClient>

function SalesbotsTab({ supabase, clinicId }: { supabase: SupaClient; clinicId: string }) {
  const [rows, setRows] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' })
  const [usage, setUsage] = useState<Record<string, string[]>>({})

  const [flows, setFlows] = useState<FlowRow[]>([])
  const [flowName, setFlowName] = useState('')
  const [flowJson, setFlowJson] = useState('')
  const [flowDefault, setFlowDefault] = useState(true)
  const [flowImporting, setFlowImporting] = useState(false)
  const [flowMsg, setFlowMsg] = useState('')

  const loadFlows = useCallback(async () => {
    const { data } = await supabase
      .from('salesbot_flows')
      .select('id, name, start_step, is_active, is_default, trigger_event, created_at, steps')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
    setFlows((data ?? []) as FlowRow[])
  }, [supabase, clinicId])

  const load = useCallback(async () => {
    setLoading(true)
    const [bots, trgs] = await Promise.all([
      supabase
        .from('message_templates')
        .select('id, clinic_id, title, body, key, sort_order, is_active')
        .eq('clinic_id', clinicId)
        .eq('kind', 'salesbot')
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('pipeline_stage_triggers')
        .select('config, stage:pipeline_stages!inner(name, pipeline:pipelines!inner(name, clinic_id))')
        .eq('stage.pipeline.clinic_id', clinicId),
    ])
    setRows((bots.data ?? []) as Bot[])
    const u: Record<string, string[]> = {}
    for (const t of (trgs.data ?? []) as unknown as TriggerRow[]) {
      const k = t?.config?.template_key
      if (!k) continue
      const where = `${t.stage?.pipeline?.name ?? '—'} → ${t.stage?.name ?? '—'}`
      u[k] = u[k] ? [...u[k], where] : [where]
    }
    setUsage(u)
    setLoading(false)
  }, [supabase, clinicId])

  useEffect(() => { load(); loadFlows() }, [load, loadFlows])

  async function importFlow() {
    setFlowMsg('')
    if (!flowName.trim()) { setFlowMsg('Укажите название бота'); return }
    if (!flowJson.trim()) { setFlowMsg('Вставьте JSON'); return }
    setFlowImporting(true)
    try {
      const res = await fetch('/api/salesbot-flows/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: flowName.trim(), json: flowJson, make_default: flowDefault }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'import failed')
      setFlowMsg(`Импортировано: ${j.steps_count} шаг(ов), старт=${j.start_step}` +
        (Array.isArray(j.warnings) && j.warnings.length ? `; предупреждения: ${j.warnings.length}` : ''))
      setFlowName(''); setFlowJson('')
      await loadFlows()
    } catch (e) {
      setFlowMsg('Ошибка: ' + (e as Error).message)
    } finally {
      setFlowImporting(false)
    }
  }

  async function patchFlow(id: string, patch: Partial<FlowRow>) {
    const res = await fetch(`/api/salesbot-flows/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert('Ошибка: ' + (j.error || res.status)); return }
    await loadFlows()
  }
  async function deleteFlow(id: string) {
    if (!confirm('Удалить flow? Активные диалоги по нему остановятся.')) return
    const res = await fetch(`/api/salesbot-flows/${id}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert('Ошибка: ' + (j.error || res.status)); return }
    await loadFlows()
  }

  async function createSimple() {
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) { alert('Укажите название и текст'); return }
    setSaving(true)
    let key = slugifyKey(title)
    if (rows.some(r => r.key === key)) key = `${key}_${Math.random().toString(36).slice(2, 6)}`
    const nextOrder = rows.length === 0 ? 0 : Math.max(...rows.map(r => r.sort_order)) + 1
    const { error } = await supabase.from('message_templates').insert({
      clinic_id: clinicId, title, body, key, sort_order: nextOrder, kind: 'salesbot', is_active: true,
    })
    setSaving(false)
    if (error) { alert('Не удалось создать: ' + error.message); return }
    setDraft({ title: '', body: '' })
    load()
  }

  async function update(id: string, patch: Partial<Bot>) {
    const { error } = await supabase.from('message_templates').update(patch).eq('id', id)
    if (error) { alert('Не удалось сохранить: ' + error.message); return }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function remove(r: Bot) {
    if (r.key && SYSTEM_KEYS.has(r.key)) {
      alert('Системный шаблон удалить нельзя — можно только отключить или изменить текст.')
      return
    }
    const inUse = r.key ? (usage[r.key]?.length ?? 0) : 0
    if (inUse > 0) {
      if (!confirm(`Этот бот используется в ${inUse} триггер(ах). Всё равно удалить?`)) return
    } else {
      if (!confirm('Удалить бота? Это действие необратимо.')) return
    }
    const { error } = await supabase.from('message_templates').delete().eq('id', r.id)
    if (error) { alert('Не удалось удалить: ' + error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  return (
    <div className="space-y-6">
      {/* Диалоговые flow-боты + большая кнопка создания */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Диалоговые боты (flow)</h2>
            <p className="text-xs text-gray-500 mt-1">
              Полноценный диалог с ветвлениями: бот шлёт вопрос с вариантами,
              ждёт ответ клиента, по ключевым словам/синонимам переходит дальше.
              Когда новый лид пишет в WhatsApp — default-бот стартует автоматически.
            </p>
          </div>
          <Link
            href="/settings/salesbots/new"
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
          >
            + Создать sales-бот
          </Link>
        </div>

        {flows.length > 0 && (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-md">
            {flows.map(f => (
              <li key={f.id} className="p-3 flex items-center gap-3 text-sm">
                <span className="font-medium text-gray-900 truncate flex-1">{f.name}</span>
                <span className="text-xs text-gray-500">{Object.keys(f.steps ?? {}).length} шагов</span>
                {f.is_default && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-50 border border-emerald-200 text-emerald-700 uppercase tracking-wide">
                    default
                  </span>
                )}
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <input type="checkbox" checked={f.is_active}
                    onChange={e => patchFlow(f.id, { is_active: e.target.checked })} />
                  активен
                </label>
                {!f.is_default && (
                  <button type="button"
                    onClick={() => patchFlow(f.id, { is_default: true })}
                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">
                    Сделать default
                  </button>
                )}
                <button type="button"
                  onClick={() => deleteFlow(f.id)}
                  className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}

        <details className="border border-gray-200 rounded-md bg-gray-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800">
            Импортировать flow из amoCRM (JSON)
          </summary>
          <div className="p-3 space-y-2">
            <input
              type="text" value={flowName} onChange={e => setFlowName(e.target.value)}
              placeholder="Название бота (например: Приветствие)"
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white hover:border-gray-300 focus:border-blue-400 outline-none"
            />
            <textarea
              value={flowJson} onChange={e => setFlowJson(e.target.value)} rows={8}
              placeholder='Вставьте сюда JSON-экспорт Salesbot из amoCRM (целиком файл, обёртку с model.text принимаем).'
              className="w-full border border-gray-200 rounded px-3 py-2 text-xs font-mono bg-white hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
            />
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={flowDefault} onChange={e => setFlowDefault(e.target.checked)} />
              Сделать ботом по умолчанию для новых входящих диалогов
            </label>
            {flowMsg && (
              <div className={`text-xs ${flowMsg.startsWith('Ошибка') ? 'text-red-600' : 'text-emerald-700'}`}>
                {flowMsg}
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={importFlow} disabled={flowImporting}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                {flowImporting ? 'Импортируем…' : 'Импортировать flow'}
              </button>
            </div>
          </div>
        </details>
      </div>

      {/* Одиночные шаблоны kind='salesbot' (для триггеров воронки) */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Одиночные шаблоны Salesbot</h2>
          <p className="text-xs text-gray-500 mt-1">
            Простые тексты без диалога — на них ссылаются триггеры воронки
            (см. «CRM — воронки и автоматизации») и системные события вроде
            <code className="text-[11px] mx-1">bot_greeting</code>.
          </p>
        </div>
        <input
          type="text" value={draft.title}
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="Название (например: Приветствие новой заявки)"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none"
        />
        <textarea
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
          placeholder="Текст, который отправит бот клиенту."
          rows={3}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
        />
        <button type="button" onClick={createSimple} disabled={saving}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
          {saving ? 'Сохраняем…' : 'Добавить шаблон'}
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">
          Список одиночных шаблонов
        </div>
        {loading ? (
          <div className="p-5 text-sm text-gray-500">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">Пока нет шаблонов.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(r => {
              const isSystem = !!r.key && SYSTEM_KEYS.has(r.key)
              const used = (r.key && usage[r.key]) || []
              return (
                <li key={r.id} className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text" value={r.title}
                      onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, title: e.target.value } : x))}
                      onBlur={e => update(r.id, { title: e.target.value.trim() })}
                      className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 outline-none py-1"
                    />
                    {isSystem && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-50 border border-amber-200 text-amber-700 uppercase tracking-wide">
                        системный
                      </span>
                    )}
                    {r.key && <code className="text-[11px] text-gray-400 font-mono">{r.key}</code>}
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input type="checkbox" checked={r.is_active}
                        onChange={e => update(r.id, { is_active: e.target.checked })} />
                      активен
                    </label>
                    <button type="button" onClick={() => remove(r)} disabled={isSystem}
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:hover:bg-transparent">
                      Удалить
                    </button>
                  </div>
                  <textarea
                    value={r.body}
                    onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, body: e.target.value } : x))}
                    onBlur={e => update(r.id, { body: e.target.value })}
                    rows={3}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
                  />
                  {used.length > 0 && (
                    <div className="text-[11px] text-gray-500">
                      Используется в триггерах:{' '}
                      <span className="text-gray-700">{used.join(' · ')}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Шаблоны ответов (kind='quick_reply') ────────────────────────────────

function QuickRepliesTab({ supabase, clinicId }: { supabase: SupaClient; clinicId: string }) {
  const [rows, setRows] = useState<QuickReply[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('message_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('kind', 'quick_reply')
      .order('sort_order')
      .order('created_at')
    setRows((data ?? []) as QuickReply[])
    setLoading(false)
  }, [supabase, clinicId])

  useEffect(() => { load() }, [load])

  async function create() {
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) { alert('Укажите название и текст шаблона'); return }
    setSaving(true)
    const nextOrder = rows.length === 0 ? 0 : Math.max(...rows.map(r => r.sort_order)) + 1
    const { error } = await supabase.from('message_templates').insert({
      clinic_id: clinicId, title, body, sort_order: nextOrder, kind: 'quick_reply',
    })
    setSaving(false)
    if (error) { alert('Не удалось создать: ' + error.message); return }
    setDraft({ title: '', body: '' })
    load()
  }

  async function update(id: string, patch: Partial<QuickReply>) {
    const { error } = await supabase.from('message_templates').update(patch).eq('id', id)
    if (error) { alert('Не удалось сохранить: ' + error.message); return }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function remove(id: string) {
    if (!confirm('Удалить шаблон? Это действие необратимо.')) return
    const { error } = await supabase.from('message_templates').delete().eq('id', id)
    if (error) { alert('Не удалось удалить: ' + error.message); return }
    setRows(prev => prev.filter(r => r.id !== id))
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = rows.findIndex(r => r.id === id)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= rows.length) return
    const a = rows[idx], b = rows[j]
    await supabase.from('message_templates').update({ sort_order: b.sort_order }).eq('id', a.id)
    await supabase.from('message_templates').update({ sort_order: a.sort_order }).eq('id', b.id)
    load()
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Заранее заготовленные тексты для ручной отправки оператором — кнопка «Шаблоны»
        в композере чата сделки. Отмеченные ★ попадают в секцию «Избранные».
      </p>

      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Новый шаблон</h2>
        <input
          type="text" value={draft.title}
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="Название (например: Приветствие)"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none"
        />
        <textarea
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
          placeholder="Текст шаблона — именно он вставляется в поле ввода композера."
          rows={4}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
        />
        <button type="button" onClick={create} disabled={saving}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
          {saving ? 'Сохраняем…' : 'Добавить шаблон'}
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">
          Имеющиеся шаблоны
        </div>
        {loading ? (
          <div className="p-5 text-sm text-gray-500">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">Пока нет шаблонов. Создайте первый выше.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r, idx) => (
              <li key={r.id} className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => update(r.id, { is_favorite: !r.is_favorite })}
                    title={r.is_favorite ? 'Убрать из избранного' : 'В избранное'}
                    className={`text-lg leading-none ${r.is_favorite ? 'text-amber-500' : 'text-gray-300 hover:text-gray-500'}`}>
                    ★
                  </button>
                  <input
                    type="text" value={r.title}
                    onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, title: e.target.value } : x))}
                    onBlur={e => update(r.id, { title: e.target.value.trim() })}
                    className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 outline-none py-1"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" checked={r.is_active}
                      onChange={e => update(r.id, { is_active: e.target.checked })} />
                    активен
                  </label>
                  <button type="button" onClick={() => move(r.id, -1)} disabled={idx === 0}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => move(r.id, 1)} disabled={idx === rows.length - 1}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => remove(r.id)}
                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded">Удалить</button>
                </div>
                <textarea
                  value={r.body}
                  onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, body: e.target.value } : x))}
                  onBlur={e => update(r.id, { body: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
