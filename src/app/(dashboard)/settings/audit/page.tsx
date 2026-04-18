'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  fetchAuditLogs,
  ACTION_LABEL, ENTITY_LABEL, SEVERITY_LABEL, SEVERITY_CLASS,
  fieldLabel, formatValue,
  type AuditLog, type AuditFilters, type AuditSeverity,
} from '@/lib/audit'

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
const lbl = 'block text-xs font-medium text-gray-500 mb-1'

const ENTITY_OPTIONS = Object.entries(ENTITY_LABEL)
const SEVERITY_OPTIONS: AuditSeverity[] = ['low', 'medium', 'high', 'critical']

function shortTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  const [entityType, setEntityType] = useState('')
  const [severity, setSeverity] = useState<'' | AuditSeverity>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [userSearch, setUserSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const filters: AuditFilters = { limit: 100 }
    if (entityType) filters.entityType = entityType
    if (severity)   filters.severity   = severity as AuditSeverity
    if (from)       filters.from       = new Date(from).toISOString()
    if (to) {
      const end = new Date(to); end.setHours(23, 59, 59, 999)
      filters.to = end.toISOString()
    }
    const data = await fetchAuditLogs(filters)
    setLogs(data)
    setLoading(false)
  }, [entityType, severity, from, to])

  useEffect(() => { load() }, [load])

  const filtered = userSearch.trim()
    ? logs.filter(l => (l.user_name ?? '').toLowerCase().includes(userSearch.toLowerCase()))
    : logs

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Журнал действий</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Автоматический аудит изменений на уровне базы данных. Последние 100 записей.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className={lbl}>Сущность</label>
            <select className={inp} value={entityType} onChange={e => setEntityType(e.target.value)}>
              <option value="">Все</option>
              {ENTITY_OPTIONS.map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Важность</label>
            <select className={inp} value={severity}
              onChange={e => setSeverity(e.target.value as '' | AuditSeverity)}>
              <option value="">Любая</option>
              {SEVERITY_OPTIONS.map(s => (
                <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>С даты</label>
            <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>По дату</label>
            <input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Пользователь</label>
            <input className={inp} value={userSearch} onChange={e => setUserSearch(e.target.value)}
              placeholder="Поиск по имени" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Нет записей</div>
        ) : (
          <div className="divide-y divide-gray-50">
            <div className="grid grid-cols-[130px_160px_110px_140px_1fr_100px] gap-3 px-5 py-2 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <div>Время</div>
              <div>Пользователь</div>
              <div>Действие</div>
              <div>Сущность</div>
              <div>Изменения</div>
              <div>Важность</div>
            </div>
            {filtered.map(log => {
              const open = expanded === log.id
              return (
                <div key={log.id}>
                  <button
                    onClick={() => setExpanded(open ? null : log.id)}
                    className="w-full grid grid-cols-[130px_160px_110px_140px_1fr_100px] gap-3 px-5 py-3 text-left text-sm hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-xs text-gray-500 font-mono">{shortTime(log.created_at)}</div>
                    <div className="text-gray-700 truncate">{log.user_name ?? 'Система'}</div>
                    <div className="text-gray-700">{ACTION_LABEL[log.action]}</div>
                    <div className="text-gray-700 truncate">
                      {ENTITY_LABEL[log.entity_type] ?? log.entity_type}
                    </div>
                    <div className="text-gray-500 text-xs truncate">
                      {log.action === 'update'
                        ? (log.changed_fields ?? []).map(fieldLabel).join(', ') || '—'
                        : log.entity_id ? `ID: ${log.entity_id.slice(0, 8)}…` : '—'}
                    </div>
                    <div>
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${SEVERITY_CLASS[log.severity]}`}>
                        {SEVERITY_LABEL[log.severity]}
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div className="px-5 pb-4 bg-gray-50/60">
                      {log.action === 'update' && log.changed_fields && log.changed_fields.length > 0 ? (
                        <div className="space-y-1.5">
                          {log.changed_fields.map(k => (
                            <div key={k} className="text-xs grid grid-cols-[180px_1fr_1fr] gap-2 items-start">
                              <div className="font-medium text-gray-700">{fieldLabel(k)}</div>
                              <div className="text-red-600 bg-red-50 rounded px-2 py-1 break-all">
                                {formatValue(log.old_value?.[k])}
                              </div>
                              <div className="text-green-700 bg-green-50 rounded px-2 py-1 break-all">
                                {formatValue(log.new_value?.[k])}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="font-medium text-gray-700 mb-1">До</p>
                            <pre className="bg-white border border-gray-100 rounded-lg p-3 overflow-auto max-h-64 text-[11px]">
{JSON.stringify(log.old_value, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="font-medium text-gray-700 mb-1">После</p>
                            <pre className="bg-white border border-gray-100 rounded-lg p-3 overflow-auto max-h-64 text-[11px]">
{JSON.stringify(log.new_value, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
