/**
 * Печать медицинских документов (рецепт, справка) с официальной шапкой клиники.
 * Используется через window.open() + window.print() — в диалоге печати
 * браузера есть встроенная кнопка «Сохранить как PDF», поэтому отдельная
 * PDF-библиотека (react-pdf / jsPDF) не нужна.
 */

import { createClient } from '@/lib/supabase/client'

export interface PrintClinic {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  settings: { license_number?: string; license_date?: string; bin?: string } | null
}

export interface PrintDoctor {
  first_name: string
  last_name: string
  middle_name: string | null
  specialization: string | null
  certificates: Array<{ name?: string; number?: string }> | null
  phone: string | null
  signature_url: string | null
  prescription_header: string | null
}

export interface PrintPatient {
  full_name: string
  birth_date: string | null
  iin: string | null
  phones: string[]
}

export interface PrintMeta {
  clinic: PrintClinic
  doctor: PrintDoctor
  patient: PrintPatient
}

/* ─── Data loader ──────────────────────────────────────────── */

export async function loadPrintMeta(
  clinicId: string,
  patientId: string,
  doctorId: string,
): Promise<PrintMeta> {
  const sb = createClient()

  const [{ data: clinic }, { data: doctor }, { data: patient }] = await Promise.all([
    sb.from('clinics')
      .select('name, address, phone, email, logo_url, settings')
      .eq('id', clinicId).single(),
    sb.from('doctors')
      .select('first_name, last_name, middle_name, phone, certificates, signature_url, prescription_header, specialization:specializations(name)')
      .eq('id', doctorId).single(),
    sb.from('patients')
      .select('full_name, birth_date, iin, phones')
      .eq('id', patientId).single(),
  ])

  return {
    clinic: (clinic as PrintClinic) ?? {
      name: '', address: null, phone: null, email: null, logo_url: null, settings: null,
    },
    doctor: {
      first_name: (doctor as any)?.first_name ?? '',
      last_name: (doctor as any)?.last_name ?? '',
      middle_name: (doctor as any)?.middle_name ?? null,
      phone: (doctor as any)?.phone ?? null,
      certificates: (doctor as any)?.certificates ?? null,
      specialization: (doctor as any)?.specialization?.name ?? null,
      signature_url: (doctor as any)?.signature_url ?? null,
      prescription_header: (doctor as any)?.prescription_header ?? null,
    },
    patient: (patient as PrintPatient) ?? {
      full_name: '', birth_date: null, iin: null, phones: [],
    },
  }
}

/* ─── Formatting helpers ──────────────────────────────────── */

export function esc(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function doctorFullName(d: PrintDoctor): string {
  return [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(' ')
}

export function calcAge(birthDate: string | null): string | null {
  if (!birthDate) return null
  const d = new Date(birthDate)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  if (age < 0 || age > 130) return null
  // Русская плюрализация
  const mod10 = age % 10
  const mod100 = age % 100
  let w = 'лет'
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) w = 'год'
    else if (mod10 >= 2 && mod10 <= 4) w = 'года'
  }
  return `${age} ${w}`
}

