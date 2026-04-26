'use client'

/**
 * /settings/automation — визуальный редактор автоматизаций воронки «Лиды».
 *
 * Раскладка под amoCRM Salesbot: колонки = этапы (Неразобранное / В работе /
 * Касание / Записан), внутри каждой колонки — карточки автоматизаций. Каждая
 * карточка: тогл вкл/выкл + редактируемый текст шаблона.
 *
 * Тогл лежит в clinics.settings.automation.<flag>; текст — в
 * message_templates по соответствующему key. Шаблоны с маркером
 * '[ЗАПОЛНИТЬ ...]' не отправляются — sender это блокирует.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type AutoFlag =
  | 'bot_enabled'
  | 'work_24h' | 'work_48h'
  | 'touch_1' | 'touch_2' | 'touch_3' | 'touch_no_reply'

interface AutoCard {
  flag: AutoFlag
  templateKey: string
  badge: string          // 🤖 / ⏰ / 💬 …
  badgeLabel: string     // «Бот» / «Задача» / «Касание»
  title: string
  hint: string
  rows: number
  // bot_enabled живёт в settings напрямую, не в settings.automation —
  // совместимость с миграцией 083.
  legacyBotFlag?: boolean
}

interface StageColumn {
  code: string
  title: string
  color: string          // border + header tint
  cards: AutoCard[]
}

const STAGES: StageColumn[] = [
  {
    code: 'new', title: 'Неразобранное',
    color: 'slate',
    cards: [
      {
        flag: 'bot_enabled',
        legacyBotFlag: true,
        templateKey: 'bot_greeting',
        badge: '🤖', badgeLabel: 'Salesbot',
        title: 'Запуск Salesbot: Приветствие',
        hint: 'Сразу при появлении нового лида — приветствие в WhatsApp. Через 1 ч без ответа — фоллоуап. Бот работает 24/7.',
        rows: 4,
      },
    ],
  },
  {
    code: 'in_progress', title: 'В работе',
    color: 'blue',
    cards: [
      {
        flag: 'work_24h',
        templateKey: 'work_task_24h',
        badge: '⏰', badgeLabel: 'Задача',
        title: '24 ч с последнего входящего → задача',
        hint: 'Если клиент не отвечает 24 ч — менеджеру создаётся задача с этим текстом.',
        rows: 3,
      },
      {
        flag: 'work_48h',
        templateKey: 'work_task_48h',
        badge: '⏰', badgeLabel: 'Задача',
        title: '48 ч с последнего входящего → задача',
        hint: 'Финальная задача, если за 48 ч ответа нет.',
        rows: 3,
      },
    ],
  },
  {
    code: 'contact', title: 'Касание',
    color: 'amber',
    cards: [
      {
        flag: 'touch_1',
        templateKey: 'touch_1',
        badge: '💬', badgeLabel: 'Касание',
        title: '1-е касание: сразу при входе в этап',
        hint: 'WhatsApp-сообщение в момент перевода сделки в «Касание».',
        rows: 4,
      },
      {
        flag: 'touch_2',
        templateKey: 'touch_2',
        badge: '💬', badgeLabel: 'Касание',
        title: '2-е касание: через 120 ч (≈ 5 дн.)',
        hint: 'Через 120 ч после входа, если клиент не ответил.',
        rows: 4,
      },
      {
        flag: 'touch_3',
        templateKey: 'touch_3',
        badge: '💬', badgeLabel: 'Касание',
        title: '3-е касание: через 240 ч (≈ 10 дн.)',
        hint: 'Через 240 ч после входа. Финальное автоматическое касание.',
        rows: 4,
      },
      {
        flag: 'touch_no_reply',
        templateKey: 'touch_no_reply_task',
        badge: '⏰', badgeLabel: 'Задача',
        title: 'Через сутки после 3-го касания → задача',
        hint: 'Если клиент молчит сутки после 3-го касания — менеджеру задача.',
        rows: 3,
      },
    ],
  },
  {
    code: 'booked', title: 'Записан',
    color: 'green',
    cards: [],
  },
]

const COLOR_MAP: Record<string, { border: string; header: string; bg: string }> = {
  slate:  { border: 'border-slate-300',  header: 'bg-slate-100  text-slate-700',  bg: 'bg-slate-50/40' },
  blue:   { border: 'border-blue-300',   header: 'bg-blue-100   text-blue-800',   bg: 'bg-blue-50/40' },
  amber:  { border: 'border-amber-300',  header: 'bg-amber-100  text-amber-800',  bg: 'bg-amber-50/40' },
  green:  { border: 'border-emerald-300',header: 'bg-emerald-100 text-emerald-800', bg: 'bg-emerald-50/40' },
}

interface ClinicSettings {
  bot_enabled?: boolean
  automation?: Partial<Record<AutoFlag, boolean>>
  [k: string]: unknown
}

export default function AutomationSettingsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState('')
  const [error, setError]     = useState('')

  const [flags, setFlags] = useState<Record<AutoFlag, boolean>>({
    bot_enabled: true,
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
          .single<{ settings: ClinicSettings | null }>()
        const s = clinic?.settings ?? {}
        const auto = s.automation ?? {}

        const allKeys = STAGES.flatMap(st => st.cards.map(c => c.templateKey))
        const { data: tmpls } = await supabase
          .from('message_templates')
          .select('key, body')
          .eq('clinic_id', profile.clinic_id)
          .in('key', allKeys)
          .returns<{ key: string; body: string }[]>()

        if (cancelled) return

        setFlags(prev => {
          const next = { ...prev }
          // bot_enabled — старый ключ, лежит в settings напрямую.
          next.bot_enabled = s.bot_enabled !== false
          for (const st of STAGES) {
            for (const c of st.cards) {
              if (c.legacyBotFlag) continue
              next[c.flag] = auto[c.flag] !== false
            }
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
      // 1. Мерджим settings (чтобы не потерять working_hours и пр.).
      const { data: clinic } = await supabase
        .from('clinics')
        .select('settings')
        .eq('id', profile.clinic_id)
        .single<{ settings: ClinicSettings | null }>()

      const automation: Partial<Record<AutoFlag, boolean>> = {}
      for (const st of STAGES) for (const c of st.cards) {
        if (c.legacyBotFlag) continue
        automation[c.flag] = flags[c.flag]
      }
      const settings = {
        ...(clinic?.settings ?? {}),
        bot_enabled: flags.bot_enabled,
        automation,
      }

      const { error: cErr } = await supabase
        .from('clinics')
        .update({ settings })
        .eq('id', profile.clinic_id)
      if (cErr) throw cErr

      // 2. Тексты шаблонов.
      for (const st of STAGES) for (const c of st.cards) {
        const body = bodies[c.templateKey]?.trim()
        if (!body) continue
        const { error: tErr } = await supabase
          .from('message_templates')
          .upsert({
            clinic_id: profile.clinic_id,
            key: c.templateKey,
            title: c.title,
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
    <div className="p-2 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Настройка воронки «Лиды»</h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Автоматизации по этапам — как в amoCRM. Тогл — вкл/выкл; текст в
            карточке редактируется и сохраняется одной кнопкой. Шаблоны
            с маркером «[ЗАПОЛНИТЬ …]» клиентам не отправляются.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {toast && <span className="text-sm text-emerald-600">{toast}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Канбан-раскладка: горизонтальный скролл, колонки фикс ширины */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {STAGES.map(st => {
            const c = COLOR_MAP[st.color]
            return (
              <div
                key={st.code}
                className={`w-[340px] shrink-0 rounded-lg border ${c.border} ${c.bg}`}
              >
                <div className={`px-3 py-2 ${c.header} font-semibold text-sm uppercase tracking-wide rounded-t-lg`}>
                  {st.title}
                </div>
                <div className="p-2 space-y-2 min-h-[120px]">
                  {st.cards.length === 0 && (
                    <div className="text-xs text-slate-400 italic px-2 py-4 text-center">
                      Автоматизаций нет
                    </div>
                  )}
                  {st.cards.map(card => (
                    <div
                      key={card.flag}
                      className="rounded-md bg-white border border-slate-200 p-3 space-y-2 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-base">{card.badge}</span>
                          <span className="font-semibold uppercase tracking-wide text-slate-500">
                            {card.badgeLabel}
                          </span>
                        </div>
                        <label className="inline-flex shrink-0 items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-blue-600"
                            checked={flags[card.flag]}
                            onChange={e => setFlags(p => ({ ...p, [card.flag]: e.target.checked }))}
                          />
                          <span className={`text-xs ${flags[card.flag] ? 'text-emerald-700' : 'text-slate-400'}`}>
                            {flags[card.flag] ? 'Вкл' : 'Выкл'}
                          </span>
                        </label>
                      </div>
                      <div className="text-sm font-medium text-slate-900 leading-snug">
                        {card.title}
                      </div>
                      <div className="text-xs text-slate-500 leading-snug">{card.hint}</div>
                      <textarea
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono"
                        rows={card.rows}
                        placeholder="Текст шаблона…"
                        value={bodies[card.templateKey] ?? ''}
                        onChange={e => setBodies(p => ({ ...p, [card.templateKey]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="text-xs text-slate-400">
        Бот «Приветствие/Фоллоуап» в этапе «Неразобранное» работает 24/7 без
        проверки рабочих часов клиники.
      </div>
    </div>
  )
}
