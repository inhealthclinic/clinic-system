'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────── */
interface Reagent {
  id: string
  clinic_id: string
  name: string
  code: string | null
  unit: string
  min_stock: number
  is_active: boolean
  created_at: string
}

interface Consumable {
  id: string
  clinic_id: string
  name: string
  code: string | null
  unit: string
  min_stock: number
  is_active: boolean
  created_at: string
}

interface Batch {
  id: string
  clinic_id: string
  item_type: 'reagent' | 'consumable'
  item_id: string
  batch_number: string
  manufactured_at: string | null
  expires_at: string | null
  quantity_initial: number
  quantity_remaining: number
  unit: string
  supplier: string | null
  price_per_unit: number | null
  received_at: string | null
  is_active: boolean
  created_at: string
}

interface Movement {
  id: string
  clinic_id: string
  batch_id: string
  item_type: 'reagent' | 'consumable'
  item_id: string
  type: 'receipt' | 'consumption' | 'correction' | 'writeoff'
  quantity: number
  notes: string | null
  performed_by: string | null
  created_at: string
  item_name?: string
  batch_number?: string
}

interface ServiceUsageRow {
  id: string
  clinic_id: string
  service_id: string
  item_type: 'reagent' | 'consumable'
  item_id: string
  qty_per_service: number
  notes: string | null
  is_active: boolean
  created_at: string
}

interface ServiceLite {
  id: string
  name: string
  code: string | null
  is_lab?: boolean | null
}

interface LabOrderCostRow {
  lab_order_id: string
  clinic_id: string
  patient_id: string | null
  status: string
  ordered_at: string | null
  auto_writeoff_at: string | null
  cost_total: number
  movements_count: number
  items_used: number
  patient_name?: string
}

interface ServiceMarginRow {
  service_id: string
  service_name: string
  price: number | null
  orders_count: number
  cost_total: number
  cost_per_order: number | null
  margin_pct: number | null
}

interface MonthlyCostRow {
  clinic_id: string
  month: string        // YYYY-MM-DD (first day of month)
  orders_count: number
  cost_total: number
}

type Tab = 'reagents' | 'consumables' | 'movements' | 'templates' | 'cost'
type ItemType = Reagent | Consumable

/* ─── Constants ──────────────────────────────────────────── */
const MOVEMENT_LABEL: Record<string, string> = {
  receipt:          'Приход',
  incoming:         'Приход',
  consumption:      'Расход',
  writeoff_service: 'Расход (услуга)',
  writeoff_lab:     'Расход (лаб.)',
  correction:       'Корректировка',
  writeoff:         'Списание',
  damaged:          'Повреждение',
  expired:          'Истёк срок',
  return:           'Возврат',
}

const MOVEMENT_CLR: Record<string, string> = {
  receipt:          'bg-green-100 text-green-700',
  incoming:         'bg-green-100 text-green-700',
  consumption:      'bg-red-100 text-red-600',
  writeoff_service: 'bg-red-100 text-red-600',
  writeoff_lab:     'bg-red-100 text-red-600',
  correction:       'bg-yellow-100 text-yellow-700',
  writeoff:         'bg-orange-100 text-orange-700',
  damaged:          'bg-orange-100 text-orange-700',
  expired:          'bg-red-100 text-red-700',
  return:           'bg-blue-100 text-blue-600',
}

const UNITS = ['мл', 'г', 'шт', 'уп']

const INP = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

