'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────── */
interface NotifTemplate {
  key: string
  label: string
  description: string
  channel: 'sms' | 'whatsapp' | 'both'
  variables: string[]
  text: string
  enabled: boolean
}

const DEFAULT_TEMPLATES: NotifTemplate[] = [
  {
    key: 'appointment_reminder_24h',
    label: 'Напоминание о записи (за 24 ч)',
    description: 'Отправляется пациенту за сутки до приёма',
    channel: 'both',
    variables: ['{{ФИО}}', '{{дата}}', '{{время}}', '{{врач}}', '{{клиника}}'],
    text: 'Здравствуйте, {{ФИО}}! Напоминаем о визите {{дата}} в {{время}} к врачу {{врач}}. Клиника IN HEALTH. Ответьте "+" для подтверждения.',
    enabled: true,
  },
  {
    key: 'appointment_reminder_2h',
    label: 'Напоминание о записи (за 2 ч)',
    description: 'Короткое напоминание за 2 часа до приёма',
    channel: 'sms',
    variables: ['{{ФИО}}', '{{время}}', '{{врач}}'],
    text: '{{ФИО}}, ваш приём в {{время}} у {{врач}}. Ждём вас! IN HEALTH.',
    enabled: true,
  },
  {
    key: 'appointment_confirmed',
    label: 'Подтверждение записи',
    description: 'Сразу после создания записи в расписании',
    channel: 'both',
    variables: ['{{ФИО}}', '{{дата}}', '{{время}}', '{{врач}}', '{{адрес}}'],
    text: 'Здравствуйте, {{ФИО}}! Вы записаны на {{дата}} в {{время}} к {{врач}}. Адрес: {{адрес}}. IN HEALTH.',
    enabled: true,
  },
  {
    key: 'lab_result_ready',
    label: 'Результаты анализов готовы',
    description: 'Когда статус направления переходит в «Готово»',
    channel: 'both',
    variables: ['{{ФИО}}', '{{анализы}}'],
    text: 'Здравствуйте, {{ФИО}}! Ваши результаты анализов ({{анализы}}) готовы. Обратитесь к врачу или заберите в клинике. IN HEALTH.',
    enabled: true,
  },
  {
    key: 'appointment_cancelled',
    label: 'Отмена записи',
    description: 'При отмене приёма со стороны клиники',
    channel: 'both',
    variables: ['{{ФИО}}', '{{дата}}', '{{время}}', '{{телефон}}'],
    text: 'Здравствуйте, {{ФИО}}! К сожалению, приём {{дата}} в {{время}} отменён. Для перезаписи: {{телефон}}. Приносим извинения. IN HEALTH.',
    enabled: false,
  },
  {
    key: 'payment_received',
    label: 'Подтверждение оплаты',
    description: 'После успешного проведения платежа',
    channel: 'sms',
    variables: ['{{ФИО}}', '{{сумма}}', '{{метод}}'],
    text: '{{ФИО}}, оплата {{сумма}} ₸ ({{метод}}) принята. Спасибо! IN HEALTH.',
    enabled: false,
  },
  {
    key: 'birthday',
    label: 'Поздравление с днём рождения',
    description: 'Автоматически в день рождения пациента',
    channel: 'whatsapp',
    variables: ['{{ФИО}}', '{{имя}}'],
    text: 'Дорогой(ая) {{имя}}! Команда IN HEALTH поздравляет вас с днём рождения! Желаем крепкого здоровья и хорошего настроения! 🎉',
    enabled: false,
  },
]

const CHANNEL_LABEL: Record<string, string> = {
  sms:      'SMS',
  whatsapp: 'WhatsApp',
  both:     'SMS + WhatsApp',
}
const CHANNEL_CLR: Record<string, string> = {
  sms:      'bg-blue-100 text-blue-700',
  whatsapp: 'bg-green-100 text-green-700',
  both:     'bg-purple-100 text-purple-700',
}

/* ─── Load / save from clinic settings ───────────────────── */
const SETTINGS_KEY = 'notification_templates'

