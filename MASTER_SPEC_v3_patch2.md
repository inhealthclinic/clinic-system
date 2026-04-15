# MASTER SPEC v3.0 — PATCH 2 (UX по ролям)
> Дата: 2026-04-14 | Применять поверх patch1

---

## 1. ВРАЧ — ЭКРАН ВИЗИТА

### 1.1 Блок "Последний визит" (прямо на экране приёма)

```typescript
// components/visits/LastVisitPanel.tsx
// Показывается в правой колонке или верхним аккордеоном при открытии визита

interface LastVisitSummary {
  visit_date: string
  doctor_name: string
  diagnosis_text: string
  icd10_code: string
  prescriptions: { drug_name: string; dosage: string; frequency: string }[]
  recommendations: string
  lab_orders: { name: string; status: string }[]
  control_date: string
}

// API:
// GET /api/patients/[id]/last-visit
// → последний COMPLETED визит, исключая текущий
```

**UI:** Сворачиваемая панель сверху экрана визита. Кнопка "Скопировать назначения" — переносит прошлые назначения в текущую форму одним кликом.

---

### 1.2 Аллергия — предупреждение при назначении препарата

```typescript
// lib/utils/allergyCheck.ts
export function checkDrugAllergy(
  drugName: string,
  allergies: Allergy[]
): Allergy | null {
  const drug = drugName.toLowerCase()
  return allergies.find(a =>
    a.type === 'drug' &&
    (
      drug.includes(a.allergen.toLowerCase()) ||
      a.allergen.toLowerCase().includes(drug) ||
      DRUG_SYNONYMS[a.allergen]?.some(s => drug.includes(s))
      // DRUG_SYNONYMS: { 'пенициллин': ['амоксициллин','ампициллин','флемоксин'] }
    )
  ) ?? null
}

// При вводе названия препарата в PrescriptionForm:
// onChange → checkDrugAllergy(value, patient.allergies)
// Если совпадение → красный баннер НЕ ЗАКРЫВАЕТСЯ пока врач не нажмёт
// "Осознаю риск и продолжаю" + обязательный комментарий
```

```sql
-- Таблица синонимов/групп препаратов (seed)
CREATE TABLE drug_allergy_groups (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name TEXT NOT NULL,   -- 'Пенициллины'
  drugs      TEXT[] NOT NULL  -- ['пенициллин','амоксициллин','ампициллин','флемоксин']
);

-- При назначении — проверяем по группе, не только по точному совпадению
```

**Правило:** Аллергии пациента показываются красными бейджами в шапке карточки пациента **всегда видимо** — не скрываются за вкладкой.

---

### 1.3 Направление → автосоздание записи (referral flow)

**Логика (продуманная):**

```
Врач создаёт направление к другому врачу (внутри клиники)
  ↓
Система показывает модальное окно:
  "Записать пациента прямо сейчас?"
  [Да, записать] → открывается форма appointment
                   пре-заполнено: patient, to_doctor, reason=referral
                   администратор/врач выбирает дату-время
  [Нет, пациент запишется сам] → referral.status='issued'
                                  создаётся Task для администратора:
                                  "Записать [пациент] к [врач] по направлению"
                                  due: +2 дня

Если к внешнему специалисту:
  → Только Task "Дать направление пациенту на руки"
  → Напечатать направление (PDF на бланке клиники)
```

```sql
-- Добавить в referrals:
ALTER TABLE referrals
  ADD COLUMN appointment_id UUID REFERENCES appointments(id),
  -- заполняется если сразу записали
  ADD COLUMN task_id UUID REFERENCES tasks(id);
  -- заполняется если отложили
```

---

### 1.4 Шаблоны назначений (избранные препараты)

