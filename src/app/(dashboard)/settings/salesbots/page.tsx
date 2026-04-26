'use client'

/**
 * Список Salesbot — отдельная страница (как в amoCRM):
 * управление текстами, которые рассылает Salesbot из триггеров воронки
 * и системных событий (приветствие, напоминание о неответе).
 *
 * CRUD поверх message_templates с фильтром kind='salesbot' (мигр. 093).
 * key — стабильный машинный идентификатор; именно на него ссылаются
 * pipeline_stage_triggers.config.template_key и системные ключи
 * bot_greeting / bot_followup_no_answer (трогать нельзя).
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

interface TriggerRow {
  config: { template_key?: string | null } | null
  stage: { name: string | null; pipeline: { name: string | null } | null } | null
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

export default function SalesbotsSettingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? null

  const [rows, setRows] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' })
  const [usage, setUsage] = useState<Record<string, string[]>>({})

  const load = useCallback(async () => {
    if (!clinicId) return
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

  useEffect(() => { load() }, [load])

  async function create() {
    if (!clinicId) return
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) { alert('Укажите название и текст'); return }
    setSaving(true)
    let key = slugifyKey(title)
    if (rows.some(r => r.key === key)) key = `${key}_${Math.random().toString(36).slice(2, 6)}`
    const nextOrder = rows.length === 0 ? 0 : Math.max(...rows.map(r => r.sort_order)) + 1
    const { error } = await supabase.from('message_templates').insert({
      clinic_id: clinicId,
      title,
      body,
      key,
      sort_order: nextOrder,
      kind: 'salesbot',
      is_active: true,
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Salesbot</h1>
        <p className="text-sm text-gray-500 mt-1">
          Заготовленные тексты, которые рассылает бот из триггеров воронки и системных
          событий (приветствие, напоминание о неответе). Привязка к триггеру делается
          в редакторе воронки —{' '}
          <Link href="/settings/pipelines" className="text-blue-600 hover:underline">
            Настройки → CRM воронки
          </Link>
          . Шаблоны для ручной отправки оператором живут в разделе{' '}
          <Link href="/settings/message-templates" className="text-blue-600 hover:underline">
            «Шаблоны ответов»
          </Link>.
        </p>
      </div>

      {/* Новый бот */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Создать нового бота</h2>
        <input
          type="text"
          value={draft.title}
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
          placeholder="Название (например: Приветствие новой заявки)"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none"
        />
        <textarea
          value={draft.body}
          onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
          placeholder="Текст, который отправит бот клиенту."
          rows={4}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
        />
        <button
          type="button"
          onClick={create}
          disabled={saving}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Сохраняем…' : 'Добавить бота'}
        </button>
      </div>

      {/* Список */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">
          Список Salesbot
        </div>
        {loading ? (
          <div className="p-5 text-sm text-gray-500">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">Пока нет ботов. Создайте первого выше.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r, idx) => {
              const isSystem = !!r.key && SYSTEM_KEYS.has(r.key)
              const used = (r.key && usage[r.key]) || []
              return (
                <li key={r.id} className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={r.title}
                      onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, title: e.target.value } : x))}
                      onBlur={e => update(r.id, { title: e.target.value.trim() })}
                      className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 outline-none py-1"
                    />
                    {isSystem && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-50 border border-amber-200 text-amber-700 uppercase tracking-wide">
                        системный
                      </span>
                    )}
                    {r.key && (
                      <code className="text-[11px] text-gray-400 font-mono">{r.key}</code>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        onChange={e => update(r.id, { is_active: e.target.checked })}
                      />
                      активен
                    </label>
                    <button
                      type="button"
                      onClick={() => move(r.id, -1)}
                      disabled={idx === 0}
                      className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded disabled:opacity-30"
                      title="Выше"
                    >↑</button>
                    <button
                      type="button"
                      onClick={() => move(r.id, 1)}
                      disabled={idx === rows.length - 1}
                      className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded disabled:opacity-30"
                      title="Ниже"
                    >↓</button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={isSystem}
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      title={isSystem ? 'Нельзя удалить системного бота' : 'Удалить'}
                    >Удалить</button>
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
