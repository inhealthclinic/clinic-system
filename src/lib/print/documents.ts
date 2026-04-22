/**
 * Шаблоны печатаемых мед-документов: рецепт и справка.
 * Используют общий letterhead из ./letterhead.ts
 */

import {
  loadPrintMeta,
  renderLetterhead,
  renderSignature,
  openPrintWindow,
  esc,
  calcAge,
  formatDateRu,
  type PrintMeta,
} from './letterhead'

export interface PrescriptionItem {
  drug_name: string
  dosage: string
  frequency: string
  duration: string
  form?: string | null
  route?: string | null
  instructions?: string | null
}

export interface PrescriptionInput {
  number: string | null
  issued_at?: string | null
  icd10_code: string | null
  diagnosis_text: string | null
  items: PrescriptionItem[]
  recommendations?: string | null
  control_date?: string | null
}

/* ─── Prescription (Рецепт) ─────────────────────────────── */

function renderPatientBlock(meta: PrintMeta): string {
  const age = calcAge(meta.patient.birth_date)
  const dob = meta.patient.birth_date ? formatDateRu(meta.patient.birth_date) : null
  return `
    <div class="patient-grid">
      <div>
        <div class="block-label">Пациент</div>
        <div class="block-value">${esc(meta.patient.full_name)}</div>
      </div>
      <div>
        <div class="block-label">Дата рождения${age ? ` · ${esc(age)}` : ''}</div>
        <div class="block-value">${dob ?? '—'}</div>
      </div>
      ${meta.patient.iin ? `<div>
        <div class="block-label">ИИН</div>
        <div class="block-value">${esc(meta.patient.iin)}</div>
      </div>` : ''}
      ${meta.patient.phones?.length ? `<div>
        <div class="block-label">Телефон</div>
        <div class="block-value">${esc(meta.patient.phones[0])}</div>
      </div>` : ''}
    </div>
  `
}