export function formatDateRu(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/* ─── Shared building blocks ──────────────────────────────── */

export function renderLetterhead(clinic: PrintClinic): string {
  const license = clinic.settings?.license_number
    ? `Лицензия № ${esc(clinic.settings.license_number)}${clinic.settings.license_date ? ` от ${esc(clinic.settings.license_date)}` : ''}`
    : ''
  const bin = clinic.settings?.bin ? `БИН ${esc(clinic.settings.bin)}` : ''
  const contacts = [clinic.phone, clinic.email].filter(Boolean).map(esc).join(' · ')

  return `
    <div class="letterhead">
      ${clinic.logo_url ? `<img src="${esc(clinic.logo_url)}" alt="logo" class="logo" />` : ''}
      <div class="clinic-info">
        <div class="clinic-name">${esc(clinic.name) || 'Медицинская клиника'}</div>
        ${clinic.address ? `<div class="clinic-line">${esc(clinic.address)}</div>` : ''}
        ${contacts ? `<div class="clinic-line">${contacts}</div>` : ''}
        ${[license, bin].filter(Boolean).length ? `<div class="clinic-line muted">${[license, bin].filter(Boolean).join(' · ')}</div>` : ''}
      </div>
    </div>
  `
}

export function renderSignature(doctor: PrintDoctor): string {
  const cert = doctor.certificates?.[0]
  const certLine = cert?.number ? `Сертификат № ${esc(cert.number)}` : ''
  const headerLine = doctor.prescription_header
    ? `<div class="sig-sub">${esc(doctor.prescription_header)}</div>`
    : ''
  const signatureBlock = doctor.signature_url
    ? `<img src="${esc(doctor.signature_url)}" alt="подпись" class="sig-img" />
       <div class="sig-label">Подпись</div>`
    : `<div class="sig-line"></div>
       <div class="sig-label">Подпись</div>`
  return `
    <div class="signature">
      <div class="sig-doctor">
        <div class="sig-label">Врач</div>
        <div class="sig-name">${esc(doctorFullName(doctor))}</div>
        ${doctor.specialization ? `<div class="sig-sub">${esc(doctor.specialization)}</div>` : ''}
        ${certLine ? `<div class="sig-sub">${certLine}</div>` : ''}
        ${headerLine}
      </div>
      <div class="sig-stamp">
        ${signatureBlock}
      </div>
      <div class="sig-stamp">
        <div class="sig-mp">М.П.</div>
      </div>
    </div>
  `
}

/* ─── Shared CSS ──────────────────────────────────────────── */

export const PRINT_CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; color: #111; margin: 0; padding: 0; line-height: 1.45; }
  .doc { max-width: 180mm; margin: 0 auto; }
  .letterhead { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid #0f172a; margin-bottom: 18px; }
  .logo { width: 60px; height: 60px; object-fit: contain; flex-shrink: 0; }
  .clinic-info { flex: 1; }
  .clinic-name { font-size: 15pt; font-weight: 700; letter-spacing: 0.3px; }
  .clinic-line { font-size: 10pt; color: #374151; margin-top: 2px; }
  .clinic-line.muted { color: #6b7280; }
  h1.doc-title { text-align: center; font-size: 16pt; font-weight: 700; letter-spacing: 2px; margin: 8px 0 4px; }
  .doc-meta { text-align: center; color: #6b7280; font-size: 10pt; margin-bottom: 18px; }
  .block { margin-bottom: 14px; }
  .block-label { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .block-value { font-size: 12pt; }
  .patient-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 18px; padding: 10px 12px; background: #f9fafb; border-radius: 6px; }
  table.rx { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.rx th { text-align: left; padding: 8px 6px; border-bottom: 1.5px solid #0f172a; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.3px; }
  table.rx td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; font-size: 11pt; vertical-align: top; }
  table.rx td.num { width: 24px; color: #6b7280; font-size: 10pt; }
  table.rx td.drug { font-weight: 600; }
  table.rx td.sig { font-size: 10pt; color: #4b5563; }
  .rx-latin { font-family: 'Times New Roman', serif; font-style: italic; margin: 2px 0; }
  .recommendations { margin-top: 18px; padding: 10px 12px; border-left: 3px solid #0f172a; background: #f9fafb; font-size: 11pt; }
  .signature { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 20px; margin-top: 40px; align-items: end; }
  .sig-label { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; }
  .sig-name { font-size: 12pt; font-weight: 600; margin-top: 2px; }
  .sig-sub { font-size: 10pt; color: #4b5563; }
  .sig-line { border-bottom: 1px solid #0f172a; height: 24px; margin-bottom: 4px; }
  .sig-img { max-height: 60px; max-width: 140px; object-fit: contain; display: block; margin-bottom: 4px; }
  .sig-mp { border: 1.5px dashed #9ca3af; border-radius: 50%; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 11pt; margin: 0 auto; }
  .footer-note { margin-top: 28px; text-align: center; color: #9ca3af; font-size: 9pt; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

/* ─── Window opener ──────────────────────────────────────── */

export function openPrintWindow(title: string, bodyHtml: string, autoprint = true): void {
  const html = `<!DOCTYPE html><html lang="ru"><head>
    <meta charset="utf-8">
    <title>${esc(title)}</title>
    <style>${PRINT_CSS}</style>
  </head><body>
    <div class="doc">${bodyHtml}</div>
    ${autoprint ? '<script>window.onload = () => { setTimeout(() => window.print(), 150); }</script>' : ''}
  </body></html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) {
    alert('Браузер заблокировал всплывающее окно печати. Разрешите pop-ups для этого сайта.')
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
}
