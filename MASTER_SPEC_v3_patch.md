# MASTER SPEC v3.0 — PATCH (дополнения после операционного ревью)
> Применять поверх part1 + part2. Дата: 2026-04-14

---

## 1. WALK-IN ПАЦИЕНТЫ

### Изменение в appointments
```sql
ALTER TABLE appointments
  ADD COLUMN is_walkin BOOLEAN DEFAULT false,
  ADD COLUMN arrived_at TIMESTAMPTZ;       -- когда пришёл физически

-- Статус 'arrived' добавляется в CHECK
-- pending → confirmed → arrived → in_progress → completed
--                    ↗
--          (walk-in создаётся сразу в arrived)
ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pending','confirmed','arrived','rescheduled','cancelled','no_show','completed'));
```

### Правило walk-in
```
Walk-in = appointment создаётся и сразу Visit (status=in_progress)
is_walkin = true → пропускаем этапы pending/confirmed/arrived
Кнопка в UI: "Быстрый приём" → выбрать врача + услугу → сразу старт визита
```

---

## 2. СКИДКИ С ЛИМИТАМИ ПО РОЛИ

### Изменение в roles
```sql
ALTER TABLE roles
  ADD COLUMN max_discount_percent DECIMAL(5,2) DEFAULT 0;
  -- owner: NULL (без ограничений)
  -- admin: 20.00
  -- cashier: 5.00
  -- doctor: 0.00 (не может давать скидки)
```

### Изменение в charges
```sql
ALTER TABLE charges
  ADD COLUMN discount_approved_by UUID REFERENCES user_profiles(id),
  ADD COLUMN discount_reason TEXT;
  -- Если discount > role.max_discount_percent → требуется одобрение вышестоящего
```

### Бизнес-правило
```
При создании Charge:
  1. Получить role.max_discount_percent текущего пользователя
  2. Если discount > max → статус charge = 'pending_approval'
  3. Admin/Owner видит очередь на одобрение скидок
  4. При одобрении → discount_approved_by = approver.id
```

---

## 3. ОБНАРУЖЕНИЕ И СЛИЯНИЕ ДУБЛЕЙ ПАЦИЕНТОВ

### Функция поиска дублей
```sql
CREATE OR REPLACE FUNCTION find_patient_duplicates(p_clinic_id UUID)
RETURNS TABLE(
  patient_id_1 UUID, patient_id_2 UUID,
  full_name_1 TEXT, full_name_2 TEXT,
  similarity_score DECIMAL
) AS $$
  SELECT
    p1.id, p2.id,
    p1.full_name, p2.full_name,
    similarity(p1.full_name, p2.full_name) as score
  FROM patients p1
  JOIN patients p2
    ON p1.id < p2.id                            -- без повторов
    AND p1.clinic_id = p_clinic_id
    AND p2.clinic_id = p_clinic_id
    AND p1.deleted_at IS NULL
    AND p2.deleted_at IS NULL
  WHERE
    similarity(p1.full_name, p2.full_name) > 0.7  -- 70% схожесть имён
    OR (p1.birth_date = p2.birth_date AND p1.birth_date IS NOT NULL)
    OR EXISTS (                                    -- общий телефон
      SELECT 1 FROM unnest(p1.phones) ph1
      JOIN unnest(p2.phones) ph2 ON ph1 = ph2
    )
  ORDER BY score DESC;
$$ LANGUAGE sql;
```

### Таблица подтверждённых дублей
```sql
CREATE TABLE patient_duplicates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  patient_id_1  UUID REFERENCES patients(id),   -- оставляем
  patient_id_2  UUID REFERENCES patients(id),   -- сливаем в первого
  status        TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','merged','not_duplicate')),
  reviewed_by   UUID REFERENCES user_profiles(id),
  merged_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Функция слияния (merge)
```sql
-- При слиянии patient_id_2 → patient_id_1:
-- 1. Все appointments, visits, charges, payments → patient_id = patient_id_1
-- 2. Объединить phones[] (убрать дубли)
-- 3. Объединить tags[]
-- 4. patient_id_2.deleted_at = now(), notes += 'Merged into P-XXXXXX'
-- 5. Записать в activity_logs

