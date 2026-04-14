'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import type { Deal } from '@/types/app'

// Воронки
const LEAD_STAGES = [
  { key: 'new',         label: 'Неразобранное', color: 'bg-gray-50 border-gray-200' },
  { key: 'in_progress', label: 'В работе',      color: 'bg-blue-50 border-blue-200' },
  { key: 'contact',     label: 'Контакт',        color: 'bg-amber-50 border-amber-200' },
  { key: 'booked',      label: 'Записан',        color: 'bg-green-50 border-green-200' },
]

const MED_STAGES = [
  { key: 'booked',     label: 'Запись',       color: 'bg-blue-50 border-blue-200' },
  { key: 'confirmed',  label: 'Подтверждён',  color: 'bg-indigo-50 border-indigo-200' },
  { key: 'arrived',    label: 'Пришёл',       color: 'bg-amber-50 border-amber-200' },
  { key: 'in_visit',   label: 'На приёме',    color: 'bg-green-50 border-green-200' },
  { key: 'completed',  label: 'Завершён',     color: 'bg-emerald-50 border-emerald-200' },
  { key: 'follow_up',  label: 'Follow-up',    color: 'bg-purple-50 border-purple-200' },
  { key: 'repeat',     label: 'Повторный',    color: 'bg-teal-50 border-teal-200' },
]

const PRIORITY_COLORS: Record<string, string> = {
  hot: 'bg-red-100 text-red-600',
  warm: 'bg-amber-100 text-amber-600',
  cold: 'bg-blue-100 text-blue-600',
}

