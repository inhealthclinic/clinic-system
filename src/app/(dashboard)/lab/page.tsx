'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import { LabResultsForm } from '@/components/lab/LabResultsForm'
import { LabStockWidget } from '@/components/lab/LabStockWidget'

type LabStatus = 'ordered'|'agreed'|'paid'|'sample_taken'|'in_progress'|'rejected'|'ready'|'verified'|'delivered'

interface LabOrder {
  id: string
  order_number: string
  status: LabStatus
  urgent: boolean
  ordered_at: string
  sample_taken_at?: string
  external_lab_name?: string
  rejected_reason?: string
  patient: { id: string; full_name: string; phones: string[]; birth_date?: string; gender: string }
  doctor: { first_name: string; last_name: string }
  items: { id: string; name: string; status: string; template?: { parameters: any[] } }[]
}

const STATUS_LABELS: Record<LabStatus, string> = {
  ordered:      'Назначен',
  agreed:       'Согласован',
  paid:         'Оплачен',
  sample_taken: 'Образец взят',
  in_progress:  'В работе',
  rejected:     'Отклонён',
  ready:        'Готов',
  verified:     'Верифицирован',
  delivered:    'Выдан',
}

const STATUS_COLORS: Record<LabStatus, string> = {
  ordered:      'bg-gray-100 text-gray-600',
  agreed:       'bg-blue-100 text-blue-600',
  paid:         'bg-green-100 text-green-700',
  sample_taken: 'bg-amber-100 text-amber-700',
  in_progress:  'bg-purple-100 text-purple-700',
  rejected:     'bg-red-100 text-red-600',
  ready:        'bg-teal-100 text-teal-700',
  verified:     'bg-blue-100 text-blue-700',
  delivered:    'bg-gray-100 text-gray-500',
}

// Следующий статус для прогресса
const NEXT_STATUS: Partial<Record<LabStatus, LabStatus>> = {
  ordered:      'sample_taken',
  agreed:       'sample_taken',
  paid:         'sample_taken',
  sample_taken: 'in_progress',
  in_progress:  'ready',
  ready:        'verified',
  verified:     'delivered',
}

const REJECT_REASONS: Record<string, string> = {
  hemolysis:          'Гемолиз',
  insufficient_volume:'Недостаточный объём',
  wrong_tube:         'Неправильная пробирка',
  contaminated:       'Загрязнение',
  expired:            'Истёк срок',
  other:              'Другое',
}

