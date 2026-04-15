'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

const DAYS = ['mon','tue','wed','thu','fri','sat','sun']
const DAY_LABELS: Record<string,string> = {
  mon:'Пн', tue:'Вт', wed:'Ср', thu:'Чт', fri:'Пт', sat:'Сб', sun:'Вс'
}

export default function ClinicSettingsPage() {
  const supabase = createClient()
  const { user } = usePermissions()
  const [form, setForm] = useState({ name:'', address:'', phone:'', email:'', timezone:'Asia/Almaty', currency:'KZT' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user?.clinic_id) return
    supabase.from('clinics').select('*').eq('id', user.clinic_id).single()
      .then(({ data }) => { if (data) setForm({ name:data.name||'', address:data.address||'', phone:data.phone||'', email:data.email||'', timezone:data.timezone||'Asia/Almaty', currency:data.currency||'KZT' }) })
  }, [user?.clinic_id])

  const save = async () => {
    setSaving(true)
    await supabase.from('clinics').update(form).eq('id', user!.clinic_id)
    setSaved(true); setSaving(false)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Настройки клиники</h1>
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        {[
          { key:'name', label:'Название клиники *', placeholder:'ООО «Клиника»' },
          { key:'address', label:'Адрес', placeholder:'г. Алматы, ул. ...' },
          { key:'phone', label:'Телефон', placeholder:'+7 727 ...' },
          { key:'email', label:'Email', placeholder:'info@clinic.kz' },
        ].map(f => (
          <div key={f.key}>
            <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
            <input value={(form as any)[f.key]} onChange={e => setForm(p => ({...p,[f.key]:e.target.value}))}
              placeholder={f.placeholder}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Часовой пояс</label>
            <select value={form.timezone} onChange={e => setForm(p=>({...p,timezone:e.target.value}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="Asia/Almaty">Asia/Almaty (UTC+5)</option>
              <option value="Asia/Aqtau">Asia/Aqtau (UTC+5)</option>
              <option value="Asia/Oral">Asia/Oral (UTC+5)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Валюта</label>
            <select value={form.currency} onChange={e => setForm(p=>({...p,currency:e.target.value}))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="KZT">KZT — Тенге</option>
              <option value="USD">USD — Доллар</option>
            </select>
          </div>
        </div>
        <button onClick={save} disabled={saving}
          className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saved ? '✓ Сохранено' : saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
