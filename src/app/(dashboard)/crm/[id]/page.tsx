import { redirect } from 'next/navigation'

/**
 * Permalink на сделку: /crm/<uuid> → /crm?openDeal=<uuid>
 *
 * Канвас CRM — одна страница (`/crm`), модалка сделки управляется
 * локальным стейтом (см. crm/page.tsx). Чтобы из задач/уведомлений/писем
 * можно было дать ссылку на конкретную сделку, делаем server redirect
 * на канвас с одноразовым параметром `?openDeal=<id>`. Канвас при
 * первой загрузке откроет сделку и сразу зачистит URL — F5 не будет
 * её переоткрывать.
 */
export default async function DealPermalinkPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/crm?openDeal=${encodeURIComponent(id)}`)
}
