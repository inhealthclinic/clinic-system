'use client'

/**
 * /settings/users — объединённый раздел «Сотрудники + Роли и права».
 *
 * Две вкладки:
 *   • «Сотрудники» — список, создание, редактирование, деактивация.
 *   • «Роли и права» — общий <RolesMatrix /> (раньше жил на /settings/roles).
 *
 * Редактирование делает PATCH на /api/settings/users/[id] (требует JWT,
 * права owner/admin или users:edit).
 */

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RolesMatrix from '@/components/settings/RolesMatrix'
import type { UserProfile, Role } from '@/types'

const ROLE_OPTIONS_FALLBACK = [
  { slug: 'owner',   label: 'Админ' },
  { slug: 'admin',   label: 'Администратор' },
  { slug: 'doctor',  label: 'Врач' },
  { slug: 'nurse',   label: 'Медсестра' },
  { slug: 'cashier', label: 'Кассир' },
  { slug: 'manager', label: 'Менеджер' },
]

interface CreateForm {
  first_name: string
  last_name: string
  email: string
  password: string
  role_slug: string
}

interface EditForm {
  first_name: string
  last_name: string
  middle_name: string
  phone: string
  role_slug: string
  is_active: boolean
}

const EMPTY_CREATE: CreateForm = {
  first_name: '', last_name: '', email: '', password: '', role_slug: 'doctor',
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">Загрузка…</div>}>
      <UsersPageInner />
    </Suspense>
  )
}

function UsersPageInner() {
  const params = useSearchParams()
  const router = useRouter()
  const tab = (params.get('tab') === 'roles' ? 'roles' : 'users') as 'users' | 'roles'

  const setTab = (t: 'users' | 'roles') => {
    const sp = new URLSearchParams(params.toString())
    if (t === 'users') sp.delete('tab'); else sp.set('tab', t)
    router.replace(`/settings/users${sp.toString() ? `?${sp.toString()}` : ''}`)
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-100 mb-5">
        <TabButton active={tab === 'users'} onClick={() => setTab('users')}>Сотрудники</TabButton>
        <TabButton active={tab === 'roles'} onClick={() => setTab('roles')}>Роли и права</TabButton>
      </div>

      {tab === 'users' ? <UsersTab /> : <RolesMatrix />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:text-gray-800',
      ].join(' ')}>
      {children}
    </button>
  )
}

