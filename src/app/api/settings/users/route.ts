import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/settings/users
 *
 * Создание сотрудника: проверка прав → auth.admin.createUser → insert
 * в user_profiles. Порядок важен: сначала идентифицируем и авторизуем
 * вызывающего, и только потом заводим нового юзера в Supabase Auth.
 * Иначе при любой ошибке прав мы оставляли бы «сиротские» auth-юзеры,
 * а при повторной попытке создания с тем же email получали «already
 * registered».
 */
/**
 * GET /api/settings/users
 *
 * Возвращает сотрудников клиники вместе с email из auth.users.
 * Email живёт в auth.users и недоступен по RLS — поэтому ходим
 * через service-role клиент.
 */
export async function GET(req: NextRequest) {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceKey || !url) {
      return NextResponse.json({ error: 'Сервер не настроен' }, { status: 503 })
    }
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const authHeader = req.headers.get('authorization') ?? ''
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ error: 'Нужна авторизация' }, { status: 401 })
    }
    const jwt = authHeader.slice('bearer '.length).trim()
    const { data: userInfo, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userInfo?.user) {
      return NextResponse.json({ error: 'Сессия недействительна' }, { status: 401 })
    }
    const { data: caller } = await admin
      .from('user_profiles')
      .select('clinic_id')
      .eq('id', userInfo.user.id)
      .maybeSingle()
    if (!caller?.clinic_id) {
      return NextResponse.json({ error: 'Профиль не найден' }, { status: 403 })
    }

    const { data: profiles, error } = await admin
      .from('user_profiles')
      .select('*, role:roles(id, slug, name, color)')
      .eq('clinic_id', caller.clinic_id)
      .order('last_name')
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Подтягиваем email-ы пачкой.
    // listUsers пагинирован (1000 на страницу) — для клиники этого с запасом.
    const emailById = new Map<string, string>()
    let page = 1
    while (true) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page, perPage: 1000,
      })
      if (listErr) break
      for (const u of list.users) {
        if (u.email) emailById.set(u.id, u.email)
      }
      if (list.users.length < 1000) break
      page += 1
      if (page > 10) break // safety
    }

    const users = (profiles ?? []).map(p => ({
      ...p,
      email: emailById.get(p.id) ?? null,
    }))
    return NextResponse.json({ users })
  } catch (err) {
    console.error('GET /api/settings/users:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // ── 0. Env ───────────────────────────────────────────────
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      return NextResponse.json(
        { error: 'Сервер не настроен: отсутствует SUPABASE_SERVICE_ROLE_KEY' },
        { status: 503 }
      )
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      return NextResponse.json(
        { error: 'Сервер не настроен: отсутствуют SUPABASE URL/ANON_KEY' },
        { status: 503 }
      )
    }

    const adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── 1. Тело запроса ──────────────────────────────────────
    let body: Record<string, string>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
    }
    const { first_name, last_name, email, password, role_slug } = body
    if (!first_name || !last_name || !email || !password || !role_slug) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 })
    }

    // ── 2. Идентификация вызывающего ─────────────────────────
    const authHeader = req.headers.get('authorization') ?? ''
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json(
        { error: 'Нужна авторизация (перелогиньтесь и попробуйте снова)' },
        { status: 401 }
      )
    }
    const jwt = authHeader.slice('bearer '.length).trim()

    // Через admin-клиент достаём пользователя по его JWT — это надёжнее
    // чем делать запрос от имени анон-клиента с прокинутым header'ом
    // (в прод-окружении некоторые прокси режут Authorization у внутренних fetch-ов).
    const { data: userInfo, error: userErr } = await adminClient.auth.getUser(jwt)
    if (userErr || !userInfo?.user) {
      console.error('[api/settings/users] getUser failed:', userErr)
      return NextResponse.json(
        { error: 'Сессия недействительна — перелогиньтесь' },
        { status: 401 }
      )
    }
    const callerUserId = userInfo.user.id

    // ── 3. Профиль и роль вызывающего ────────────────────────
    // Читаем через adminClient, чтобы не зависеть от RLS: проверку прав
    // делаем сами по slug роли + по разрешению users:create (если есть).
    const { data: callerProfile, error: profileError } = await adminClient
      .from('user_profiles')
      .select('clinic_id, role_id, roles:role_id(slug)')
      .eq('id', callerUserId)
      .maybeSingle()

    if (profileError) {
      console.error('[api/settings/users] profile lookup failed:', profileError)
      return NextResponse.json(
        { error: 'Не удалось проверить права: ' + profileError.message },
        { status: 500 }
      )
    }
    if (!callerProfile) {
      return NextResponse.json(
        { error: 'Профиль вызывающего не найден. Обратитесь к администратору.' },
        { status: 403 }
      )
    }
    const clinic_id = callerProfile.clinic_id
    if (!clinic_id) {
      return NextResponse.json(
        { error: 'У вашего профиля не указана клиника' },
        { status: 403 }
      )
    }
    const callerRoleSlug = (callerProfile as unknown as {
      roles?: { slug?: string } | { slug?: string }[]
    }).roles
    const slug = Array.isArray(callerRoleSlug) ? callerRoleSlug[0]?.slug : callerRoleSlug?.slug

    // Разрешаем owner / admin без проверки прав. Остальным — через has_permission.
    let allowed = slug === 'owner' || slug === 'admin'
    if (!allowed) {
      const { data: hasPerm } = await adminClient.rpc('has_permission', {
        p_user: callerUserId,
        p_perm: 'users:create',
      })
      allowed = !!hasPerm
    }
    if (!allowed) {
      return NextResponse.json(
        { error: 'Нет прав для создания сотрудников (нужна роль owner/admin или право users:create)' },
        { status: 403 }
      )
    }

    // ── 4. Находим role_id по slug НОВОГО сотрудника ─────────
    const { data: role, error: roleError } = await adminClient
      .from('roles')
      .select('id')
      .eq('clinic_id', clinic_id)
      .eq('slug', role_slug)
      .single()
    if (roleError || !role) {
      return NextResponse.json(
        { error: `Роль «${role_slug}» не найдена в вашей клинике` },
        { status: 400 }
      )
    }

    // ── 5. Создаём Auth-пользователя (только после всех проверок) ──
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) {
      const msg = authError.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        return NextResponse.json(
          { error: 'Пользователь с таким email уже существует' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }
    const userId = authData.user.id

    // ── 6. user_profile ───────────────────────────────────────
    const { data: profile, error: insertError } = await adminClient
      .from('user_profiles')
      .insert({
        id: userId,
        clinic_id,
        role_id: role.id,
        first_name,
        last_name,
        is_active: true,
      })
      .select()
      .single()

    if (insertError) {
      // Откат auth-юзера, иначе следующий create с этим email упадёт с 409.
      await adminClient.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ user: profile }, { status: 201 })
  } catch (err) {
    console.error('POST /api/settings/users:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}