```sql
CREATE TABLE prescription_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID REFERENCES clinics(id),
  doctor_id   UUID REFERENCES doctors(id),  -- личные шаблоны врача
  name        TEXT NOT NULL,   -- 'Метформин стандарт', 'Омепразол курс'
  drug_name   TEXT NOT NULL,
  dosage      TEXT NOT NULL,
  form        TEXT,
  frequency   TEXT NOT NULL,
  duration    TEXT,
  route       TEXT,
  instructions TEXT,
  use_count   INT DEFAULT 0,   -- для сортировки по популярности
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

**UI в PrescriptionForm:**
- Кнопка "Из шаблона" → выпадающий список личных шаблонов врача
- Отсортированы по use_count (самые частые — вверху)
- После добавления назначения — кнопка "💾 Сохранить как шаблон"

---

### 1.5 Врач видит очередь на сегодня

```typescript
// Виджет в шапке экрана врача (или sidebar)
// GET /api/schedule/my-day-summary
interface DoctorDaySummary {
  completed: number      // завершено
  in_progress: number    // сейчас у врача
  arrived: number        // пришли, ждут
  upcoming: number       // ещё не пришли
  next_patient: {        // следующий пациент
    name: string
    time: string
    service: string
  }
}
// Обновляется через Supabase Realtime
```

---

### 1.6 Печать рецепта на бланке клиники

```typescript
// lib/utils/pdf.ts → generatePrescriptionPDF()

interface PrescriptionPDF {
  // Шапка (из clinic.settings)
  clinic_logo: string
  clinic_name: string
  clinic_address: string
  clinic_phone: string
  clinic_license: string  // лицензия мед. деятельности

  // Врач
  doctor_full_name: string
  doctor_specialization: string
  doctor_certificate: string  // № сертификата

  // Пациент
  patient_full_name: string
  patient_birth_date: string
  patient_iin: string  // опционально

  // Дата и номер
  prescription_number: string  // авто: RX-2026-001234
  issued_at: string

  // Препараты (список)
  prescriptions: PrescriptionItem[]

  // Подпись и печать (место для печати)
  signature_placeholder: true
}

// Кнопка "Распечатать рецепт" на экране визита
// Формат: A5, книжная ориентация
// Можно распечатать сразу или отправить в WhatsApp пациенту
```

```sql
-- Номер рецепта (авто)
CREATE SEQUENCE prescription_number_seq START 1000;
ALTER TABLE medical_records
  ADD COLUMN prescription_number TEXT;
-- Генерируется при подписи: 'RX-' || YEAR || '-' || seq
```

---

## 2. МЕДСЕСТРА — ПРОЦЕДУРЫ

### 2.1 Экран "Мои процедуры сегодня"

```typescript
// GET /api/nurse/procedures-today
// Показывает все charges за сегодня где service.type = 'procedure'
// и visit.doctor_id IN (врачи медсестры)

interface ProcedureQueueItem {
  charge_id: UUID
  patient_name: string
  patient_room: string  // кабинет если есть
  service_name: string
  visit_id: UUID
  status: 'pending' | 'in_progress' | 'done'
  scheduled_time: string
}
```

```sql
-- Добавить в charges:
ALTER TABLE charges
  ADD COLUMN performed_by  UUID REFERENCES user_profiles(id),
  ADD COLUMN performed_at  TIMESTAMPTZ,
  ADD COLUMN procedure_status TEXT DEFAULT 'pending'
    CHECK (procedure_status IN ('pending','in_progress','done'));
  -- Медсестра меняет статус сама
```

**UI:** Простой список карточек. На каждой: имя пациента, процедура, кнопки [Начать] → [Выполнено]. Без лишнего.

### 2.2 Списание расходников — после оплаты

```
БЫЛО: списание при закрытии визита (Visit.completed)
СТАЛО: списание при оплате услуги (Payment.created / charge.status → 'paid')

Триггер:
  payment.created → charge.status = 'paid'
    → найти service_templates для charge.service_id
    → создать inventory_movements (FEFO)
    → если медсестра выполняла → performed_by для attribution
```

---

## 3. ЛАБОРАНТ — УЛУЧШЕНИЯ

### 3.1 Печать этикеток (штрихкод/QR)

```typescript
// Этикетка генерируется при переводе lab_order в 'sample_taken'
// Делает АДМИНИСТРАТОР/РЕГИСТРАТОР (не лаборант)

