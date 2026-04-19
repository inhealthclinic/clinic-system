'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Role } from '@/types'

interface Permission {
  id: string
  module: string
  action: string
  name: string
}

interface RolePermission {
  role_id: string
  permission_id: string
}

const MODULE_RU: Record<string, string> = {
  patients:  'Пациенты',
  crm:       'CRM',
  schedule:  'Расписание',
  visit:     'Визиты',
  medcard:   'Медкарта',
  lab:       'Лаборатория',
  finance:   'Финансы',
  inventory: 'Склад',
  analytics: 'Аналитика',
  tasks:     'Задачи',
  settings:  'Настройки',
}

const MODULE_ORDER = [
  'patients', 'crm', 'schedule', 'visit', 'medcard',
  'lab', 'finance', 'inventory', 'analytics', 'tasks', 'settings',
]

const SLUG_RU: Record<string, string> = {
  owner:    'Админ',
  admin:    'Администратор',
  doctor:   'Врач',
  nurse:    'Медсестра',
  laborant: 'Лаборант',
  cashier:  'Кассир',
  manager:  'Менеджер',
}

export default function RolesPage() {
  const supabase = createClient()

  const [roles, setRoles]       = useState<Role[]>([])
  const [perms, setPerms]       = useState<Permission[]>([])
  const [granted, setGranted]   = useState<Set<string>>(new Set()) // "role_id:perm_id"
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState<string | null>(null) // key while saving

  const load = useCallback(async () => {
    const [r, p, rp] = await Promise.all([
      supabase.from('roles').select('*').order('created_at'),
      supabase.from('permissions').select('*').order('module').order('action'),
      supabase.from('role_permissions').select('role_id, permission_id'),
    ])
    setRoles(r.data ?? [])
    setPerms(p.data ?? [])
    const grantedSet = new Set(
      (rp.data ?? []).map((x: RolePermission) => `${x.role_id}:${x.permission_id}`)
    )
    setGranted(grantedSet)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (roleId: string, permId: string, isOwner: boolean) => {
    if (isOwner) return // owner always has all
    const key = `${roleId}:${permId}`
    if (toggling) return
    setToggling(key)

    const has = granted.has(key)

    // Optimistic update
    setGranted(prev => {
      const next = new Set(prev)
      if (has) next.delete(key)
      else next.add(key)
      return next
    })

    if (has) {
      await supabase
        .from('role_permissions')
        .delete()
        .eq('role_id', roleId)
        .eq('permission_id', permId)
    } else {
      await supabase
        .from('role_permissions')
        .insert({ role_id: roleId, permission_id: permId })
    }

    setToggling(null)
  }

  // Group permissions by module
  const byModule = MODULE_ORDER.reduce<Record<string, Permission[]>>((acc, mod) => {
    const group = perms.filter(p => p.module === mod)
    if (group.length) acc[mod] = group
    return acc
  }, {})

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Роли и права</h2>
        <span className="text-xs text-gray-400">{roles.length} ролей · {perms.length} прав</span>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Загрузка...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              {/* ── Header ── */}
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3 min-w-[200px] sticky left-0 bg-gray-50 z-10 border-r border-gray-100">
                    Право
                  </th>
                  {roles.map(r => (
                    <th
                      key={r.id}
                      className="px-3 py-3 text-center min-w-[90px]"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: r.color }}
                        />
                        <span className="text-xs font-medium text-gray-700 leading-tight">
                          {SLUG_RU[r.slug] ?? r.name}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* ── Body ── */}
              <tbody>
                {Object.entries(byModule).map(([mod, modPerms]) => (
                  <>
                    {/* Module group header */}
                    <tr key={`grp-${mod}`} className="bg-blue-50/50 border-y border-blue-100/60">
                      <td
                        colSpan={roles.length + 1}
                        className="px-4 py-2 sticky left-0 bg-blue-50/50"
                      >
                        <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                          {MODULE_RU[mod] ?? mod}
                        </span>
                      </td>
                    </tr>

                    {/* Permission rows */}
                    {modPerms.map((perm, idx) => (
                      <tr
                        key={perm.id}
                        className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-50/30'}`}
                      >
                        <td className="px-4 py-2.5 sticky left-0 bg-white border-r border-gray-100 z-10">
                          <span className="text-xs text-gray-700">{perm.name}</span>
                          <span className="ml-2 text-[10px] text-gray-300 font-mono">{perm.action}</span>
                        </td>
                        {roles.map(r => {
                          const isOwner = r.slug === 'owner'
                          const key     = `${r.id}:${perm.id}`
                          const checked = isOwner || granted.has(key)
                          const isSaving = toggling === key

                          return (
                            <td key={r.id} className="px-3 py-2.5 text-center">
                              <button
                                type="button"
                                disabled={isOwner || isSaving}
                                onClick={() => toggle(r.id, perm.id, isOwner)}
                                className={[
                                  'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all',
                                  isOwner
                                    ? 'border-purple-300 bg-purple-100 cursor-default opacity-70'
                                    : checked
                                    ? 'border-blue-500 bg-blue-500 hover:bg-blue-600 hover:border-blue-600 cursor-pointer'
                                    : 'border-gray-300 bg-white hover:border-gray-400 cursor-pointer',
                                  isSaving ? 'opacity-50' : '',
                                ].join(' ')}
                                title={isOwner ? 'Админ имеет все права' : (checked ? 'Убрать право' : 'Добавить право')}
                              >
                                {checked && (
                                  <svg className={`w-3 h-3 ${isOwner ? 'text-purple-600' : 'text-white'}`} viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-6 bg-gray-50/50">
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded border-2 border-purple-300 bg-purple-100 inline-flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-purple-600" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="text-xs text-gray-500">Админ — всегда все права</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded border-2 border-blue-500 bg-blue-500 inline-flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span className="text-xs text-gray-500">Право включено</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded border-2 border-gray-300 bg-white inline-block" />
              <span className="text-xs text-gray-500">Право выключено</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
