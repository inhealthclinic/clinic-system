'use client'

/**
 * /doctor/settings — персональные настройки врача.
 * Подпись (PNG/JPG в Storage) · шапка для PDF-рецепта · избранные ICD-10 · избранные препараты.
 *
 * Важно: если зашёл админ/владелец, который не врач, — страница показывает
 * селектор и позволяет редактировать настройки любого врача клиники.
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type DoctorOpt = { id: string; first_name: string; last_name: string }

type DrugFav = {
  name: string
  form?: string
  dosage?: string
  frequency?: string
  duration?: string
  instructions?: string
}

type IcdFav = { code: string; name: string }

export default function DoctorSettingsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [isOwnDoctor, setIsOwnDoctor] = useState(false)
  const [allDoctors, setAllDoctors] = useState<DoctorOpt[]>([])

  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [header, setHeader] = useState('')
  const [icds, setIcds] = useState<IcdFav[]>([])
  const [drugs, setDrugs] = useState<DrugFav[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const [newIcdCode, setNewIcdCode] = useState('')
  const [newIcdName, setNewIcdName] = useState('')
  const [newDrug, setNewDrug] = useState<DrugFav>({ name: '' })

  useEffect(() => {
    if (!profile?.clinic_id || !profile.id) return
    ;(async () => {
      const [ownRes, allRes] = await Promise.all([
        supabase.from('doctors').select('id')
          .eq('user_id', profile.id).eq('clinic_id', profile.clinic_id).maybeSingle(),
        supabase.from('doctors').select('id, first_name, last_name')
          .eq('clinic_id', profile.clinic_id).eq('is_active', true).order('last_name'),
      ])
      const own = (ownRes.data as { id: string } | null)?.id ?? null
      setIsOwnDoctor(!!own)
      setAllDoctors((allRes.data ?? []) as DoctorOpt[])
      setDoctorId(own ?? (allRes.data?.[0]?.id ?? null))
    })()
  }, [supabase, profile?.id, profile?.clinic_id])

  const load = useCallback(async () => {
    if (!doctorId) return
    setLoading(true)
    const { data } = await supabase.from('doctors')
      .select('signature_url, prescription_header, favorite_icd10, favorite_drugs')
      .eq('id', doctorId).maybeSingle()
    if (data) {
      setSignatureUrl((data as any).signature_url ?? null)
      setHeader((data as any).prescription_header ?? '')
      setIcds(((data as any).favorite_icd10 ?? []) as IcdFav[])
      setDrugs(((data as any).favorite_drugs ?? []) as DrugFav[])
    }
    setLoading(false)
  }, [supabase, doctorId])

  useEffect(() => { if (doctorId) void load() }, [load, doctorId])

  async function save() {
    if (!doctorId) return
    setSaving(true)
    const { error } = await supabase.from('doctors').update({
      prescription_header: header || null,
      favorite_icd10: icds,
      favorite_drugs: drugs,
    }).eq('id', doctorId)
    setSaving(false)
    if (!error) setSavedAt(new Date())
    else alert('Ошибка сохранения: ' + error.message)
  }

  async function uploadSignature(file: File) {
    if (!doctorId || !profile?.clinic_id) return
    const ext = file.name.split('.').pop() || 'png'
    const path = `${profile.clinic_id}/${doctorId}/signature.${ext}`
    const { error: upErr } = await supabase.storage
      .from('signatures').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { alert('Ошибка загрузки: ' + upErr.message); return }
    const { data: pub } = supabase.storage.from('signatures').getPublicUrl(path)
    const url = pub.publicUrl + '?v=' + Date.now()
    await supabase.from('doctors').update({ signature_url: url }).eq('id', doctorId)
    setSignatureUrl(url)
  }

  async function removeSignature() {
    if (!doctorId) return
    await supabase.from('doctors').update({ signature_url: null }).eq('id', doctorId)
    setSignatureUrl(null)
  }

  function addIcd() {
    const code = newIcdCode.trim().toUpperCase()
    const name = newIcdName.trim()
    if (!code) return
    if (icds.find(i => i.code === code)) return
    setIcds([...icds, { code, name }])
    setNewIcdCode(''); setNewIcdName('')
  }
  function removeIcd(code: string) { setIcds(icds.filter(i => i.code !== code)) }

  function addDrug() {
    if (!newDrug.name.trim()) return
    setDrugs([...drugs, { ...newDrug, name: newDrug.name.trim() }])
    setNewDrug({ name: '' })
  }
  function removeDrug(idx: number) { setDrugs(drugs.filter((_, i) => i !== idx)) }

  if (!profile) return null

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
  const selectedDoctor = allDoctors.find(d => d.id === doctorId)

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isOwnDoctor ? 'Мои настройки' : 'Настройки врача'}
          </h1>
          <p className="text-xs text-gray-500">
            Подпись, шапка рецепта, избранные коды и препараты
            {!isOwnDoctor && selectedDoctor && <> · {selectedDoctor.last_name} {selectedDoctor.first_name}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isOwnDoctor && allDoctors.length > 1 && (
            <select value={doctorId ?? ''} onChange={e => setDoctorId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {allDoctors.map(d => (
                <option key={d.id} value={d.id}>{d.last_name} {d.first_name}</option>
              ))}
            </select>
          )}
          <Link href="/doctor" className="text-sm text-blue-600 hover:text-blue-800">← Мой день</Link>
        </div>
      </div>

      {loading ? <div className="text-sm text-gray-400">Загрузка…</div> : (
        <>
          {/* Подпись */}
          <section className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Подпись</h2>
            <p className="text-xs text-gray-500">PNG с прозрачным фоном, рекомендуемая высота 120–200px.</p>
            {signatureUrl ? (
              <div className="flex items-center gap-4">
                <img src={signatureUrl} alt="подпись" className="max-h-32 border border-gray-100 rounded bg-white p-2" />
                <button onClick={removeSignature}
                  className="text-xs text-red-600 hover:text-red-800">Удалить подпись</button>
              </div>
            ) : (
              <p className="text-xs text-gray-400">Подпись не загружена</p>
            )}
            <input type="file" accept="image/png,image/jpeg"
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadSignature(f) }}
              className="text-sm" />
          </section>

          {/* Шапка рецепта */}
          <section className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Шапка PDF-рецепта</h2>
            <p className="text-xs text-gray-500">ФИО, регалии, кабинет — то, что печатается под шапкой клиники.</p>
            <textarea value={header} onChange={e => setHeader(e.target.value)}
              rows={3} className={inp}
              placeholder="Камалова Алия Бакытовна, врач-терапевт, к.м.н., каб. 204" />
          </section>

          {/* Избранные ICD-10 */}
          <section className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Избранные ICD-10 · {icds.length}</h2>
            <p className="text-xs text-gray-500">Коды, которые будут предложены быстрым списком в медзаписи.</p>
            <div className="space-y-1">
              {icds.map(i => (
                <div key={i.code} className="flex items-center gap-2 py-1 border-b border-gray-50">
                  <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{i.code}</span>
                  <span className="text-sm text-gray-700 flex-1 truncate">{i.name}</span>
                  <button onClick={() => removeIcd(i.code)} className="text-xs text-red-500 hover:text-red-700">×</button>
                </div>
              ))}
              {icds.length === 0 && <p className="text-xs text-gray-400">Пусто</p>}
            </div>
            <div className="flex gap-2">
              <input value={newIcdCode} onChange={e => setNewIcdCode(e.target.value)}
                placeholder="J06.9" className={inp + ' w-24 font-mono'} />
              <input value={newIcdName} onChange={e => setNewIcdName(e.target.value)}
                placeholder="ОРВИ, неуточнённая" className={inp + ' flex-1'} />
              <button onClick={addIcd}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+</button>
            </div>
          </section>

          {/* Избранные препараты */}
          <section className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Избранные препараты · {drugs.length}</h2>
            <p className="text-xs text-gray-500">Быстрый список при заполнении рецептов.</p>
            <div className="space-y-1">
              {drugs.map((d, idx) => (
                <div key={idx} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{d.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[d.form, d.dosage, d.frequency, d.duration].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <button onClick={() => removeDrug(idx)} className="text-xs text-red-500 hover:text-red-700">×</button>
                </div>
              ))}
              {drugs.length === 0 && <p className="text-xs text-gray-400">Пусто</p>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <input value={newDrug.name} onChange={e => setNewDrug({ ...newDrug, name: e.target.value })}
                placeholder="Парацетамол" className={inp + ' col-span-2'} />
              <input value={newDrug.form ?? ''} onChange={e => setNewDrug({ ...newDrug, form: e.target.value })}
                placeholder="таб." className={inp} />
              <input value={newDrug.dosage ?? ''} onChange={e => setNewDrug({ ...newDrug, dosage: e.target.value })}
                placeholder="500 мг" className={inp} />
              <input value={newDrug.frequency ?? ''} onChange={e => setNewDrug({ ...newDrug, frequency: e.target.value })}
                placeholder="3 р/день" className={inp} />
              <div className="flex gap-1">
                <input value={newDrug.duration ?? ''} onChange={e => setNewDrug({ ...newDrug, duration: e.target.value })}
                  placeholder="5 дней" className={inp + ' flex-1'} />
                <button onClick={addDrug}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+</button>
              </div>
            </div>
          </section>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            {savedAt && (
              <span className="text-xs text-green-600">
                ✓ сохранено в {savedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
