// Возвращает состояние WhatsApp-интеграции (Green API) для клиники
// текущего пользователя. Фронт (карточка сделки в CRM) прячет плашку
// «WhatsApp ещё не подключён…», если connected = true.
//
// Креды per-clinic: достаём clinic_id из user_profiles по сессии.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStateInstance, isGreenApiConfigured } from '@/lib/greenapi'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    return NextResponse.json({ connected: false, state: null, reason: 'unauthorized' })
  }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clinic_id')
    .eq('id', auth.user.id)
    .maybeSingle()
  const clinicId = profile?.clinic_id ?? null
  if (!clinicId) {
    return NextResponse.json({ connected: false, state: null, reason: 'no_clinic' })
  }

  const configured = await isGreenApiConfigured(clinicId)
  if (!configured) {
    return NextResponse.json({
      connected: false,
      state: null,
      reason: 'missing_creds',
    })
  }

  try {
    const { stateInstance } = await getStateInstance(clinicId)
    return NextResponse.json({
      connected: stateInstance === 'authorized',
      state: stateInstance,
    })
  } catch (e) {
    return NextResponse.json({
      connected: false,
      state: null,
      reason: e instanceof Error ? e.message : 'unknown',
    })
  }
}