/* ─── LIS: Print inventory report ───────────────────────── */
function printInventoryReport(items: ItemType[], batches: Batch[], itemType: 'reagent' | 'consumable') {
  const w = window.open('', '_blank', 'width=800,height=700')
  if (!w) return
  const title = itemType === 'reagent' ? 'Реагенты' : 'Расходники'
  const now30 = new Date(); now30.setDate(now30.getDate() + 30)

  const rows = items.map(item => {
    const itemBatches = batches.filter(b => b.item_id === item.id)
    const stock = itemBatches.reduce((s, b) => s + b.quantity_remaining, 0)
    const expiring = itemBatches.find(b => b.expires_at && new Date(b.expires_at) <= now30)
    const status = stock === 0 ? 'НЕТ' : stock < item.min_stock ? 'МАЛО' : 'В НАЛИЧИИ'
    const statusColor = stock === 0 ? '#dc2626' : stock < item.min_stock ? '#ea580c' : '#16a34a'
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${item.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace">${item.code ?? '—'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${item.min_stock.toLocaleString('ru-RU')} ${item.unit}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${stock.toLocaleString('ru-RU')} ${item.unit}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:${statusColor};font-weight:600">${status}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:${expiring ? '#ea580c' : '#9ca3af'};font-size:11px">${expiring ? `⚠ до ${new Date(expiring.expires_at!).toLocaleDateString('ru-RU')}` : '—'}</td>
    </tr>`
  }).join('')

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Отчёт: ${title}</title>
  <style>body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:24px}h2{margin:0 0 4px}
  .sub{color:#777;font-size:12px;margin-bottom:16px}table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:6px 8px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px}
  .foot{margin-top:20px;font-size:10px;color:#ccc;border-top:1px dashed #ddd;padding-top:8px}</style></head><body>
  <h2>IN HEALTH — ${title}</h2>
  <div class="sub">Отчёт по остаткам · ${new Date().toLocaleString('ru-RU')}</div>
  <table>
    <thead><tr><th>Наименование</th><th>Код</th><th style="text-align:right">Мин. остаток</th><th style="text-align:right">Остаток</th><th>Статус</th><th>Срок годности</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">Всего позиций: ${items.length} · Сформировано автоматически · IN HEALTH</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

/* ─── Stock status helpers ───────────────────────────────── */
function stockStatus(current: number, min: number): { label: string; cls: string } {
  if (current === 0)         return { label: 'Нет в наличии', cls: 'bg-red-100 text-red-600' }
  if (current < min)         return { label: 'Мало',          cls: 'bg-orange-100 text-orange-600' }
  return                            { label: 'В наличии',     cls: 'bg-green-100 text-green-700' }
}

/* ─── Add Item Modal ─────────────────────────────────────── */
function AddItemModal({ clinicId, itemType, onClose, onSaved }: {
  clinicId: string
  itemType: 'reagent' | 'consumable'
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [name, setName]         = useState('')
  const [code, setCode]         = useState('')
  const [unit, setUnit]         = useState('шт')
  const [minStock, setMinStock] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const table = itemType === 'reagent' ? 'reagents' : 'consumables'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Укажите название'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from(table).insert({
      clinic_id: clinicId,
      name:      name.trim(),
      code:      code.trim() || null,
      unit,
      min_stock: parseFloat(minStock) || 0,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onSaved(); onClose()
  }

  const title = itemType === 'reagent' ? 'Новый реагент' : 'Новый расходник'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Название *</label>
            <input className={INP} value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Например: Физраствор 0.9%" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Код / артикул</label>
            <input className={INP} value={code} onChange={e => setCode(e.target.value)} placeholder="Необязательно" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Единица</label>
              <select className={INP} value={unit} onChange={e => setUnit(e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Мин. остаток</label>
              <input className={INP} type="number" min="0" step="0.01"
                value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="0" />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Writeoff Modal (manual) ───────────────────────────── */
const WRITEOFF_REASONS: Array<{ value: 'damaged'|'expired'|'correction'|'writeoff'; label: string; cls: string }> = [
  { value: 'damaged',    label: 'Повреждение',   cls: 'bg-orange-600 hover:bg-orange-700' },
  { value: 'expired',    label: 'Истёк срок',    cls: 'bg-red-600 hover:bg-red-700' },
  { value: 'correction', label: 'Корректировка', cls: 'bg-yellow-600 hover:bg-yellow-700' },
  { value: 'writeoff',   label: 'Прочее',        cls: 'bg-gray-600 hover:bg-gray-700' },
]

function WriteoffModal({ clinicId, item, itemType, batch, userId, onClose, onSaved }: {
  clinicId: string
  item: ItemType
  itemType: 'reagent' | 'consumable'
  batch: Batch
  userId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [qty, setQty]         = useState('')
  const [reason, setReason]   = useState<typeof WRITEOFF_REASONS[number]['value']>('damaged')
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const max = batch.quantity_remaining

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = parseFloat(qty)
    if (!q || q <= 0)  { setError('Укажите количество больше 0'); return }
    if (q > max)       { setError(`Макс. доступно: ${max} ${batch.unit}`); return }
    setSaving(true); setError('')

    // 1) Уменьшить остаток партии
    const { error: bErr } = await supabase
      .from('inventory_batches')
      .update({ quantity_remaining: max - q })
      .eq('id', batch.id)
    if (bErr) { setError(bErr.message); setSaving(false); return }

    // 2) Запись движения (тип = reason, чтобы в логе видеть почему)
    const movType = reason === 'correction' ? 'correction' : reason
    const costSnapshot = batch.price_per_unit != null ? q * batch.price_per_unit : null
    const { error: mErr } = await supabase.from('inventory_movements').insert({
      clinic_id:   clinicId,
      batch_id:    batch.id,
      item_type:   itemType,
      item_id:     item.id,
      type:        movType,
      quantity:    q,
      notes:       notes.trim() || WRITEOFF_REASONS.find(r => r.value === reason)?.label || null,
      performed_by: userId,
      cost_snapshot: costSnapshot,
    })
    if (mErr) {
      // Откатываем остаток
      await supabase.from('inventory_batches')
        .update({ quantity_remaining: max })
        .eq('id', batch.id)
      setError(mErr.message); setSaving(false); return
    }

    onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-100 bg-red-50">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Ручное списание</h3>
            <p className="text-xs text-red-700 mt-0.5">{item.name} · партия {batch.batch_number}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 flex items-center justify-between">
            <span>Текущий остаток:</span>
            <span className="font-semibold text-gray-900">{max.toLocaleString('ru-RU')} {batch.unit}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Причина *</label>
            <div className="grid grid-cols-2 gap-2">
              {WRITEOFF_REASONS.map(r => {
                const active = reason === r.value
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? `text-white border-transparent ${r.cls}`
                        : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Количество *</label>
            <div className="flex items-center gap-2">
              <input className={INP} type="number" min="0.01" step="0.01" max={max}
                value={qty} onChange={e => setQty(e.target.value)} placeholder="0" autoFocus />
              <span className="text-sm text-gray-500 flex-shrink-0">{batch.unit}</span>
              <button type="button" onClick={() => setQty(String(max))}
                className="text-xs text-blue-600 hover:text-blue-700 whitespace-nowrap">
                всё
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Примечание</label>
            <textarea className={INP + ' resize-none'} rows={2}
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Детали (необязательно)" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Списание...' : 'Списать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Add Batch Modal ────────────────────────────────────── */
function AddBatchModal({ clinicId, item, itemType, onClose, onSaved }: {
  clinicId: string
  item: ItemType
  itemType: 'reagent' | 'consumable'
  onClose: () => void
  onSaved: () => void
}) {
  const supabase     = createClient()
  const [batchNum, setBatchNum]   = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [quantity, setQuantity]   = useState('')
  const [unit, setUnit]           = useState(item.unit)
  const [supplier, setSupplier]   = useState('')
  const [price, setPrice]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!batchNum.trim())  { setError('Укажите номер партии'); return }
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0)  { setError('Укажите количество'); return }
    setSaving(true); setError('')

    const { data: batch, error: bErr } = await supabase
      .from('inventory_batches')
      .insert({
        clinic_id:         clinicId,
        item_type:         itemType,
        item_id:           item.id,
        batch_number:      batchNum.trim(),
        expires_at:        expiresAt || null,
        quantity_initial:  qty,
        quantity_remaining: qty,
        unit,
        supplier:          supplier.trim() || null,
        price_per_unit:    price ? parseFloat(price) : null,
      })
      .select('id')
      .single()

    if (bErr || !batch) { setError(bErr?.message ?? 'Ошибка'); setSaving(false); return }

    await supabase.from('inventory_movements').insert({
      clinic_id: clinicId,
      batch_id:  batch.id,
      item_type: itemType,
      item_id:   item.id,
      type:      'receipt',
      quantity:  qty,
    })

    onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Приход партии</h3>
            <p className="text-xs text-gray-400 mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Номер партии *</label>
            <input className={INP} value={batchNum} onChange={e => setBatchNum(e.target.value)} autoFocus placeholder="Напр. LOT-2024-001" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Срок годности</label>
            <input className={INP} type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Количество *</label>
              <input className={INP} type="number" min="0.01" step="0.01"
                value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Единица</label>
              <select className={INP} value={unit} onChange={e => setUnit(e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Поставщик</label>
            <input className={INP} value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Необязательно" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Цена за единицу</label>
            <input className={INP} type="number" min="0" step="0.01"
              value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Сохранение...' : 'Оприходовать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Expanded row with batches ──────────────────────────── */
function ItemBatchRow({ item, itemType, clinicId, batches, userId, onBatchAdded }: {
  item: ItemType
  itemType: 'reagent' | 'consumable'
  clinicId: string
  batches: Batch[]
  userId: string | null
  onBatchAdded: () => void
}) {
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [writeoffBatch, setWriteoffBatch] = useState<Batch | null>(null)
  const itemBatches = batches.filter(b => b.item_id === item.id)
  const now30 = new Date(); now30.setDate(now30.getDate() + 30)

  return (
    <>
      {showBatchModal && (
        <AddBatchModal
          clinicId={clinicId}
          item={item}
          itemType={itemType}
          onClose={() => setShowBatchModal(false)}
          onSaved={onBatchAdded}
        />
      )}
      {writeoffBatch && (
        <WriteoffModal
          clinicId={clinicId}
          item={item}
          itemType={itemType}
          batch={writeoffBatch}
          userId={userId}
          onClose={() => setWriteoffBatch(null)}
          onSaved={onBatchAdded}
        />
      )}
      <tr>
        <td colSpan={6} className="px-5 pb-4 pt-0 bg-gray-50/50">
          <div className="ml-4 border-l-2 border-blue-100 pl-4">
            <div className="flex items-center justify-between mb-2 mt-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Партии</p>
              <button
                onClick={() => setShowBatchModal(true)}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors">
                + Приход
              </button>
            </div>
            {itemBatches.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">Нет активных партий</p>
            ) : (
              <div className="space-y-1">
                {itemBatches.map(b => {
                  const expiring = b.expires_at && new Date(b.expires_at) <= now30
                  const empty    = b.quantity_remaining <= 0
                  return (
                    <div key={b.id} className={`flex items-center gap-4 text-xs py-1.5 px-3 rounded-lg border ${
                      empty      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : expiring ? 'bg-orange-50/40 border-orange-100'
                                 : 'bg-white border-gray-100'
                    }`}>
                      <span className="font-mono text-gray-700 font-medium w-32 truncate">{b.batch_number}</span>
                      <span className={expiring ? 'text-orange-600' : 'text-gray-400'}>
                        {b.expires_at
                          ? `до ${new Date(b.expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
                          : 'Срок не указан'}
                      </span>
                      <span className={`font-medium ${empty ? 'text-gray-400' : 'text-gray-700'}`}>
                        {b.quantity_remaining.toLocaleString('ru-RU')} {b.unit}
                      </span>
                      {b.supplier && <span className="text-gray-400 truncate flex-1">{b.supplier}</span>}
                      {!empty && (
                        <button
                          onClick={() => setWriteoffBatch(b)}
                          className="ml-auto text-[11px] font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded transition-colors flex-shrink-0">
                          Списать
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </td>
      </tr>
    </>
  )
}

/* ─── Items tab (shared for reagents & consumables) ──────── */
function ItemsTab({ clinicId, userId, itemType }: {
  clinicId: string
  userId: string | null
  itemType: 'reagent' | 'consumable'
}) {
  const supabase   = createClient()
  const table      = itemType === 'reagent' ? 'reagents' : 'consumables'
  const [items, setItems]       = useState<ItemType[]>([])
  const [batches, setBatches]   = useState<Batch[]>([])
  const [loading, setLoading]   = useState(true)
  const [expandedId, setExpanded] = useState<string | null>(null)
  const [showAdd, setShowAdd]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: itemData }, { data: batchData }] = await Promise.all([
      supabase.from(table).select('*').eq('is_active', true).order('name'),
      supabase.from('inventory_batches').select('*').eq('item_type', itemType).eq('is_active', true),
    ])
    setItems((itemData ?? []) as ItemType[])
    setBatches((batchData ?? []) as Batch[])
    setLoading(false)
  }, [itemType, table])

  useEffect(() => { if (clinicId) load() }, [clinicId, load])

  const currentStock = (itemId: string) =>
    batches
      .filter(b => b.item_id === itemId)
      .reduce((sum, b) => sum + b.quantity_remaining, 0)

  const toggleExpand = (id: string) =>
    setExpanded(prev => prev === id ? null : id)

  return (
    <>
      {showAdd && (
        <AddItemModal
          clinicId={clinicId}
          itemType={itemType}
          onClose={() => setShowAdd(false)}
          onSaved={load}
        />
      )}

      {/* ── LIS: Expiry warning banner ────────────────────── */}
      {!loading && (() => {
        const now30 = new Date(); now30.setDate(now30.getDate() + 30)
        const expiring = batches.filter(b => b.expires_at && new Date(b.expires_at) <= now30 && b.quantity_remaining > 0)
        if (expiring.length === 0) return null
        return (
          <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-orange-500 text-lg mt-0.5">⚠</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-orange-800 mb-1">
                {expiring.length} {expiring.length === 1 ? 'партия истекает' : 'партии истекают'} в ближайшие 30 дней
              </p>
              <div className="flex flex-wrap gap-2">
                {expiring.slice(0, 5).map(b => (
                  <span key={b.id} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                    {b.batch_number} · до {new Date(b.expires_at!).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </span>
                ))}
                {expiring.length > 5 && <span className="text-xs text-orange-500">+{expiring.length - 5} ещё</span>}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          {loading ? 'Загрузка...' : `${items.length} позиций`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => printInventoryReport(items, batches, itemType)}
            disabled={loading || items.length === 0}
            title="Печать отчёта по остаткам"
            className="px-3 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm font-medium rounded-lg transition-colors">
            🖨 Отчёт
          </button>
          <button
            onClick={() => setShowAdd(true)}
            disabled={!clinicId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            + Добавить
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Позиций нет. Добавьте первую.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Название</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Код</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Ед.</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Мин. остаток</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Текущий остаток</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const stock = currentStock(item.id)
                const { label, cls } = stockStatus(stock, item.min_stock)
                const expanded = expandedId === item.id
                return (
                  <>
                    <tr
                      key={item.id}
                      onClick={() => toggleExpand(item.id)}
                      className={[
                        'border-b border-gray-50 cursor-pointer transition-colors',
                        expanded ? 'bg-blue-50/40' : 'hover:bg-blue-50/30',
                      ].join(' ')}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-gray-300 text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                          <span className="text-sm font-medium text-gray-900">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono text-gray-400">{item.code ?? '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-500">{item.unit}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-500 text-right">
                        {item.min_stock.toLocaleString('ru-RU')}
                      </td>
                      <td className="px-5 py-3.5 text-sm font-semibold text-gray-900 text-right">
                        {stock.toLocaleString('ru-RU')}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${cls}`}>{label}</span>
                      </td>
                    </tr>
                    {expanded && (
                      <ItemBatchRow
                        key={`${item.id}-batches`}
                        item={item}
                        itemType={itemType}
                        clinicId={clinicId}
                        userId={userId}
                        batches={batches}
                        onBatchAdded={load}
                      />
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

/* ─── Movements tab ──────────────────────────────────────── */
function MovementsTab({ clinicId }: { clinicId: string }) {
  const supabase = createClient()
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading]     = useState(true)

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'in' | 'out'>('all')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [search, setSearch]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // Load movements
    let q = supabase
      .from('inventory_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')
    const { data: movData } = await q

    if (!movData || movData.length === 0) {
      setMovements([])
      setLoading(false)
      return
    }

    // Enrich with item names and batch numbers in-memory
    const reagentIds    = [...new Set(movData.filter(m => m.item_type === 'reagent').map(m => m.item_id))]
    const consumableIds = [...new Set(movData.filter(m => m.item_type === 'consumable').map(m => m.item_id))]
    const batchIds      = [...new Set(movData.map(m => m.batch_id).filter(Boolean))]

    const [{ data: reagents }, { data: consumables }, { data: batchRows }] = await Promise.all([
      reagentIds.length > 0
        ? supabase.from('reagents').select('id,name').in('id', reagentIds)
        : Promise.resolve({ data: [] }),
      consumableIds.length > 0
        ? supabase.from('consumables').select('id,name').in('id', consumableIds)
        : Promise.resolve({ data: [] }),
      batchIds.length > 0
        ? supabase.from('inventory_batches').select('id,batch_number').in('id', batchIds)
        : Promise.resolve({ data: [] }),
    ])

    const nameMap: Record<string, string> = {}
    for (const r of (reagents ?? []))    nameMap[r.id] = r.name
    for (const c of (consumables ?? [])) nameMap[c.id] = c.name

    const batchMap: Record<string, string> = {}
    for (const b of (batchRows ?? [])) batchMap[b.id] = b.batch_number

    const enriched: Movement[] = movData.map(m => ({
      ...(m as Movement),
      item_name:    nameMap[m.item_id] ?? '—',
      batch_number: batchMap[m.batch_id] ?? '—',
    }))

    setMovements(enriched)
    setLoading(false)
  }, [clinicId, dateFrom, dateTo])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (clinicId) load() }, [clinicId, load])

  const IN_TYPES  = new Set(['receipt','incoming','return'])
  const OUT_TYPES = new Set(['consumption','writeoff','writeoff_service','writeoff_lab','damaged','expired'])
  const filtered = movements.filter(m => {
    if (typeFilter === 'in'  && !IN_TYPES.has(m.type))  return false
    if (typeFilter === 'out' && !OUT_TYPES.has(m.type)) return false
    const q = search.trim().toLowerCase()
    if (q && !(m.item_name ?? '').toLowerCase().includes(q)
          && !(m.batch_number ?? '').toLowerCase().includes(q)) return false
    return true
  })

  return (
    <>
      <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 mb-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Поиск по наименованию или партии"
            className="flex-1 min-w-[200px] border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <span className="text-xs text-gray-400">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { k: 'all', label: 'Все движения', cls: 'border-gray-300 text-gray-700' },
            { k: 'in',  label: '⬆ Приход',     cls: 'border-green-300 text-green-700' },
            { k: 'out', label: '⬇ Расход',     cls: 'border-red-300 text-red-700' },
          ].map(f => (
            <button
              key={f.k}
              onClick={() => setTypeFilter(f.k as typeof typeFilter)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                typeFilter === f.k
                  ? 'bg-gray-900 text-white border-gray-900'
                  : `bg-white hover:bg-gray-50 ${f.cls}`
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-xs text-gray-400 ml-auto">
            Показано: {filtered.length} из {movements.length}
          </span>
        </div>
      </div>

    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">
          {movements.length === 0 ? 'Движений нет' : 'По фильтрам ничего не найдено'}
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Тип</th>
              <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Наименование</th>
              <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Партия</th>
              <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Количество</th>
              <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Примечание</th>
              <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Дата</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3.5">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${MOVEMENT_CLR[m.type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {MOVEMENT_LABEL[m.type] ?? m.type}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-sm text-gray-800">{m.item_name}</td>
                <td className="px-5 py-3.5 text-xs font-mono text-gray-400">{m.batch_number}</td>
                <td className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right">
                  {m.quantity.toLocaleString('ru-RU')}
                </td>
                <td className="px-5 py-3.5 text-xs text-gray-400 max-w-[160px] truncate">
                  {m.notes ?? '—'}
                </td>
                <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                  {new Date(m.created_at).toLocaleDateString('ru-RU', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    </>
  )
}

/* ─── Templates tab (service → item × qty) ──────────────── */
function TemplatesTab({ clinicId }: { clinicId: string }) {
  const supabase = createClient()
  const [services, setServices]       = useState<ServiceLite[]>([])
  const [reagents, setReagents]       = useState<Reagent[]>([])
  const [consumables, setConsumables] = useState<Consumable[]>([])
  const [rows, setRows]               = useState<ServiceUsageRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')

  // Add form state
  const [formService, setFormService] = useState('')
  const [formItemType, setFormItemType] = useState<'reagent'|'consumable'>('reagent')
  const [formItem, setFormItem]       = useState('')
  const [formQty, setFormQty]         = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: svc }, { data: reag }, { data: cons }, { data: rws }] = await Promise.all([
      supabase.from('services')
        .select('id,name,code,is_lab')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name'),
      supabase.from('reagents')
        .select('*').eq('clinic_id', clinicId).eq('is_active', true).order('name'),
      supabase.from('consumables')
        .select('*').eq('clinic_id', clinicId).eq('is_active', true).order('name'),
      supabase.from('service_inventory_usage')
        .select('*').eq('clinic_id', clinicId).eq('is_active', true).order('created_at', { ascending: false }),
    ])
    setServices((svc ?? []) as ServiceLite[])
    setReagents((reag ?? []) as Reagent[])
    setConsumables((cons ?? []) as Consumable[])
    setRows((rws ?? []) as ServiceUsageRow[])
    setLoading(false)
  }, [clinicId, supabase])

  useEffect(() => { if (clinicId) load() }, [clinicId, load])

  const itemPool = formItemType === 'reagent' ? reagents : consumables
  const itemMap: Record<string, ItemType> = {}
  for (const r of reagents)    itemMap[r.id] = r
  for (const c of consumables) itemMap[c.id] = c
  const svcMap: Record<string, ServiceLite> = {}
  for (const s of services) svcMap[s.id] = s

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!formService) { setError('Выберите услугу'); return }
    if (!formItem)    { setError('Выберите реагент/расходник'); return }
    const q = parseFloat(formQty)
    if (!q || q <= 0) { setError('Укажите количество > 0'); return }
    setSaving(true)
    const { error: err } = await supabase.from('service_inventory_usage').insert({
      clinic_id:       clinicId,
      service_id:      formService,
      item_type:       formItemType,
      item_id:         formItem,
      qty_per_service: q,
    })
    setSaving(false)
    if (err) {
      setError(err.message.includes('unique')
        ? 'Такая связка услуга ↔ позиция уже существует'
        : err.message)
      return
    }
    setFormItem(''); setFormQty('')
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить шаблон?')) return
    await supabase.from('service_inventory_usage').delete().eq('id', id)
    load()
  }

  const handleQtyEdit = async (id: string, newQty: number) => {
    if (!newQty || newQty <= 0) return
    await supabase.from('service_inventory_usage')
      .update({ qty_per_service: newQty })
      .eq('id', id)
    load()
  }

  // Group rows by service
  const grouped: Record<string, ServiceUsageRow[]> = {}
  for (const r of rows) {
    const sName = svcMap[r.service_id]?.name ?? ''
    const iName = itemMap[r.item_id]?.name ?? ''
    const q = search.trim().toLowerCase()
    if (q && !sName.toLowerCase().includes(q) && !iName.toLowerCase().includes(q)) continue
    if (!grouped[r.service_id]) grouped[r.service_id] = []
    grouped[r.service_id].push(r)
  }
  const serviceIds = Object.keys(grouped).sort((a, b) =>
    (svcMap[a]?.name ?? '').localeCompare(svcMap[b]?.name ?? '', 'ru')
  )

  return (
    <>
      {/* Add form */}
      <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Добавить шаблон списания</p>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr_1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Услуга</label>
            <select className={INP} value={formService} onChange={e => setFormService(e.target.value)}>
              <option value="">— выбрать —</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {s.is_lab ? '🔬 ' : ''}{s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Тип</label>
            <select className={INP} value={formItemType}
              onChange={e => { setFormItemType(e.target.value as 'reagent'|'consumable'); setFormItem('') }}>
              <option value="reagent">Реагент</option>
              <option value="consumable">Расходник</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Позиция</label>
            <select className={INP} value={formItem} onChange={e => setFormItem(e.target.value)}>
              <option value="">— выбрать —</option>
              {itemPool.map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Кол-во</label>
            <input className={INP} type="number" min="0.001" step="0.001"
              value={formQty} onChange={e => setFormQty(e.target.value)} placeholder="0" />
          </div>
          <button type="submit" disabled={saving}
            className="h-[42px] px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? '...' : '+ Добавить'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </form>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Поиск по услуге или позиции"
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Шаблонов нет. При заборе образца расходники списываются только если настроен шаблон для услуги.
          </div>
        ) : serviceIds.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">По фильтру ничего не найдено</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {serviceIds.map(sid => {
              const s = svcMap[sid]
              const entries = grouped[sid]
              return (
                <div key={sid} className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {s?.is_lab ? '🔬 ' : ''}{s?.name ?? 'Неизвестная услуга'}
                    </span>
                    {s?.code && (
                      <span className="text-[11px] font-mono text-gray-400">{s.code}</span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{entries.length} позиций</span>
                  </div>
                  <div className="space-y-1 ml-4 border-l-2 border-blue-100 pl-4">
                    {entries.map(r => {
                      const item = itemMap[r.item_id]
                      return (
                        <div key={r.id} className="flex items-center gap-3 text-xs py-1.5 px-3 rounded-lg bg-gray-50/50">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            r.item_type === 'reagent' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {r.item_type === 'reagent' ? 'Р' : 'Р/М'}
                          </span>
                          <span className="text-gray-700 flex-1 truncate">
                            {item?.name ?? '—'}
                          </span>
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            defaultValue={r.qty_per_service}
                            onBlur={e => {
                              const v = parseFloat(e.target.value)
                              if (v && v !== r.qty_per_service) handleQtyEdit(r.id, v)
                            }}
                            className="w-20 text-right border border-gray-200 rounded px-2 py-0.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <span className="text-gray-400 w-8">{item?.unit ?? ''}</span>
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="text-red-500 hover:text-red-700 text-sm leading-none flex-shrink-0">
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-gray-400">
        💡 При переходе заказа в статус «Образец взят» расходники списываются автоматически по FEFO (ближайший срок годности).
      </p>
    </>
  )
}

/* ─── CSV helper ─────────────────────────────────────────── */
function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return ''
    const s = String(v)
    if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const csv = rows.map(r => r.map(esc).join(';')).join('\r\n')
  // Add BOM so Excel picks UTF-8 correctly for Russian text
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* ─── Monthly cost bar chart ─────────────────────────────── */
function CostMonthlyChart({ data }: { data: MonthlyCostRow[] }) {
  if (data.length === 0) return null
  const W = 600
  const H = 120
  const PAD_L = 40, PAD_R = 8, PAD_T = 10, PAD_B = 24
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const max = Math.max(...data.map(d => d.cost_total), 1)
  const barW = plotW / data.length
  const fmt = (v: number) => v >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
  const monthLabel = (m: string) => {
    const d = new Date(m)
    return d.toLocaleDateString('ru-RU', { month: 'short' })
  }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
      {/* Y-axis: 0 and max */}
      <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{fmt(max)}</text>
      <text x={PAD_L - 4} y={PAD_T + plotH} textAnchor="end" fontSize="10" fill="#9ca3af">0</text>
      <line x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} stroke="#e5e7eb" />

      {data.map((d, i) => {
        const h = (d.cost_total / max) * plotH
        const x = PAD_L + i * barW + barW * 0.15
        const y = PAD_T + plotH - h
        const w = barW * 0.7
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={w} height={h}
              fill="#3b82f6" fillOpacity="0.85" rx="2">
              <title>{`${monthLabel(d.month)}: ${fmt(d.cost_total)} сом (${d.orders_count} заказов)`}</title>
            </rect>
            <text x={x + w / 2} y={PAD_T + plotH + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
              {monthLabel(d.month)}
            </text>
            {d.cost_total > 0 && (
              <text x={x + w / 2} y={y - 2} textAnchor="middle" fontSize="9" fill="#1f2937" fontWeight="600">
                {fmt(d.cost_total)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/* ─── Cost tab ───────────────────────────────────────────── */
function CostTab({ clinicId }: { clinicId: string }) {
  const supabase = createClient()
  const [orders, setOrders]     = useState<LabOrderCostRow[]>([])
  const [margins, setMargins]   = useState<ServiceMarginRow[]>([])
  const [monthly, setMonthly]   = useState<MonthlyCostRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [view, setView]         = useState<'orders' | 'services'>('orders')

  const load = useCallback(async () => {
    setLoading(true)

    // 1) Заказы с себестоимостью
    let oq = supabase.from('v_lab_order_costs')
      .select('*')
      .eq('clinic_id', clinicId)
      .gt('cost_total', 0)
      .order('ordered_at', { ascending: false })
      .limit(200)
    if (dateFrom) oq = oq.gte('ordered_at', dateFrom)
    if (dateTo)   oq = oq.lte('ordered_at', dateTo + 'T23:59:59')
    const { data: ordData } = await oq

    // Enrich with patient names
    const patientIds = [...new Set((ordData ?? []).map(o => o.patient_id).filter(Boolean))] as string[]
    let nameMap: Record<string, string> = {}
    if (patientIds.length > 0) {
      const { data: pts } = await supabase.from('patients')
        .select('id,last_name,first_name').in('id', patientIds)
      for (const p of (pts ?? [])) nameMap[p.id] = `${p.last_name ?? ''} ${p.first_name ?? ''}`.trim()
    }
    const enriched: LabOrderCostRow[] = (ordData ?? []).map(o => ({
      ...(o as LabOrderCostRow),
      patient_name: o.patient_id ? nameMap[o.patient_id] : undefined,
    }))
    setOrders(enriched)

    // 2) Маржа по услугам
    const { data: mData } = await supabase.from('v_service_margin')
      .select('*')
      .eq('clinic_id', clinicId)
      .gt('orders_count', 0)
      .order('cost_total', { ascending: false })
      .limit(100)
    setMargins((mData ?? []) as ServiceMarginRow[])

    // 3) Месячный тренд за последние 12 месяцев
    const since = new Date()
    since.setMonth(since.getMonth() - 11)
    since.setDate(1); since.setHours(0, 0, 0, 0)
    const { data: monData } = await supabase.from('v_lab_costs_monthly')
      .select('*')
      .eq('clinic_id', clinicId)
      .gte('month', since.toISOString().slice(0, 10))
      .order('month')
    // Заполнить пустые месяцы нулями
    const filled: MonthlyCostRow[] = []
    const byMonth: Record<string, MonthlyCostRow> = {}
    for (const r of (monData ?? []) as MonthlyCostRow[]) {
      byMonth[r.month.slice(0, 7)] = r
    }
    for (let i = 0; i < 12; i++) {
      const d = new Date(since); d.setMonth(since.getMonth() + i)
      const key = d.toISOString().slice(0, 7)
      const existing = byMonth[key]
      filled.push(existing ?? {
        clinic_id: clinicId,
        month: d.toISOString().slice(0, 10),
        orders_count: 0,
        cost_total: 0,
      })
    }
    setMonthly(filled)

    setLoading(false)
  }, [clinicId, dateFrom, dateTo, supabase])

  useEffect(() => { if (clinicId) load() }, [clinicId, load])

  const fmt = (v: number | null | undefined) =>
    v == null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // KPI calculations
  const kpis = useMemo(() => {
    const totalCost      = orders.reduce((s, o) => s + (o.cost_total || 0), 0)
    const ordersCount    = orders.length
    const avgCost        = ordersCount ? totalCost / ordersCount : 0
    // Weighted margin across services (weight = orders_count)
    const marginsWeighted = margins.filter(m => m.margin_pct != null && m.orders_count > 0)
    const totalWeight = marginsWeighted.reduce((s, m) => s + m.orders_count, 0)
    const avgMargin = totalWeight > 0
      ? marginsWeighted.reduce((s, m) => s + (m.margin_pct ?? 0) * m.orders_count, 0) / totalWeight
      : null
    const unprofitable = margins.filter(m => m.margin_pct != null && m.margin_pct < 0).length
    return { totalCost, ordersCount, avgCost, avgMargin, unprofitable }
  }, [orders, margins])
  const totalCost = kpis.totalCost

  // Export handlers
  const exportOrdersCSV = () => {
    const header = ['ID заказа', 'Пациент', 'Статус', 'Позиций', 'Себестоимость', 'Дата заказа']
    const rows = orders.map(o => [
      o.lab_order_id,
      o.patient_name ?? '',
      o.status,
      o.items_used,
      o.cost_total,
      o.ordered_at ? new Date(o.ordered_at).toLocaleDateString('ru-RU') : '',
    ])
    const period = [dateFrom || 'начало', dateTo || 'сегодня'].join('_')
    downloadCSV(`lab-costs-orders_${period}.csv`, [header, ...rows])
  }
  const exportServicesCSV = () => {
    const header = ['Услуга', 'Цена', 'Себест-ть/заказ', 'Маржа %', 'Заказов', 'Себест-ть всего']
    const rows = margins.map(m => [
      m.service_name,
      m.price,
      m.cost_per_order,
      m.margin_pct,
      m.orders_count,
      m.cost_total,
    ])
    downloadCSV('lab-costs-services.csv', [header, ...rows])
  }

  return (
    <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Заказов</p>
          <p className="text-xl font-semibold text-gray-900 mt-0.5">{kpis.ordersCount}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Себест-ть всего</p>
          <p className="text-xl font-semibold text-gray-900 mt-0.5">{fmt(kpis.totalCost)}</p>
          <p className="text-[11px] text-gray-400">сом</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Средн. себест-ть</p>
          <p className="text-xl font-semibold text-gray-900 mt-0.5">{fmt(kpis.avgCost)}</p>
          <p className="text-[11px] text-gray-400">сом / заказ</p>
        </div>
        <div className={`bg-white border rounded-xl px-4 py-3 ${
          kpis.unprofitable > 0 ? 'border-red-200' : 'border-gray-100'
        }`}>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Средн. маржа</p>
          <p className={`text-xl font-semibold mt-0.5 ${
            kpis.avgMargin == null ? 'text-gray-400'
            : kpis.avgMargin >= 50 ? 'text-green-600'
            : kpis.avgMargin >= 20 ? 'text-yellow-600'
            : kpis.avgMargin >= 0  ? 'text-orange-600'
                                   : 'text-red-600'
          }`}>
            {kpis.avgMargin == null ? '—' : `${kpis.avgMargin.toFixed(1)}%`}
          </p>
          {kpis.unprofitable > 0 && (
            <p className="text-[11px] text-red-600 mt-0.5">⚠ убыточных: {kpis.unprofitable}</p>
          )}
        </div>
      </div>

      {/* Chart + Top-5 unprofitable */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3 mb-4">
        <div className="bg-white border border-gray-100 rounded-xl px-4 pt-3 pb-2">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">
            Себестоимость по месяцам (12 мес)
          </p>
          {loading ? (
            <div className="h-[120px] flex items-center justify-center text-xs text-gray-400">Загрузка...</div>
          ) : monthly.every(m => m.cost_total === 0) ? (
            <div className="h-[120px] flex items-center justify-center text-xs text-gray-400">Данных нет</div>
          ) : (
            <CostMonthlyChart data={monthly} />
          )}
        </div>
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">Топ убыточных услуг</p>
          {(() => {
            const losers = [...margins]
              .filter(m => m.margin_pct != null && m.margin_pct < 20)
              .sort((a, b) => (a.margin_pct ?? 0) - (b.margin_pct ?? 0))
              .slice(0, 5)
            if (losers.length === 0) {
              return <p className="text-xs text-gray-400">Всё в плюсе 🎉</p>
            }
            return (
              <div className="space-y-1.5">
                {losers.map(m => {
                  const pct = m.margin_pct ?? 0
                  const cls = pct < 0 ? 'text-red-600' : pct < 10 ? 'text-orange-600' : 'text-yellow-600'
                  return (
                    <div key={m.service_id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-700 truncate flex-1 pr-2">{m.service_name}</span>
                      <span className={`font-semibold ${cls} flex-shrink-0`}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 items-center">
        {[
          { k: 'orders',   label: 'По заказам' },
          { k: 'services', label: 'По услугам' },
        ].map(v => (
          <button
            key={v.k}
            onClick={() => setView(v.k as typeof view)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              view === v.k
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            {v.label}
          </button>
        ))}
        <button
          onClick={view === 'orders' ? exportOrdersCSV : exportServicesCSV}
          disabled={loading || (view === 'orders' ? orders.length === 0 : margins.length === 0)}
          className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
          ⬇ CSV
        </button>
      </div>

      {view === 'orders' ? (
        <>
          {/* Filters + total */}
          <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-xs text-gray-400">—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="ml-auto text-sm">
              <span className="text-gray-400">Себестоимость всего: </span>
              <span className="font-semibold text-gray-900">{fmt(totalCost)} сом</span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
            ) : orders.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                Нет заказов с себестоимостью. Настрой шаблоны списания и оприходуй партии с указанной ценой за единицу.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Заказ</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Пациент</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Позиций</th>
                    <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Себест-ть</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.lab_order_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-xs font-mono text-gray-500">
                        {o.lab_order_id.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-800">
                        {o.patient_name ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {o.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 text-right">{o.items_used}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-gray-900 text-right">
                        {fmt(o.cost_total)}
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {o.ordered_at
                          ? new Date(o.ordered_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
          ) : margins.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              Данных по услугам пока нет.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Услуга</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Цена</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Себест-ть / заказ</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Маржа %</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Заказов</th>
                  <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">Себест-ть всего</th>
                </tr>
              </thead>
              <tbody>
                {margins.map(m => {
                  const mPct = m.margin_pct
                  const mColor = mPct == null
                    ? 'text-gray-400'
                    : mPct >= 50 ? 'text-green-600'
                    : mPct >= 20 ? 'text-yellow-600'
                    : mPct >= 0  ? 'text-orange-600'
                                 : 'text-red-600'
                  return (
                    <tr key={m.service_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-sm text-gray-800">{m.service_name}</td>
                      <td className="px-5 py-3 text-sm text-gray-600 text-right">{fmt(m.price)}</td>
                      <td className="px-5 py-3 text-sm text-gray-600 text-right">{fmt(m.cost_per_order)}</td>
                      <td className={`px-5 py-3 text-sm font-semibold text-right ${mColor}`}>
                        {mPct == null ? '—' : `${mPct.toFixed(1)}%`}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 text-right">{m.orders_count}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-gray-900 text-right">{fmt(m.cost_total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        💡 Себестоимость снимается в момент списания (qty × цена партии). Исторические списания пересчитаны по текущей цене партии миграцией 031.
      </p>
    </>
  )
}

/* ─── Page ───────────────────────────────────────────────── */
export default function InventoryPage() {
  const { profile }   = useAuthStore()
  const clinicId      = profile?.clinic_id ?? ''
  const userId        = profile?.id ?? null
  const [tab, setTab] = useState<Tab>('reagents')

  const TABS: { key: Tab; label: string }[] = [
    { key: 'reagents',    label: 'Реагенты'   },
    { key: 'consumables', label: 'Расходники' },
    { key: 'movements',   label: 'Движения'   },
    { key: 'templates',   label: 'Шаблоны'    },
    { key: 'cost',        label: 'Себестоимость' },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'px-5 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'reagents' && (
        <ItemsTab key="reagents" clinicId={clinicId} userId={userId} itemType="reagent" />
      )}
      {tab === 'consumables' && (
        <ItemsTab key="consumables" clinicId={clinicId} userId={userId} itemType="consumable" />
      )}
      {tab === 'movements' && (
        <MovementsTab clinicId={clinicId} />
      )}
      {tab === 'templates' && (
        <TemplatesTab clinicId={clinicId} />
      )}
      {tab === 'cost' && (
        <CostTab clinicId={clinicId} />
      )}
    </div>
  )
}