export default function LabPage() {
  const { can } = usePermissions()
  const supabase = createClient()

  const [orders, setOrders] = useState<LabOrder[]>([])
  const [filter, setFilter] = useState<LabStatus | 'all'>('all')
  const [selected, setSelected] = useState<LabOrder | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [loading, setLoading] = useState(false)

  const loadOrders = async () => {
    setLoading(true)
    let q = supabase
      .from('lab_orders')
      .select(`
        *,
        patient:patients(id, full_name, phones, birth_date, gender),
        doctor:doctors(first_name, last_name),
        items:lab_order_items(*, template:lab_test_templates(parameters))
      `)
      .order('urgent', { ascending: false })
      .order('ordered_at', { ascending: false })

    if (filter !== 'all') q = q.eq('status', filter)

    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => { loadOrders() }, [filter])

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel('lab-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_orders' }, loadOrders)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const advanceStatus = async (order: LabOrder) => {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    await supabase.from('lab_orders')
      .update({
        status: next,
        ...(next === 'sample_taken' ? { sample_taken_at: new Date().toISOString() } : {}),
        ...(next === 'verified' ? { verified_at: new Date().toISOString() } : {}),
      })
      .eq('id', order.id)
    loadOrders()
    if (selected?.id === order.id) setSelected({ ...order, status: next })
  }

  const rejectOrder = async () => {
    if (!selected || !rejectReason) return
    await supabase.from('lab_orders').update({
      status: 'rejected',
      rejected_reason: rejectReason,
      rejected_at: new Date().toISOString(),
    }).eq('id', selected.id)
    setShowReject(false)
    loadOrders()
  }

  const patientAge = (dob?: string) => {
    if (!dob) return undefined
    return new Date().getFullYear() - new Date(dob).getFullYear()
  }

  const filteredOrders = orders

  const tabs: { key: LabStatus | 'all'; label: string }[] = [
    { key: 'all',         label: 'Все' },
    { key: 'sample_taken',label: 'Образцы' },
    { key: 'in_progress', label: 'В работе' },
    { key: 'ready',       label: 'Готовы' },
    { key: 'verified',    label: 'Верифицированы' },
    { key: 'rejected',    label: 'Отклонены' },
  ]

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Левая панель — очередь */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-100">
          <h1 className="text-lg font-bold text-gray-900">Лаборатория</h1>
        </div>

        {/* Фильтр статусов */}
        <div className="p-3 border-b border-gray-100 overflow-x-auto">
          <div className="flex gap-1.5">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  filter === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Список заказов */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {loading ? (
            <div className="p-4 text-center text-gray-400 text-sm">Загрузка...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Нет направлений</div>
          ) : (
            filteredOrders.map(order => (
              <button key={order.id} onClick={() => { setSelected(order); setShowResults(false) }}
                className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                  selected?.id === order.id ? 'bg-blue-50 border-l-2 border-blue-600' : ''
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {order.urgent && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">СРОЧНО</span>}
                      <span className="text-xs text-gray-400 font-mono">{order.order_number}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{order.patient.full_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {order.items.length} {order.items.length === 1 ? 'анализ' : 'анализа(ов)'}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${STATUS_COLORS[order.status]}`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Склад реагентов */}
        <div className="p-3 border-t border-gray-100">
          <LabStockWidget />
        </div>
      </div>

      {/* Правая панель — детали */}
      {selected ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Шапка заказа */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm text-gray-500">{selected.order_number}</span>
                    {selected.urgent && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">СРОЧНО</span>
                    )}
                    <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLORS[selected.status]}`}>
                      {STATUS_LABELS[selected.status]}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{selected.patient.full_name}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {selected.patient.phones?.[0]}
                    {selected.patient.birth_date && ` · ${patientAge(selected.patient.birth_date)} лет`}
                    {` · ${selected.patient.gender === 'male' ? 'М' : 'Ж'}`}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Назначил: {selected.doctor.first_name} {selected.doctor.last_name} ·{' '}
                    {new Date(selected.ordered_at).toLocaleDateString('ru', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' })}
                  </p>
                  {selected.external_lab_name && (
                    <p className="text-xs text-purple-600 mt-1">🏥 Внешняя лаборатория: {selected.external_lab_name}</p>
                  )}
                </div>

                {/* Действия */}
                <div className="flex flex-col gap-2 items-end">
                  {NEXT_STATUS[selected.status] && (
                    <PermissionGuard anyOf={['lab:enter_results', 'lab:verify']}>
                      <button onClick={() => advanceStatus(selected)}
                        className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
                        → {STATUS_LABELS[NEXT_STATUS[selected.status]!]}
                      </button>
                    </PermissionGuard>
                  )}
                  {['sample_taken', 'in_progress'].includes(selected.status) && (
                    <PermissionGuard permission="lab:enter_results">
                      <button onClick={() => setShowReject(true)}
                        className="text-red-500 border border-red-200 px-3 py-1.5 rounded-xl text-xs hover:bg-red-50">
                        Отклонить образец
                      </button>
                    </PermissionGuard>
                  )}
                </div>
              </div>

              {/* Отклонён */}
              {selected.status === 'rejected' && selected.rejected_reason && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-sm font-medium text-red-700">
                    Причина отклонения: {REJECT_REASONS[selected.rejected_reason] || selected.rejected_reason}
                  </p>
                </div>
              )}
            </div>

            {/* Список анализов */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">Анализы</h3>
              </div>
              {selected.items.map(item => (
                <div key={item.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.name}</p>
                    <p className="text-xs text-gray-400">
                      {item.template?.parameters?.length || 0} показателей
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      item.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {item.status === 'completed' ? '✓ Готово' : 'Ожидает'}
                    </span>
                    {['in_progress', 'sample_taken'].includes(selected.status) && item.status !== 'completed' && (
                      <PermissionGuard permission="lab:enter_results">
                        <button
                          onClick={() => { setShowResults(true) }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          Ввести результаты
                        </button>
                      </PermissionGuard>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Форма ввода результатов */}
            {showResults && selected.items.find(i => i.status !== 'completed') && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Ввод результатов</h3>
                {selected.items
                  .filter(i => i.status !== 'completed')
                  .map(item => (
                    <LabResultsForm
                      key={item.id}
                      orderId={selected.id}
                      orderItem={item}
                      patientAge={patientAge(selected.patient.birth_date)}
                      patientGender={selected.patient.gender as any}
                      onSave={() => { setShowResults(false); loadOrders() }}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <p className="text-4xl mb-3">🔬</p>
            <p className="text-sm">Выберите направление из списка</p>
          </div>
        </div>
      )}

      {/* Модальное окно отклонения образца */}
      {showReject && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold mb-4">Отклонить образец</h2>
            <p className="text-sm text-gray-600 mb-3">
              Выберите причину отклонения. Врач и пациент получат уведомление.
            </p>
            <div className="space-y-2">
              {Object.entries(REJECT_REASONS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-gray-50">
                  <input type="radio" name="reject" value={key}
                    checked={rejectReason === key}
                    onChange={() => setRejectReason(key)}
                    className="accent-red-600" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowReject(false)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                Отмена
              </button>
              <button onClick={rejectOrder} disabled={!rejectReason}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                Отклонить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
