'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface StockItem {
  item_id: string
  name: string
  unit: string
  min_stock: number
  remaining: number
  expires_at: string | null
  status: 'ok' | 'low' | 'critical'
}

export function LabStockWidget() {
  const [items, setItems] = useState<StockItem[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    supabase.rpc('get_lab_stock_summary').then(({ data }) => {
      if (data) setItems(data)
    }).catch(() => {
      // Fallback: прямой запрос
      supabase
        .from('inventory_batches')
        .select('item_id, remaining, expires_at, reagent:reagents(name, unit, min_stock)')
        .eq('item_type', 'reagent')
        .gt('remaining', 0)
        .order('expires_at', { ascending: true, nullsFirst: false })
        .then(({ data: batches }) => {
          if (!batches) return
          // Группируем по item_id
          const grouped: Record<string, StockItem> = {}
          batches.forEach((b: any) => {
            if (!b.reagent) return
            if (!grouped[b.item_id]) {
              grouped[b.item_id] = {
                item_id: b.item_id,
                name: b.reagent.name,
                unit: b.reagent.unit,
                min_stock: b.reagent.min_stock,
                remaining: 0,
                expires_at: b.expires_at,
                status: 'ok',
              }
            }
            grouped[b.item_id].remaining += b.remaining
          })
          const result = Object.values(grouped).map(item => ({
            ...item,
            status: (
              item.remaining < item.min_stock ? 'critical'
              : item.remaining < item.min_stock * 2 ? 'low'
              : 'ok'
            ) as StockItem['status']
          }))
          setItems(result)
        })
    })
  }, [])

  const critical = items.filter(i => i.status === 'critical').length
  const low      = items.filter(i => i.status === 'low').length

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">🧪 Реагенты</span>
          {critical > 0 && (
            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
              {critical} критично
            </span>
          )}
          {low > 0 && (
            <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
              {low} мало
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 max-h-64 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Нет данных</p>
          ) : (
            items.map(item => (
              <div key={item.item_id}
                className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    item.status === 'critical' ? 'bg-red-500'
                    : item.status === 'low' ? 'bg-amber-400'
                    : 'bg-green-400'
                  }`} />
                  <span className="text-sm text-gray-700 truncate">{item.name}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className={`text-sm font-medium ${
                    item.status === 'critical' ? 'text-red-600'
                    : item.status === 'low' ? 'text-amber-600'
                    : 'text-gray-700'
                  }`}>
                    {item.remaining} {item.unit}
                  </p>
                  {item.expires_at && (
                    <p className="text-xs text-gray-400">
                      до {new Date(item.expires_at).toLocaleDateString('ru', { day:'numeric', month:'short' })}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
