'use client'

/**
 * PatientVaccinations — прививочный паспорт пациента.
 * Показывает таймлайн сделанных прививок + блок «Предстоящие» (next_due_date),
 * позволяет добавлять новые записи из справочника vaccines.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type Vaccine = {
  id: string
  name: string
  disease: string | null
  schedule_hint: string | null
  is_national: boolean
}

type VaccRecord = {
  id: string
  vaccine_id: string | null
  vaccine_name: string
  dose_number: number | null
  administered_at: string
  lot_number: string | null
  manufacturer: string | null
  site: string | null
  route: string | null
  reaction: string | null
  next_due_date: string | null
  notes: string | null
  doctor: { id: string; first_name: string; last_name: string } | null
}

export default function PatientVaccinations({ patientId }: { patientId: string }) {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [vaccines, setVaccines] = useState<Vaccine[]>([])
  const [records, setRecords] = useState<VaccRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [vRes, rRes] = await Promise.all([
      supabase.from('vaccines').select('*').eq('is_active', true).order('is_national', { ascending: false }).order('name'),
      supabase.from('patient_vaccinations')
        .select(`id, vaccine_id, vaccine_name, dose_number, administered_at,
                 lot_number, manufacturer, site, route, reaction, next_due_date, notes,
                 doctor:doctors(id, first_name, last_name)`)
        .eq('patient_id', patientId)
        .order('administered_at', { ascending: false }),
    ])
    setVaccines((vRes.data ?? []) as Vaccine[])
    setRecords((rRes.data ?? []) as unknown as VaccRecord[])
    setLoading(false)
  }, [supabase, patientId])

  useEffect(() => { void load() }, [load])

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = useMemo(() =>
    records.filter(r => r.next_due_date && r.next_due_date >= today)
      .sort((a, b) => a.next_due_date!.localeCompare(b.next_due_date!)),
    [records]
  )
  const overdue = useMemo(() =>
    records.filter(r => r.next_due_date && r.next_due_date < today),
    [records]
  )

  async function remove(id: string) {
    if (!confirm('Удалить запись о прививке?')) return
    await supabase.from('patient_vaccinations').delete().eq('id', id)
    setRecords(records.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-900 mb-2">⚠ Просроченные ревакцинации · {overdue.length}</h3>
          <div className="space-y-1">
            {overdue.map(r => (
              <div key={r.id} className="text-sm text-red-800">
                {r.vaccine_name} — планировалась {new Date(r.next_due_date! + 'T12:00:00').toLocaleDateString('ru-RU')}
              </div>
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">📅 Предстоящие · {upcoming.length}</h3>
          <div className="space-y-1">
            {upcoming.map(r => (
              <div key={r.id} className="text-sm text-blue-800 flex justify-between">
                <span>{r.vaccine_name}</span>
                <span className="text-xs text-blue-600">
                  {new Date(r.next_due_date! + 'T12:00:00').toLocaleDateString('ru-RU')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Прививочный паспорт</h3>
            <p className="text-xs text-gray-400">{records.length} записей</p>
          </div>
          <button onClick={() => setAdding(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            + Прививка
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка…</div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Записей о прививках нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {records.map(r => (
              <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                <div className="flex-shrink-0 w-16 text-right">
                  <p className="text-xs font-semibold text-gray-900">
                    {new Date(r.administered_at + 'T12:00:00').toLocaleDateString('ru-RU', {
                      day: '2-digit', month: '2-digit',
                    })}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {new Date(r.administered_at + 'T12:00:00').getFullYear()}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">
                    {r.vaccine_name}
                    {r.dose_number && <span className="text-xs text-gray-500 ml-1.5">доза {r.dose_number}</span>}
                  </p>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 mt-0.5">
                    {r.manufacturer && <span>Произв.: {r.manufacturer}</span>}
                    {r.lot_number && <span className="font-mono">Серия: {r.lot_number}</span>}
                    {r.site && <span>Место: {r.site}</span>}
                    {r.route && <span>Путь: {r.route}</span>}
                    {r.doctor && <span>Врач: {r.doctor.last_name}</span>}
                  </div>
                  {r.reaction && (
                    <p className="text-xs text-orange-700 mt-1">Реакция: {r.reaction}</p>
                  )}
                  {r.notes && (
                    <p className="text-xs text-gray-500 mt-1">{r.notes}</p>
                  )}
                  {r.next_due_date && (
                    <p className="text-xs text-blue-600 mt-1">
                      Следующая доза: {new Date(r.next_due_date + 'T12:00:00').toLocaleDateString('ru-RU')}
                    </p>
                  )}
                </div>
                <button onClick={() => remove(r.id)} className="text-xs text-red-500 hover:text-red-700">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && profile?.clinic_id && (
        <AddVaccinationModal
          clinicId={profile.clinic_id}
          userId={profile.id}
          patientId={patientId}
          vaccines={vaccines}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); void load() }}
        />
      )}
    </div>
  )
}

function AddVaccinationModal({
  clinicId, userId, patientId, vaccines, onClose, onDone,
}: {
  clinicId: string
  userId: string
  patientId: string
  vaccines: Vaccine[]
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const [vaccineId, setVaccineId] = useState('')
  const [customName, setCustomName] = useState('')
  const [doseNumber, setDoseNumber] = useState('')
  const [administeredAt, setAdministeredAt] = useState(new Date().toISOString().slice(0, 10))
  const [lotNumber, setLotNumber] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [site, setSite] = useState('')
  const [route, setRoute] = useState('в/м')
  const [nextDueDate, setNextDueDate] = useState('')
  const [reaction, setReaction] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = vaccines.find(v => v.id === vaccineId)
  const vaccineName = selected?.name || customName

  async function save() {
    if (!vaccineName.trim()) { alert('Укажите вакцину'); return }
    setSaving(true)
    const { error } = await supabase.from('patient_vaccinations').insert({
      clinic_id: clinicId,
      patient_id: patientId,
      vaccine_id: selected?.id ?? null,
      vaccine_name: vaccineName.trim(),
      dose_number: doseNumber ? parseInt(doseNumber, 10) : null,
      administered_at: administeredAt,
      lot_number: lotNumber || null,
      manufacturer: manufacturer || null,
      site: site || null,
      route: route || null,
      next_due_date: nextDueDate || null,
      reaction: reaction || null,
      notes: notes || null,
      created_by: userId,
    })
    setSaving(false)
    if (error) { alert('Ошибка: ' + error.message); return }
    onDone()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-4">Новая прививка</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Вакцина *</label>
            <select value={vaccineId} onChange={e => { setVaccineId(e.target.value); setCustomName('') }} className={inp}>
              <option value="">— выбрать из справочника —</option>
              {vaccines.filter(v => v.is_national).length > 0 && (
                <optgroup label="Национальный календарь РК">
                  {vaccines.filter(v => v.is_national).map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.schedule_hint ? `(${v.schedule_hint})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {vaccines.filter(v => !v.is_national).length > 0 && (
                <optgroup label="Дополнительные">
                  {vaccines.filter(v => !v.is_national).map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {!vaccineId && (
              <input value={customName} onChange={e => setCustomName(e.target.value)}
                placeholder="Или введите название вручную"
                className={inp + ' mt-2'} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Дата введения *</label>
              <input type="date" value={administeredAt} onChange={e => setAdministeredAt(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">№ дозы</label>
              <input type="number" min="1" value={doseNumber} onChange={e => setDoseNumber(e.target.value)}
                placeholder="1" className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Производитель</label>
              <input value={manufacturer} onChange={e => setManufacturer(e.target.value)}
                placeholder="Sanofi" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Серия (лот)</label>
              <input value={lotNumber} onChange={e => setLotNumber(e.target.value)}
                placeholder="A1234B" className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Место введения</label>
              <input value={site} onChange={e => setSite(e.target.value)}
                placeholder="левое плечо" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Путь</label>
              <select value={route} onChange={e => setRoute(e.target.value)} className={inp}>
                <option>в/м</option>
                <option>п/к</option>
                <option>в/к</option>
                <option>per os</option>
                <option>интраназально</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Следующая доза</label>
            <input type="date" value={nextDueDate} onChange={e => setNextDueDate(e.target.value)} className={inp} />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Реакция</label>
            <input value={reaction} onChange={e => setReaction(e.target.value)}
              placeholder="без реакции / температура / отёк" className={inp} />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Примечание</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inp} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Отмена</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Сохранение…' : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}
