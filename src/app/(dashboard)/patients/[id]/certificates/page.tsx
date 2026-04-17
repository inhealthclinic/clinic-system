'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * Библиотека типовых справок с подстановкой данных пациента.
 * Данные не хранятся в БД — при необходимости добавим таблицу "certificates".
 */

interface Patient {
  id: string
  full_name: string
  birth_date: string | null
  iin: string | null
  phones: string[]
  gender: string | null
}

interface Doctor { id: string; first_name: string; last_name: string }

type TemplateKey = 'general' | 'workfit' | 'school' | 'covid_neg' | 'no_contraindications'

interface Template {
  key: TemplateKey
  title: string
  subtitle: string
  needs: ('dates' | 'diagnosis' | 'doctor' | 'period')[]
  body: (opts: {
    patientName: string; ageLine: string; iinLine: string;
    dateFrom: string; dateTo: string;
    diagnosis: string; doctor: string; today: string;
  }) => string
}

const TEMPLATES: Template[] = [
  {
    key: 'general',
    title: 'Медицинская справка',
    subtitle: 'О состоянии здоровья (свободная форма)',
    needs: ['diagnosis', 'doctor'],
    body: ({ patientName, ageLine, iinLine, diagnosis, doctor, today }) => `
      <p>Настоящая справка выдана <b>${patientName}</b>, ${ageLine}${iinLine ? ', ' + iinLine : ''}
      в том, что он/она обратился(-ась) в клинику и был(-а) осмотрен(-а) специалистом.</p>
      ${diagnosis ? `<p><b>Заключение:</b> ${diagnosis}</p>` : ''}
      <p>Справка действительна на ${today}.</p>
      ${doctor ? `<p style="margin-top:12px">Лечащий врач: <b>${doctor}</b></p>` : ''}
    `,
  },
  {
    key: 'workfit',
    title: 'Листок нетрудоспособности',
    subtitle: 'О временной нетрудоспособности',
    needs: ['dates', 'diagnosis', 'doctor'],
    body: ({ patientName, ageLine, iinLine, dateFrom, dateTo, diagnosis, doctor }) => `
      <p>Настоящая справка выдана <b>${patientName}</b>, ${ageLine}${iinLine ? ', ' + iinLine : ''}
      в том, что он/она был(-а) временно нетрудоспособен(-на) в связи с заболеванием.</p>
      <p><b>Период нетрудоспособности:</b> с ${dateFrom || '—'} по ${dateTo || '—'}.</p>
      ${diagnosis ? `<p><b>Диагноз:</b> ${diagnosis}</p>` : ''}
      <p>К выполнению трудовых обязанностей приступить с ${dateTo || '—'} (следующий день).</p>
      ${doctor ? `<p style="margin-top:12px">Лечащий врач: <b>${doctor}</b></p>` : ''}
    `,
  },
  {
    key: 'school',
    title: 'Справка в школу/детский сад',
    subtitle: 'Об освобождении от занятий',
    needs: ['dates', 'diagnosis', 'doctor'],
    body: ({ patientName, ageLine, dateFrom, dateTo, diagnosis, doctor }) => `
      <p>Настоящая справка выдана <b>${patientName}</b>, ${ageLine}
      в том, что он/она не посещал(-а) образовательное учреждение
      с ${dateFrom || '—'} по ${dateTo || '—'} в связи с болезнью.</p>
      ${diagnosis ? `<p><b>Диагноз:</b> ${diagnosis}</p>` : ''}
      <p>К посещению занятий допущен(-а) с ${dateTo || '—'}. Противопоказаний для учёбы нет.</p>
      ${doctor ? `<p style="margin-top:12px">Лечащий врач: <b>${doctor}</b></p>` : ''}
    `,
  },
  {
    key: 'no_contraindications',
    title: 'Справка об отсутствии противопоказаний',
    subtitle: 'Для занятий спортом / бассейном',
    needs: ['doctor'],
    body: ({ patientName, ageLine, iinLine, doctor, today }) => `
      <p>Настоящая справка выдана <b>${patientName}</b>, ${ageLine}${iinLine ? ', ' + iinLine : ''}
      в том, что противопоказаний к занятиям физической культурой и спортом, посещению бассейна
      на момент осмотра (${today}) — не выявлено.</p>
      ${doctor ? `<p style="margin-top:12px">Врач: <b>${doctor}</b></p>` : ''}
    `,
  },
  {
    key: 'covid_neg',
    title: 'Справка: отрицательный тест',
    subtitle: 'На COVID-19 / другое',
    needs: ['dates', 'doctor'],
    body: ({ patientName, ageLine, iinLine, dateFrom, doctor, today }) => `
      <p>Настоящая справка выдана <b>${patientName}</b>, ${ageLine}${iinLine ? ', ' + iinLine : ''}
      в том, что по результатам лабораторного исследования от ${dateFrom || today}
      инфекция не обнаружена (<b>отрицательный результат</b>).</p>
      <p>Справка действительна в течение 72 часов с момента забора биоматериала.</p>
      ${doctor ? `<p style="margin-top:12px">Врач: <b>${doctor}</b></p>` : ''}
    `,
  },
]

