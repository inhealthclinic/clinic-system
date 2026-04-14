'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { PermissionGuard } from '@/components/shared/PermissionGuard'

interface Permission { id: string; module: string; action: string; name: string }
interface Role { id: string; name: string; slug: string; color: string; max_discount_percent: number | null; is_system: boolean }
interface RolePerm { role_id: string; permission_id: string }

const MODULE_LABELS: Record<string, string> = {
  patients: 'Пациенты', crm: 'CRM', schedule: 'Расписание',
  visit: 'Визиты', medcard: 'Медкарта', lab: 'Лаборатория',
  finance: 'Финансы', inventory: 'Склад', analytics: 'Аналитика',
  tasks: 'Задачи', settings: 'Настройки',
}

export default function RolesPage() {
  const { can } = usePermissions()
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [rolePerms, setRolePerms] = useState<RolePerm[]>([])
  const [activeRole, setActiveRole] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()
  const canEdit = can('settings:roles')

  useEffect(() => {
    Promise.all([
      supabase.from('roles').select('*').order('is_system', { ascending: false }),
      supabase.from('permissions').select('*').order('module').order('action'),
      supabase.from('role_permissions').select('*'),
    ]).then(([r, p, rp]) => {
      setRoles(r.data || [])
      setPermissions(p.data || [])
      setRolePerms(rp.data || [])
      if (r.data?.length) setActiveRole(r.data[0].id)
    })
  }, [])

  const hasPerm = (roleId: string, permId: string) =>
    rolePerms.some(rp => rp.role_id === roleId && rp.permission_id === permId)

  const togglePerm = async (roleId: string, permId: string) => {
    if (!canEdit) return
    const role = roles.find(r => r.id === roleId)
    if (role?.slug === 'owner') return // owner нельзя менять

    setSaving(true)
    if (hasPerm(roleId, permId)) {
      await supabase.from('role_permissions')
        .delete().eq('role_id', roleId).eq('permission_id', permId)
      setRolePerms(prev => prev.filter(
        rp => !(rp.role_id === roleId && rp.permission_id === permId)
      ))
    } else {
      await supabase.from('role_permissions').insert({ role_id: roleId, permission_id: permId })
      setRolePerms(prev => [...prev, { role_id: roleId, permission_id: permId }])
    }
    setSaving(false)
  }

  // Сгруппировать права по модулю
  const grouped = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = []
    acc[p.module].push(p)
    return acc
  }, {} as Record<string, Permission[]>)

  const activeRoleData = roles.find(r => r.id === activeRole)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Роли и права</h1>
        <p className="text-gray-500 text-sm mt-1">
          Управление доступом сотрудников к разделам системы
        </p>
      </div>

      <div className="flex gap-6">
        {/* Список ролей */}
        <div className="w-56 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {roles.map(role => (
              <button
                key={role.id}
                onClick={() => setActiveRole(role.id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors ${
                  activeRole === role.id ? 'bg-blue-50' : ''
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: role.color }}
                />
                <span className={`text-sm font-medium ${activeRole === role.id ? 'text-blue-700' : 'text-gray-700'}`}>
                  {role.name}
                </span>
                {role.slug === 'owner' && (
                  <span className="ml-auto text-xs text-gray-400">∞</span>
                )}
              </button>
            ))}
          </div>

          {activeRoleData && activeRoleData.slug !== 'owner' && (
            <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-2">Макс. скидка</p>
              <PermissionGuard permission="settings:roles" fallback={
                <p className="text-sm font-semibold">
                  {activeRoleData.max_discount_percent ?? '∞'}%
                </p>
              }>
                <input
                  type="number"
                  min={0} max={100}
                  value={activeRoleData.max_discount_percent ?? ''}
                  placeholder="∞"
                  onChange={async (e) => {
                    const val = e.target.value === '' ? null : Number(e.target.value)
                    await supabase.from('roles')
                      .update({ max_discount_percent: val })
                      .eq('id', activeRoleData.id)
                    setRoles(prev => prev.map(r =>
                      r.id === activeRoleData.id ? { ...r, max_discount_percent: val } : r
                    ))
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </PermissionGuard>
            </div>
          )}
        </div>

        {/* Матрица прав */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
          {activeRoleData?.slug === 'owner' ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <div className="text-center">
                <p className="text-lg">👑</p>
                <p className="text-sm mt-1">Владелец имеет все права</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {Object.entries(grouped).map(([module, perms]) => (
                <div key={module} className="p-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    {MODULE_LABELS[module] || module}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {perms.map(perm => {
                      const checked = activeRole ? hasPerm(activeRole, perm.id) : false
                      return (
                        <label
                          key={perm.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                            checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                          } ${!canEdit ? 'opacity-60 cursor-default' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canEdit || saving}
                            onChange={() => activeRole && togglePerm(activeRole, perm.id)}
                            className="w-4 h-4 rounded accent-blue-600"
                          />
                          <span className="text-sm text-gray-700">{perm.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