export default function CRMPage() {
  const supabase = createClient()
  const { can } = usePermissions()
  const [funnel, setFunnel] = useState<'leads' | 'medical'>('leads')
  const [deals, setDeals] = useState<(Deal & { patient: any })[]>([])
  const [showNew, setShowNew] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const stages = funnel === 'leads' ? LEAD_STAGES : MED_STAGES

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('deals')
      .select('*, patient:patients(id, full_name, phones, status)')
      .eq('funnel', funnel)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    setDeals(data || [])
    setLoading(false)
  }, [funnel])

  useEffect(() => { load() }, [load])

  const byStage = (stage: string) => deals.filter(d => d.stage === stage)

  const moveToStage = async (dealId: string, newStage: string) => {
    await supabase.from('deals').update({ stage: newStage }).eq('id', dealId)
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage as any } : d))
  }

  const markLost = async (dealId: string, reason: string) => {
    await supabase.from('deals')
      .update({ status: 'lost', lost_reason: reason }).eq('id', dealId)
    setDeals(prev => prev.filter(d => d.id !== dealId))
  }

  // Drag and drop
  const onDragStart = (dealId: string) => setDragging(dealId)
  const onDragOver  = (e: React.DragEvent) => e.preventDefault()
  const onDrop      = (stage: string) => {
    if (dragging) { moveToStage(dragging, stage); setDragging(null) }
  }

  const totalByStage = (stage: string) => byStage(stage).length

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Шапка */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0">
        <h1 className="text-lg font-bold text-gray-900">CRM</h1>

        {/* Переключатель воронок */}
        <div className="flex bg-gray-100 rounded-xl p-1">
          {([['leads','Лиды'], ['medical','Медицинская']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFunnel(k)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                funnel === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <PermissionGuard permission="crm:create">
          <button onClick={() => setShowNew(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
            + Новый лид
          </button>
        </PermissionGuard>
      </div>

      {/* Канбан */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-3 h-full" style={{ minWidth: stages.length * 260 }}>
          {stages.map(stage => (
            <div
              key={stage.key}
              onDragOver={onDragOver}
              onDrop={() => onDrop(stage.key)}
              className={`flex flex-col w-60 shrink-0 rounded-2xl border-2 ${stage.color} overflow-hidden`}
            >
              {/* Заголовок колонки */}
              <div className="px-3 py-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">{stage.label}</span>
                <span className="text-xs bg-white/70 text-gray-500 px-1.5 py-0.5 rounded-full">
                  {totalByStage(stage.key)}
                </span>
              </div>

              {/* Карточки */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                {loading ? (
                  <div className="text-center py-4 text-gray-300 text-xs">...</div>
                ) : byStage(stage.key).length === 0 ? (
                  <div className="text-center py-6 text-gray-300 text-xs">Пусто</div>
                ) : byStage(stage.key).map(deal => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stages={stages}
                    onMove={moveToStage}
                    onLost={markLost}
                    onDragStart={onDragStart}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Новый лид */}
      {showNew && (
        <NewDealModal
          onClose={() => setShowNew(false)}
          onSave={(deal) => { setDeals(prev => [deal, ...prev]); setShowNew(false) }}
        />
      )}
    </div>
  )
}

// Карточка сделки
function DealCard({ deal, stages, onMove, onLost, onDragStart }: {
  deal: Deal & { patient: any }
  stages: typeof LEAD_STAGES
  onMove: (id: string, stage: string) => void
  onLost: (id: string, reason: string) => void
  onDragStart: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const currentIdx = stages.findIndex(s => s.key === deal.stage)

  const age = deal.created_at
    ? Math.floor((Date.now() - new Date(deal.created_at).getTime()) / 86400000)
    : 0

  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal.id)}
      className="bg-white rounded-xl border border-gray-200 p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow select-none"
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <p className="text-sm font-semibold text-gray-800 leading-tight">
          {deal.patient?.full_name}
        </p>
        <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_COLORS[deal.priority]}`}>
          {deal.priority === 'hot' ? '🔥' : deal.priority === 'warm' ? '♨️' : '❄️'}
        </span>
      </div>

      {deal.patient?.phones?.[0] && (
        <p className="text-xs text-gray-400 mb-1.5">{deal.patient.phones[0]}</p>
      )}

      {deal.source && (
        <p className="text-xs text-gray-400">{deal.source}</p>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-400">{age}д назад</span>
        <button onClick={() => setExpanded(e => !e)}
          className="text-gray-300 hover:text-gray-500 text-xs">
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
          {/* Перемещение по этапам */}
          {stages.map((s, idx) => idx !== currentIdx && (
            <button key={s.key} onClick={() => onMove(deal.id, s.key)}
              className="w-full text-left text-xs px-2 py-1 rounded-lg hover:bg-gray-50 text-gray-600">
              → {s.label}
            </button>
          ))}
          <button onClick={() => onLost(deal.id, 'other')}
            className="w-full text-left text-xs px-2 py-1 rounded-lg hover:bg-red-50 text-red-400">
            ✗ Потерян
          </button>
        </div>
      )}
    </div>
  )
}

// Модальное окно нового лида
function NewDealModal({ onClose, onSave }: { onClose: () => void; onSave: (d: any) => void }) {
  const supabase = createClient()
  const { user } = usePermissions()
  const [form, setForm] = useState({
    name: '', phone: '', source: 'whatsapp', priority: 'warm'
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    // Создаём пациента
    const { data: patient } = await supabase.from('patients').insert({
      clinic_id: user?.clinic_id,
      full_name: form.name,
      phones: [form.phone],
      gender: 'other',
      status: 'new',
      first_owner_id: user?.id,
      manager_id: user?.id,
    }).select('id').single()

    if (!patient) { setSaving(false); return }

    // Создаём сделку
    const { data: deal } = await supabase.from('deals').insert({
      clinic_id: user?.clinic_id,
      patient_id: patient.id,
      funnel: 'leads',
      stage: 'new',
      source: form.source,
      priority: form.priority,
      first_owner_id: user?.id,
    }).select('*, patient:patients(id, full_name, phones)').single()

    if (deal) onSave(deal)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Новый лид</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Имя *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Телефон</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+7..." className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Источник</label>
              <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                {['whatsapp','instagram','2gis','referral','organic','target','other'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Приоритет</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                <option value="hot">🔥 Горячий</option>
                <option value="warm">♨️ Тёплый</option>
                <option value="cold">❄️ Холодный</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
          <button onClick={save} disabled={!form.name || saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
            {saving ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
