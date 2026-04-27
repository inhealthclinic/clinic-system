/**
 * Module-level CRM prefetch cache.
 * Lives in memory for the lifetime of the browser tab (SPA session).
 * Dashboard pre-warms it; CRM page reads synchronously on mount — zero spinner.
 */

export interface CrmCacheEntry {
  deals: unknown[]
  pipelines: unknown[]
  stages: unknown[]
  counts: unknown[]
  conversions: unknown[]
  reasons: unknown[]
  sources: unknown[]
  users: unknown[]
  doctors: unknown[]
}

export const crmCache: Record<string, CrmCacheEntry> = {}

const inflight: Record<string, Promise<void>> = {}

export async function prefetchCrm(
  clinicId: string,
  accessToken: string,
  supabase: ReturnType<typeof import('./supabase/client').createClient>,
) {
  if (crmCache[clinicId]) return
  if (inflight[clinicId]) return

  inflight[clinicId] = (async () => {
    try {
      const [dealsResp, p, r, ls, up, doc] = await Promise.all([
        fetch(`/api/crm/deals?owner=all`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        }),
        supabase.from('pipelines').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('deal_loss_reasons').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('lead_sources').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('user_profiles').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
        supabase.from('doctors').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
      ])
      if (!dealsResp.ok) return
      const { deals: rawDeals = [], patients = [] } = await dealsResp.json()

      const ps = p.data ?? []
      const usersList = up.data ?? []
      const doctorsList = doc.data ?? []

      type IdObj = { id: string }
      const patientsById = new Map((patients as IdObj[]).map(x => [x.id, x]))
      const usersById = new Map((usersList as IdObj[]).map(x => [x.id, x]))
      const doctorsById = new Map((doctorsList as IdObj[]).map(x => [x.id, x]))

      type RawDeal = { id: string; patient_id?: string | null; responsible_user_id?: string | null; preferred_doctor_id?: string | null }
      const enriched = (rawDeals as RawDeal[]).map(d => ({
        ...d,
        patient: d.patient_id ? (patientsById.get(d.patient_id) ?? null) : null,
        responsible: d.responsible_user_id ? (usersById.get(d.responsible_user_id) ?? null) : null,
        doctor: d.preferred_doctor_id ? (doctorsById.get(d.preferred_doctor_id) ?? null) : null,
      }))

      const pipelineIds = (ps as IdObj[]).map(x => x.id)
      let stagesData: unknown[] = []
      let countsData: unknown[] = []
      let conversionsData: unknown[] = []
      if (pipelineIds.length > 0) {
        const [st, c, cv] = await Promise.all([
          supabase.from('pipeline_stages').select('*').in('pipeline_id', pipelineIds).order('sort_order'),
          supabase.from('v_pipeline_stage_counts').select('pipeline_id,stage_id,deals_count,open_count'),
          supabase.from('v_pipeline_conversion').select('pipeline_id,total,won,lost,open_count,conversion_pct').eq('clinic_id', clinicId),
        ])
        stagesData = st.data ?? []
        countsData = c.data ?? []
        conversionsData = cv.data ?? []
      }

      crmCache[clinicId] = {
        deals: enriched,
        pipelines: ps,
        stages: stagesData,
        counts: countsData,
        conversions: conversionsData,
        reasons: r.data ?? [],
        sources: ls.data ?? [],
        users: usersList,
        doctors: doctorsList,
      }
    } catch {
      // ignore — CRM page will load normally
    } finally {
      delete inflight[clinicId]
    }
  })()
}
