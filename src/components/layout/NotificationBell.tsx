'use client'

// ============================================================
// NotificationBell
// ────────────────────────────────────────────────────────────
// Header chip with unread count + dropdown.
//
// • Polls staff_notifications every 30s for the current user
//   (kept simple; can be upgraded to Supabase realtime later).
// • Click on bell → dropdown with last 20 notifications.
// • Click on a notification → mark read + navigate to .link.
// • "Прочитать все" — bulk markAllRead.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { markRead, markAllRead } from '@/lib/notifications/create'
import type { StaffNotificationRow } from '@/lib/notifications/types'

const POLL_MS = 30_000

const EVENT_ICON: Record<string, string> = {
  whatsapp_new_lead:    '🆕',
  whatsapp_new_message: '💬',
  whatsapp_no_reply:    '⏰',
  task_assigned:        '✅',
  task_overdue:         '⚠️',
  deal_stage_changed:   '📊',
  deal_assigned:        '👤',
  deal_won:             '🏆',
  appointment_created:  '📅',
  appointment_cancelled:'❌',
  appointment_no_show:  '🚫',
  payment_received:     '💰',
  lab_critical:         '🚨',
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)     return 'только что'
  if (diff < 3600)   return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400)  return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} дн назад`
}

export function NotificationBell() {
  const supabase = createClient()
  const router = useRouter()
  const { user } = useCurrentUser()
  const userId = user?.id ?? null
  const [items, setItems] = useState<StaffNotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    const [listRes, countRes] = await Promise.all([
      supabase.from('staff_notifications')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'dismissed')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('staff_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'unread'),
    ])
    setItems((listRes.data ?? []) as StaffNotificationRow[])
    setUnread(countRes.count ?? 0)
  }, [userId])

  useEffect(() => {
    load()
    if (timerRef.current) clearInterval(timerRef.current)
    if (userId) timerRef.current = setInterval(load, POLL_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [userId, load])

  const handleClick = async (n: StaffNotificationRow) => {
    if (n.status === 'unread') {
      await markRead(supabase, n.id)
      setUnread(c => Math.max(0, c - 1))
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, status: 'read' as const } : x))
    }
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  const handleMarkAll = async () => {
    if (!userId) return
    await markAllRead(supabase, userId)
    setUnread(0)
    setItems(prev => prev.map(x => x.status === 'unread' ? { ...x, status: 'read' as const } : x))
  }

  if (!userId) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Уведомления"
        className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .53-.21 1.04-.59 1.4L4 17h5m6 0a3 3 0 01-6 0m6 0H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-[16px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-96 max-h-[80vh] bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <p className="text-sm font-semibold text-gray-800">Уведомления</p>
              {unread > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Прочитать все
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <p className="text-center text-sm text-gray-300 py-12 italic">Уведомлений нет</p>
              ) : (
                items.map(n => {
                  const icon = EVENT_ICON[n.event_type] ?? '🔔'
                  const isUnread = n.status === 'unread'
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={[
                        'w-full text-left px-4 py-3 border-b border-gray-50 last:border-b-0 transition-colors',
                        isUnread ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-gray-50',
                      ].join(' ')}
                    >
                      <div className="flex gap-3">
                        <span className="text-base flex-shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className={['text-sm', isUnread ? 'font-medium text-gray-900' : 'text-gray-700'].join(' ')}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{n.body}</p>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1">{relTime(n.created_at)}</p>
                        </div>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            <div className="border-t border-gray-100 px-4 py-2.5 flex-shrink-0">
              <Link
                href="/settings/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                ⚙ Настройки уведомлений
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
