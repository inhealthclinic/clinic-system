'use client'

/**
 * /settings/roles — матрица «право × роль» с логическими цепочками.
 *
 * Ключевые улучшения:
 *   1. Автокаскад ON: включение «edit/create/delete/sign/verify/…» автоматически
 *      включает «view» в том же модуле (и другие prerequisite).
 *   2. Автокаскад OFF: снятие «view» предлагает снять все права модуля
 *      (иначе роль физически не сможет их использовать).
 *   3. Пакетный выбор по модулю для роли (✓ всё / ✕ ничего).
 *   4. Поиск по правам.
 *   5. Управление ролями: добавление, переименование, цвет, лимит скидки, удаление.
 *   6. Сводка «прав включено» в шапке каждой колонки.
 *   7. Предупреждение, если у роли есть edit/delete, но нет view.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
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

// ─── Логические цепочки ─────────────────────────────────────────────────────
// Для каждой пары (module, action) — какие права (module.action) должны быть
// включены автоматически при включении этого права.
const PREREQS: Record<string, Array<[string, string]>> = {
  // В каждом модуле write-действия требуют view
  'patients:create':    [['patients','view']],
  'patients:edit':      [['patients','view']],
  'patients:delete':    [['patients','view']],
  'patients:export':    [['patients','view']],
  'patients:merge':     [['patients','view']],
  'crm:create':         [['crm','view']],
  'crm:edit':           [['crm','view']],
  'crm:delete':         [['crm','view']],
  'schedule:create':    [['schedule','view']],
  'schedule:edit':      [['schedule','view']],
  'schedule:delete':    [['schedule','view']],
  'schedule:view_all':  [['schedule','view']],
  'visit:create':       [['visit','view']],
  'visit:edit':         [['visit','view']],
  'visit:close':        [['visit','view'], ['visit','edit'], ['medcard','view'], ['medcard','edit']],
  'medcard:create':     [['medcard','view']],
  'medcard:edit':       [['medcard','view']],
  'medcard:delete':     [['medcard','view']],
  'medcard:sign':       [['medcard','view'], ['medcard','edit']],
  'lab:enter_results':  [['lab','view']],
  'lab:edit_result':    [['lab','view'], ['lab','enter_results']],
  'lab:verify':         [['lab','view'], ['lab','enter_results']],
  'lab:order':          [['lab','view']],
  'inventory:create':   [['inventory','view']],
  'inventory:writeoff': [['inventory','view']],
  'tasks:create':       [['tasks','view']],
  'tasks:edit':         [['tasks','view']],
  'settings:clinic':        [['settings','view']],
  'settings:doctors':       [['settings','view']],
  'settings:services':      [['settings','view']],
  'settings:users':         [['settings','view']],
  'settings:roles':         [['settings','view']],
  'settings:lab_templates': [['settings','view']],
  'settings:notifications': [['settings','view']],
}

const keyOf = (module: string, action: string) => `${module}:${action}`

// ─── Page ───────────────────────────────────────────────────────────────────
export default function RolesPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [roles, setRoles]       = useState<Role[]>([])
  const [perms, setPerms]       = useState<Permission[]>([])
  const [granted, setGranted]   = useState<Set<string>>(new Set()) // "role_id:perm_id"
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [search, setSearch]     = useState('')
  const [editRole, setEditRole] = useState<Role | null | undefined>(undefined) // undefined=closed, null=create
  const [cascadeNotice, setCascadeNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [r, p, rp] = await Promise.all([
      supabase.from('roles').select('*').order('created_at'),
      supabase.from('permissions').select('*').order('module').order('action'),
      supabase.from('role_permissions').select('role_id, permission_id'),
    ])
    setRoles((r.data ?? []) as Role[])
    setPerms((p.data ?? []) as Permission[])
    const grantedSet = new Set(
      (rp.data ?? []).map((x: RolePermission) => `${x.role_id}:${x.permission_id}`)
    )
    setGranted(grantedSet)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // Быстрый доступ: permission_id по (module,action), и обратно
  const permByMa = useMemo(() => {
    const m = new Map<string, Permission>()
    perms.forEach(p => m.set(keyOf(p.module, p.action), p))
    return m
  }, [perms])

  // Группировка по модулю (для видимого порядка)
  const byModule = useMemo(() => {
    const q = search.trim().toLowerCase()
    return MODULE_ORDER.reduce<Record<string, Permission[]>>((acc, mod) => {
      const group = perms.filter(p => p.module === mod
        && (!q
          || p.name.toLowerCase().includes(q)
          || p.action.toLowerCase().includes(q)
          || (MODULE_RU[p.module] ?? p.module).toLowerCase().includes(q)))
      if (group.length) acc[mod] = group
      return acc
    }, {})
  }, [perms, search])

  // Применяет к БД разницу: add[] и remove[] — массивы ключей (role:perm)
  const applyBatch = async (roleId: string, addPermIds: string[], removePermIds: string[]) => {
    if (addPermIds.length === 0 && removePermIds.length === 0) return
    // Оптимистично
    setGranted(prev => {
      const next = new Set(prev)
      addPermIds.forEach(pid => next.add(`${roleId}:${pid}`))
      removePermIds.forEach(pid => next.delete(`${roleId}:${pid}`))
      return next
    })
    // Real
    if (addPermIds.length > 0) {
      await supabase.from('role_permissions').insert(
        addPermIds.map(pid => ({ role_id: roleId, permission_id: pid }))
      )
    }
    if (removePermIds.length > 0) {
      for (const pid of removePermIds) {
        await supabase.from('role_permissions')
          .delete().eq('role_id', roleId).eq('permission_id', pid)
      }
    }
  }

  // Включить право + каскад prereqs
  const enableWithCascade = async (roleId: string, perm: Permission) => {
    const k = keyOf(perm.module, perm.action)
    const toAdd = new Set<string>([perm.id])
    const touchedNames: string[] = []
    const queue = [k]
    const visited = new Set<string>([k])
    while (queue.length) {
      const cur = queue.shift()!
      const reqs = PREREQS[cur] ?? []
      for (const [m, a] of reqs) {
        const rk = keyOf(m, a)
        if (visited.has(rk)) continue
        visited.add(rk)
        const reqPerm = permByMa.get(rk)
        if (!reqPerm) continue
        const gkey = `${roleId}:${reqPerm.id}`
        if (!granted.has(gkey) && !toAdd.has(reqPerm.id)) {
          toAdd.add(reqPerm.id)
          touchedNames.push(reqPerm.name)
          queue.push(rk)
        }
      }
    }
    await applyBatch(roleId, Array.from(toAdd), [])
    if (touchedNames.length) {
      setCascadeNotice(`Автоматически добавлено: ${touchedNames.join(', ')}`)
      setTimeout(() => setCascadeNotice(''), 4000)
    }
  }

  // Выключить право + каскад всех зависящих от него
  const disableWithCascade = async (roleId: string, perm: Permission) => {
    const k = keyOf(perm.module, perm.action)
    // Найти всех, у кого prereq == k
    const dependents = Object.entries(PREREQS)
      .filter(([, reqs]) => reqs.some(([m, a]) => keyOf(m, a) === k))
      .map(([dep]) => dep)

    const toRemoveIds = new Set<string>([perm.id])
    const touchedNames: string[] = []
    const queue = [...dependents]
    while (queue.length) {
      const depKey = queue.shift()!
      const depPerm = permByMa.get(depKey)
      if (!depPerm) continue
      const gkey = `${roleId}:${depPerm.id}`
      if (granted.has(gkey) && !toRemoveIds.has(depPerm.id)) {
        toRemoveIds.add(depPerm.id)
        touchedNames.push(depPerm.name)
        // рекурсивно — что зависит от этого
        const nested = Object.entries(PREREQS)
          .filter(([, reqs]) => reqs.some(([m, a]) => keyOf(m, a) === depKey))
          .map(([dep]) => dep)
        queue.push(...nested)
      }
    }

    if (touchedNames.length > 0) {
      const ok = confirm(
        `Права, требующие «${perm.name}», будут сняты:\n\n• ${touchedNames.join('\n• ')}\n\nПродолжить?`
      )
      if (!ok) return
    }
    await applyBatch(roleId, [], Array.from(toRemoveIds))
    if (touchedNames.length) {
      setCascadeNotice(`Автоматически снято: ${touchedNames.join(', ')}`)
      setTimeout(() => setCascadeNotice(''), 4000)
    }
  }

  const toggle = async (role: Role, perm: Permission) => {
    if (role.slug === 'owner') return
    const key = `${role.id}:${perm.id}`
    if (toggling) return
    setToggling(key)
    try {
      if (granted.has(key)) {
        await disableWithCascade(role.id, perm)
      } else {
        await enableWithCascade(role.id, perm)
      }
    } finally {
      setToggling(null)
    }
  }

  // Пакетный тоггл для модуля у роли
  const toggleModule = async (role: Role, module: string, turnOn: boolean) => {
    if (role.slug === 'owner') return
    const modPerms = perms.filter(p => p.module === module)
    if (turnOn) {
      const toAdd = modPerms
        .filter(p => !granted.has(`${role.id}:${p.id}`))
        .map(p => p.id)
      await applyBatch(role.id, toAdd, [])
    } else {
      // Проверим, есть ли вне модуля зависимости, которые без этих прав не работают
      const touched: string[] = []
      const toRemove: string[] = []
      for (const p of modPerms) {
        if (granted.has(`${role.id}:${p.id}`)) toRemove.push(p.id)
      }
      // Каскад: что во всех остальных модулях зависит от любого из снимаемых
      const removingKeys = new Set(modPerms.map(p => keyOf(p.module, p.action)))
      for (const [depKey, reqs] of Object.entries(PREREQS)) {
        if (!reqs.some(([m, a]) => removingKeys.has(keyOf(m, a)))) continue
        const depPerm = permByMa.get(depKey)
        if (!depPerm) continue
        if (granted.has(`${role.id}:${depPerm.id}`) && !toRemove.includes(depPerm.id)) {
          toRemove.push(depPerm.id)
          touched.push(depPerm.name)
        }
      }
      if (touched.length > 0) {
        const ok = confirm(
          `Вместе с модулем снимутся зависимые права:\n\n• ${touched.join('\n• ')}\n\nПродолжить?`
        )
        if (!ok) return
      }
      await applyBatch(role.id, [], toRemove)
    }
  }

  // Считает кол-во прав у роли
  const roleCount = (role: Role): number => {
    if (role.slug === 'owner') return perms.length
    return perms.reduce((n, p) => n + (granted.has(`${role.id}:${p.id}`) ? 1 : 0), 0)
  }

  // Проверяет «висячие» права (edit/delete/… без view)
  const roleHasDangling = (role: Role): boolean => {
    if (role.slug === 'owner') return false
    for (const [depKey, reqs] of Object.entries(PREREQS)) {
      const dep = permByMa.get(depKey)
      if (!dep || !granted.has(`${role.id}:${dep.id}`)) continue
      for (const [m, a] of reqs) {
        const req = permByMa.get(keyOf(m, a))
        if (req && !granted.has(`${role.id}:${req.id}`)) return true
      }
    }
    return false
  }

  // Кол-во пользователей с этой ролью (чтобы блокировать удаление)
  const [usersPerRole, setUsersPerRole] = useState<Record<string, number>>({})
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('role_id')
        .not('role_id', 'is', null)
      const counts: Record<string, number> = {}
      ;(data ?? []).forEach((u: { role_id: string }) => {
        counts[u.role_id] = (counts[u.role_id] ?? 0) + 1
      })
      setUsersPerRole(counts)
    })()
  }, [supabase, roles.length])

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900">Роли и права</h2>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по правам..."
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <button
            onClick={() => setEditRole(null)}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium">
            + Роль
          </button>
          <span className="text-xs text-gray-400">{roles.length} ролей · {perms.length} прав</span>
        </div>
      </div>

      {/* Уведомление о каскаде */}
      {cascadeNotice && (
        <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
          {cascadeNotice}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Загрузка...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3 min-w-[220px] sticky left-0 bg-gray-50 z-10 border-r border-gray-100">
                    Право
                  </th>
                  {roles.map(r => {
                    const cnt = roleCount(r)
                    const dangling = roleHasDangling(r)
                    return (
                      <th key={r.id} className="px-3 py-3 text-center min-w-[100px]">
                        <button
                          onClick={() => setEditRole(r)}
                          className="flex flex-col items-center gap-1 mx-auto group">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ background: r.color }} />
                          <span className="text-xs font-medium text-gray-700 leading-tight group-hover:text-blue-600 group-hover:underline">
                            {SLUG_RU[r.slug] ?? r.name}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {cnt}/{perms.length}
                            {dangling && <span className="ml-1 text-amber-600" title="Есть права без view">⚠</span>}
                          </span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>

              <tbody>
                {Object.entries(byModule).map(([mod, modPerms]) => (
                  <ModuleBlock
                    key={mod}
                    module={mod}
                    perms={modPerms}
                    roles={roles}
                    granted={granted}
                    toggling={toggling}
                    onToggle={toggle}
                    onToggleModule={toggleModule}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-4 bg-gray-50/50">
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded border-2 border-purple-300 bg-purple-100 inline-flex items-center justify-center">
                <Check className="text-purple-600" />
              </span>
              <span className="text-xs text-gray-500">Админ — всегда все права</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded border-2 border-blue-500 bg-blue-500 inline-flex items-center justify-center">
                <Check className="text-white" />
              </span>
              <span className="text-xs text-gray-500">Включено</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded border-2 border-gray-300 bg-white inline-block" />
              <span className="text-xs text-gray-500">Выключено</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-amber-600 text-sm">⚠</span>
              <span className="text-xs text-gray-500">Есть права без view (неработоспособно)</span>
            </div>
            <div className="flex-1" />
            <span className="text-xs text-gray-400">
              При включении права автоматически добавятся зависимые (например, view). При отключении view — каскад снимет всё.
            </span>
          </div>
        </div>
      )}

      {editRole !== undefined && clinicId && (
        <RoleModal
          role={editRole}
          clinicId={clinicId}
          usersCount={editRole ? (usersPerRole[editRole.id] ?? 0) : 0}
          onClose={() => setEditRole(undefined)}
          onSaved={() => { setEditRole(undefined); load() }}
        />
      )}
    </div>
  )
}

// ─── Module block (row with bulk controls + permission rows) ────────────────
function ModuleBlock({
  module, perms, roles, granted, toggling,
  onToggle, onToggleModule,
}: {
  module: string
  perms: Permission[]
  roles: Role[]
  granted: Set<string>
  toggling: string | null
  onToggle: (role: Role, perm: Permission) => void
  onToggleModule: (role: Role, module: string, on: boolean) => void
}) {
  // Для пакетного toggl’а — считаем сколько прав роли включено в этом модуле
  const roleModuleState = (role: Role): 'none' | 'some' | 'all' => {
    if (role.slug === 'owner') return 'all'
    const total = perms.length
    const on = perms.filter(p => granted.has(`${role.id}:${p.id}`)).length
    if (on === 0) return 'none'
    if (on === total) return 'all'
    return 'some'
  }

  return (
    <>
      {/* Module group header with bulk controls per role */}
      <tr className="bg-blue-50/50 border-y border-blue-100/60">
        <td className="px-4 py-2 sticky left-0 bg-blue-50/50 z-10">
          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            {MODULE_RU[module] ?? module}
          </span>
        </td>
        {roles.map(r => {
          const st = roleModuleState(r)
          const isOwner = r.slug === 'owner'
          return (
            <td key={r.id} className="px-2 py-1 text-center">
              {!isOwner && (
                <div className="inline-flex rounded border border-blue-200 bg-white overflow-hidden">
                  <button
                    onClick={() => onToggleModule(r, module, true)}
                    disabled={st === 'all'}
                    title="Включить все права модуля"
                    className={`text-[11px] px-1.5 py-0.5 ${st === 'all' ? 'bg-blue-100 text-blue-500 cursor-default' : 'hover:bg-blue-50 text-blue-700'}`}>
                    ✓
                  </button>
                  <button
                    onClick={() => onToggleModule(r, module, false)}
                    disabled={st === 'none'}
                    title="Снять все права модуля"
                    className={`text-[11px] px-1.5 py-0.5 border-l border-blue-200 ${st === 'none' ? 'bg-gray-50 text-gray-300 cursor-default' : 'hover:bg-red-50 text-red-600'}`}>
                    ✕
                  </button>
                </div>
              )}
            </td>
          )
        })}
      </tr>

      {/* Permission rows */}
      {perms.map((perm, idx) => (
        <tr key={perm.id}
            className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
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
                  onClick={() => onToggle(r, perm)}
                  className={[
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-all',
                    isOwner
                      ? 'border-purple-300 bg-purple-100 cursor-default opacity-70'
                      : checked
                      ? 'border-blue-500 bg-blue-500 hover:bg-blue-600 hover:border-blue-600 cursor-pointer'
                      : 'border-gray-300 bg-white hover:border-gray-400 cursor-pointer',
                    isSaving ? 'opacity-50' : '',
                  ].join(' ')}
                  title={isOwner ? 'Админ имеет все права' : (checked ? 'Снять' : 'Добавить')}>
                  {checked && <Check className={isOwner ? 'text-purple-600' : 'text-white'} />}
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

// ─── Role modal (create / edit / delete) ─────────────────────────────────────
function RoleModal({
  role, clinicId, usersCount, onClose, onSaved,
}: {
  role: Role | null
  clinicId: string
  usersCount: number
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const isEdit = !!role
  const isSystem = role?.is_system ?? false
  const isOwner  = role?.slug === 'owner'

  const [name, setName]                 = useState(role?.name ?? '')
  const [slug, setSlug]                 = useState(role?.slug ?? '')
  const [color, setColor]               = useState(role?.color ?? '#6366f1')
  const [maxDiscount, setMaxDiscount]   = useState(
    role?.max_discount_percent != null ? String(role.max_discount_percent) : ''
  )
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]     = useState('')

  const save = async () => {
    setError('')
    if (!name.trim()) { setError('Название обязательно'); return }
    if (!isEdit && !slug.trim()) { setError('Slug обязателен для новой роли'); return }
    setSaving(true)
    const payload: Record<string, unknown> = {
      name: name.trim(),
      color,
      max_discount_percent: maxDiscount.trim() === '' ? null : Number(maxDiscount),
    }
    if (!isEdit) {
      payload.clinic_id = clinicId
      payload.slug      = slug.trim().toLowerCase()
      payload.is_system = false
    }
    const { error: err } = isEdit
      ? await supabase.from('roles').update(payload).eq('id', role!.id)
      : await supabase.from('roles').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  const del = async () => {
    if (!role) return
    if (usersCount > 0) {
      setError(`Удалить нельзя: к роли привязано ${usersCount} пользователей`)
      return
    }
    if (!confirm(`Удалить роль «${role.name}»? Действие необратимо.`)) return
    setDeleting(true)
    const { error: err } = await supabase.from('roles').delete().eq('id', role.id)
    setDeleting(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  const colors = ['#6366f1','#ec4899','#ef4444','#f59e0b','#10b981','#06b6d4','#3b82f6','#8b5cf6','#64748b']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">
            {isEdit ? `Роль «${role!.name}»` : 'Новая роль'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Название</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              disabled={isOwner}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:bg-gray-50" />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Slug (латиница, без пробелов)</label>
              <input
                value={slug} onChange={e => setSlug(e.target.value.replace(/[^a-z0-9_]/g, ''))}
                placeholder="senior_nurse"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              <p className="text-[11px] text-gray-400 mt-1">Используется в коде; изменить потом нельзя.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Цвет</label>
            <div className="flex items-center gap-2 flex-wrap">
              {colors.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-gray-900' : 'border-gray-200'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Лимит скидки, %</label>
            <input
              type="number" min="0" max="100" step="0.5"
              value={maxDiscount}
              onChange={e => setMaxDiscount(e.target.value)}
              placeholder="пусто = нет лимита"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
            <p className="text-[11px] text-gray-400 mt-1">
              Если у пользователя с этой ролью стоит скидка больше лимита — платёж уходит на «одобрение» админу.
            </p>
          </div>

          {isEdit && (
            <div className="text-[11px] text-gray-500 border border-gray-100 rounded-lg px-3 py-2 bg-gray-50">
              {isSystem ? '🔒 Системная роль — удалять нельзя.' : null}
              {!isSystem && usersCount > 0 && `Привязано пользователей: ${usersCount}`}
              {!isSystem && usersCount === 0 && 'К роли не привязаны пользователи — её можно удалить.'}
            </div>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-2">
            {isEdit && !isSystem && (
              <button onClick={del} disabled={deleting || usersCount > 0}
                className="border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium">
                {deleting ? '...' : 'Удалить'}
              </button>
            )}
            <div className="flex-1" />
            <button onClick={onClose}
              className="border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium">
              Отмена
            </button>
            <button onClick={save} disabled={saving || isOwner}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
              {saving ? '...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Check icon ──────────────────────────────────────────────────────────────
function Check({ className }: { className?: string }) {
  return (
    <svg className={`w-3 h-3 ${className ?? ''}`} viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
