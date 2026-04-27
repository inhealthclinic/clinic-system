'use client'

/**
 * Корзина CRM — список soft-deleted сделок с восстановлением.
 *
 * Зачем: менеджеры в проде уже один раз случайно снесли всю воронку
 * массовым удалением. Native confirm() не спасает. Эта страница — второй
 * рубеж защиты: всё, что попало в «удалённые», лежит здесь и одним
 * кликом возвращается обратно. Никакого permanent-delete UI — только
 * owner через SQL может физически стереть запись.
 *
 * RLS на deals не фильтрует по deleted_at — у нас просто запрос с
 * `deleted_at IS NOT NULL` поверх стандартной clinic-фильтрации.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { notify } from '@/lib/ui/notify'

interface DeletedDeal {
  id: string
  name: string | null
  contact_phone: string | null
  amount: number | null
  pipeline_id: string | null
  stage_id: string | null
  stage: string | null
  external_id: string | null
  deleted_at: string
  created_at: string
  patient?: { id: string; full_name: string } | null
  responsible?: { id: string; first_name: string; last_name: string | null } | null
}

interface PipelineLite { id: string; name: string }
interface StageLite { id: string; name: string }

export default function CRMTrashPage() {
  const supabase = useMemo(() => createClient(), [])
  const profile = useAuthStore(s => s.profile)
  const clinicId = profile?.clinic_id ?? ''

  const [rows, setRows] = useState<DeletedDeal[]>([])
  const [pipelines, setPipelines] = useState<PipelineLite[]>([])
  const [stages, setStages] = useState<StageLite[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [purging, setPurging] = useState(false)
  const isOwner = profile?.role?.slug === 'owner'

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const [{ data: deals }, { data: pls }, { data: sts }] = await Promise.all([
      supabase
        .from('deals')
        .select(`
          id, name, contact_phone, amount, pipeline_id, stage_id, stage,
          external_id, deleted_at, created_at,
          patient:patients(id, full_name),
          responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name)
        `)
        .eq('clinic_id', clinicId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .limit(500),
      supabase.from('pipelines').select('id, name').eq('clinic_id', clinicId),
      supabase.from('pipeline_stages').select('id, name'),
    ])
    setRows((deals ?? []) as unknown as DeletedDeal[])
    setPipelines(pls ?? [])
    setStages(sts ?? [])
    setLoading(false)
  }, [supabase, clinicId])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => {
      const hay = [
        r.name ?? '',
        r.contact_phone ?? '',
        r.patient?.full_name ?? '',
        r.external_id ?? '',
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search])

  const pipelineName = useCallback((id: string | null) => {
    if (!id) return '—'
    return pipelines.find(p => p.id === id)?.name ?? '—'
  }, [pipelines])

  const stageName = useCallback((id: string | null, fallback: string | null) => {
    if (!id) return fallback ?? '—'
    return stages.find(s => s.id === id)?.name ?? fallback ?? '—'
  }, [stages])

  const allChecked = filtered.length > 0 && filtered.every(r => selected.has(r.id))

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(r => r.id)))
    }
  }

  async function restoreOne(id: string) {
    setRestoring(true)
    const { error } = await supabase.from('deals')
      .update({ deleted_at: null })
      .eq('id', id)
    setRestoring(false)
    if (error) { notify.error(error.message); return }
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    notify.success('Сделка восстановлена')
    load()
  }

  async function purgeOne(id: string, name: string | null) {
    if (!isOwner) { notify.error('Безвозвратное удаление доступно только владельцу'); return }
    if (!confirm(`Удалить «${name ?? 'без имени'}» БЕЗВОЗВРАТНО? Действие нельзя отменить.`)) return
    setPurging(true)
    const { error } = await supabase.from('deals').delete().eq('id', id)
    setPurging(false)
    if (error) { notify.error(error.message); return }
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    notify.success('Удалено навсегда')
    load()
  }

  async function purgeSelected() {
    if (!isOwner) { notify.error('Безвозвратное удаление доступно только владельцу'); return }
    if (selected.size === 0) return
    if (!confirm(`Удалить БЕЗВОЗВРАТНО ${selected.size} сделок? Действие нельзя отменить.`)) return
    setPurging(true)
    const ids = Array.from(selected)
    const { error } = await supabase.from('deals').delete().in('id', ids)
    setPurging(false)
    if (error) { notify.error(error.message); return }
    notify.success(`Удалено навсегда: ${ids.length}`)
    setSelected(new Set())
    load()
  }

  async function restoreSelected() {
    if (selected.size === 0) return
    setRestoring(true)
    const ids = Array.from(selected)
    const { error } = await supabase.from('deals')
      .update({ deleted_at: null })
      .in('id', ids)
    setRestoring(false)
    if (error) { notify.error(error.message); return }
    notify.success(`Восстановлено: ${ids.length}`)
    setSelected(new Set())
    load()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="text-sm text-blue-600 hover:underline">← К канбану</Link>
          <h1 className="text-xl font-semibold text-gray-900">Корзина CRM</h1>
          <span className="text-sm text-gray-500">{rows.length} удалённых</span>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: имя, телефон, ID amoCRM…"
          className="border border-gray-200 rounded px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-sm text-blue-900">Выбрано: <b>{selected.size}</b></span>
          <button
            type="button"
            onClick={restoreSelected}
            disabled={restoring}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {restoring ? 'Восстанавливаю…' : 'Восстановить выбранные'}
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={purgeSelected}
              disabled={purging}
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {purging ? 'Удаляю…' : 'Удалить навсегда'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-gray-600 hover:text-gray-900"
          >
            Снять выбор
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left w-8">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2 text-left">Сделка</th>
              <th className="px-3 py-2 text-left">Пациент</th>
              <th className="px-3 py-2 text-left">Телефон</th>
              <th className="px-3 py-2 text-left">Воронка / этап</th>
              <th className="px-3 py-2 text-right">Сумма</th>
              <th className="px-3 py-2 text-left">Удалена</th>
              <th className="px-3 py-2 text-right w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Загрузка…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                {rows.length === 0 ? 'Корзина пуста.' : 'Ничего не найдено.'}
              </td></tr>
            )}
            {!loading && filtered.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{r.name ?? '(без имени)'}</div>
                  {r.external_id && (
                    <div className="text-[11px] text-gray-400 font-mono">amo: {r.external_id}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700">{r.patient?.full_name ?? '—'}</td>
                <td className="px-3 py-2 text-gray-700 font-mono text-xs">{r.contact_phone ?? '—'}</td>
                <td className="px-3 py-2 text-gray-700">
                  <div>{pipelineName(r.pipeline_id)}</div>
                  <div className="text-xs text-gray-500">{stageName(r.stage_id, r.stage)}</div>
                </td>
                <td className="px-3 py-2 text-right text-gray-700">
                  {r.amount != null ? r.amount.toLocaleString('ru-RU') : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {new Date(r.deleted_at).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => restoreOne(r.id)}
                      disabled={restoring}
                      className="px-2.5 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 text-xs font-medium disabled:opacity-50"
                    >
                      Восстановить
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => purgeOne(r.id, r.name)}
                        disabled={purging}
                        title="Удалить навсегда (только владелец)"
                        className="px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium disabled:opacity-50"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Сделка остаётся в БД после удаления (soft-delete) и одним кликом возвращается обратно.
        {isOwner
          ? ' Кнопка «Удалить» стирает запись физически — действие необратимо.'
          : ' Безвозвратно удалить запись может только владелец клиники.'}
      </p>
    </div>
  )
}
