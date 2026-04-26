'use client'

/**
 * /settings/automation — управление автоматизациями воронки «Лиды».
 *
 * Каждый блок: тогл (вкл/выкл) + редактор текста шаблона. Тогл лежит в
 * clinics.settings.automation.<key>; текст — в message_templates по
 * соответствующему key. Структура зеркалит /settings/clinic для бота.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type AutoFlag =
  | 'work_24h' | 'work_48h'
  | 'touch_1' | 'touch_2' | 'touch_3' | 'touch_no_reply'

interface Block {
  flag: AutoFlag
  templateKey: string
  title: string
  hint: string
  rows: number
}

const BLOCKS: Block[] = [
  { flag: 'work_24h',     templateKey: 'work_task_24h',
    title: 'В работе → задача через 24 часа',
    hint: 'Если клиент не ответил в течение 24 ч после перевода в этап «В работе» — менеджеру создаётся задача с этим текстом.',
    rows: 3 },
  { flag: 'work_48h',     templateKey: 'work_task_48h',
    title: 'В работе → задача через 48 часов',
    hint: 'Финальная задача, если за 48 ч клиент так и не ответил.',
    rows: 3 },
  { flag: 'touch_1',      templateKey: 'touch_1',
    title: 'Касание → 1-е касание (сразу при входе в этап)',
    hint: 'WhatsApp-сообщение клиенту в момент перевода в этап «Касание».',
    rows: 4 },
  { flag: 'touch_2',      templateKey: 'touch_2',
    title: 'Касание → 2-е касание (через 120 ч ≈ 5 дн.)',
    hint: 'Через 120 часов после входа в этап «Касание», если клиент не ответил.',
    rows: 4 },
  { flag: 'touch_3',      templateKey: 'touch_3',
    title: 'Касание → 3-е касание (через 240 ч ≈ 10 дн.)',
    hint: 'Через 240 часов после входа в этап «Касание». Финальное автоматическое касание.',
    rows: 4 },
  { flag: 'touch_no_reply', templateKey: 'touch_no_reply_task',
    title: 'Касание → задача после 3-го касания без ответа',
    hint: 'Через сутки после 3-го касания, если клиент молчит — менеджеру создаётся задача с этим текстом.',
    rows: 3 },
]

interface ClinicSettingsAutomation {
  automation?: Partial<Record<AutoFlag, boolean>>
}

export default function AutomationSettingsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState('')
  const [error, setError]     = useState('')

  const [flags, setFlags] = useState<Record<AutoFlag, boolean>>({
    work_24h: true, work_48h: true,
    touch_1: true, touch_2: true, touch_3: true, touch_no_reply: true,
  })
  const [bodies, setBodies] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!profile?.clinic_id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const { data: clinic } = await supabase
          .from('clinics')
          .select('settings')
          .eq('id', profile.clinic_id)
          .single<{ settings: ClinicSettingsAutomation | null }>()
        const auto = clinic?.settings?.automation ?? {}

        const { data: tmpls } = await supabase
          .from('message_templates')
          .select('key, body')
          .eq('clinic_id', profile.clinic_id)
          .in('key', BLOCKS.map(b => b.templateKey))
          .returns<{ key: string; body: string }[]>()

        if (cancelled) return

        setFlags(prev => {
          const next = { ...prev }
          for (const b of BLOCKS) {
            // По умолчанию включено (true) — выключаем только явный false.
            next[b.flag] = auto[b.flag] !== false
          }
          return next
        })
        setBodies(Object.fromEntries((tmpls ?? []).map(t => [t.key, t.body])))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.clinic_id, supabase])

  const save = async () => {
    if (!profile?.clinic_id) return
    setSaving(true); setError(''); setToast('')
    try {
      // 1. Мерджим текущие settings (не убиваем bot_enabled / working_hours).
      const { data: clinic } = await supabase
        .from('clinics')
        .select('settings')
        .eq('id', profile.clinic_id)
        .single<{ settings: Record<string, unknown> | null }>()
      const settings = { ...(clinic?.settings ?? {}), automation: flags }

      const { error: cErr } = await supabase
        .from('clinics')
        .update({ settings })
        .eq('id', profile.clinic_id)
      if (cErr) throw cErr

      // 2. Апсерты текстов шаблонов. partial unique (clinic_id, key) есть в 083.
      for (const b of BLOCKS) {
        const body = bodies[b.templateKey]?.trim()
        if (!body) continue // пустое поле — не трогаем
        const { error: tErr } = await supabase
          .from('message_templates')
          .upsert({
            clinic_id: profile.clinic_id,
            key: b.templateKey,
            title: b.title,
            body,
            is_active: true,
          }, { onConflict: 'clinic_id,key' })
        if (tErr) throw tErr
      }

      setToast('Сохранено')
      setTimeout(() => setToast(''), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Загрузка…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Автоматизации воронки «Лиды»</h1>
        <p className="mt-1 text-sm text-slate-500">
          Перенос сценариев из amoCRM. Бот работает 24/7 — никаких проверок
          рабочих часов клиники. Тексты с маркером «[ЗАПОЛНИТЬ …]» не отправляются
          клиентам — сначала впишите реальный текст.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {BLOCKS.map(b => (
          <section key={b.flag} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium text-slate-900">{b.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{b.hint}</p>
              </div>
              <label className="inline-flex shrink-0 items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={flags[b.flag]}
                  onChange={e => setFlags(p => ({ ...p, [b.flag]: e.target.checked }))}
                />
                <span className="text-sm">{flags[b.flag] ? 'Включено' : 'Выключено'}</span>
              </label>
            </div>
            <textarea
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              rows={b.rows}
              placeholder="Текст шаблона…"
              value={bodies[b.templateKey] ?? ''}
              onChange={e => setBodies(p => ({ ...p, [b.templateKey]: e.target.value }))}
            />
          </section>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        {toast && <span className="text-sm text-emerald-600">{toast}</span>}
      </div>
    </div>
  )
}
