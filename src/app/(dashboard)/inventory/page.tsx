'use client'

import { useEffect, useState, useCallback } from 'react'
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

type Tab = 'reagents' | 'consumables' | 'movements'
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
    const { error: mErr } = await supabase.from('inventory_movements').insert({
      clinic_id:   clinicId,
      batch_id:    batch.id,
      item_type:   itemType,
      item_id:     item.id,
      type:        movType,
      quantity:    q,
      notes:       notes.trim() || WRITEOFF_REASONS.find(r => r.value === reason)?.label || null,
      performed_by: userId,
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
    </div>
  )
}
