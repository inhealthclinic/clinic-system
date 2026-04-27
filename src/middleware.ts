import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Middleware для @supabase/ssr — обязателен в Next.js App Router.
 * Без него access token не рефрешится корректно: cookies не успевают
 * прокинуться между server-side и client-side, и через ~1 час после
 * логина getSession() начинает возвращать null → юзера выкидывает.
 *
 * Здесь мы:
 *   1. Читаем cookies из запроса
 *   2. Создаём server client
 *   3. Вызываем getUser() — это триггерит автоматический refresh токена
 *   4. Записываем обновлённые cookies обратно в response
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // ВАЖНО: вызвать getUser() — это валидирует JWT и триггерит refresh.
  // Не убирать никакой код между createServerClient и getUser().
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    /*
     * Запускаем на всех путях, кроме статики и публичных ассетов.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
