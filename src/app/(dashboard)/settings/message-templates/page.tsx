'use client'

/**
 * Настройки шаблонов сообщений для CRM.
 * Используются в карточке сделки через кнопку «Шаблоны» в композере.
 *
 * CRUD поверх таблицы message_templates (миграция 042).
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface MessageTemplate {
  id: string
  clinic_id: string
  title: string
  body: string
  is_favorite: boolean
  sort_order: number
  is_active: boolean
}

export default function MessageTemplatesSettingsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? null

  const [rows, setRows] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' })

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('kind', 'quick_reply')
      .order('sort_order')
      .order('created_at')
    if (!error) setRows((data ?? []) as MessageTemplate[])
    setLoading(false)
  }, [supabase, clinicId])

  useEffect(() => { load() }, [load])

  async function create() {
    if (!clinicId) return
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) { alert('Укажите название и текст шаблона'); return }
    setSaving(true)
    const nextOrder = rows.length === 0 ? 0 : Math.max(...rows.map(r => r.sort_order)) + 1
    const { error } = await supabase.from('message_templates').insert({
      clinic_id: clinicId,
      title,
      body,
      sort_order: nextOrder,
      kind: 'quick_reply',
    })
    setSaving(false)
    if (error) { alert('Не удалось создать: ' + error.message); return }
    setDraft({ title: '', body: '' })
    load()
  }

  async function update(id: string, patch: Partial<MessageTemplate>) {
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Шаблоны ответов</h1>
        <p className="text-sm text-gray-500 mt-1">
          Заранее заготовленные тексты для ручной отправки оператором — кнопка «Шаблоны»
          в композере чата сделки. Отмеченные звёздочкой попадают в секцию «Избранные».
          Тексты для Salesbot настраиваются отдельно в разделе «Salesbot».
        </p>
      </div>

      {/* New template form */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Новый шаблон</h2>
        <input
          type="text"
          value={draft.title}
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
        <button
          type="button"
          onClick={create}
          disabled={saving}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Сохраняем…' : 'Добавить шаблон'}
        </button>
      </div>

      {/* Existing list */}
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
                  <button
                    type="button"
                    onClick={() => update(r.id, { is_favorite: !r.is_favorite })}
                    title={r.is_favorite ? 'Убрать из избранного' : 'В избранное'}
                    className={`text-lg leading-none ${r.is_favorite ? 'text-amber-500' : 'text-gray-300 hover:text-gray-500'}`}
                  >★</button>
                  <input
                    type="text"
                    value={r.title}
                    onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, title: e.target.value } : x))}
                    onBlur={e => update(r.id, { title: e.target.value.trim() })}
                    className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 outline-none py-1"
                  />
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
                    onClick={() => remove(r.id)}
                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                  >Удалить</button>
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