function printCert(
  patient: Patient,
  tpl: Template,
  opts: {
    dateFrom: string; dateTo: string; diagnosis: string;
    doctorName: string;
  },
) {
  const w = window.open('', '_blank', 'width=680,height=820')
  if (!w) return
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const age = patient.birth_date ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear() : null
  const dobStr = patient.birth_date
    ? new Date(patient.birth_date).toLocaleDateString('ru-RU')
    : null
  const ageLine = age
    ? `${age} лет${dobStr ? `, ${dobStr} г.р.` : ''}`
    : dobStr ? `${dobStr} г.р.` : ''
  const iinLine = patient.iin ? `ИИН ${patient.iin}` : ''
  const dateFromStr = opts.dateFrom ? new Date(opts.dateFrom).toLocaleDateString('ru-RU') : ''
  const dateToStr   = opts.dateTo   ? new Date(opts.dateTo).toLocaleDateString('ru-RU')   : ''

  const body = tpl.body({
    patientName: patient.full_name,
    ageLine, iinLine,
    dateFrom: dateFromStr, dateTo: dateToStr,
    diagnosis: opts.diagnosis,
    doctor: opts.doctorName,
    today,
  })

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${tpl.title}</title>
  <style>
    @page { size: A4; margin: 22mm 18mm }
    body{font-family:Arial,sans-serif;max-width:580px;margin:24px auto;font-size:14px;color:#111;line-height:1.55}
    h1{margin:0 0 4px;font-size:20px;text-align:center}
    .sub{color:#777;font-size:12px;text-align:center;margin-bottom:18px;border-bottom:2px solid #111;padding-bottom:8px}
    .header{text-align:center;margin-bottom:20px;font-size:11px;color:#555}
    .body p{margin:10px 0}
    .sig{margin-top:48px;display:flex;justify-content:space-between;font-size:12px;color:#555}
    .sig-line{border-top:1px solid #999;padding-top:4px;min-width:220px;text-align:center}
    .foot{margin-top:30px;font-size:10px;color:#aaa;border-top:1px dashed #ddd;padding-top:8px;text-align:center}
    .date{text-align:right;margin-top:20px;font-size:12px;color:#555}
  </style></head><body>
  <div class="header">
    <div style="font-weight:600;color:#111">IN HEALTH — Медицинский центр</div>
    <div>г. Актау</div>
  </div>
  <h1>${tpl.title}</h1>
  <div class="sub">${tpl.subtitle}</div>
  <div class="body">${body}</div>
  <div class="date">Дата выдачи: ${today}</div>
  <div class="sig">
    <div class="sig-line">Подпись врача</div>
    <div class="sig-line">М.П.</div>
  </div>
  <div class="foot">Сформировано ${new Date().toLocaleString('ru-RU')} · IN HEALTH Медицинский центр</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

export default function CertificatesPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)

  const [tplKey, setTplKey] = useState<TemplateKey>('general')
  const [doctorId, setDoctorId] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10))

  useEffect(() => {
    Promise.all([
      supabase.from('patients').select('id,full_name,birth_date,iin,phones,gender').eq('id', id).maybeSingle(),
      supabase.from('doctors').select('id,first_name,last_name').eq('is_active', true).order('last_name'),
    ]).then(([p, d]) => {
      if (!p.data) { router.push('/patients'); return }
      setPatient(p.data as Patient)
      setDoctors((d.data ?? []) as Doctor[])
      setLoading(false)
    })
  }, [id])  // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !patient) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  }

  const tpl = TEMPLATES.find(t => t.key === tplKey)!
  const doctorName = doctors.find(d => d.id === doctorId)
  const doctorFull = doctorName ? `${doctorName.last_name} ${doctorName.first_name}` : ''
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'

  return (
    <div className="max-w-3xl mx-auto">
      <Link href={`/patients/${id}`}
        className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
        ← {patient.full_name}
      </Link>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">📄 Справки и документы</h2>

      {/* Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
        {TEMPLATES.map(t => (
          <button key={t.key} onClick={() => setTplKey(t.key)}
            className={`text-left p-3 rounded-xl border transition-colors ${
              tplKey === t.key
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}>
            <p className="text-sm font-medium text-gray-900">{t.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.subtitle}</p>
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Врач</label>
          <select className={inp} value={doctorId} onChange={e => setDoctorId(e.target.value)}>
            <option value="">— не указан —</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.last_name} {d.first_name}</option>)}
          </select>
        </div>

        {tpl.needs.includes('dates') && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">С</label>
              <input type="date" className={inp} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">По</label>
              <input type="date" className={inp} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
        )}

        {tpl.needs.includes('diagnosis') && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Диагноз</label>
            <input className={inp} value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
              placeholder="Например: J06.9 Острая инфекция ВДП" />
          </div>
        )}

        <button
          onClick={() => printCert(patient, tpl, { dateFrom, dateTo, diagnosis, doctorName: doctorFull })}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium">
          🖨 Сформировать и распечатать
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center mt-3">
        Данные пациента подставляются автоматически. Печатная форма открывается в новой вкладке.
      </p>
    </div>
  )
}
