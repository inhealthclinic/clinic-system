'use client'

import { useRouter } from 'next/navigation'
import { usePermissions } from '@/lib/hooks/usePermissions'

interface Props {
  patientId: string
  patientName: string
  onDeposit?: () => void
  onLabOrder?: () => void
  onTask?: () => void
  onCompareResults?: () => void
}

export function QuickActions({ patientId, patientName, onDeposit, onLabOrder, onTask, onCompareResults }: Props) {
  const router = useRouter()
  const { can } = usePermissions()

  const actions = [
    {
      key: 'appointment',
      label: 'Записать',
      icon: '📅',
      perm: 'schedule:create',
      onClick: () => router.push(`/schedule?patient_id=${patientId}&patient_name=${encodeURIComponent(patientName)}`),
      color: 'bg-blue-600 hover:bg-blue-700 text-white',
    },
    {
      key: 'payment',
      label: 'Оплата',
      icon: '💳',
      perm: 'finance:create',
      onClick: () => router.push(`/finance?patient_id=${patientId}`),
      color: 'bg-green-600 hover:bg-green-700 text-white',
    },
    {
      key: 'deposit',
      label: 'Депозит',
      icon: '💰',
      perm: 'finance:create',
      onClick: onDeposit,
      color: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    },
    {
      key: 'lab',
      label: 'Анализы',
      icon: '🔬',
      perm: 'lab:order',
      onClick: onLabOrder,
      color: 'bg-purple-600 hover:bg-purple-700 text-white',
    },
    {
      key: 'procedure',
      label: 'Процедура',
      icon: '💉',
      perm: 'visit:create',
      onClick: () => router.push(`/schedule?patient_id=${patientId}&walkin=true`),
      color: 'bg-orange-500 hover:bg-orange-600 text-white',
    },
    {
      key: 'task',
      label: 'Задача',
      icon: '✅',
      perm: 'tasks:create',
      onClick: onTask,
      color: 'bg-gray-600 hover:bg-gray-700 text-white',
    },
    {
      key: 'compare',
      label: 'Сравнить',
      icon: '📊',
      perm: 'lab:view',
      onClick: onCompareResults,
      color: 'bg-teal-500 hover:bg-teal-600 text-white',
    },
  ]

  const available = actions.filter(a => !a.perm || can(a.perm))

  return (
    <div className="flex flex-wrap gap-2">
      {available.map(a => (
        <button
          key={a.key}
          onClick={a.onClick}
          disabled={!a.onClick}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 ${a.color}`}
        >
          <span>{a.icon}</span>
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  )
}
