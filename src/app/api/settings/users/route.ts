import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS для создания пользователя через Admin API
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const { first_name, last_name, email, password, role_slug } = await req.json()

    // Валидация
    if (!first_name || !last_name || !email || !password || !role_slug) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль минимум 6 символов' }, { status: 400 })
    }

    // 1. Создаём пользователя в Supabase Auth
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message.includes('already registered')) {
        return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 409 })
      }
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    // 2. Получаем clinic_id и role_id из контекста вызывающего пользователя
    //    (используем anon-токен из заголовка Authorization)
    const authHeader = req.headers.get('authorization')
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )

    const { data: callerProfile, error: profileError } = await anonClient
      .from('user_profiles')
      .select('clinic_id')
      .single()

    if (profileError || !callerProfile) {
      // Откатываем созданного пользователя
      await adminClient.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: 'Нет прав для создания сотрудников' }, { status: 403 })
    }

    const clinic_id = callerProfile.clinic_id

    // 3. Находим role_id по slug
    const { data: role, error: roleError } = await adminClient
      .from('roles')
      .select('id')
      .eq('clinic_id', clinic_id)
      .eq('slug', role_slug)
      .single()

    if (roleError || !role) {
      await adminClient.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: `Роль "${role_slug}" не найдена` }, { status: 400 })
    }

    // 4. Создаём user_profile
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
      await adminClient.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ user: profile }, { status: 201 })
  } catch (err) {
    console.error('POST /api/settings/users:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}
