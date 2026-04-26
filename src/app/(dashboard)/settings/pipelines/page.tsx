'use client'

/**
 * Настройки CRM-воронок. Всё хранится в БД (pipelines, pipeline_stages,
 * deal_loss_reasons, lead_sources). Переводить сделки с localStorage нельзя.
 *
 * Возможности:
 *  • выбрать воронку → добавить/переименовать, переключить активность
 *  • стадии: добавить, переименовать, цвет, роль (normal/won/lost/closed),
 *    порядок (стрелки ↑↓), KPI-флаг, активность, удалить (если разрешено).
 *  • системные стадии блокируются от удаления; от переименования —
 *    опционально через is_editable.
 *  • справочники причин потери и источников — CRUD.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import AutomationKanban from '@/components/automation/AutomationKanban'

// ─── types ────────────────────────────────────────────────────────────────────

interface Pipeline {
  id: string
  clinic_id: string
  code: string
  name: string
  is_system: boolean
  is_active: boolean
  sort_order: number
}

interface Stage {
  id: string
  pipeline_id: string
  code: string
  name: string
  color: string
  sort_order: number
  is_active: boolean
  stage_role: 'normal' | 'won' | 'lost' | 'closed'
  is_system: boolean
  is_editable: boolean
  is_deletable: boolean
  counts_in_kpi: boolean
}

interface LossReason {
  id: string
  clinic_id: string
  pipeline_id: string | null
  name: string
  is_active: boolean
  sort_order: number
}

interface LeadSource {
  id: string
  clinic_id: string
  name: string
  is_active: boolean
  sort_order: number
}

const ROLE_LABEL: Record<Stage['stage_role'], string> = {
  normal: 'Обычный',
  won:    'Успех',
  lost:   'Потеря',
  closed: 'Закрыт',
}
const ROLE_BADGE: Record<Stage['stage_role'], string> = {
  normal: 'bg-gray-100 text-gray-700',
  won:    'bg-green-100 text-green-700',
  lost:   'bg-red-100 text-red-700',
  closed: 'bg-slate-200 text-slate-700',
}

const PRESET_COLORS = [
  '#94a3b8','#64748b','#3b82f6','#06b6d4','#14b8a6','#10b981','#16a34a','#84cc16',
  '#f59e0b','#f97316','#ef4444','#dc2626','#a855f7','#8b5cf6','#6366f1','#ec4899',
]

// ─── page ────────────────────────────────────────────────────────────────────

export default function PipelinesSettingsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [reasons, setReasons] = useState<LossReason[]>([])
  const [sources, setSources] = useState<LeadSource[]>([])
  const [loading, setLoading] = useState(true)
  const [activePipelineId, setActivePipelineId] = useState<string>('')

  // Tab — как в amoCRM: «Этапы» / «Автоматизации» / «Справочники».
  // Иначе автоматизации прячутся внизу длинной таблицы и пользователь их
  // просто не находит.
  type Tab = 'stages' | 'automation' | 'dicts'
  const [tab, setTab] = useState<Tab>('stages')

  // Локальные черновики полей ввода — чтобы на каждую клавишу не дёргать БД
  // и чтобы корректно работало сохранение на blur (иначе guard
  // `e.target.value !== s.name` всегда ложный — обновление не уходит).
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})

  // Статус автосохранения — видимая индикация, что настройки уходят в БД.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Supabase возвращает PostgrestBuilder — PromiseLike, не Promise (нет .catch/.finally).
  // Поэтому принимаем PromiseLike и await приводит к результату корректно.
  async function runSave(op: () => PromiseLike<{ error: { message: string } | null }>): Promise<boolean> {
    setSaveState('saving')
    const { error } = await op()
    if (error) {
      setSaveState('error')
      alert(error.message)
      setTimeout(() => setSaveState(s => s === 'error' ? 'idle' : s), 2500)
      return false
    }
    setSaveState('saved')
    setTimeout(() => setSaveState(s => s === 'saved' ? 'idle' : s), 1200)
    return true
  }

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const [p, s, r, l] = await Promise.all([
      supabase.from('pipelines').select('*').eq('clinic_id', clinicId).order('sort_order'),
      supabase.from('pipeline_stages').select('*')
        .in('pipeline_id', (
          await supabase.from('pipelines').select('id').eq('clinic_id', clinicId)
        ).data?.map(x => x.id) ?? [])
        .order('sort_order'),
      supabase.from('deal_loss_reasons').select('*').eq('clinic_id', clinicId).order('sort_order'),
      supabase.from('lead_sources').select('*').eq('clinic_id', clinicId).order('sort_order'),
    ])
    const ps = (p.data ?? []) as Pipeline[]
    setPipelines(ps)
    setStages((s.data ?? []) as Stage[])
    setReasons((r.data ?? []) as LossReason[])
    setSources((l.data ?? []) as LeadSource[])
    if (!activePipelineId && ps.length > 0) setActivePipelineId(ps[0].id)
    setLoading(false)
  }, [clinicId, supabase, activePipelineId])

  useEffect(() => { load() }, [load])

  const activeStages = useMemo(
    () => stages.filter(s => s.pipeline_id === activePipelineId).sort((a,b) => a.sort_order - b.sort_order),
    [stages, activePipelineId]
  )
  const activePipeline = pipelines.find(p => p.id === activePipelineId) ?? null

  // ── mutations ──────────────────────────────────────────────────────────────

  async function addPipeline() {
    if (!clinicId) return
    const name = prompt('Название воронки')?.trim()
    if (!name) return
    const code = prompt('Код (латиницей, без пробелов)', name.toLowerCase().replace(/[^a-z0-9]+/g,'_'))?.trim()
    if (!code) return
    const { data, error } = await supabase.from('pipelines').insert({
      clinic_id: clinicId, code, name, sort_order: (pipelines.at(-1)?.sort_order ?? 0) + 10,
    }).select().single()
    if (error) { alert(error.message); return }
    setActivePipelineId(data.id)
    load()
  }

  async function renamePipeline(p: Pipeline) {
    const name = prompt('Новое название', p.name)?.trim()
    if (!name || name === p.name) return
    if (await runSave(() => supabase.from('pipelines').update({ name }).eq('id', p.id))) load()
  }

  async function togglePipelineActive(p: Pipeline) {
    if (await runSave(() => supabase.from('pipelines').update({ is_active: !p.is_active }).eq('id', p.id))) load()
  }

  async function addStage() {
    if (!activePipeline) return
    const name = prompt('Название этапа')?.trim()
    if (!name) return
    const code = (prompt('Код (латиницей)', name.toLowerCase().replace(/[^a-z0-9]+/g,'_')) ?? '').trim()
    if (!code) return
    const next = (activeStages.at(-1)?.sort_order ?? 0) + 10
    const { error } = await supabase.from('pipeline_stages').insert({
      pipeline_id: activePipeline.id, name, code, color: '#94a3b8', sort_order: next,
    })
    if (error) { alert(error.message); return }
    load()
  }

  async function updateStage(id: string, patch: Partial<Stage>) {
    if (await runSave(() => supabase.from('pipeline_stages').update(patch).eq('id', id))) load()
  }

  async function deleteStage(s: Stage) {
    if (!confirm(`Удалить этап «${s.name}»?`)) return
    if (await runSave(() => supabase.from('pipeline_stages').delete().eq('id', s.id))) load()
  }

  async function moveStage(s: Stage, dir: -1 | 1) {
    const sorted = activeStages
    const idx = sorted.findIndex(x => x.id === s.id)
    const other = sorted[idx + dir]
    if (!other) return
    // swap sort_order
    const { error } = await supabase.from('pipeline_stages').upsert([
      { id: s.id,     sort_order: other.sort_order, pipeline_id: s.pipeline_id,     name: s.name,     code: s.code,     color: s.color,     stage_role: s.stage_role,     is_active: s.is_active,     is_editable: s.is_editable,     is_system: s.is_system,     is_deletable: s.is_deletable,     counts_in_kpi: s.counts_in_kpi },
      { id: other.id, sort_order: s.sort_order,     pipeline_id: other.pipeline_id, name: other.name, code: other.code, color: other.color, stage_role: other.stage_role, is_active: other.is_active, is_editable: other.is_editable, is_system: other.is_system, is_deletable: other.is_deletable, counts_in_kpi: other.counts_in_kpi },
    ])
    if (error) { alert(error.message); return }
    load()
  }

  // Loss reasons
  async function addReason() {
    if (!clinicId) return
    const name = prompt('Причина потери')?.trim()
    if (!name) return
    const { error } = await supabase.from('deal_loss_reasons').insert({
      clinic_id: clinicId, name, sort_order: (reasons.at(-1)?.sort_order ?? 0) + 10,
    })
    if (error) { alert(error.message); return }
    load()
  }
  async function toggleReason(r: LossReason) {
    if (await runSave(() => supabase.from('deal_loss_reasons').update({ is_active: !r.is_active }).eq('id', r.id))) load()
  }
  async function deleteReason(r: LossReason) {
    if (!confirm(`Удалить причину «${r.name}»?`)) return
    if (await runSave(() => supabase.from('deal_loss_reasons').delete().eq('id', r.id))) load()
  }

  // Sources
  async function addSource() {
    if (!clinicId) return
    const name = prompt('Источник')?.trim()
    if (!name) return
    const { error } = await supabase.from('lead_sources').insert({
      clinic_id: clinicId, name, sort_order: (sources.at(-1)?.sort_order ?? 0) + 10,
    })
    if (error) { alert(error.message); return }
    load()
  }
  async function toggleSource(s: LeadSource) {
    if (await runSave(() => supabase.from('lead_sources').update({ is_active: !s.is_active }).eq('id', s.id))) load()
  }
  async function deleteSource(s: LeadSource) {
    if (!confirm(`Удалить «${s.name}»?`)) return
    if (await runSave(() => supabase.from('lead_sources').delete().eq('id', s.id))) load()
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Воронки CRM</h1>
          <p className="text-sm text-gray-500">
            Изменения сохраняются автоматически и сразу применяются ко всем менеджерам клиники.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Индикатор автосохранения — заменяет привычную кнопку «Сохранить» */}
          <span
            className={[
              'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors',
              saveState === 'saving' ? 'bg-blue-50 border-blue-100 text-blue-700'
                : saveState === 'saved' ? 'bg-green-50 border-green-100 text-green-700'
                : saveState === 'error' ? 'bg-red-50 border-red-100 text-red-700'
                : 'bg-gray-50 border-gray-100 text-gray-500',
            ].join(' ')}
            aria-live="polite"
          >
            {saveState === 'saving' && (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" className="animate-spin" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Сохраняем…
              </>
            )}
            {saveState === 'saved' && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Сохранено
              </>
            )}
            {saveState === 'error' && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 8v5M12 17h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                </svg>
                Ошибка сохранения
              </>
            )}
            {saveState === 'idle' && (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                Автосохранение
              </>
            )}
          </span>
          <Link href="/crm" className="text-sm text-blue-600 hover:underline">← К канбану</Link>
        </div>
      </div>

      {/* Pipelines tabs */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 flex-wrap">
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => setActivePipelineId(p.id)}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                activePipelineId === p.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
              title={p.is_active ? '' : 'Воронка отключена'}
            >
              {p.name}
              {p.is_system && <span className="ml-1 text-xs opacity-70">· sys</span>}
              {!p.is_active && <span className="ml-1 text-xs opacity-70">· off</span>}
            </button>
          ))}
          <button
            onClick={addPipeline}
            className="px-3 py-1.5 rounded-md text-sm border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50"
          >
            + Воронка
          </button>
          {activePipeline && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => renamePipeline(activePipeline)}
                className="text-xs text-gray-600 hover:text-gray-900">Переименовать</button>
              <button onClick={() => togglePipelineActive(activePipeline)}
                className="text-xs text-gray-600 hover:text-gray-900">
                {activePipeline.is_active ? 'Выключить' : 'Включить'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs — Этапы / Автоматизации / Справочники */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {[
          { id: 'stages',     label: 'Этапы воронки' },
          { id: 'automation', label: '🤖 Автоматизации' },
          { id: 'dicts',      label: 'Причины потери и источники' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={[
              'px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-blue-600 text-blue-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Stages */}
      {tab === 'stages' && activePipeline && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="font-medium text-gray-900">Этапы «{activePipeline.name}»</div>
            <button onClick={addStage}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md">
              + Этап
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left w-12"></th>
                <th className="px-3 py-2 text-left">Название</th>
                <th className="px-3 py-2 text-left">Код</th>
                <th className="px-3 py-2 text-left">Цвет</th>
                <th className="px-3 py-2 text-left">Роль</th>
                <th className="px-3 py-2 text-center">KPI</th>
                <th className="px-3 py-2 text-center">Активен</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {activeStages.map((s, i) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-400">
                    <div className="flex flex-col">
                      <button onClick={() => moveStage(s, -1)} disabled={i === 0}
                        className="text-xs px-1 hover:text-gray-800 disabled:opacity-20">↑</button>
                      <button onClick={() => moveStage(s, 1)} disabled={i === activeStages.length - 1}
                        className="text-xs px-1 hover:text-gray-800 disabled:opacity-20">↓</button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={nameDrafts[s.id] ?? s.name}
                      disabled={!s.is_editable}
                      onChange={e => setNameDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                      onBlur={e => {
                        const v = e.target.value.trim()
                        setNameDrafts(d => {
                          if (!(s.id in d)) return d
                          const n = { ...d }; delete n[s.id]; return n
                        })
                        if (v && v !== s.name) updateStage(s.id, { name: v })
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') {
                          setNameDrafts(d => {
                            if (!(s.id in d)) return d
                            const n = { ...d }; delete n[s.id]; return n
                          })
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-500 outline-none"
                    />
                    {s.is_system && <div className="text-[10px] text-gray-400 mt-0.5">системный</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{s.code}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => updateStage(s.id, { color: c })}
                          className={`w-4 h-4 rounded ${s.color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                          style={{ background: c }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.stage_role}
                      disabled={s.is_system}
                      onChange={e => updateStage(s.id, { stage_role: e.target.value as Stage['stage_role'] })}
                      className={`text-xs px-2 py-1 rounded ${ROLE_BADGE[s.stage_role]} border-0 disabled:opacity-60`}
                    >
                      {(['normal','won','lost','closed'] as const).map(r => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={s.counts_in_kpi}
                      onChange={e => updateStage(s.id, { counts_in_kpi: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={s.is_active}
                      onChange={e => updateStage(s.id, { is_active: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteStage(s)}
                      disabled={!s.is_deletable || s.is_system}
                      className="text-xs text-red-600 hover:text-red-700 disabled:text-gray-300"
                      title={s.is_system ? 'Системный этап — нельзя удалить' : 'Удалить'}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {activeStages.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">Нет этапов</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Loss reasons */}
      {tab === 'dicts' && (
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="font-medium text-gray-900">Причины потери</div>
          <button onClick={addReason}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md">+ Причина</button>
        </div>
        <ul className="divide-y divide-gray-100">
          {reasons.map(r => (
            <li key={r.id} className="px-4 py-2 flex items-center justify-between text-sm">
              <div className={r.is_active ? '' : 'text-gray-400 line-through'}>{r.name}</div>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleReason(r)} className="text-xs text-gray-500 hover:text-gray-800">
                  {r.is_active ? 'Выключить' : 'Включить'}
                </button>
                <button onClick={() => deleteReason(r)} className="text-xs text-red-600 hover:text-red-700">Удалить</button>
              </div>
            </li>
          ))}
          {reasons.length === 0 && <li className="px-4 py-6 text-center text-gray-400 text-sm">Нет причин</li>}
        </ul>
      </div>
      )}

      {/* Sources */}
      {tab === 'dicts' && (
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="font-medium text-gray-900">Источники лидов</div>
          <button onClick={addSource}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md">+ Источник</button>
        </div>
        <ul className="divide-y divide-gray-100">
          {sources.map(s => (
            <li key={s.id} className="px-4 py-2 flex items-center justify-between text-sm">
              <div className={s.is_active ? '' : 'text-gray-400 line-through'}>{s.name}</div>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleSource(s)} className="text-xs text-gray-500 hover:text-gray-800">
                  {s.is_active ? 'Выключить' : 'Включить'}
                </button>
                <button onClick={() => deleteSource(s)} className="text-xs text-red-600 hover:text-red-700">Удалить</button>
              </div>
            </li>
          ))}
          {sources.length === 0 && <li className="px-4 py-6 text-center text-gray-400 text-sm">Нет источников</li>}
        </ul>
      </div>
      )}

      {/* ─── Автоматизации ─────────────────────────────────────────────────
          Та же панель, что и на /settings/automation. Под отдельной
          вкладкой — чтобы её было видно, а не пряталось внизу страницы. */}
      {tab === 'automation' && (
        <div id="automation" className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="font-medium text-gray-900">Автоматизации этапов</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Бот, касания и автозадачи — как в amoCRM Salesbot. Текст с маркером
              «[ЗАПОЛНИТЬ&nbsp;…]» клиентам не отправляется.
            </div>
          </div>
          <div className="p-3">
            <AutomationKanban />
          </div>
        </div>
      )}
    </div>
  )
}
