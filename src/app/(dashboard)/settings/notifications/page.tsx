'use client'

// ============================================================
// /settings/notifications
// ────────────────────────────────────────────────────────────
// Two-level notification preferences:
//
//   Tab «Системные»     (scope='clinic', user_id=NULL)
//     One row per event_type. Configures the DEFAULT routing for
//     everyone in the clinic. Only owners/admins should see it
//     (the page is enforced by clinic-wide RLS — UI hides the tab
//     for non-admins).
//
//   Tab «Мои настройки» (scope='user', user_id=<me>)
//     Personal opt-OUT only: a checkbox per event for "не присылать
//     мне это". Implemented as enabled=false rows. Routing/channel
//     are inherited from the clinic-level config.
//
// All writes go to notification_preferences via upsert; the DB
// function resolve_notification_recipients() does the actual
// dispatch logic.
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { usePermissions } from '@/lib/hooks/usePermissions'
import {
  EVENT_TYPES, EVENT_LABEL, EVENT_GROUP, GROUP_LABEL,
  ROUTING_OPTIONS, CHANNEL_OPTIONS,
  type EventType, type RoutingValue, type ChannelValue,
  type NotificationPreferenceRow,
} from '@/lib/notifications/types'

interface RoleRow { id: string; slug: string; name: string }
interface UserRow { id: string; first_name: string; last_name: string }