interface SampleLabel {
  qr_data: string         // lab_order.order_number
  order_number: string    // LAB-2026-00123
  patient_name: string
  patient_birth_date: string
  test_names: string[]    // список анализов
  collected_at: string
  tube_color: string      // цвет пробирки по типу анализа (красная/фиолетовая/зелёная)
}

// GET /api/lab/orders/[id]/label → HTML для печати
// Формат: 40×25мм (стандарт Brother/Zebra этикеток)
// Кнопка "Напечатать этикетку" у администратора на экране lab_order
```

### 3.2 Бракованный образец (rejected)

```sql
ALTER TABLE lab_orders DROP CONSTRAINT lab_orders_status_check;
ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_status_check
  CHECK (status IN (
    'ordered','agreed','paid','sample_taken',
    'in_progress','rejected','ready','verified','delivered'
  ));

ALTER TABLE lab_orders
  ADD COLUMN rejected_reason TEXT,
  -- hemolysis / insufficient_volume / wrong_tube / contaminated / expired
  ADD COLUMN rejected_at     TIMESTAMPTZ,
  ADD COLUMN rejected_by     UUID REFERENCES user_profiles(id),
  ADD COLUMN resample_order_id UUID REFERENCES lab_orders(id);
  -- ссылка на новый заказ после повторного забора
```

```typescript
// При rejected → автоматически:
// 1. Уведомить врача: "Образец пациента [ФИО] отклонён: [причина]. Нужен повторный забор"
// 2. Создать Task врачу/медсестре: "Повторный забор — [пациент]", due: сегодня
// 3. Уведомить пациента (WhatsApp): "Для получения результатов необходим повторный визит"
```

### 3.3 Лаборант видит остатки реагентов прямо в интерфейсе

```typescript
// Виджет в боковой панели экрана лаборанта

// GET /api/inventory/lab-stock
// Показывает только reagents (не consumables)
// Три зоны:
//   🟢 OK:      remaining > min_stock * 2
//   🟡 Мало:    remaining между min_stock и min_stock*2
//   🔴 Критично: remaining < min_stock

interface LabStockWidget {
  reagent_name: string
  remaining: number
  unit: string
  min_stock: number
  expires_at: string  // ближайшая партия
  status: 'ok' | 'low' | 'critical'
}

// Лаборант сам списывает реагенты при выполнении анализа
// Кнопка "Списать реагент" → выбрать реагент → количество → подтвердить
// inventory_movement.type = 'writeoff_lab'
```

---

## 4. КАССИР — УЛУЧШЕНИЯ

### 4.1 История платежей пациента в кассе

```typescript
// На экране приёма оплаты — сайдпанель или аккордеон
// GET /api/patients/[id]/payment-summary

interface PatientPaymentSummary {
  balance: number           // текущий депозит
  total_debt: number        // общий долг
  last_payment_at: string   // когда последний раз платил
  recent_payments: {        // последние 5 платежей
    date: string
    amount: number
    method: string
    service: string
  }[]
  open_charges: {           // неоплаченные начисления
    charge_id: UUID
    service_name: string
    amount: number
    visit_date: string
    days_overdue: number
  }[]
}
// Показывается сразу при выборе пациента в кассе
```

### 4.2 Экран "Должники"

```typescript
// GET /api/finance/debtors
// Доступ: cashier, admin, owner

interface DebtorRecord {
  patient_id: UUID
  patient_name: string
  phone: string
  total_debt: number
  oldest_debt_date: string   // дата самого старого долга
  days_overdue: number       // от oldest_debt_date
  visits_count: number       // сколько визитов с долгом
  last_contact_at: string    // последнее взаимодействие в CRM
}