CREATE OR REPLACE FUNCTION merge_patients(
  p_keep_id UUID, p_merge_id UUID, p_user_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Переносим все связи
  UPDATE appointments   SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE visits         SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE charges        SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE payments       SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE lab_orders     SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE medical_records SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE deals          SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE crm_interactions SET patient_id = p_keep_id WHERE patient_id = p_merge_id;
  UPDATE tasks          SET patient_id = p_keep_id WHERE patient_id = p_merge_id;

  -- Объединяем телефоны
  UPDATE patients SET
    phones = ARRAY(
      SELECT DISTINCT unnest(
        (SELECT phones FROM patients WHERE id = p_keep_id) ||
        (SELECT phones FROM patients WHERE id = p_merge_id)
      )
    )
  WHERE id = p_keep_id;

  -- Объединяем баланс
  UPDATE patient_balance SET
    balance = balance + (SELECT balance FROM patient_balance WHERE patient_id = p_merge_id)
  WHERE patient_id = p_keep_id;

  -- Soft-delete дубля
  UPDATE patients SET
    deleted_at = now(),
    notes = COALESCE(notes,'') || ' | Merged into ' ||
      (SELECT patient_number FROM patients WHERE id = p_keep_id)
  WHERE id = p_merge_id;

  -- Лог
  INSERT INTO activity_logs(entity_type, entity_id, action, user_id, metadata)
  VALUES('patient', p_keep_id, 'merged', p_user_id,
    jsonb_build_object('merged_patient_id', p_merge_id));
END;
$$ LANGUAGE plpgsql;
```

---

## 4. КРИТИЧЕСКИЕ ЗНАЧЕНИЯ ЛАБОРАТОРИИ — СРОЧНОЕ УВЕДОМЛЕНИЕ ВРАЧУ

### Изменение в lab_results
```sql
-- Уже есть flag: 'critical' в results JSONB
-- Добавляем:
ALTER TABLE lab_results
  ADD COLUMN has_critical    BOOLEAN DEFAULT false,
  ADD COLUMN critical_notified_at TIMESTAMPTZ,
  ADD COLUMN critical_notified_doctor UUID REFERENCES user_profiles(id);
```

### Триггер при вводе результатов
```typescript
// supabase/functions/process-lab-results/index.ts
async function onResultsEntered(result: LabResult) {
  const hasCritical = result.results.some(r => r.flag === 'critical');

  if (hasCritical) {
    // 1. Пометить
    await supabase.from('lab_results')
      .update({ has_critical: true })
      .eq('id', result.id);

    // 2. Найти врача
    const order = await getLabOrder(result.order_id);
    const doctor = await getDoctor(order.doctor_id);

    // 3. Уведомить ВРАЧА (не пациента!) немедленно
    await sendNotification({
      channel: 'whatsapp',   // и/или push
      recipient: doctor.phone,
      template: 'lab_critical',
      vars: {
        patient_name: order.patient.full_name,
        test_name: getCriticalParams(result.results).join(', '),
        order_number: order.order_number,
      }
    });

    // 4. Создать задачу врачу — СРОЧНО
    await createTask({
      type: 'lab_ready',
      priority: 'urgent',
      title: `⚠️ КРИТИЧНО: Результаты анализов — ${order.patient.full_name}`,
      assigned_to: doctor.user_id,
      patient_id: order.patient_id,
      due_at: new Date(),   // немедленно
    });
  }
}
```

---

## 5. ЗАРПЛАТА И КОМИССИЯ ВРАЧЕЙ

### Новые таблицы
```sql
-- Настройки оплаты врача
CREATE TABLE doctor_salary_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  doctor_id     UUID REFERENCES doctors(id) UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('fixed','percent','mixed')),
  fixed_amount  DECIMAL(10,2) DEFAULT 0,    -- фиксированный оклад/мес
  percent_rate  DECIMAL(5,2)  DEFAULT 0,    -- % от выручки (0-100)
  -- mixed = fixed + percent сверх плана
  plan_amount   DECIMAL(10,2),              -- план выручки для mixed
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by    UUID REFERENCES user_profiles(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Начисления зарплаты (по периодам)
CREATE TABLE doctor_payroll (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID REFERENCES clinics(id),
  doctor_id      UUID REFERENCES doctors(id),
  period_from    DATE NOT NULL,
  period_to      DATE NOT NULL,
  visits_count   INT DEFAULT 0,
  revenue_total  DECIMAL(10,2) DEFAULT 0,   -- выручка за период
  fixed_part     DECIMAL(10,2) DEFAULT 0,
  percent_part   DECIMAL(10,2) DEFAULT 0,
  total_earned   DECIMAL(10,2) DEFAULT 0,
  status         TEXT DEFAULT 'draft'
                   CHECK (status IN ('draft','approved','paid')),
  approved_by    UUID REFERENCES user_profiles(id),
  paid_at        TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

### SQL расчёт за период
```sql
-- Выручка врача за период (для расчёта %)
SELECT
  d.id as doctor_id,
  d.first_name || ' ' || d.last_name as doctor,
  COUNT(DISTINCT v.id) as visits,
  SUM(c.total - c.discount) as revenue
FROM doctors d
JOIN visits v ON v.doctor_id = d.id
JOIN charges c ON c.visit_id = v.id
WHERE v.completed_at BETWEEN $1 AND $2
  AND c.status = 'paid'
  AND d.clinic_id = $3
GROUP BY d.id, doctor;
```

---

## 6. ВНЕШНЯЯ ЛАБОРАТОРИЯ — ПОЛНЫЙ WORKFLOW

### Изменения в lab_orders
```sql
ALTER TABLE lab_orders
  ADD COLUMN external_lab_name   TEXT,
  ADD COLUMN sent_to_external_at TIMESTAMPTZ,
  ADD COLUMN sent_by             UUID REFERENCES user_profiles(id),
  ADD COLUMN expected_ready_at   TIMESTAMPTZ,
  ADD COLUMN received_at         TIMESTAMPTZ,
  ADD COLUMN received_by         UUID REFERENCES user_profiles(id);
```

### Статусная машина для внешней лаборатории
```
Обычная:     ordered → sample_taken → in_progress → ready → verified → delivered
Внешняя:     ordered → sample_taken → sent_external → in_progress → ready → verified → delivered
                                           ↑
                               sent_to_external_at фиксируется
```

### Правило
```
Если external_lab_name заполнен:
  - При переводе в 'in_progress' → обязательно filled sent_to_external_at
  - При переводе в 'ready' → обязательно filled received_at + received_by
  - expected_ready_at = sent_at + lab_test_templates.turnaround_h
  - Если просрочено → задача "Уточнить статус в лаборатории"
```

---

## 7. СОГЛАСИЕ ПАЦИЕНТА (ПДн — Закон РК)

```sql
CREATE TABLE patient_consents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  patient_id    UUID REFERENCES patients(id),
  type          TEXT NOT NULL
                  CHECK (type IN ('personal_data','medical_processing','photo','marketing')),
  -- personal_data: обязательно по закону РК
  -- medical_processing: обработка медданных
  -- photo: фото/видео съёмка
  -- marketing: рассылки
  version       TEXT NOT NULL DEFAULT '1.0',  -- версия текста соглашения
  agreed        BOOLEAN NOT NULL,
  agreed_at     TIMESTAMPTZ DEFAULT now(),
  ip_address    INET,
  signed_by     UUID REFERENCES user_profiles(id),  -- кто оформил (админ)
  file_url      TEXT,                               -- скан подписанного документа
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Правило: нельзя сохранить пациента без согласия 'personal_data' agreed=true
-- При первичной регистрации → показать форму согласия → подпись/галочка
-- Хранить 5 лет после отзыва (требование РК)
```

---

## 8. ПАКЕТЫ УСЛУГ — ИСПРАВЛЕНИЯ

```sql
-- Добавить в service_packages (не было в part1):
CREATE TABLE service_packages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID REFERENCES clinics(id),
  name         TEXT NOT NULL,             -- 'Курс массажа 10 сеансов'
  description  TEXT,
  total_price  DECIMAL(10,2) NOT NULL,
  validity_days INT DEFAULT 365,          -- срок действия в днях с момента покупки
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE service_package_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID REFERENCES service_packages(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id),
  quantity    INT NOT NULL DEFAULT 1
);

-- Купленный пакет пациента
CREATE TABLE patient_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID REFERENCES clinics(id),
  patient_id    UUID REFERENCES patients(id),
  package_id    UUID REFERENCES service_packages(id),
  payment_id    UUID REFERENCES payments(id),
  purchased_at  TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,   -- purchased_at + validity_days
  status        TEXT DEFAULT 'active'
                  CHECK (status IN ('active','exhausted','expired','refunded')),
  notes         TEXT
);

-- Сеансы из пакета
CREATE TABLE patient_package_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_package_id UUID REFERENCES patient_packages(id),
  service_id         UUID REFERENCES services(id),
  visit_id           UUID REFERENCES visits(id),
  charge_id          UUID REFERENCES charges(id),
  used_at            TIMESTAMPTZ DEFAULT now(),
  created_by         UUID REFERENCES user_profiles(id)
);

-- При использовании сеанса из пакета:
-- charge.unit_price = 0 (или цена из пакета уже оплачена)
-- Проверить patient_package.expires_at > now()
-- Проверить остаток сеансов (count sessions vs package_items.quantity)
```

---

## 9. ОБНОВЛЁННАЯ МАТРИЦА БИЗНЕС-ПРАВИЛ

```
Новые правила (добавить к part2):

W1: Walk-in → appointment.is_walkin=true, сразу visit.status=in_progress
W2: arrived → arrived_at фиксируется, администратор видит в списке ожидания

D1: При создании пациента → проверить find_patient_duplicates → показать предупреждение
D2: Слияние — только owner или admin

SC1: discount > role.max_discount_percent → charge.status='pending_approval'
SC2: Нельзя закрыть визит с неодобренной скидкой

L1: Результат с flag='critical' → немедленно уведомить врача + срочная задача
L2: Внешняя лаборатория: sent_to_external_at и received_at обязательны

SAL1: Расчёт зарплаты — только owner/admin
SAL2: Выплата фиксируется в payroll.paid_at

PKG1: При использовании пакета → проверить expires_at и остаток сеансов
PKG2: Просроченный пакет → status='expired', возврат на усмотрение owner
PKG3: Возврат пакета → пересчитать использованные сеансы по текущей цене, остаток вернуть на баланс

CON1: patient_consents{type:'personal_data', agreed:true} обязательно при регистрации
CON2: Без согласия нельзя отправлять SMS/WhatsApp
```

---

## 10. ОБНОВЛЁННЫЕ СПРИНТЫ

```
Спринт 1 — добавить:
  + Миграции новых таблиц (consents, packages, salary, duplicates)
  + Seed: roles с max_discount_percent

Спринт 2 — добавить:
  + Форма согласия при создании пациента
  + Обнаружение дублей при поиске
  + Функция merge_patients (UI: только owner)

Спринт 3 — добавить:
  + Walk-in кнопка в расписании
  + Статус 'arrived' + список ожидания

Спринт 5 (Лаборатория) — добавить:
  + Workflow внешней лаборатории
  + Критические значения → уведомление врачу

Спринт 6 (Финансы) — добавить:
  + Пакеты услуг (покупка, использование, истечение)
  + Скидки с лимитами и одобрением

Спринт 7 — добавить:
  + Расчёт зарплаты врачей
  + Отчёт выплат
```

---

*PATCH применяется поверх MASTER_SPEC_v3_part1.md и part2.md*  
*Итого таблиц в БД: ~45. Итого миграций: 14 файлов.*