function renderRxItems(items: PrescriptionItem[]): string {
  if (!items.length) {
    return '<p style="color:#9ca3af;font-style:italic">Препараты не назначены</p>'
  }
  const rows = items.map((it, i) => {
    const sig = [it.frequency, it.duration, it.route, it.instructions]
      .filter(Boolean).map(esc).join(' · ')
    return `
      <tr>
        <td class="num">${i + 1}.</td>
        <td class="drug">
          ${esc(it.drug_name)}${it.form ? ` <span style="font-weight:400;color:#6b7280">(${esc(it.form)})</span>` : ''}
          ${it.dosage ? `<div class="rx-latin">Rp: ${esc(it.drug_name)}${it.dosage ? ' ' + esc(it.dosage) : ''}</div>` : ''}
        </td>
        <td class="sig">${sig || '—'}</td>
      </tr>
    `
  }).join('')
  return `
    <table class="rx">
      <thead><tr>
        <th style="width:24px">№</th>
        <th>Препарат / дозировка</th>
        <th>Схема приёма</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

export async function printPrescription(
  clinicId: string, patientId: string, doctorId: string,
  rx: PrescriptionInput,
): Promise<void> {
  const meta = await loadPrintMeta(clinicId, patientId, doctorId)
  const issued = formatDateRu(rx.issued_at ?? new Date().toISOString())

  const body = `
    ${renderLetterhead(meta.clinic)}
    <h1 class="doc-title">РЕЦЕПТ</h1>
    <div class="doc-meta">№ ${esc(rx.number) || '—'} · ${issued}</div>

    ${renderPatientBlock(meta)}

    <div class="block">
      <div class="block-label">Диагноз</div>
      <div class="block-value">
        ${rx.icd10_code ? `<span style="font-family:monospace;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:4px;margin-right:8px;font-size:10pt">${esc(rx.icd10_code)}</span>` : ''}
        ${esc(rx.diagnosis_text) || '—'}
      </div>
    </div>

    ${renderRxItems(rx.items)}

    ${rx.recommendations ? `<div class="recommendations">
      <div class="block-label" style="margin-bottom:4px">Рекомендации</div>
      ${esc(rx.recommendations)}
    </div>` : ''}

    ${rx.control_date ? `<div class="block" style="margin-top:14px">
      <div class="block-label">Контрольный осмотр</div>
      <div class="block-value">${formatDateRu(rx.control_date)}</div>
    </div>` : ''}

    ${renderSignature(meta.doctor)}

    <div class="footer-note">
      Документ сгенерирован автоматически · ${formatDateRu(new Date().toISOString())}
    </div>
  `

  openPrintWindow(`Рецепт · ${rx.number ?? ''}`, body)
}

/* ─── Medical Certificate (Справка) ──────────────────────── */

export interface MedCertificateInput {
  icd10_code: string | null
  diagnosis_text: string | null
  diagnosis_type: 'preliminary' | 'final'
  complaints?: string | null
  recommendations?: string | null
  control_date?: string | null
}

export async function printMedCertificate(
  clinicId: string, patientId: string, doctorId: string,
  cert: MedCertificateInput,
): Promise<void> {
  const meta = await loadPrintMeta(clinicId, patientId, doctorId)
  const today = formatDateRu(new Date().toISOString())

  const body = `
    ${renderLetterhead(meta.clinic)}
    <h1 class="doc-title">МЕДИЦИНСКАЯ СПРАВКА</h1>
    <div class="doc-meta">Дата выдачи: ${today}</div>

    ${renderPatientBlock(meta)}

    <div class="block">
      <div class="block-label">Диагноз (${cert.diagnosis_type === 'final' ? 'окончательный' : 'предварительный'})</div>
      <div class="block-value">
        ${cert.icd10_code ? `<span style="font-family:monospace;background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:4px;margin-right:8px;font-size:10pt">${esc(cert.icd10_code)}</span>` : ''}
        ${esc(cert.diagnosis_text) || '—'}
      </div>
    </div>

    ${cert.complaints ? `<div class="block">
      <div class="block-label">Жалобы</div>
      <div class="block-value">${esc(cert.complaints)}</div>
    </div>` : ''}

    ${cert.recommendations ? `<div class="block">
      <div class="block-label">Рекомендации</div>
      <div class="block-value">${esc(cert.recommendations)}</div>
    </div>` : ''}

    ${cert.control_date ? `<div class="block">
      <div class="block-label">Контрольный осмотр</div>
      <div class="block-value">${formatDateRu(cert.control_date)}</div>
    </div>` : ''}

    ${renderSignature(meta.doctor)}

    <div class="footer-note">
      Справка выдана на основании данных медицинской карты · ${today}
    </div>
  `

  openPrintWindow('Справка', body)
}

/* ─── Cash receipt (Чек) ─────────────────────────────────── */

export interface CashReceiptLine {
  name: string
  quantity: number
  unit_price: number
  discount: number
  total: number
}

export interface CashReceiptInput {
  number: string | null
  issued_at?: string | null
  patient_name: string
  lines: CashReceiptLine[]
  paid: number
  payment_method?: string | null
  cashier_name?: string | null
}

export async function printCashReceipt(
  clinicId: string,
  input: CashReceiptInput,
): Promise<void> {
  // Для чека нам не нужны данные доктора/пациента из БД — всё передано явно.
  // Но клинику грузим для шапки.
  const { createClient } = await import('@/lib/supabase/client')
  const sb = createClient()
  const { data: clinic } = await sb.from('clinics')
    .select('name, address, phone, email, logo_url, settings')
    .eq('id', clinicId).single()

  const c = (clinic as any) ?? { name: '', address: null, phone: null, email: null, logo_url: null, settings: null }
  const issued = formatDateRu(input.issued_at ?? new Date().toISOString())

  const subtotal = input.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0)
  const totalDiscount = input.lines.reduce((s, l) => s + l.discount, 0)
  const total = input.lines.reduce((s, l) => s + l.total, 0)

  const rows = input.lines.map((l, i) => `
    <tr>
      <td class="num">${i + 1}.</td>
      <td>${esc(l.name)}</td>
      <td style="text-align:right">${l.quantity}</td>
      <td style="text-align:right">${l.unit_price.toLocaleString('ru-RU')} ₸</td>
      <td style="text-align:right">${l.total.toLocaleString('ru-RU')} ₸</td>
    </tr>
  `).join('')

  const body = `
    ${renderLetterhead(c)}
    <h1 class="doc-title">ЧЕК ОБ ОПЛАТЕ</h1>
    <div class="doc-meta">№ ${esc(input.number) || '—'} · ${issued}</div>

    <div class="block"><div class="block-label">Пациент</div><div class="block-value">${esc(input.patient_name)}</div></div>

    <table class="rx">
      <thead><tr>
        <th style="width:24px">№</th><th>Услуга / товар</th>
        <th style="text-align:right;width:60px">Кол-во</th>
        <th style="text-align:right;width:110px">Цена</th>
        <th style="text-align:right;width:110px">Сумма</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4" style="text-align:right;padding-top:10px">Подытог:</td><td style="text-align:right;padding-top:10px">${subtotal.toLocaleString('ru-RU')} ₸</td></tr>
        ${totalDiscount > 0 ? `<tr><td colspan="4" style="text-align:right;color:#dc2626">Скидка:</td><td style="text-align:right;color:#dc2626">−${totalDiscount.toLocaleString('ru-RU')} ₸</td></tr>` : ''}
        <tr style="font-weight:700;font-size:13pt"><td colspan="4" style="text-align:right;padding-top:6px">ИТОГО:</td><td style="text-align:right;padding-top:6px">${total.toLocaleString('ru-RU')} ₸</td></tr>
        <tr><td colspan="4" style="text-align:right;color:#16a34a">Оплачено${input.payment_method ? ` (${esc(input.payment_method)})` : ''}:</td><td style="text-align:right;color:#16a34a;font-weight:600">${input.paid.toLocaleString('ru-RU')} ₸</td></tr>
      </tfoot>
    </table>

    <div class="signature" style="grid-template-columns:2fr 1fr;margin-top:28px">
      <div>
        <div class="sig-label">Кассир</div>
        <div class="sig-name">${esc(input.cashier_name) || '—'}</div>
      </div>
      <div>
        <div class="sig-line"></div>
        <div class="sig-label">Подпись</div>
      </div>
    </div>

    <div class="footer-note">
      Благодарим за обращение · ${formatDateRu(new Date().toISOString())}
    </div>
  `

  openPrintWindow(`Чек · ${input.number ?? ''}`, body)
}
