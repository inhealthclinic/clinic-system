'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface DayHours {
  active: boolean
  from: string
  to: string
}

type WorkingHours = Record<string, DayHours>

interface ClinicSettings {
  working_hours: WorkingHours
  default_appointment_duration: number
  slot_interval_min: number
  booking_advance_hours_min: number
  booking_days_max: number
  sms_sender_name: string
  receipt_bin: string
  receipt_legal_name: string
  receipt_address: string
  bot_enabled?: boolean
}

const DEFAULT_BOT_GREETING =
  'Здравствуйте! Спасибо, что обратились. Я — Камилла, ассистент клиники IN HEALTH. Подскажите, пожалуйста, по какому вопросу пишете?'
const DEFAULT_BOT_FOLLOWUP =
  'Я отметила Ваш запрос. Скоро администратор клиники свяжется с Вами и поможет с записью. Хорошего дня!'

interface ClinicData {
  id: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  timezone: string
  currency: string
  settings: ClinicSettings | null
}

/* ─── Constants ──────────────────────────────────────────────────────────── */
const DAYS = [
  { key: 'mon', label: 'Пн' },
  { key: 'tue', label: 'Вт' },
  { key: 'wed', label: 'Ср' },
  { key: 'thu', label: 'Чт' },
  { key: 'fri', label: 'Пт' },
  { key: 'sat', label: 'Сб' },
  { key: 'sun', label: 'Вс' },
]

const TIMEZONES = [
  { value: 'Asia/Almaty',   label: 'Алматы (UTC+5)' },
  { value: 'Asia/Bishkek',  label: 'Бишкек (UTC+6)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)'  },
  { value: 'UTC',           label: 'UTC'              },
]

