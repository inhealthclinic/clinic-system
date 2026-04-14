import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const supabaseUser = await createClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Проверяем право
    const { data: profile } = await supabaseUser
      .from('user_profiles')
      .select('clinic_id, role:roles(slug)')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { first_name, last_name, middle_name, phone, role_id, email, password } = await req.json()

    const admin = createAdminClient()

    // 1. Создать auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

    // 2. Создать profile
    const { data: newProfile, error: profErr } = await admin
      .from('user_profiles')
      .insert({
        id: authData.user.id,
        clinic_id: profile.clinic_id,
        role_id,
        first_name,
        last_name,
        middle_name: middle_name || null,
        phone: phone || null,
      })
      .select('*, role:roles(id,name,color,slug)')
      .single()

    if (profErr) {
      await admin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: profErr.message }, { status: 400 })
    }

    return NextResponse.json({ user: newProfile })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