// Фильтры: > 7 дней / > 30 дней / > 90 дней
// Действия из таблицы:
//   [Позвонить] → создать crm_interaction{type:'call'}
//   [Написать] → отправить WhatsApp напоминание о долге
//   [Создать задачу] → назначить менеджеру
```

### 4.3 Возврат наличными — подтверждение

```sql
ALTER TABLE payments
  ADD COLUMN cash_refund_confirmed_by UUID REFERENCES user_profiles(id),
  ADD COLUMN cash_refund_confirmed_at TIMESTAMPTZ;
  -- Обязательно заполнить если type='refund' AND method='cash'
```

```typescript
// Workflow возврата наличными:
// 1. Кассир создаёт refund → Payment{type:'refund', method:'cash', status:'pending_confirmation'}
// 2. На экране кассы появляется: "⚠️ Выдайте [сумма] тг наличными пациенту"
// 3. Кассир физически выдаёт деньги
// 4. Нажимает [Подтвердить выдачу] → payment.status='completed'
//    cash_refund_confirmed_by = current_user
// 5. Записывается в activity_log
// Возврат без подтверждения не закрывается в кассовой смене
```

---

## 5. ВЛАДЕЛЕЦ — СКИДКИ ТОЛЬКО OWNER

```sql
-- Убрать возможность одобрять скидки у admin
-- В patch1 было: admin может одобрять
-- ИСПРАВЛЕНИЕ: только owner

-- Логика одобрения скидок:
-- discount > role.max_discount_percent → charge.status = 'pending_approval'
-- Уведомление ТОЛЬКО owner (не admin)
-- Одобряет ТОЛЬКО owner

-- Обновить в permissions:
-- finance:approve_discount → только role slug='owner'

-- В charge добавить проверку:
CREATE OR REPLACE FUNCTION can_approve_discount(p_user UUID)
RETURNS BOOLEAN AS $$
  SELECT (
    SELECT r.slug FROM user_profiles up
    JOIN roles r ON r.id = up.role_id
    WHERE up.id = p_user
  ) = 'owner';
$$ LANGUAGE sql;
```

```typescript
// При попытке admin одобрить скидку → 403 Forbidden
// Уведомление owner при новой скидке на одобрение:
// WhatsApp: "Запрос на скидку [X]% для [пациент] от [менеджер]. Сумма: [Y] тг"
// Ссылка прямо на charge для одобрения одним кликом

// Владелец видит на дашборде:
// Виджет "Ожидают одобрения: [N] скидок"
```

### Владелец — аналитика (было в списке но не реализовано)

```typescript
// GET /api/analytics/profit-report?from=&to=
interface ProfitReport {
  revenue: number           // выручка
  inventory_costs: number   // списанные расходники (по себестоимости)
  salary_costs: number      // выплаченные зарплаты (doctor_payroll.paid)
  gross_profit: number      // revenue - inventory_costs - salary_costs
  margin_percent: number

  by_doctor: {
    doctor_name: string
    revenue: number
    salary: number
    profit: number
  }[]
  by_service: {
    service_name: string
    revenue: number
    cost: number
    margin: number
  }[]

  // Сравнение периодов
  prev_period: {
    revenue: number
    profit: number
    revenue_delta_percent: number  // +12% или -5%
  }
}
```

---

## 6. WHATSAPP — ВХОДЯЩИЕ (интеграция подтверждена)

```typescript
// supabase/functions/whatsapp-webhook/index.ts
// Принимает входящие сообщения от WhatsApp Business API

interface IncomingWhatsApp {
  from: string          // телефон пациента
  message: string       // текст сообщения
  timestamp: number
  message_id: string
}

async function handleIncoming(msg: IncomingWhatsApp) {
  // 1. Найти пациента по телефону
  const patient = await findPatientByPhone(msg.from)

  if (!patient) {
    // 2а. Не найден → создать лид автоматически
    await createLead({
      name: 'Новый лид из WhatsApp',
      phone: msg.from,
      source: 'whatsapp',
      funnel: 'leads',
      stage: 'new',
    })
    await createTask({
      title: `Новое сообщение WhatsApp: ${msg.message.slice(0, 50)}`,
      type: 'call',
      due_at: new Date(),
      priority: 'high'
    })
  } else {
    // 2б. Найден → создать crm_interaction
    await createInteraction({
      patient_id: patient.id,
      type: 'whatsapp',
      direction: 'inbound',
      summary: msg.message,
    })
    // Уведомить ответственного менеджера
    await notifyManager(patient.manager_id, patient, msg.message)
  }

  // 3. Сохранить в whatsapp_messages для показа в интерфейсе
  await saveMessage(msg)
}