// ─── Tabs ────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const { isOwner, isAdmin } = usePermissions()
  const canEditClinic = isOwner || isAdmin
  const clinicId = profile?.clinic_id ?? ''
  const userId = profile?.id ?? ''

  // For non-admins, force the user tab — clinic tab is hidden.
  const [tab, setTab] = useState<'clinic' | 'user'>(canEditClinic ? 'clinic' : 'user')
  const [prefs, setPrefs] = useState<NotificationPreferenceRow[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<EventType | null>(null)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const [prefRes, roleRes, userRes] = await Promise.all([
      supabase.from('notification_preferences')
        .select('*')
        .eq('clinic_id', clinicId),
      supabase.from('roles').select('id, slug, name').eq('clinic_id', clinicId),
      supabase.from('user_profiles')
        .select('id, first_name, last_name')
        .eq('clinic_id', clinicId).eq('is_active', true),
    ])
    setPrefs((prefRes.data ?? []) as NotificationPreferenceRow[])
    setRoles((roleRes.data ?? []) as RoleRow[])
    setUsers((userRes.data ?? []) as UserRow[])
    setLoading(false)
  }, [clinicId])

  useEffect(() => { load() }, [load])

  const flashSaved = (ev: EventType) => {
    setSaved(ev)
    setTimeout(() => setSaved(null), 1500)
  }

  // ── Clinic-level upsert ───────────────────────────────────
  const upsertClinicPref = async (
    eventType: EventType,
    patch: Partial<NotificationPreferenceRow>,
  ) => {
    const existing = prefs.find(p => p.scope === 'clinic' && p.event_type === eventType && p.user_id === null)
    const row = {
      clinic_id:         clinicId,
      scope:             'clinic' as const,
      user_id:           null,
      event_type:        eventType,
      enabled:           existing?.enabled ?? true,
      routing:           existing?.routing ?? 'responsible',
      target_role_slugs: existing?.target_role_slugs ?? [],
      target_user_ids:   existing?.target_user_ids ?? [],
      channels:          existing?.channels ?? ['in_app'],
      ...patch,
    }
    const { data } = await supabase
      .from('notification_preferences')
      .upsert(row, { onConflict: 'clinic_id,event_type,scope,user_id' })
      .select()
      .single()
    if (data) {
      setPrefs(prev => {
        const others = prev.filter(p => !(p.scope === 'clinic' && p.event_type === eventType && p.user_id === null))
        return [...others, data as NotificationPreferenceRow]
      })
      flashSaved(eventType)
    }
  }

  // ── User-level opt-out toggle ─────────────────────────────
  const toggleUserOptOut = async (eventType: EventType, optOut: boolean) => {
    if (!userId) return
    if (optOut) {
      const row = {
        clinic_id: clinicId,
        scope: 'user' as const,
        user_id: userId,
        event_type: eventType,
        enabled: false,
        routing: 'responsible' as RoutingValue,
        target_role_slugs: [],
        target_user_ids: [],
        channels: ['in_app'] as ChannelValue[],
      }
      const { data } = await supabase
        .from('notification_preferences')
        .upsert(row, { onConflict: 'clinic_id,event_type,scope,user_id' })
        .select()
        .single()
      if (data) {
        setPrefs(prev => {
          const others = prev.filter(p => !(p.scope === 'user' && p.event_type === eventType && p.user_id === userId))
          return [...others, data as NotificationPreferenceRow]
        })
      }
    } else {
      // delete the user-row to revert to clinic default
      await supabase
        .from('notification_preferences')
        .delete()
        .eq('clinic_id', clinicId)
        .eq('scope', 'user')
        .eq('user_id', userId)
        .eq('event_type', eventType)
      setPrefs(prev => prev.filter(p => !(p.scope === 'user' && p.event_type === eventType && p.user_id === userId)))
    }
    flashSaved(eventType)
  }

  // ── Render ────────────────────────────────────────────────

  const grouped = EVENT_TYPES.reduce<Record<string, EventType[]>>((acc, ev) => {
    const g = EVENT_GROUP[ev]
    if (!acc[g]) acc[g] = []
    acc[g].push(ev)
    return acc
  }, {})

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-gray-400 hover:text-gray-600">
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Уведомления</h1>
          <p className="text-sm text-gray-400">Кто получает какие события и как</p>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 max-w-md">
        {canEditClinic && (
          <button
            onClick={() => setTab('clinic')}
            className={[
              'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors',
              tab === 'clinic' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            🏥 Системные правила
          </button>
        )}
        <button
          onClick={() => setTab('user')}
          className={[
            'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors',
            tab === 'user' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          👤 Мои настройки
        </button>
      </div>
      {!canEditClinic && (
        <p className="text-xs text-gray-400 mb-4">
          Системные правила настраивает владелец или администратор клиники.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-12">Загрузка...</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([group, events]) => (
            <div key={group} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{GROUP_LABEL[group]}</h2>
              </div>
              <div className="divide-y divide-gray-50">
                {events.map(ev => {
                  const clinicPref = prefs.find(p => p.scope === 'clinic' && p.event_type === ev && p.user_id === null)
                  const userPref   = prefs.find(p => p.scope === 'user'   && p.event_type === ev && p.user_id === userId)
                  const justSaved = saved === ev

                  if (tab === 'clinic') {
                    return (
                      <ClinicPrefRow
                        key={ev}
                        event={ev}
                        pref={clinicPref ?? null}
                        roles={roles}
                        users={users}
                        onChange={patch => upsertClinicPref(ev, patch)}
                        justSaved={justSaved}
                      />
                    )
                  }
                  // user tab
                  const optedOut = !!userPref && userPref.enabled === false
                  return (
                    <UserPrefRow
                      key={ev}
                      event={ev}
                      clinicPref={clinicPref ?? null}
                      optedOut={optedOut}
                      onToggle={v => toggleUserOptOut(ev, v)}
                      justSaved={justSaved}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Clinic row ──────────────────────────────────────────────

function ClinicPrefRow({ event, pref, roles, users, onChange, justSaved }: {
  event: EventType
  pref: NotificationPreferenceRow | null
  roles: RoleRow[]
  users: UserRow[]
  onChange: (patch: Partial<NotificationPreferenceRow>) => void
  justSaved: boolean
}) {
  const enabled = pref?.enabled ?? true
  const routing = pref?.routing ?? 'responsible'
  const targetRoles = pref?.target_role_slugs ?? []
  const targetUsers = pref?.target_user_ids ?? []
  const channels = pref?.channels ?? ['in_app']

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-4">
        {/* Toggle */}
        <button
          onClick={() => onChange({ enabled: !enabled })}
          className={[
            'mt-0.5 relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
            enabled ? 'bg-emerald-500' : 'bg-gray-200',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform',
              enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
            ].join(' ')}
          />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{EVENT_LABEL[event]}</p>

          {enabled && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={routing}
                onChange={e => onChange({ routing: e.target.value as RoutingValue })}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
              >
                {ROUTING_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>

              {routing === 'all_role' && (
                <select
                  value={targetRoles[0] ?? ''}
                  onChange={e => onChange({ target_role_slugs: e.target.value ? [e.target.value] : [] })}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                >
                  <option value="">— выбрать роль —</option>
                  {roles.map(r => <option key={r.id} value={r.slug}>{r.name}</option>)}
                </select>
              )}

              {routing === 'specific_users' && (
                <select
                  multiple
                  value={targetUsers}
                  onChange={e => {
                    const sel = Array.from(e.target.selectedOptions).map(o => o.value)
                    onChange({ target_user_ids: sel })
                  }}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white min-w-[180px]"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>
                  ))}
                </select>
              )}

              {/* Channels */}
              <div className="flex items-center gap-1.5 ml-auto">
                {CHANNEL_OPTIONS.map(c => {
                  const on = channels.includes(c.value)
                  return (
                    <button
                      key={c.value}
                      onClick={() => {
                        if (!c.ready) return
                        const next: ChannelValue[] = on
                          ? channels.filter(x => x !== c.value)
                          : [...channels, c.value]
                        onChange({ channels: next })
                      }}
                      disabled={!c.ready}
                      title={c.ready ? c.label : `${c.label} — скоро`}
                      className={[
                        'text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors',
                        on
                          ? 'bg-blue-100 text-blue-700'
                          : c.ready
                            ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            : 'bg-gray-50 text-gray-300 cursor-not-allowed',
                      ].join(' ')}
                    >
                      {c.label}{!c.ready && ' (скоро)'}
                    </button>
                  )
                })}
              </div>

              {justSaved && (
                <span className="text-[10px] text-emerald-600 font-medium ml-2">✓ сохранено</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── User row (opt-out only) ─────────────────────────────────

function UserPrefRow({ event, clinicPref, optedOut, onToggle, justSaved }: {
  event: EventType
  clinicPref: NotificationPreferenceRow | null
  optedOut: boolean
  onToggle: (optOut: boolean) => void
  justSaved: boolean
}) {
  const clinicEnabled = clinicPref?.enabled ?? true
  const clinicRouting = clinicPref?.routing ?? 'responsible'
  const routingLabel = ROUTING_OPTIONS.find(r => r.value === clinicRouting)?.label ?? ''

  return (
    <div className="px-4 py-3 flex items-center gap-4">
      <button
        onClick={() => onToggle(!optedOut)}
        disabled={!clinicEnabled}
        className={[
          'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
          !clinicEnabled ? 'bg-gray-100 cursor-not-allowed' : optedOut ? 'bg-gray-200' : 'bg-emerald-500',
        ].join(' ')}
        title={clinicEnabled ? 'Получать это уведомление' : 'Отключено в системных правилах'}
      >
        <span
          className={[
            'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform',
            !clinicEnabled || optedOut ? 'translate-x-0.5' : 'translate-x-[18px]',
          ].join(' ')}
        />
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{EVENT_LABEL[event]}</p>
        <p className="text-xs text-gray-400">
          {clinicEnabled
            ? `Системно: ${routingLabel}${optedOut ? ' · я отключил для себя' : ''}`
            : 'Отключено системно'}
        </p>
      </div>

      {justSaved && (
        <span className="text-[10px] text-emerald-600 font-medium">✓</span>
      )}
    </div>
  )
}
