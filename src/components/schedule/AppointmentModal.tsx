'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Appointment, Doctor, Service, Patient } from '@/types/app'
import { minutesToTime, APPOINTMENT_STATUS_LABELS } from '@/lib/utils/schedule'

interface Props {
  appointment?: Appointment | null  // null = новая
  defaultDoctorId?: string
  defaultTime?: string
  defaultDate?: string
  onClose: () => void
  onSave: (apt: Appointment) => void
  onDelete?: (id: string) => void
}

interface Conflict {
  type: string
  message: string
}

export function AppointmentModal({
  appointment, defaultDoctorId, defaultTime, defaultDate,
  onClose, onSave, onDelete
}: Props) {
  const supabase = createClient()
  const isEdit = !!appointment

  const [form, setForm] = useState({
    patient_id:  appointment?.patient_id  || '',
    doctor_id:   appointment?.doctor_id   || defaultDoctorId || '',
    service_id:  appointment?.service_id  || '',
    date:        appointment?.date        || defaultDate || '',
    time_start:  appointment?.time_start  || defaultTime || '',
    duration_min: appointment?.duration_min || 30,
    status:      appointment?.status      || 'pending',
    notes:       appointment?.notes       || '',
    is_walkin:   appointment?.is_walkin   || false,
  })

  const [doctors,   setDoctors]   = useState<Doctor[]>([])
  const [services,  setServices]  = useState<Service[]>([])
  const [patients,  setPatients]  = useState<Patient[]>([])
  const [patSearch, setPatSearch] = useState(appointment?.patient?.full_name || '')
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading,   setLoading]   = useState(false)
  const [checking,  setChecking]  = useState(false)

  // Загрузка справочников
  useEffect(() => {
    supabase.from('doctors').select('*,specialization:specializations(name)')
      .eq('is_active', true).then(({ data }) => setDoctors(data || []))
    supabase.from('services').select('*').eq('is_active', true)
      .then(({ data }) => setServices(data || []))
  }, [])

  // Поиск пациентов
  useEffect(() => {
    if (patSearch.length < 2) { setPatients([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id,full_name,phones,birth_date,balance_amount,debt_amount')
        .ilike('full_name', `%${patSearch}%`)
        .is('deleted_at', null)
        .limit(8)
      setPatients(data || [])
    }, 300)
    return () => clearTimeout(t)
  }, [patSearch])

  // time_end = time_start + duration
  const timeEnd = (() => {
    if (!form.time_start) return ''
    const [h, m] = form.time_start.split(':').map(Number)
    return minutesToTime(h * 60 + m + form.duration_min)
  })()

  // Проверка конфликтов при изменении ключевых полей
  useEffect(() => {
    if (!form.doctor_id || !form.date || !form.time_start) return
    setChecking(true)
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/appointments/conflicts?doctor_id=${form.doctor_id}&date=${form.date}` +
        `&start=${form.time_start}&end=${timeEnd}` +
        (isEdit ? `&exclude=${appointment!.id}` : '')
      )
      const data = await res.json()
      setConflicts(data.conflicts || [])
      setChecking(false)
    }, 500)
    return () => clearTimeout(t)
  }, [form.doctor_id, form.date, form.time_start, form.duration_min])

  // При выборе услуги — подставить длительность
  const onServiceChange = (serviceId: string) => {
    const svc = services.find(s => s.id === serviceId)
    setForm(f => ({
      ...f,
      service_id: serviceId,
      duration_min: svc?.duration_min || f.duration_min
    }))
  }

  const save = async () => {
    if (!form.patient_id || !form.doctor_id || !form.date || !form.time_start) return
    if (conflicts.some(c => c.type === 'double_booking')) return

    setLoading(true)
    const payload = { ...form, time_end: timeEnd }

    let result
    if (isEdit) {
      const { data } = await supabase.from('appointments')
        .update(payload).eq('id', appointment!.id)
        .select('*, patient:patients(id,full_name,phones), doctor:doctors(id,first_name,last_name,color), service:services(id,name,price)')
        .single()
      result = data
    } else {
      const { data } = await supabase.from('appointments')
        .insert(payload)
        .select('*, patient:patients(id,full_name,phones), doctor:doctors(id,first_name,last_name,color), service:services(id,name,price)')
        .single()
      result = data
    }

    if (result) onSave(result as Appointment)
    setLoading(false)
  }

  const changeStatus = async (status: string) => {
    if (!isEdit) return
    await supabase.from('appointments').update({ status }).eq('id', appointment!.id)
    onSave({ ...appointment!, status: status as any })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? 'Запись' : 'Новая запись'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Пациент */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Пациент *</label>
            <input
              value={patSearch}
              onChange={e => { setPatSearch(e.target.value); setForm(f => ({ ...f, patient_id: '' })) }}
              placeholder="Начните вводить имя..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
            />
            {patients.length > 0 && !form.patient_id && (
              <div className="border border-gray-200 rounded-xl mt-1 overflow-hidden shadow-sm">
                {patients.map(p => (
                  <button key={p.id} onClick={() => {
                    setForm(f => ({ ...f, patient_id: p.id }))
                    setPatSearch(p.full_name)
                    setPatients([])
                  }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                  >
                    <p className="text-sm font-medium text-gray-800">{p.full_name}</p>
                    <p className="text-xs text-gray-400">{p.phones?.[0]}</p>
                    {(p.debt_amount || 0) > 0 && (
                      <p className="text-xs text-red-500">Долг: {p.debt_amount.toLocaleString()} ₸</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Врач */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Врач *</label>
            <select value={form.doctor_id} onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="">Выберите врача</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.last_name} {d.first_name} — {(d as any).specialization?.name}
                </option>
              ))}
            </select>
          </div>

          {/* Дата и время */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Дата *</label>
              <input type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Время *</label>
              <input type="time" value={form.time_start} step={1800}
                onChange={e => setForm(f => ({ ...f, time_start: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>

          {/* Услуга и длительность */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Услуга</label>
              <select value={form.service_id} onChange={e => onServiceChange(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                <option value="">Без услуги</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} — {s.price.toLocaleString()} ₸</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Длительность (мин)</label>
              <select value={form.duration_min}
                onChange={e => setForm(f => ({ ...f, duration_min: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                {[15,20,30,45,60,90,120].map(m => (
                  <option key={m} value={m}>{m} мин {timeEnd ? `(до ${timeEnd})` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Walk-in */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_walkin}
              onChange={e => setForm(f => ({ ...f, is_walkin: e.target.checked }))}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-gray-700">Walk-in (пришёл без записи)</span>
          </label>

          {/* Примечание */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Примечание</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2} placeholder="Причина обращения..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
          </div>

          {/* Конфликты */}
          {checking && (
            <p className="text-xs text-gray-400">Проверка конфликтов...</p>
          )}
          {conflicts.map((c, i) => (
            <div key={i} className={`flex items-start gap-2 p-3 rounded-xl text-sm ${
              c.type === 'double_booking'
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              <span>{c.type === 'double_booking' ? '🚫' : '⚠️'}</span>
              <span>{c.message}</span>
            </div>
          ))}

          {/* Статус (только редактирование) */}
          {isEdit && (
            <div>
              <label className="text-xs text-gray-500 mb-2 block">Статус</label>
              <div className="flex flex-wrap gap-2">
                {(['pending','confirmed','arrived','no_show','cancelled'] as const).map(s => (
                  <button key={s} onClick={() => changeStatus(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      appointment?.status === s
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}>
                    {APPOINTMENT_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Кнопки */}
        <div className="p-5 border-t border-gray-100 flex gap-3">
          {isEdit && onDelete && (
            <button onClick={() => onDelete(appointment!.id)}
              className="px-4 py-2.5 text-sm text-red-500 hover:text-red-700 border border-red-200 rounded-xl hover:bg-red-50">
              Удалить
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={save} disabled={loading || conflicts.some(c => c.type === 'double_booking')}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Записать'}
          </button>
        </div>
      </div>
    </div>
  )
}
