'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { SOURCE_OPTIONS } from '@/lib/crm/constants'
import {
  PHONE_PREFIX,
  formatPhoneInput,
  normalizePhoneKZ,
  isValidPhoneKZ,
  onPhoneKeyDown,
} from '@/lib/utils/phone'

export default function NewPatientPage() {
  const router = useRouter()
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [form, setForm] = useState({
    full_name: '',
    phone: PHONE_PREFIX,
    phone2: PHONE_PREFIX,
    gender: 'other' as 'male' | 'female' | 'other',
    birth_date: '',
    iin: '',
    city: '',
    email: '',
    source_text: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (f: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [f]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clinicId) { setError('Ошибка: нет клиники'); return }
    setError('')
    setSaving(true)

    // Only attach phones that the user actually filled in past the +77 prefix
    // AND that normalise to a valid +77XXXXXXXXX form.
    const p1 = form.phone.length  > PHONE_PREFIX.length ? normalizePhoneKZ(form.phone)  : null
    const p2 = form.phone2.length > PHONE_PREFIX.length ? normalizePhoneKZ(form.phone2) : null
    if (form.phone.length  > PHONE_PREFIX.length && !p1) { setError('Телефон 1: нужно +77 и 9 цифр'); setSaving(false); return }
    if (form.phone2.length > PHONE_PREFIX.length && !p2) { setError('Телефон 2: нужно +77 и 9 цифр'); setSaving(false); return }
    const phones = [p1, p2].filter((x): x is string => Boolean(x))

    const { data, error: err } = await supabase
      .from('patients')
      .insert({
        clinic_id: clinicId,
        full_name: form.full_name.trim(),
        phones,
        gender: form.gender,
        birth_date: form.birth_date || null,
        iin: form.iin.trim() || null,
        city: form.city.trim() || null,
        email: form.email.trim() || null,
        source_text: form.source_text || null,
        notes: form.notes.trim() || null,
        status: 'new',
        is_vip: false,
        balance_amount: 0,
        debt_amount: 0,
        tags: [],
      })
      .select('id')
      .single()

    if (err) { setError(err.message); setSaving(false); return }
    router.push(`/patients/${data.id}`)
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
        ← Пациенты
      </Link>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Новый пациент</h2>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Основные данные */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Основное</h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className={labelCls}>ФИО <span className="text-red-400">*</span></label>
                <input
                  className={inputCls}
                  placeholder="Иванова Айгерим Сериковна"
                  value={form.full_name}
                  onChange={set('full_name')}
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Пол <span className="text-red-400">*</span></label>
                  <select className={inputCls} value={form.gender} onChange={set('gender')}>
                    <option value="female">Женский</option>
                    <option value="male">Мужской</option>
                    <option value="other">Не указан</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Дата рождения</label>
                  <input type="date" className={inputCls} value={form.birth_date} onChange={set('birth_date')} />
                </div>
              </div>
              <div>
                <label className={labelCls}>ИИН</label>
                <input
                  className={inputCls}
                  placeholder="000000000000"
                  value={form.iin}
                  onChange={set('iin')}
                  maxLength={12}
                  pattern="[0-9]{12}"
                  title="12 цифр"
                />
              </div>
            </div>
          </div>

          {/* Контакты */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Контакты</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Телефон 1</label>
                <input
                  type="tel"
                  className={inputCls + (form.phone.length > PHONE_PREFIX.length && !isValidPhoneKZ(form.phone) ? ' border-orange-300' : '')}
                  placeholder={PHONE_PREFIX + ' XXXXXXXXX'}
                  value={form.phone}
                  onChange={e => setForm(p => ({ ...p, phone: formatPhoneInput(e.target.value) }))}
                  onKeyDown={onPhoneKeyDown}
                />
              </div>
              <div>
                <label className={labelCls}>Телефон 2</label>
                <input
                  type="tel"
                  className={inputCls + (form.phone2.length > PHONE_PREFIX.length && !isValidPhoneKZ(form.phone2) ? ' border-orange-300' : '')}
                  placeholder={PHONE_PREFIX + ' XXXXXXXXX'}
                  value={form.phone2}
                  onChange={e => setForm(p => ({ ...p, phone2: formatPhoneInput(e.target.value) }))}
                  onKeyDown={onPhoneKeyDown}
                />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" className={inputCls} placeholder="patient@mail.ru" value={form.email} onChange={set('email')} />
              </div>
              <div>
                <label className={labelCls}>Город</label>
                <input className={inputCls} placeholder="Актау" value={form.city} onChange={set('city')} />
              </div>
            </div>
          </div>

          {/* Дополнительно */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Дополнительно</h3>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className={labelCls}>Источник</label>
                <select className={inputCls} value={form.source_text} onChange={set('source_text')}>
                  <option value="">— не указан —</option>
                  {SOURCE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Заметки</label>
                <textarea
                  className={inputCls + ' resize-none'}
                  placeholder="Любая важная информация о пациенте..."
                  rows={3}
                  value={form.notes}
                  onChange={set('notes')}
                />
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href="/patients"
              className="flex-1 text-center border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              Отмена
            </Link>
            <button
              type="submit"
              disabled={saving || !clinicId}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {saving ? 'Сохранение...' : 'Создать пациента'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