// Автоответ на "Да"/"Подтверждаю" при напоминании о записи:
const CONFIRM_KEYWORDS = ['да','подтверждаю','буду','ok','ок','yes']
if (CONFIRM_KEYWORDS.includes(msg.message.toLowerCase().trim())) {
  const pendingAppointment = await findPendingReminderFor(msg.from)
  if (pendingAppointment) {
    await updateAppointmentStatus(pendingAppointment.id, 'confirmed')
    // Уведомить администратора о подтверждении
  }
}
```

```sql
-- Входящие сообщения WhatsApp
CREATE TABLE whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  patient_id    UUID REFERENCES patients(id),
  lead_id       UUID REFERENCES deals(id),
  direction     TEXT CHECK (direction IN ('inbound','outbound')),
  from_phone    TEXT NOT NULL,
  to_phone      TEXT NOT NULL,
  message       TEXT NOT NULL,
  media_url     TEXT,           -- если фото/документ
  wa_message_id TEXT UNIQUE,    -- ID из WhatsApp API (дедупликация)
  status        TEXT DEFAULT 'received',
  -- received / read / replied
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wa_phone ON whatsapp_messages(from_phone, created_at DESC);
```

**UI — Входящие WhatsApp (для менеджера):**
- Отдельный раздел "Сообщения" в sidebar
- Список диалогов (как мессенджер) с непрочитанными
- Кликаешь → видишь историю переписки
- Кнопки: [Создать лид] [Привязать к пациенту] [Ответить]
- Непрочитанные — красный бейдж в sidebar

---

## 7. ИТОГОВЫЙ СПИСОК ИЗМЕНЕНИЙ В БД

```sql
-- Новые таблицы:
CREATE TABLE drug_allergy_groups (...)    -- синонимы препаратов
CREATE TABLE prescription_templates (...)  -- шаблоны назначений врача
CREATE TABLE whatsapp_messages (...)       -- входящие/исходящие WA

-- Изменения существующих:
ALTER TABLE referrals ADD COLUMN appointment_id, task_id
ALTER TABLE charges ADD COLUMN performed_by, performed_at, procedure_status
ALTER TABLE payments ADD COLUMN cash_refund_confirmed_by, cash_refund_confirmed_at
ALTER TABLE lab_orders ADD COLUMN rejected_reason, rejected_at, rejected_by, resample_order_id
ALTER TABLE lab_orders -- новый статус 'rejected' в CHECK
ALTER TABLE medical_records ADD COLUMN prescription_number
```

---

## 8. ОБНОВЛЁННЫЕ СПРИНТЫ (дополнения)

```
Спринт 1: + drug_allergy_groups seed, + prescription_templates таблица
Спринт 2: + whatsapp_messages, + webhook handler, + UI входящих
Спринт 3: + arrived статус, + DoctorDaySummary виджет
Спринт 4: + LastVisitPanel, + AllergyCheck, + ReferralModal, + PrintPrescription
Спринт 5: + rejected статус, + этикетки, + LabStockWidget, + списание реагентов лаборантом
Спринт 6: + procedure_status в charges, + списание после оплаты, + PrescriptionTemplates
           + PatientPaymentSummary в кассе, + Debtors экран, + cash refund confirm
           + owner-only discount approval + WhatsApp уведомление owner
Спринт 8: + ProfitReport (выручка - расходники - зарплаты), + сравнение периодов
```

---
*Patch 2 закрывает все UX-пробелы по ролям.*
*Итого таблиц: ~48. Всё готово к Спринту 1.*
