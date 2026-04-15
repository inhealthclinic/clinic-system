'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

const DAYS = ['mon','tue','wed','thu','fri','sat','sun']
const DAY_LABELS: Record<string,string> = {mon:'Пн',tue:'Вт',wed:'Ср',thu:'Чт',fri:'Пт',sat:'Сб',sun:'Вс'}
const COLORS = ['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#EC4899','#6366F1']

export default function DoctorsPage() {
  const supabase = createClient()
  const { user } = usePermissions()
  const [doctors, setDoctors] = useState<any[]>([])
  const [specs, setSpecs] = useState<any[]>([])
  const [editing, setEditing] = useState<any|null>(null)

  useEffect(() => {
    supabase.from('doctors').select('*, specialization:specializations(name)')
      .is('deleted_at', null).order('last_name').then(({data})=>setDoctors(data||[]))
    supabase.from('specializations').select('*').order('name').then(({data})=>setSpecs(data||[]))
  }, [])

  const save = async (form: any) => {
    if (editing?.id) {
      const {data} = await supabase.from('doctors').update(form).eq('id', editing.id)
        .select('*, specialization:specializations(name)').single()
      setDoctors(p => p.map(d => d.id===editing.id ? data : d))
    } else {
      const {data} = await supabase.from('doctors').insert({...form, clinic_id: user?.clinic_id})
        .select('*, specialization:specializations(name)').single()
      setDoctors(p => [data, ...p])
    }
    setEditing(null)
  }

  const deactivate = async (id: string) => {
    await supabase.from('doctors').update({is_active: false}).eq('id', id)
    setDoctors(p => p.filter(d => d.id !== id))
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Врачи</h1>
        <button onClick={() => setEditing({})}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
          + Добавить врача
        </button>
      </div>

      <div className="space-y-3">
        {doctors.map(d => (
          <div key={d.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
              style={{backgroundColor: d.color}}>
              {d.first_name?.[0]}{d.last_name?.[0]}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-800">{d.last_name} {d.first_name} {d.middle_name||''}</p>
              <p className="text-sm text-gray-400">{d.specialization?.name || '—'} · {d.consultation_duration} мин</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(d)}
                className="text-xs text-blue-500 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50">
                Изменить
              </button>
              <button onClick={() => deactivate(d.id)}
                className="text-xs text-red-400 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50">
                Деактивировать
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <DoctorForm initial={editing} specs={specs}
          onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function DoctorForm({initial, specs, onSave, onClose}: any) {
  const [form, setForm] = useState({
    first_name: initial?.first_name||'', last_name: initial?.last_name||'',
    middle_name: initial?.middle_name||'', specialization_id: initial?.specialization_id||'',
    phone: initial?.phone||'', color: initial?.color||'#3B82F6',
    consultation_duration: initial?.consultation_duration||30,
    working_hours: initial?.working_hours||{},
  })

  const toggleDay = (day: string) => {
    const wh = {...form.working_hours}
    if (wh[day]?.length) delete wh[day]
    else wh[day] = [{from:'09:00', to:'18:00'}]
    setForm(p=>({...p, working_hours: wh}))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{initial?.id ? 'Изменить врача' : 'Новый врач'}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Фамилия *</label>
              <input value={form.last_name} onChange={e=>setForm(p=>({...p,last_name:e.target.value}))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Имя *</label>
              <input value={form.first_name} onChange={e=>setForm(p=>({...p,first_name:e.target.value}))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Специализация</label>
            <select value={form.specialization_id} onChange={e=>setForm(p=>({...p,specialization_id:e.target.value}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="">Не указана</option>
              {specs.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Телефон</label>
              <input value={form.phone} onChange={e=>setForm(p=>({...p,phone:e.target.value}))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Длит. приёма (мин)</label>
              <input type="number" value={form.consultation_duration}
                onChange={e=>setForm(p=>({...p,consultation_duration:Number(e.target.value)}))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
          {/* Цвет */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">Цвет в расписании</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} onClick={()=>setForm(p=>({...p,color:c}))}
                  className={`w-7 h-7 rounded-full border-2 ${form.color===c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{backgroundColor:c}} />
              ))}
            </div>
          </div>
          {/* Рабочие дни */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">Рабочие дни</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map(d => (
                <button key={d} onClick={()=>toggleDay(d)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                    form.working_hours[d]?.length ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500'
                  }`}>{DAY_LABELS[d]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
          <button onClick={()=>onSave(form)} disabled={!form.first_name||!form.last_name}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