const DEFAULT_HOURS: WorkingHours = Object.fromEntries(
  DAYS.map(d => [d.key, { active: ['mon','tue','wed','thu','fri'].includes(d.key), from: '09:00', to: '18:00' }])
)

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function ClinicSettingsPage() {
  const supabase  = createClient()
  const { profile } = useAuthStore()

  const [clinic, setClinic]   = useState<ClinicData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState(false)
  const [error, setError]     = useState('')

  // Form fields
  const [name, setName]       = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone]     = useState('')
  const [email, setEmail]     = useState('')
  const [timezone, setTimezone] = useState('Asia/Almaty')
  const [duration, setDuration]       = useState(30)
  const [slotInterval, setSlotInterval] = useState(15)
  const [advanceHours, setAdvanceHours] = useState(0)
  const [daysMax, setDaysMax]         = useState(60)
  const [smsSender, setSmsSender]     = useState('')
  const [receiptBin, setReceiptBin]   = useState('')
  const [receiptLegal, setReceiptLegal] = useState('')
  const [receiptAddress, setReceiptAddress] = useState('')
  const [workingHours, setWorkingHours] = useState<WorkingHours>({ ...DEFAULT_HOURS })

  // Бот: чекбокс читает clinics.settings.bot_enabled, тексты лежат в
  // message_templates по key='bot_greeting'/'bot_followup_no_answer'.
  const [botEnabled, setBotEnabled] = useState(true)
  const [botGreeting, setBotGreeting] = useState(DEFAULT_BOT_GREETING)
  const [botFollowup, setBotFollowup] = useState(DEFAULT_BOT_FOLLOWUP)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('clinics')
      .select('*')
      .single()

    if (err || !data) {
      setError('Не удалось загрузить данные клиники')
      setLoading(false)
      return
    }

    const d = data as ClinicData
    setClinic(d)
    setName(d.name ?? '')
    setAddress(d.address ?? '')
    setPhone(d.phone ?? '')
    setEmail(d.email ?? '')
    setTimezone(d.timezone ?? 'Asia/Almaty')

    const s = d.settings
    setDuration(s?.default_appointment_duration ?? 30)
    setSlotInterval(s?.slot_interval_min ?? 15)
    setAdvanceHours(s?.booking_advance_hours_min ?? 0)
    setDaysMax(s?.booking_days_max ?? 60)
    setSmsSender(s?.sms_sender_name ?? '')
    setReceiptBin(s?.receipt_bin ?? '')
    setReceiptLegal(s?.receipt_legal_name ?? '')
    setReceiptAddress(s?.receipt_address ?? '')
    setWorkingHours({ ...DEFAULT_HOURS, ...(s?.working_hours ?? {}) })
    setBotEnabled(s?.bot_enabled !== false) // по умолчанию ON

    // Подгружаем тела шаблонов бота отдельным запросом.
    const { data: tmpls } = await supabase
      .from('message_templates')
      .select('key, body')
      .eq('clinic_id', d.id)
      .in('key', ['bot_greeting', 'bot_followup_no_answer'])
    const byKey = new Map((tmpls ?? []).map(t => [t.key as string, t.body as string]))
    setBotGreeting(byKey.get('bot_greeting') ?? DEFAULT_BOT_GREETING)
    setBotFollowup(byKey.get('bot_followup_no_answer') ?? DEFAULT_BOT_FOLLOWUP)

    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const showToast = () => {
    setToast(true)
    setTimeout(() => setToast(false), 3000)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clinic) return
    setSaving(true)
    setError('')

    const newSettings: ClinicSettings = {
      working_hours:                workingHours,
      default_appointment_duration: duration,
      slot_interval_min:            slotInterval,
      booking_advance_hours_min:    advanceHours,
      booking_days_max:             daysMax,
      sms_sender_name:              smsSender,
      receipt_bin:                  receiptBin.trim(),
      receipt_legal_name:           receiptLegal.trim(),
      receipt_address:              receiptAddress.trim(),
      bot_enabled:                  botEnabled,
    }

    const { error: err } = await supabase
      .from('clinics')
      .update({
        name:     name.trim(),
        address:  address.trim() || null,
        phone:    phone.trim() || null,
        email:    email.trim() || null,
        timezone,
        settings: newSettings,
      })
      .eq('id', clinic.id)

    if (err) { setSaving(false); setError(err.message); return }

    // Сохраняем шаблоны бота. UPDATE по (clinic_id, key); если строки нет —
    // вставляем. Без ON CONFLICT, потому что у нас частичный unique index.
    for (const [key, body, title] of [
      ['bot_greeting', botGreeting, 'Бот: приветствие'],
      ['bot_followup_no_answer', botFollowup, 'Бот: фоллоуап без ответа'],
    ] as const) {
      const { data: existing } = await supabase
        .from('message_templates')
        .select('id')
        .eq('clinic_id', clinic.id)
        .eq('key', key)
        .maybeSingle()
      if (existing) {
        await supabase
          .from('message_templates')
          .update({ body: body.trim(), is_active: true })
          .eq('id', existing.id)
      } else {
        await supabase.from('message_templates').insert({
          clinic_id: clinic.id,
          key,
          title,
          body: body.trim(),
          is_active: true,
        })
      }
    }

    setSaving(false)
    showToast()
  }

  const updateHours = (key: string, field: keyof DayHours, value: string | boolean) => {
    setWorkingHours(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  /* ─── UI helpers ──────────────────────────────────────────────────────── */
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const lbl = 'block text-xs font-medium text-gray-500 mb-1.5'
  const sectionHd = 'text-sm font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100'

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse bg-gray-100 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Настройки сохранены
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section: Основное */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className={sectionHd}>Основное</h2>
          <div className="space-y-4">
            <div>
              <label className={lbl}>Название клиники *</label>
              <input className={inp} value={name} onChange={e => setName(e.target.value)} required placeholder="Медицинский центр «Здоровье»" />
            </div>
            <div>
              <label className={lbl}>Адрес</label>
              <input className={inp} value={address} onChange={e => setAddress(e.target.value)} placeholder="г. Алматы, ул. Примерная, 1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Телефон</label>
                <input className={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 (777) 000-00-00" />
              </div>
              <div>
                <label className={lbl}>Email</label>
                <input type="email" className={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="info@clinic.kz" />
              </div>
            </div>
          </div>
        </div>

        {/* Section: Время работы */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className={sectionHd}>Время работы</h2>
          <div className="space-y-2">
            {DAYS.map(d => {
              const h = workingHours[d.key] ?? { active: false, from: '09:00', to: '18:00' }
              return (
                <div key={d.key} className="flex items-center gap-3">
                  {/* Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={h.active}
                      onChange={e => updateHours(d.key, 'active', e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
                  </label>
                  {/* Day label */}
                  <span className={`w-6 text-sm font-medium flex-shrink-0 ${h.active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {d.label}
                  </span>
                  {/* Time inputs */}
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      className={`${inp} py-1.5 ${!h.active ? 'opacity-40 cursor-not-allowed' : ''}`}
                      value={h.from}
                      disabled={!h.active}
                      onChange={e => updateHours(d.key, 'from', e.target.value)}
                    />
                    <span className="text-gray-400 text-sm flex-shrink-0">—</span>
                    <input
                      type="time"
                      className={`${inp} py-1.5 ${!h.active ? 'opacity-40 cursor-not-allowed' : ''}`}
                      value={h.to}
                      disabled={!h.active}
                      onChange={e => updateHours(d.key, 'to', e.target.value)}
                    />
                  </div>
                  {!h.active && (
                    <span className="text-xs text-gray-400 flex-shrink-0">Выходной</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Section: Настройки записи */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className={sectionHd}>Расписание и запись</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Длительность приёма по умолчанию (мин)</label>
                <input type="number" min={5} max={480} step={5} className={inp}
                  value={duration} onChange={e => setDuration(Number(e.target.value))} />
              </div>
              <div>
                <label className={lbl}>Интервал слотов (мин)</label>
                <select className={inp} value={slotInterval} onChange={e => setSlotInterval(Number(e.target.value))}>
                  <option value={10}>10 минут</option>
                  <option value={15}>15 минут</option>
                  <option value={20}>20 минут</option>
                  <option value={30}>30 минут</option>
                  <option value={60}>1 час</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Минимум часов до записи</label>
                <input type="number" min={0} max={72} step={1} className={inp}
                  value={advanceHours} onChange={e => setAdvanceHours(Number(e.target.value))}
                  placeholder="0 = без ограничений" />
                <p className="text-xs text-gray-400 mt-1">0 — без ограничений</p>
              </div>
              <div>
                <label className={lbl}>Запись вперёд максимум (дней)</label>
                <input type="number" min={1} max={365} step={1} className={inp}
                  value={daysMax} onChange={e => setDaysMax(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <label className={lbl}>Часовой пояс</label>
              <select className={inp} value={timezone} onChange={e => setTimezone(e.target.value)}>
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Section: Реквизиты (чек) */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className={sectionHd}>Реквизиты для чеков и квитанций</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>БИН / ИНН организации</label>
                <input className={inp} value={receiptBin}
                  onChange={e => setReceiptBin(e.target.value)}
                  placeholder="123456789012" maxLength={12} />
              </div>
              <div>
                <label className={lbl}>Юридическое название</label>
                <input className={inp} value={receiptLegal}
                  onChange={e => setReceiptLegal(e.target.value)}
                  placeholder='ТОО "ИН ХЭЛС"' />
              </div>
            </div>
            <div>
              <label className={lbl}>Юридический адрес</label>
              <input className={inp} value={receiptAddress}
                onChange={e => setReceiptAddress(e.target.value)}
                placeholder="г. Алматы, ул. Примерная, д. 1" />
            </div>
          </div>
        </div>

        {/* Section: Уведомления */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className={sectionHd}>SMS и уведомления</h2>
          <div className="space-y-4">
            <div>
              <label className={lbl}>Имя отправителя SMS</label>
              <input className={inp} value={smsSender}
                onChange={e => setSmsSender(e.target.value)}
                placeholder="INHEALTH" maxLength={11} />
              <p className="text-xs text-gray-400 mt-1">Латиница, до 11 символов. Отображается у получателя вместо номера.</p>
            </div>
            <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-700">
              Шаблоны текстов SMS и WhatsApp настраиваются в разделе{' '}
              <a href="/settings/notifications" className="font-medium underline">Уведомления →</a>
            </div>
          </div>
        </div>

        {/* Section: Приветственный бот */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className={sectionHd}>Приветственный бот</h2>
          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <span className="relative inline-flex items-center mt-0.5">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={botEnabled}
                  onChange={e => setBotEnabled(e.target.checked)}
                />
                <span className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
              </span>
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  Включить приветственного бота
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Бот работает 24/7. Отправляет приветствие сразу при создании лида,
                  через 1 час шлёт напоминание, если клиент не ответил. Отключается
                  автоматически, как только менеджер ответит или сделка перейдёт на
                  другой этап.
                </span>
              </span>
            </label>

            <div>
              <label className={lbl}>Текст приветствия (отправляется сразу)</label>
              <textarea
                className={`${inp} min-h-[90px] resize-y`}
                value={botGreeting}
                onChange={e => setBotGreeting(e.target.value)}
                disabled={!botEnabled}
              />
            </div>
            <div>
              <label className={lbl}>Текст фоллоуапа (если клиент молчит 1 час)</label>
              <textarea
                className={`${inp} min-h-[90px] resize-y`}
                value={botFollowup}
                onChange={e => setBotFollowup(e.target.value)}
                disabled={!botEnabled}
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </form>
    </div>
  )
}
