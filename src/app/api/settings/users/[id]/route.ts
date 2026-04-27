import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * PATCH /api/settings/users/[id]
 *
 * Редактирование сотрудника: ФИО, телефон, роль, флаг активности.
 * Email и пароль не редактируем здесь (нужно отдельной ручкой через
 * supabase.auth.admin.updateUserById; добавим, когда потребуется).
 *
 * Доступ — owner/admin (или users:edit).
 */
async function requireOwnerOrAdmin(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) {
    return { error: NextResponse.json({ error: 'Сервер не настроен' }, { status: 503 }) }
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: NextResponse.json({ error: 'Нужна авторизация' }, { status: 401 }) }
  }
  const jwt = authHeader.slice('bearer '.length).trim()
  const { data: userInfo, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userInfo?.user) {
    return { error: NextResponse.json({ error: 'Сессия недействительна' }, { status: 401 }) }
  }
  const callerId = userInfo.user.id
  const { data: prof } = await admin
    .from('user_profiles')
    .select('clinic_id, roles:role_id(slug)')
    .eq('id', callerId)
    .maybeSingle()
  if (!prof?.clinic_id) {
    return { error: NextResponse.json({ error: 'Профиль не найден' }, { status: 403 }) }
  }
  const rolesField = (prof as unknown as { roles?: { slug?: string } | { slug?: string }[] }).roles
  const slug = Array.isArray(rolesField) ? rolesField[0]?.slug : rolesField?.slug
  let allowed = slug === 'owner' || slug === 'admin'
  if (!allowed) {
    const { data: hasPerm } = await admin.rpc('has_permission', {
      p_user: callerId,
      p_perm: 'users:edit',
    })
    allowed = !!hasPerm
  }
  if (!allowed) {
    return { error: NextResponse.json({ error: 'Нет прав' }, { status: 403 }) }
  }
  return { admin, clinicId: prof.clinic_id as string, callerId }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const auth = await requireOwnerOrAdmin(req)
    if ('error' in auth) return auth.error
    const { admin, clinicId } = auth

    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Неверный формат' }, { status: 400 })
    }

    // Целевой профиль обязан быть в той же клинике
    const { data: target } = await admin
      .from('user_profiles')
      .select('id, clinic_id, roles:role_id(slug)')
      .eq('id', id)
      .maybeSingle()
    if (!target || target.clinic_id !== clinicId) {
      return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 })
    }
    const targetRoles = (target as unknown as { roles?: { slug?: string } | { slug?: string }[] }).roles
    const targetSlug = Array.isArray(targetRoles) ? targetRoles[0]?.slug : targetRoles?.slug
    if (targetSlug === 'owner') {
      // Не позволяем менять роль/деактивировать владельца через эту ручку
      if ('role_slug' in body || body.is_active === false) {
        return NextResponse.json({ error: 'Нельзя менять роль владельца' }, { status: 400 })
      }
    }

    const update: Record<string, unknown> = {}
    if (typeof body.first_name === 'string') update.first_name = body.first_name.trim()
    if (typeof body.last_name === 'string')  update.last_name  = body.last_name.trim()
    if ('middle_name' in body) update.middle_name = body.middle_name === '' ? null : body.middle_name
    if ('phone' in body)       update.phone       = body.phone === '' ? null : body.phone
    if (typeof body.is_active === 'boolean') update.is_active = body.is_active

    if (typeof body.role_slug === 'string' && body.role_slug.trim()) {
      const { data: role } = await admin
        .from('roles')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('slug', body.role_slug)
        .maybeSingle()
      if (!role) {
        return NextResponse.json({ error: `Роль «${body.role_slug}» не найдена` }, { status: 400 })
      }
      update.role_id = role.id
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Нечего обновлять' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('user_profiles')
      .update(update)
      .eq('id', id)
      .select('*, role:roles(id, slug, name, color)')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ user: data })
  } catch (err) {
    console.error('PATCH /api/settings/users/[id]:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
