'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

export default function ServicesPage() {
  const supabase = createClient()
  const { user } = usePermissions()
  const [services, setServices] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [editing, setEditing] = useState<any | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    supabase.from('services').select('*, category:service_categories(name)')
      .eq('is_active', true).order('name').then(({data}) => setServices(data||[]))
    supabase.from('service_categories').select('*').order('name')
      .then(({data}) => setCategories(data||[]))
  }, [])

  const save = async (form: any) => {
    if (editing?.id) {
      const {data} = await supabase.from('services').update(form).eq('id', editing.id).select('*, category:service_categories(name)').single()
      setServices(p => p.map(s => s.id === editing.id ? data : s))
    } else {
      const {data} = await supabase.from('services').insert({...form, clinic_id: user?.clinic_id}).select('*, category:service_categories(name)').single()
      setServices(p => [data, ...p])
    }
    setEditing(null); setShowForm(false)
  }

  const toggle = async (id: string, active: boolean) => {
    await supabase.from('services').update({is_active: active}).eq('id', id)
    setServices(p => p.map(s => s.id === id ? {...s, is_active: active} : s))
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Услуги и прайс-лист</h1>
        <button onClick={() => {setEditing(null); setShowForm(true)}}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
          + Добавить услугу
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Услуга</th>
              <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Категория</th>
              <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Цена</th>
              <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Длительность</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {services.map(s => (
              <tr key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                <td className="px-4 py-3 text-gray-500">{s.category?.name || '—'}</td>
                <td className="px-4 py-3 text-right font-semibold">{s.price.toLocaleString()} ₸</td>
                <td className="px-4 py-3 text-right text-gray-400">{s.duration_min} мин</td>
                <td className="px-4 py-3 flex justify-end gap-2">
                  <button onClick={() => {setEditing(s); setShowForm(true)}}
                    className="text-xs text-blue-500 hover:text-blue-700">Изменить</button>
                  <button onClick={() => toggle(s.id, !s.is_active)}
                    className={`text-xs ${s.is_active ? 'text-red-400 hover:text-red-600' : 'text-green-500 hover:text-green-700'}`}>
                    {s.is_active ? 'Скрыть' : 'Показать'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ServiceForm
          initial={editing}
          categories={categories}
          onSave={save}
          onClose={() => {setShowForm(false); setEditing(null)}}
        />
      )}
    </div>
  )
}

function ServiceForm({initial, categories, onSave, onClose}: any) {
  const [form, setForm] = useState({
    name: initial?.name||'', category_id: initial?.category_id||'',
    price: initial?.price||'', duration_min: initial?.duration_min||30, code: initial?.code||''
  })
  const set = (k: string, v: any) => setForm(p => ({...p, [k]: v}))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">{initial ? 'Изменить услугу' : 'Новая услуга'}</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Название *</label>
            <input value={form.name} onChange={e=>set('name',e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Цена (₸) *</label>
              <input type="number" value={form.price} onChange={e=>set('price',e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Длительность (мин)</label>
              <input type="number" value={form.duration_min} onChange={e=>set('duration_min',Number(e.target.value))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Категория</label>
            <select value={form.category_id} onChange={e=>set('category_id',e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="">Без категории</option>
              {categories.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
          <button onClick={() => onSave(form)} disabled={!form.name || !form.price}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
