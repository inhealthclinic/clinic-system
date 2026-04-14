'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Allergy {
  id: string
  allergen: string
  type: string
  severity: string
}

interface Props {
  patientId: string
  // Для проверки при назначении препарата
  checkDrug?: string
  onConflict?: (allergy: Allergy) => void
}

export function AllergyAlert({ patientId, checkDrug, onConflict }: Props) {
  const [allergies, setAllergies] = useState<Allergy[]>([])
  const [groups, setGroups] = useState<{ group_name: string; drugs: string[] }[]>([])
  const [conflict, setConflict] = useState<Allergy | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('allergies').select('*').eq('patient_id', patientId)
      .then(({ data }) => setAllergies(data || []))
    supabase.from('drug_allergy_groups').select('*')
      .then(({ data }) => setGroups(data || []))
  }, [patientId])

  // Проверка препарата при назначении
  useEffect(() => {
    if (!checkDrug || allergies.length === 0) { setConflict(null); return }
    const drug = checkDrug.toLowerCase()

    const found = allergies.find(a => {
      if (a.type !== 'drug') return false
      const allergen = a.allergen.toLowerCase()
      if (drug.includes(allergen) || allergen.includes(drug)) return true

      // Проверка по группе синонимов
      const group = groups.find(g =>
        g.drugs.some(d => d.toLowerCase() === allergen)
      )
      if (group) {
        return group.drugs.some(d => drug.includes(d.toLowerCase()))
      }
      return false
    })

    setConflict(found || null)
    if (found && onConflict) onConflict(found)
  }, [checkDrug, allergies, groups])

  const severityLabel: Record<string, string> = {
    mild: 'Лёгкая', moderate: 'Умеренная',
    severe: 'Тяжёлая', 'life-threatening': 'Жизнеугрожающая'
  }

  // Показываем все аллергии в шапке (всегда)
  if (!checkDrug) {
    if (allergies.length === 0) return null
    return (
      <div className="flex flex-wrap gap-1.5">
        {allergies.map(a => (
          <span key={a.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            a.severity === 'life-threatening' || a.severity === 'severe'
              ? 'bg-red-100 text-red-700'
              : 'bg-orange-100 text-orange-700'
          }`}>
            ⚠️ {a.allergen}
          </span>
        ))}
      </div>
    )
  }

  // Предупреждение при конфликте с препаратом
  if (!conflict) return null

  return (
    <div className="bg-red-50 border-2 border-red-400 rounded-xl p-3 mt-2">
      <div className="flex items-start gap-2">
        <span className="text-red-500 text-lg">🚫</span>
        <div>
          <p className="text-sm font-bold text-red-700">
            Внимание! Аллергия на {conflict.allergen}
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            Тяжесть: {severityLabel[conflict.severity] || conflict.severity}
            {conflict.type && ` · Тип: ${conflict.type}`}
          </p>
          <p className="text-xs text-red-500 mt-1">
            Назначение этого препарата может быть опасным для пациента
          </p>
        </div>
      </div>
    </div>
  )
}