export default function NotificationsSettingsPage() {
  const supabase    = createClient()
  const { profile } = useAuthStore()
  const clinicId    = profile?.clinic_id ?? ''

  const [templates, setTemplates] = useState<NotifTemplate[]>(DEFAULT_TEMPLATES)
  const [editing, setEditing]     = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(false)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const { data } = await supabase.from('clinics').select('settings').eq('id', clinicId).single()
    const saved = data?.settings?.[SETTINGS_KEY] as NotifTemplate[] | undefined
    if (saved?.length) {
      // Merge with defaults (keep new keys from defaults)
      const merged = DEFAULT_TEMPLATES.map(def => {
        const found = saved.find(s => s.key === def.key)
        return found ? { ...def, text: found.text, enabled: found.enabled } : def
      })
      setTemplates(merged)
    }
    setLoading(false)
  }, [clinicId])

  useEffect(() => { load() }, [load])

  const showToast = () => { setToast(true); setTimeout(() => setToast(false), 3000) }

  const handleSave = async () => {
    if (!clinicId) return
    setSaving(true)
    const { data: current } = await supabase.from('clinics').select('settings').eq('id', clinicId).single()
    const newSettings = {
      ...(current?.settings ?? {}),
      [SETTINGS_KEY]: templates.map(t => ({ key: t.key, text: t.text, enabled: t.enabled })),
    }
    await supabase.from('clinics').update({ settings: newSettings }).eq('id', clinicId)
    setSaving(false)
    showToast()
  }

  const updateTemplate = (key: string, field: 'text' | 'enabled', value: string | boolean) => {
    setTemplates(prev => prev.map(t => t.key === key ? { ...t, [field]: value } : t))
  }

  if (loading) return <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>

  return (
    <div>
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg flex items-center gap-2">
          ✓ Шаблоны сохранены
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Шаблоны уведомлений</h2>
          <p className="text-sm text-gray-400">SMS и WhatsApp сообщения для пациентов</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          {saving ? 'Сохранение...' : 'Сохранить все'}
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-5 text-sm text-blue-700">
        <strong>Переменные</strong> подставляются автоматически при отправке.
        Доступные переменные для каждого шаблона указаны ниже.
      </div>

      <div className="space-y-4">
        {templates.map(t => {
          const isEditing = editing === t.key
          return (
            <div key={t.key}
              className={`bg-white rounded-xl border transition-colors ${t.enabled ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start gap-4 px-5 py-4">
                {/* Toggle */}
                <label className="relative inline-flex items-center cursor-pointer mt-0.5 flex-shrink-0">
                  <input type="checkbox" className="sr-only peer" checked={t.enabled}
                    onChange={e => updateTemplate(t.key, 'enabled', e.target.checked)} />
                  <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
                </label>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-gray-900">{t.label}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHANNEL_CLR[t.channel]}`}>
                      {CHANNEL_LABEL[t.channel]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{t.description}</p>

                  {/* Variables */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {t.variables.map(v => (
                      <code key={v}
                        className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono cursor-pointer hover:bg-blue-100 hover:text-blue-700 transition-colors"
                        title="Нажмите чтобы скопировать"
                        onClick={() => navigator.clipboard.writeText(v)}>
                        {v}
                      </code>
                    ))}
                  </div>

                  {/* Text */}
                  {isEditing ? (
                    <div>
                      <textarea
                        rows={3}
                        className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                        value={t.text}
                        onChange={e => updateTemplate(t.key, 'text', e.target.value)}
                      />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-400">{t.text.length} символов</span>
                        <button onClick={() => setEditing(null)}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                          Готово
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 flex-1 leading-relaxed">
                        {t.text}
                      </p>
                      <button onClick={() => setEditing(t.key)}
                        className="text-xs text-gray-400 hover:text-blue-600 font-medium flex-shrink-0 mt-1 transition-colors">
                        ✏️ Изменить
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex justify-end mt-6">
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors">
          {saving ? 'Сохранение...' : 'Сохранить шаблоны'}
        </button>
      </div>
    </div>
  )
}
