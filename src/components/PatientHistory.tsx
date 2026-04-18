'use client'

import { useEffect, useState } from 'react'
import {
  fetchEntityHistory,
  ACTION_LABEL, SEVERITY_CLASS, SEVERITY_LABEL,
  fieldLabel, formatValue,
  type AuditLog,
} from '@/lib/audit'

interface Props { patientId: string }

function shortTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function PatientHistory({ patientId }: Props) {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    setLoading(true)
    fetchEntityHistory('patients', patientId, 20).then(data => {
      if (!cancelled) { setLogs(data); setLoading(false); setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [open, loaded, patientId])

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <span>📜</span> История изменений
        </h3>
        <span className="text-xs text-gray-400">{open ? 'Скрыть' : 'Показать'}</span>
      </button>

      {open && (
        <div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Изменений не зафиксировано</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {logs.map(log => (
                <div key={log.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-gray-500 text-xs font-mono">{shortTime(log.created_at)}</span>
                      <span className="text-gray-700 font-medium">{log.user_name ?? 'Система'}</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-gray-600 text-xs">{ACTION_LABEL[log.action]}</span>
                    </div>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${SEVERITY_CLASS[log.severity]}`}>
                      {SEVERITY_LABEL[log.severity]}
                    </span>
                  </div>
                  {log.action === 'update' && log.changed_fields && log.changed_fields.length > 0 && (
                    <div className="space-y-1 mt-1">
                      {log.changed_fields.map(k => (
                        <div key={k} className="text-xs flex items-baseline gap-2 flex-wrap">
                          <span className="font-medium text-gray-700">{fieldLabel(k)}:</span>
                          <span className="text-red-600 line-through break-all">
                            {formatValue(log.old_value?.[k])}
                          </span>
                          <span className="text-gray-400">→</span>
                          <span className="text-green-700 break-all">
                            {formatValue(log.new_value?.[k])}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
