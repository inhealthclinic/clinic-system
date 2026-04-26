'use client'

/**
 * Настройки CRM-воронок — единый канвас в стиле amoCRM.
 * - Слева: источники сделок и причины потери (компактный сайдбар).
 * - Справа: канвас воронки — этапы колонками, автоматизации карточками
 *   внутри столбцов. Редактор стадии и триггеры в одном месте.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import PipelineCanvas, {
  type Pipeline, type Stage,
} from '@/components/automation/PipelineCanvas'

interface LossReason {
  id: string; clinic_id: string; pipeline_id: string | null
  name: string; is_active: boolean; sort_order: number
}
interface LeadSource {
  id: string; clinic_id: string; name: string; is_active: boolean; sort_order: number
}

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

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

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
    () => stages.filter(s => s.pipeline_id === activePipelineId),
    [stages, activePipelineId]
  )
  const activePipeline = pipelines.find(p => p.id === activePipelineId) ?? null

  // ── pipeline CRUD ──────────────────────────────────────────────────────────
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

  // ── stage CRUD ─────────────────────────────────────────────────────────────
  async function addStage() {
    if (!activePipeline) return
    const name = prompt('Название этапа')?.trim()
    if (!name) return
    const code = (prompt('Код (латиницей)', name.toLowerCase().replace(/[^a-z0-9]+/g,'_')) ?? '').trim()
    if (!code) return
    const next = ((activeStages.at(-1)?.sort_order ?? 0) + 10)
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
    const sorted = [...activeStages].sort((a,b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(x => x.id === s.id)
    const other = sorted[idx + dir]
    if (!other) return
    const { error } = await supabase.from('pipeline_stages').upsert([
      { ...s,     sort_order: other.sort_order },
      { ...other, sort_order: s.sort_order     },
    ])
    if (error) { alert(error.message); return }
    load()
  }

  // ── reasons / sources CRUD ─────────────────────────────────────────────────
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
    <div className="p-4 max-w-[1600px] mx-auto space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Воронки CRM</h1>
          <p className="text-xs text-gray-500">
            Настройка воронок, этапов и автоматизаций — на одном холсте, как в amoCRM.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={[
              'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors',
              saveState === 'saving' ? 'bg-blue-50 border-blue-100 text-blue-700'
                : saveState === 'saved' ? 'bg-green-50 border-green-100 text-green-700'
                : saveState === 'error' ? 'bg-red-50 border-red-100 text-red-700'
                : 'bg-gray-50 border-gray-100 text-gray-500',
            ].join(' ')}
          >
            {saveState === 'saving' ? 'Сохраняем…'
             : saveState === 'saved' ? 'Сохранено'
             : saveState === 'error' ? 'Ошибка'
             : 'Автосохранение этапов'}
          </span>
          <Link href="/crm" className="text-sm text-blue-600 hover:underline">← К канбану</Link>
        </div>
      </div>

      {/* Pipeline tabs */}
      <div className="bg-white border border-gray-200 rounded-lg p-2">
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
            >
              {p.name}
              {p.is_system && <span className="ml-1 text-xs opacity-70">· sys</span>}
              {!p.is_active && <span className="ml-1 text-xs opacity-70">· off</span>}
            </button>
          ))}
          <button onClick={addPipeline}
            className="px-3 py-1.5 rounded-md text-sm border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
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

      {/* Main grid: aside + canvas */}
      <div className="flex gap-4 items-start">
        {/* Left aside — sources + loss reasons (как в amoCRM) */}
        <aside className="w-56 shrink-0 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Источники сделок
            </div>
            <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {sources.map(s => (
                <li key={s.id} className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className={s.is_active ? 'truncate' : 'text-gray-400 line-through truncate'}>{s.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleSource(s)} className="text-gray-400 hover:text-gray-700" title={s.is_active ? 'Выключить' : 'Включить'}>
                      {s.is_active ? '⏼' : '⎘'}
                    </button>
                    <button onClick={() => deleteSource(s)} className="text-red-400 hover:text-red-600" title="Удалить">×</button>
                  </div>
                </li>
              ))}
              {sources.length === 0 && <li className="px-3 py-3 text-center text-gray-400 text-xs">Нет источников</li>}
            </ul>
            <button onClick={addSource}
              className="w-full px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-100">+ Добавить</button>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Причины потери
            </div>
            <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {reasons.map(r => (
                <li key={r.id} className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className={r.is_active ? 'truncate' : 'text-gray-400 line-through truncate'}>{r.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleReason(r)} className="text-gray-400 hover:text-gray-700" title={r.is_active ? 'Выключить' : 'Включить'}>
                      {r.is_active ? '⏼' : '⎘'}
                    </button>
                    <button onClick={() => deleteReason(r)} className="text-red-400 hover:text-red-600" title="Удалить">×</button>
                  </div>
                </li>
              ))}
              {reasons.length === 0 && <li className="px-3 py-3 text-center text-gray-400 text-xs">Нет причин</li>}
            </ul>
            <button onClick={addReason}
              className="w-full px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-100">+ Добавить</button>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          {activePipeline ? (
            <PipelineCanvas
              pipeline={activePipeline}
              stages={activeStages}
              onAddStage={addStage}
              onUpdateStage={updateStage}
              onDeleteStage={deleteStage}
              onMoveStage={moveStage}
            />
          ) : (
            <div className="text-sm text-gray-400 italic p-6">Выберите воронку</div>
          )}
        </div>
      </div>
    </div>
  )
}
