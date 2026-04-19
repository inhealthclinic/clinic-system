// Возвращает состояние WhatsApp-интеграции (Green API).
// Фронт (карточка сделки в CRM) прячет плашку «WhatsApp ещё не подключён…»,
// если connected = true.

import { NextResponse } from 'next/server'
import { getStateInstance } from '@/lib/greenapi'

export const dynamic = 'force-dynamic'

export async function GET() {
  const hasEnv =
    !!process.env.GREENAPI_INSTANCE_ID && !!process.env.GREENAPI_API_TOKEN

  if (!hasEnv) {
    return NextResponse.json({
      connected: false,
      state: null,
      reason: 'missing_env',
    })
  }

  try {
    const { stateInstance } = await getStateInstance()
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