// ─── Вкладка «Сотрудники» ───────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]       = useState<UserProfile[]>([])
  const [roles, setRoles]       = useState<Role[]>([])
  const [loading, setLoading]   = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [createOpen, setCreateOpen]     = useState(false)
  const [editing, setEditing]   = useState<UserProfile | null>(null)

  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    const [u, r] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*, role:roles(id, slug, name, color)')
        .order('last_name'),
      supabase.from('roles').select('*').order('created_at'),
    ])
    setUsers((u.data ?? []) as UserProfile[])
    setRoles((r.data ?? []) as Role[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const visible = users.filter(u => showInactive || u.is_active)
  const roleOptions = roles.length
    ? roles.map(r => ({ slug: r.slug, label: r.name }))
    : ROLE_OPTIONS_FALLBACK

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Сотрудники</h2>
          <p className="text-sm text-gray-400">
            {visible.length} {visible.length === 1 ? 'сотрудник' : 'сотрудников'}
            {showInactive && users.length > visible.length ? ` · ${users.length - visible.length} неактивных` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Показывать неактивных
          </label>
          <button
            onClick={() => setCreateOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Добавить сотрудника
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Сотрудников нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visible.map(u => (
              <button
                key={u.id}
                onClick={() => setEditing(u)}
                className={`w-full text-left flex items-center gap-4 px-5 py-4 transition-colors ${u.is_active ? 'hover:bg-gray-50' : 'opacity-50 hover:bg-gray-50'}`}>
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
                  {u.first_name?.[0] ?? '?'}{u.last_name?.[0] ?? ''}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {u.last_name} {u.first_name} {u.middle_name ?? ''}
                    {!u.is_active && <span className="ml-2 text-[10px] text-gray-400 uppercase">неактивен</span>}
                  </p>
                  {u.phone && <p className="text-xs text-gray-400">{u.phone}</p>}
                </div>
                {u.role && (
                  <span
                    className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{
                      background: (u.role.color ?? '#6B7280') + '22',
                      color: u.role.color ?? '#6B7280',
                    }}>
                    {u.role.name}
                  </span>
                )}
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" className="text-gray-300">
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateModal
          roleOptions={roleOptions}
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); load() }}
        />
      )}
      {editing && (
        <EditModal
          user={editing}
          roleOptions={roleOptions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Создание ────────────────────────────────────────────────────────────────

function CreateModal({
  roleOptions, onClose, onSaved,
}: {
  roleOptions: { slug: string; label: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm]     = useState<CreateForm>(EMPTY_CREATE)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const set = (field: keyof CreateForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch('/api/settings/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(form),
    })
    let json: { error?: string } = {}
    try { json = await res.json() } catch {}
    setSaving(false)
    if (!res.ok) { setError(json.error ?? `Ошибка (${res.status})`); return }
    onSaved()
  }

  return (
    <Modal title="Новый сотрудник" onClose={() => !saving && onClose()}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Фамилия" required>
            <input className={inputCls} value={form.last_name} onChange={set('last_name')} required autoFocus placeholder="Иванов"/>
          </Field>
          <Field label="Имя" required>
            <input className={inputCls} value={form.first_name} onChange={set('first_name')} required placeholder="Алибек"/>
          </Field>
        </div>
        <Field label="Email" required>
          <input type="email" className={inputCls} value={form.email} onChange={set('email')} required placeholder="alibek@clinic.kz"/>
        </Field>
        <Field label="Роль" required>
          <select className={inputCls} value={form.role_slug} onChange={set('role_slug')} required>
            {roleOptions.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Пароль" required>
          <input type="password" className={inputCls} value={form.password} onChange={set('password')} required minLength={6} placeholder="Минимум 6 символов"/>
        </Field>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Actions>
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Отмена</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Сохранение...' : 'Создать'}</button>
        </Actions>
      </form>
    </Modal>
  )
}

// ─── Редактирование ─────────────────────────────────────────────────────────

function EditModal({
  user, roleOptions, onClose, onSaved,
}: {
  user: UserProfile
  roleOptions: { slug: string; label: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const isOwner = user.role?.slug === 'owner'
  const [form, setForm] = useState<EditForm>({
    first_name:  user.first_name ?? '',
    last_name:   user.last_name ?? '',
    middle_name: user.middle_name ?? '',
    phone:       user.phone ?? '',
    role_slug:   user.role?.slug ?? '',
    is_active:   user.is_active,
  })
  const [saving, setSaving]     = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [error, setError]       = useState('')

  const setField = <K extends keyof EditForm>(field: K, value: EditForm[K]) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch(`/api/settings/users/${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(form),
    })
    let json: { error?: string } = {}
    try { json = await res.json() } catch {}
    setSaving(false)
    if (!res.ok) { setError(json.error ?? `Ошибка (${res.status})`); return }
    onSaved()
  }

  const toggleActive = async () => {
    if (isOwner) return
    if (form.is_active && !confirm(`Деактивировать сотрудника «${user.last_name} ${user.first_name}»? Доступ в систему будет закрыт.`)) return
    setDeactivating(true)
    setError('')
    const { data: { session } } = await createClient().auth.getSession()
    const res = await fetch(`/api/settings/users/${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ is_active: !form.is_active }),
    })
    let json: { error?: string } = {}
    try { json = await res.json() } catch {}
    setDeactivating(false)
    if (!res.ok) { setError(json.error ?? `Ошибка (${res.status})`); return }
    onSaved()
  }

  return (
    <Modal title={`${user.last_name} ${user.first_name}`} onClose={() => !saving && !deactivating && onClose()}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Фамилия" required>
            <input className={inputCls} value={form.last_name} onChange={e => setField('last_name', e.target.value)} required/>
          </Field>
          <Field label="Имя" required>
            <input className={inputCls} value={form.first_name} onChange={e => setField('first_name', e.target.value)} required/>
          </Field>
        </div>
        <Field label="Отчество">
          <input className={inputCls} value={form.middle_name} onChange={e => setField('middle_name', e.target.value)}/>
        </Field>
        <Field label="Телефон">
          <input className={inputCls} value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="+7..."/>
        </Field>
        <Field label="Роль" required>
          <select
            className={inputCls}
            value={form.role_slug}
            onChange={e => setField('role_slug', e.target.value)}
            disabled={isOwner}
            required>
            {roleOptions.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
          </select>
          {isOwner && <p className="text-[11px] text-gray-400 mt-1">Роль владельца изменить нельзя.</p>}
        </Field>

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex items-center gap-2 pt-1">
          {!isOwner && (
            <button
              type="button"
              onClick={toggleActive}
              disabled={deactivating || saving}
              className={`text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${form.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'} disabled:opacity-50`}>
              {deactivating ? '...' : (form.is_active ? 'Деактивировать' : 'Активировать')}
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Отмена</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? '...' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Вспомогательные UI-куски ───────────────────────────────────────────────

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50'
const btnPrimary = 'bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors'
const btnSecondary = 'border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  )
}
function ErrorBox({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{children}</p>
}
function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3 pt-1">{children}</div>
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Закрыть">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
