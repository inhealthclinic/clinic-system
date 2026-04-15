'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

export default function NewPatientPage() {
  const router = useRouter()
  const supabase = createClient()
  const { user } = usePermissions()

  const [form, setForm] = useState({
    full_name: '', phone1: '', phone2: '',
    gender: 'female' as 'male' | 'female' | 'other',
    birth_date: '', iin: '', city: '', email: '',
    source: '', notes: '',
  })
  const [consentGiven, setConsentGiven] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.full_name.trim()) { setError('ФИО обязательно'); return }
    if (!form.phone1.trim())    { setError('Телефон обязателен'); return }
    if (!consentGiven)          { setError('Требуется согласие на обработку персональных данных'); return }

    setSaving(true); setError('')

    const phones = [form.phone1, form.phone2].filter(Boolean)

    const { data: patient, error: err } = await supabase
      .from('patients')
      .insert({
        clinic_id: user?.clinic_id,
        full_name: form.full_name.trim(),
        phones,
        gender: form.gender,
        birth_date: form.birth_date || null,
        iin: form.iin || null,
        city: form.city || null,
        email: form.email || null,
        notes: form.notes || null,
        first_owner_id: user?.id,
        manager_id: user?.id,
        status: 'new',
      })
      .select('id').single()

    if (err) { setError(err.message); setSaving(false); return }

    // Согласие ПДн
    await supabase.from('patient_consents').insert({
      clinic_id: user?.clinic_id,
      patient_id: patient.id,
      type: 'personal_data',
      agreed: true,
      signed_by: user?.id,
    })

    // Депозит
    await supabase.from('patient_balance').insert({
      patient_id: patient.id, clinic_id: user?.clinic_id, balance: 0,
    })

    router.push(`/patients/${patient.id}`)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
        <h1 className="text-2xl font-bold text-gray-900">Новый пациент</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
        {/* Персональные данные */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Персональные данные
          </h2>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ФИО *</label>
              <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder="Иванов Иван Иванович"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Пол *</label>
                <select value={form.gender} onChange={e => set('gender', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="other">Другой</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Дата рождения</label>
                <input type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">ИИН</label>
                <input value={form.iin} onChange={e => set('iin', e.target.value)}
                  placeholder="123456789012" maxLength={12}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
          </div>
        </div>

        {/* Контакты */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Контакты</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Телефон 1 *</label>
              <input value={form.phone1} onChange={e => set('phone1', e.target.value)}
                placeholder="+7 777 123 4567"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Телефон 2</label>
              <input value={form.phone2} onChange={e => set('phone2', e.target.value)}
                placeholder="+7 700 123 4567"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Город</label>
              <input value={form.city} onChange={e => set('city', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
        </div>

        {/* Доп */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Примечания</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
        </div>

        {/* Согласие ПДн — обязательно по закону РК */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={consentGiven} onChange={e => setConsentGiven(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                Согласие на обработку персональных данных *
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Пациент ознакомлен и согласен с обработкой персональных данных в соответствии
                с Законом РК «О персональных данных и их защите»
              </p>
            </div>
          </label>
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()}
            className="flex-1 border border-gray-200 rounded-xl py-3 text-sm text-gray-700 hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Создание...' : 'Создать пациента'}
          </button>
        </div>
      </div>
    </div>
  )
}
