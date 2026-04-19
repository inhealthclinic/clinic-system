'use client'

/**
 * Модалка настройки полей карточки сделки.
 * Управляет таблицей deal_field_configs:
 *   • видимость / порядок встроенных и кастомных полей
 *   • глобальная обязательность
 *   • обязательность на конкретных этапах воронки
 *   • блокировка перехода в следующий этап при пустом поле
 *   • добавление / удаление кастомных полей
 *
 * Кастомные значения пишутся в deals.custom_fields[field_key].
 */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_FIELD_CONFIGS,
  BUILTIN_FIELD_KEYS,
  type DealFieldConfig,
  type DealFieldType,
  type DealFieldOption,
  fieldDisplayLabel,
  mergeWithDefaults,
  makeCustomKey,
  CUSTOM_PREFIX,
} from '@/lib/dealFields'

interface StageLite {
  id: string
  name: string
  pipeline_id: string
}

interface PipelineLite {
  id: string
  name: string
}

const FIELD_TYPE_LABELS: Record<DealFieldType, string> = {
  text:     'Текст',
  number:   'Число',
  date:     'Дата',
  select:   'Список',
  phone:    'Телефон',
  textarea: 'Многострочный текст',
}

export function DealFieldsSettingsModal({
  clinicId,
  pipelines,
  stages,
  onClose,
  onSaved,
}: {
  clinicId: string
  pipelines: PipelineLite[]
  stages: StageLite[]
  onClose: () => void
  onSaved: (configs: DealFieldConfig[]) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [configs, setConfigs] = useState<DealFieldConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // ids of configs to delete on save (only custom)
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    setLoading(true)
    supabase
      .from('deal_field_configs')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('sort_order')
      .then(({ data }) => {
        if (!alive) return
        setConfigs(mergeWithDefaults((data ?? []) as DealFieldConfig[]))
        setLoading(false)
      })
    return () => { alive = false }
  }, [clinicId, supabase])

  function update(idx: number, patch: Partial<DealFieldConfig>) {
    setConfigs(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }

  function move(idx: number, dir: -1 | 1) {
    setConfigs(prev => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      // Перенумеруем sort_order, чтобы порядок гарантированно сохранился.
      return next.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 }))
    })
  }

  function addCustom(payload: {
    label: string
    field_type: DealFieldType
    options: DealFieldOption[]
  }) {
    const key = makeCustomKey(payload.label)
    if (configs.some(c => c.field_key === key)) {
      alert('Поле с таким ключом уже существует. Измените название.')
      return
    }
    const sort = (configs[configs.length - 1]?.sort_order ?? 0) + 10
    const cfg: DealFieldConfig = {
      clinic_id: clinicId,
      field_key: key,
      label: payload.label.trim(),
      sort_order: sort,
      is_visible: true,
      is_required: false,
      is_builtin: false,
      field_type: payload.field_type,
      options: payload.field_type === 'select' ? payload.options : [],
      required_in_stages: [],
      block_stage_progress: false,
    }
    setConfigs(prev => [...prev, cfg])
    setShowAdd(false)
  }

  function deleteRow(idx: number) {
    const c = configs[idx]
    if (c.is_builtin) return
    if (!confirm(`Удалить поле «${fieldDisplayLabel(c)}»? Уже сохранённые значения в сделках останутся в БД.`)) return
    if (c.id) setPendingDelete(prev => new Set(prev).add(c.id!))
    setConfigs(prev => prev.filter((_, i) => i !== idx))
  }

  async function save() {
    setSaving(true)
    try {
      // 1. Удалить помеченные кастомные конфиги
      if (pendingDelete.size > 0) {
        const ids = Array.from(pendingDelete)
        const { error: delErr } = await supabase
          .from('deal_field_configs')
          .delete()
          .in('id', ids)
        if (delErr) { alert('Не удалось удалить поля: ' + delErr.message); setSaving(false); return }
      }

      // 2. Upsert текущих конфигов по (clinic_id, field_key)
      const payload = configs.map(c => ({
        // id опускаем — пусть БД сама решит (при upsert по составному ключу
        // лишний id может привести к дублям; ON CONFLICT обновит существующий).
        clinic_id: clinicId,
        field_key: c.field_key,
        label: c.label,
        sort_order: c.sort_order,
        is_visible: c.is_visible,
        is_required: c.is_required,
        is_builtin: c.is_builtin,
        field_type: c.field_type,
        options: c.options,
        required_in_stages: c.required_in_stages,
        block_stage_progress: c.block_stage_progress,
      }))

      const { data, error } = await supabase
        .from('deal_field_configs')
        .upsert(payload, { onConflict: 'clinic_id,field_key' })
        .select('*')

      if (error) { alert('Ошибка сохранения: ' + error.message); setSaving(false); return }

      const merged = mergeWithDefaults((data ?? []) as DealFieldConfig[])
      onSaved(merged)
    } finally {
      setSaving(false)
    }
  }

  function resetToDefaults() {
    if (!confirm('Сбросить настройки видимости / обязательности встроенных полей? Кастомные поля сохранятся.')) return
    setConfigs(prev => {
      const customs = prev.filter(c => !c.is_builtin)
      // Defaults + сохранённые кастомные (в их прежнем относительном порядке).
      const defaults = DEFAULT_FIELD_CONFIGS.map(c => ({ ...c }))
      const sortedCustoms = customs.map((c, i) => ({
        ...c,
        sort_order: (defaults.length + i + 1) * 10,
      }))
      return [...defaults, ...sortedCustoms]
    })
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Настройки полей сделки</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-sm text-gray-500">Загрузка…</div>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-4">
                Управляйте видимостью, порядком и обязательностью полей в левой колонке карточки сделки.
                Можно добавить кастомные поля и пометить, на каких этапах воронки они должны быть заполнены.
              </p>

              <div className="space-y-2">
                {configs.map((c, idx) => (
                  <FieldRow
                    key={c.field_key}
                    config={c}
                    pipelines={pipelines}
                    stages={stages}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < configs.length - 1}
                    onChange={(patch) => update(idx, patch)}
                    onMoveUp={() => move(idx, -1)}
                    onMoveDown={() => move(idx, +1)}
                    onDelete={() => deleteRow(idx)}
                  />
                ))}
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => setShowAdd(true)}
                  className="text-sm px-3 py-1.5 rounded-md border border-dashed border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  + Добавить поле
                </button>
                <button
                  onClick={resetToDefaults}
                  className="text-sm px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800"
                >
                  Сбросить встроенные
                </button>
              </div>

              {showAdd && (
                <AddCustomFieldForm
                  onCancel={() => setShowAdd(false)}
                  onAdd={addCustom}
                />
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-md"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── FieldRow ────────────────────────────────────────────────────────────────

function FieldRow({
  config, pipelines, stages,
  canMoveUp, canMoveDown,
  onChange, onMoveUp, onMoveDown, onDelete,
}: {
  config: DealFieldConfig
  pipelines: PipelineLite[]
  stages: StageLite[]
  canMoveUp: boolean
  canMoveDown: boolean
  onChange: (patch: Partial<DealFieldConfig>) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const stagesByPipeline = useMemo(() => {
    const m = new Map<string, StageLite[]>()
    for (const s of stages) {
      const arr = m.get(s.pipeline_id) ?? []
      arr.push(s)
      m.set(s.pipeline_id, arr)
    }
    return m
  }, [stages])

  function toggleStage(stageId: string) {
    const set = new Set(config.required_in_stages)
    if (set.has(stageId)) set.delete(stageId)
    else set.add(stageId)
    onChange({ required_in_stages: Array.from(set) })
  }

  return (
    <div className={`border rounded-md ${config.is_visible ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none"
            title="Выше"
            aria-label="Переместить выше"
          >▲</button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none mt-0.5"
            title="Ниже"
            aria-label="Переместить ниже"
          >▼</button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {fieldDisplayLabel(config)}
            </span>
            <span className="text-[10px] text-gray-400 uppercase">
              {config.is_builtin ? 'встроенное' : FIELD_TYPE_LABELS[config.field_type]}
            </span>
          </div>
          <div className="text-[11px] text-gray-400 truncate font-mono">{config.field_key}</div>
        </div>

        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={config.is_visible}
            onChange={e => onChange({ is_visible: e.target.checked })}
          />
          Видно
        </label>

        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={config.is_required}
            onChange={e => onChange({ is_required: e.target.checked })}
          />
          Обяз.
        </label>

        <label className="flex items-center gap-1 text-xs text-gray-700" title="Блокировать переход в следующий этап, если поле пустое">
          <input
            type="checkbox"
            checked={config.block_stage_progress}
            onChange={e => onChange({ block_stage_progress: e.target.checked })}
          />
          Блок-переход
        </label>

        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-blue-600 hover:underline px-2"
        >
          {expanded ? 'Свернуть' : 'Подробнее'}
        </button>

        {!config.is_builtin && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-500 hover:text-red-700 px-1"
            title="Удалить поле"
            aria-label="Удалить поле"
          >🗑</button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-100 space-y-3 text-xs">
          {!config.is_builtin && (
            <div>
              <label className="block text-gray-500 mb-1">Лейбл</label>
              <input
                type="text"
                value={config.label ?? ''}
                onChange={e => onChange({ label: e.target.value })}
                className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
              />
            </div>
          )}

          {!config.is_builtin && config.field_type === 'select' && (
            <SelectOptionsEditor
              options={config.options}
              onChange={(options) => onChange({ options })}
            />
          )}

          <div>
            <div className="text-gray-500 mb-1">Обязательно на этапах:</div>
            {pipelines.length === 0 ? (
              <div className="text-gray-400">Воронок нет</div>
            ) : (
              <div className="space-y-2">
                {pipelines.map(p => {
                  const ps = stagesByPipeline.get(p.id) ?? []
                  if (ps.length === 0) return null
                  return (
                    <div key={p.id}>
                      <div className="text-[11px] text-gray-500 mb-1">{p.name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {ps.map(s => {
                          const checked = config.required_in_stages.includes(s.id)
                          return (
                            <button
                              type="button"
                              key={s.id}
                              onClick={() => toggleStage(s.id)}
                              className={`px-2 py-0.5 rounded border text-[11px] ${
                                checked
                                  ? 'bg-red-50 border-red-300 text-red-700'
                                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {checked && '★ '}{s.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-gray-400 mt-2">
              Если включено «Блок-переход» — нельзя будет передвинуть сделку на этап с пустым обязательным полем.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SelectOptionsEditor ─────────────────────────────────────────────────────

function SelectOptionsEditor({
  options, onChange,
}: {
  options: DealFieldOption[]
  onChange: (next: DealFieldOption[]) => void
}) {
  const [draft, setDraft] = useState('')
  function add() {
    const v = draft.trim()
    if (!v) return
    if (options.some(o => o.label === v)) { setDraft(''); return }
    const value = v.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `opt_${options.length + 1}`
    onChange([...options, { value, label: v }])
    setDraft('')
  }
  return (
    <div>
      <div className="text-gray-500 mb-1">Варианты выбора</div>
      <div className="flex flex-wrap gap-1 mb-2">
        {options.map((o, i) => (
          <span key={`${o.value}-${i}`} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[11px]">
            {o.label}
            <button
              type="button"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="hover:text-red-600"
              aria-label="Удалить вариант"
            >×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Новый вариант…"
          className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={add}
          className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50"
        >Добавить</button>
      </div>
    </div>
  )
}

// ─── AddCustomFieldForm ──────────────────────────────────────────────────────

function AddCustomFieldForm({
  onCancel, onAdd,
}: {
  onCancel: () => void
  onAdd: (payload: { label: string; field_type: DealFieldType; options: DealFieldOption[] }) => void
}) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<DealFieldType>('text')
  const [options, setOptions] = useState<DealFieldOption[]>([])

  function submit() {
    const v = label.trim()
    if (!v) { alert('Укажите название поля'); return }
    if (type === 'select' && options.length === 0) {
      alert('Добавьте хотя бы один вариант'); return
    }
    // Игнорируем пересечение с встроенными — они под ключами без префикса.
    if ((BUILTIN_FIELD_KEYS as readonly string[]).includes(makeCustomKey(v).slice(CUSTOM_PREFIX.length))) {
      // безопасно — у кастомных всегда префикс
    }
    onAdd({ label: v, field_type: type, options })
  }

  return (
    <div className="mt-4 border border-blue-200 bg-blue-50/40 rounded-md p-4 space-y-3">
      <div className="text-sm font-medium text-gray-900">Новое поле</div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Название</label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
          placeholder="Например, «Промокод»"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Тип</label>
        <select
          value={type}
          onChange={e => setType(e.target.value as DealFieldType)}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-white"
        >
          {(Object.keys(FIELD_TYPE_LABELS) as DealFieldType[]).map(t => (
            <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      {type === 'select' && (
        <SelectOptionsEditor options={options} onChange={setOptions} />
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
        >Отмена</button>
        <button
          type="button"
          onClick={submit}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
        >Добавить</button>
      </div>
    </div>
  )
}
