'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Parameter {
  name: string
  unit: string
  ref_min?: number
  ref_max?: number
  critical_low?: number
  critical_high?: number
}

interface ResultEntry {
  parameter: string
  value: string
  unit: string
  ref_min?: number
  ref_max?: number
  flag: 'normal' | 'low' | 'high' | 'critical'
}

interface OrderItem {
  id: string
  name: string
  template?: { parameters: Parameter[] }
}

interface Props {
  orderId: string
  orderItem: OrderItem
  patientAge?: number
  patientGender?: 'male' | 'female' | 'other'
  onSave: () => void
}

function getFlag(
  value: number,
  param: Parameter
): ResultEntry['flag'] {
  const { ref_min, ref_max, critical_low, critical_high } = param
  if (critical_low !== undefined && value < critical_low) return 'critical'
  if (critical_high !== undefined && value > critical_high) return 'critical'
  if (ref_min !== undefined && value < ref_min) return 'low'
  if (ref_max !== undefined && value > ref_max) return 'high'
  return 'normal'
}

export function LabResultsForm({ orderId, orderItem, onSave }: Props) {
  const supabase = createClient()
  const params: Parameter[] = orderItem.template?.parameters || []

  const [results, setResults] = useState<ResultEntry[]>(
    params.map(p => ({
      parameter: p.name,
      value: '',
      unit: p.unit,
      ref_min: p.ref_min,
      ref_max: p.ref_max,
      flag: 'normal',
    }))
  )
  const [conclusion, setConclusion] = useState('')
  const [saving, setSaving] = useState(false)

  const updateValue = (idx: number, val: string) => {
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const num = parseFloat(val)
      const param = params[i]
      return {
        ...r,
        value: val,
        flag: !isNaN(num) && param ? getFlag(num, param) : 'normal',
      }
    }))
  }

  const hasCritical = results.some(r => r.flag === 'critical')

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('lab_results').insert({
      order_id: orderId,
      order_item_id: orderItem.id,
      results,
      conclusion,
      has_critical: hasCritical,
    })

    if (!error) {
      // Обновить статус позиции
      await supabase.from('lab_order_items')
        .update({ status: 'completed' }).eq('id', orderItem.id)

      // Проверить все ли позиции выполнены → обновить статус заказа
      const { data: items } = await supabase.from('lab_order_items')
        .select('status').eq('order_id', orderId)

      const allDone = items?.every(i => i.status === 'completed')
      if (allDone) {
        await supabase.from('lab_orders')
          .update({ status: 'ready' }).eq('id', orderId)
      }

      onSave()
    }
    setSaving(false)
  }

  const flagColors: Record<string, string> = {
    normal:   'text-gray-700',
    low:      'text-blue-600 font-semibold',
    high:     'text-orange-600 font-semibold',
    critical: 'text-red-600 font-bold',
  }

  const flagLabels: Record<string, string> = {
    normal: '', low: '↓', high: '↑', critical: '⚠️'
  }

  return (
    <div className="space-y-4">
      {hasCritical && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-center gap-2">
          <span className="text-red-500 text-lg">🚨</span>
          <div>
            <p className="text-sm font-bold text-red-700">Критические значения!</p>
            <p className="text-xs text-red-600">Врач будет уведомлён немедленно после сохранения</p>
          </div>
        </div>
      )}

      {/* Таблица результатов */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Показатель</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Результат</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Ед.</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Норма</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Флаг</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {results.map((r, idx) => (
              <tr key={idx} className={r.flag === 'critical' ? 'bg-red-50' : r.flag !== 'normal' ? 'bg-amber-50/50' : ''}>
                <td className="px-4 py-2.5 text-gray-700">{r.parameter}</td>
                <td className="px-4 py-2.5">
                  <input
                    type="number" step="0.01" value={r.value}
                    onChange={e => updateValue(idx, e.target.value)}
                    className={`w-24 border rounded-lg px-2 py-1 text-sm ${flagColors[r.flag]} ${
                      r.flag === 'critical' ? 'border-red-300 bg-red-50'
                      : r.flag !== 'normal' ? 'border-amber-300'
                      : 'border-gray-200'
                    }`}
                  />
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{r.unit}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400">
                  {r.ref_min !== undefined && r.ref_max !== undefined
                    ? `${r.ref_min} – ${r.ref_max}`
                    : r.ref_min !== undefined ? `> ${r.ref_min}`
                    : r.ref_max !== undefined ? `< ${r.ref_max}`
                    : '—'}
                </td>
                <td className={`px-4 py-2.5 text-sm ${flagColors[r.flag]}`}>
                  {flagLabels[r.flag]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600 mb-1 block">Заключение</label>
        <textarea value={conclusion} onChange={e => setConclusion(e.target.value)}
          rows={2} placeholder="Общее заключение по анализу..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
      </div>

      <button onClick={save} disabled={saving}
        className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Сохранение...' : '✓ Сохранить результаты'}
      </button>
    </div>
  )
}
