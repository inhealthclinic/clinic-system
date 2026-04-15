# IN HEALTH — MASTER SPEC v3.0 — Часть 2
> Бизнес-правила · Автоматизация · API · UI · Структура проекта · Спринты · Acceptance Criteria

---

## 1. БИЗНЕС-ПРАВИЛА

### Пациент
| # | Правило |
|---|---------|
| P1 | Нельзя создать 2 пациентов с одинаковым ИИН |
| P2 | phones[] — минимум 1 телефон обязателен |
| P3 | gender обязателен |
| P4 | Удаление — только owner, soft-delete (deleted_at) |
| P5 | balance_amount и debt_amount пересчитываются триггером при каждом payment |

### CRM / Deal
| # | Правило |
|---|---------|
| D1 | При создании лида — автоматически создаётся Task "Позвонить" (due: +1ч) |
| D2 | NO_SHOW → задача "Выяснить причину" + поле reason обязательно |
| D3 | first_response_at фиксируется при первом crm_interaction |
| D4 | booked_at фиксируется при переходе в стадию BOOKED |
| D5 | Нельзя пропустить стадию (только вперёд или в lost) |
| D6 | При конверсии лида → пациенту: deal переходит в воронку 'medical' |

### Запись (Appointment)
| # | Правило |
|---|---------|
| A1 | Врач не может иметь 2 записи в пересекающееся время |
| A2 | time_end = time_start + service.duration_min |
| A3 | Нельзя записать в заблокированный слот врача |
| A4 | Нельзя записать вне рабочих часов врача |
| A5 | При создании записи → автоматически создаётся Visit (status=open) |
| A6 | Отмена → указать cancel_reason |
| A7 | Перенос → создать новый appointment, старый = rescheduled |

### Визит (Visit)
| # | Правило |
|---|---------|
| V1 | Нельзя закрыть без хотя бы 1 Charge |
| V2 | Нельзя закрыть без medical_record |
| V3 | Нельзя закрыть без finance_settled = true |
| V4 | partial = оплачено частично, долг зафиксирован |
| V5 | При закрытии → appointment.status = completed |
| V6 | При закрытии → списание склада по service_templates (FEFO) |

### Финансы
| # | Правило |
|---|---------|
| F1 | Возврат (refund) требует refund_reason |
| F2 | Редактирование прошлых платежей — только owner |
| F3 | Смешанная оплата = несколько Payment на один Charge |
| F4 | Списание с депозита = Payment{method:'balance'} + balance_movement{type:'deduct'} |
| F5 | Пополнение депозита = Payment{type:'prepayment'} + balance_movement{type:'topup'} |
| F6 | Касса: нельзя принять оплату без открытой cash_session |
| F7 | Закрытие кассы: expected_cash = opening_cash + sum(cash payments) |

### Лаборатория
| # | Правило |
|---|---------|
| L1 | Результат подтверждает лаборант (verified_by) |
| L2 | Редактировать результат может только owner |
| L3 | Каждое редактирование пишется в edit_history |
| L4 | При статусе 'ready' → уведомление пациенту + задача врачу |
| L5 | Сравнение результатов: только одинаковые параметры |

### Склад
| # | Правило |
|---|---------|
| S1 | Списание при выполнении услуги — автоматически по service_templates |
| S2 | Метод FEFO: сначала партия с ближайшим expiry |
| S3 | Ручное списание (correction/damaged) — только owner |
| S4 | При remaining → 0: уведомление ответственному |
| S5 | При remaining < min_stock: предупреждение в дашборде |

---

## 2. АВТОМАТИЗАЦИЯ (TRIGGERS)

```typescript
// Все триггеры реализуются через Supabase Edge Functions + pg_cron

const TRIGGERS = [

  // --- CRM ---
  {
    event: 'deal.created',
    action: 'create_task',
    params: { type: 'call', title: 'Позвонить новому лиду', due: '+1h' }
  },
  {
    event: 'appointment.status → no_show',
    action: 'create_task',
    params: { type: 'call', title: 'Выяснить причину неявки', due: '+2h' }
  },
  {
    event: 'visit.completed (primary)',  // первичный приём
    action: 'create_task',
    params: { type: 'follow_up', title: 'Назначить повторный приём', due: '+1d' }
  },

  // --- Лаборатория ---
  {
    event: 'lab_order.status → ready',
    action: ['notify_patient', 'create_task'],
    params: {
      notify: { channel: 'whatsapp', template: 'lab_ready' },
      task:   { type: 'lab_ready', title: 'Анализы готовы — проверить', due: '+0h' }
    }
  },
  {
    event: 'lab_order.status → verified',
    action: 'notify_patient',
    params: { channel: 'whatsapp', template: 'lab_verified' }
  },

  // --- Напоминания (cron) ---
  {
    cron: '0 * * * *',  // каждый час
    action: 'send_reminders_24h',  // записи завтра в это же время
  },
  {
    cron: '*/30 * * * *',  // каждые 30 мин
    action: 'send_reminders_2h',
  },

  // --- Задачи ---
  {
    cron: '*/5 * * * *',
    action: 'mark_overdue_tasks',
    sql: "UPDATE tasks SET status='overdue' WHERE due_at < now() AND status IN ('new','in_progress')"
  },

  // --- Контрольная дата ---
  {
    cron: '0 9 * * *',  // каждый день в 9:00
    action: 'check_control_dates',
    // medical_records.control_date = today → create_task{type:'control'}
  },

  // --- Склад ---
  {
    event: 'visit.completed',
    action: 'auto_writeoff_inventory',
    // для каждого charge → service_templates → inventory_movements (FEFO)
  },

  // --- Депозит ---
  {
    event: 'payment.created {type:prepayment}',
    action: 'topup_balance',
  },
  {
    event: 'payment.created {method:balance}',
    action: 'deduct_balance',
  },
];
```

---

## 3. СТРУКТУРА ПРОЕКТА

```
clinic-system/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Sidebar + Header
│   │   ├── page.tsx                # Dashboard (дашборд)
│   │   ├── patients/
│   │   │   ├── page.tsx            # Список пациентов
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx        # Карточка (лента событий)
│   │   │       ├── medical-card/page.tsx
│   │   │       ├── visits/page.tsx
│   │   │       ├── lab/page.tsx
│   │   │       └── finance/page.tsx
│   │   ├── schedule/
│   │   │   ├── page.tsx            # Тайм-грид
│   │   │   └── [date]/page.tsx
│   │   ├── visits/
│   │   │   ├── page.tsx            # Текущие визиты
│   │   │   └── [id]/page.tsx       # Экран визита (врач)
│   │   ├── crm/
│   │   │   ├── page.tsx            # Канбан-доска воронок
│   │   │   └── [id]/page.tsx
│   │   ├── lab/
│   │   │   ├── page.tsx            # Очередь анализов
│   │   │   └── [id]/page.tsx
│   │   ├── finance/
│   │   │   ├── page.tsx            # Касса / сегодня
│   │   │   ├── sessions/page.tsx   # Кассовые смены
│   │   │   └── reports/page.tsx
│   │   ├── inventory/
│   │   │   ├── page.tsx
│   │   │   ├── reagents/page.tsx
│   │   │   └── consumables/page.tsx
│   │   ├── tasks/page.tsx
│   │   ├── analytics/page.tsx
│   │   └── settings/
│   │       ├── users/page.tsx
│   │       ├── roles/page.tsx
│   │       ├── doctors/page.tsx
│   │       ├── services/page.tsx
│   │       ├── lab-templates/page.tsx
│   │       ├── notifications/page.tsx
│   │       └── clinic/page.tsx
│   └── api/                        # Route Handlers
│
├── components/
│   ├── ui/                         # shadcn/ui базовые
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx              # GlobalSearch + уведомления
│   │   └── Breadcrumb.tsx
│   ├── shared/
│   │   ├── GlobalSearch.tsx
│   │   ├── PatientSelect.tsx
│   │   ├── DoctorSelect.tsx
│   │   ├── ServiceSelect.tsx
│   │   ├── ICD10Search.tsx
│   │   ├── PermissionGuard.tsx     # <PermissionGuard perm="x:y">
│   │   ├── ActivityFeed.tsx        # Лента событий
│   │   ├── StatusBadge.tsx
│   │   └── ConfirmDialog.tsx
│   ├── patients/
│   │   ├── PatientCard.tsx         # Шапка карточки
│   │   ├── PatientForm.tsx
│   │   └── QuickActions.tsx        # 7 быстрых действий
│   ├── schedule/
│   │   ├── TimeGrid.tsx            # 08:00–20:00
│   │   ├── AppointmentCard.tsx
│   │   ├── AppointmentModal.tsx    # Создание/редактирование
│   │   └── ConflictAlert.tsx
│   ├── visits/
│   │   ├── VisitScreen.tsx         # Главный экран визита
│   │   ├── VitalsForm.tsx
│   │   ├── DiagnosisForm.tsx
│   │   ├── PrescriptionForm.tsx
│   │   └── CloseVisitValidator.tsx
│   ├── medical-card/
│   │   ├── MedCardHeader.tsx       # Аллергии-предупреждения
│   │   ├── AllergiesSection.tsx
│   │   ├── ChronicSection.tsx
│   │   ├── VaccinationsSection.tsx
│   │   └── RecordTimeline.tsx
│   ├── lab/
│   │   ├── LabOrderForm.tsx
│   │   ├── ResultsInput.tsx
│   │   ├── ResultsCompare.tsx      # График сравнения
│   │   └── PanelSelector.tsx
│   ├── finance/
│   │   ├── ChargesList.tsx
│   │   ├── PaymentModal.tsx        # Смешанная оплата
│   │   ├── DepositWidget.tsx
│   │   └── CashSessionBar.tsx
│   └── inventory/
│       ├── StockTable.tsx
│       ├── MovementForm.tsx
│       └── LowStockAlert.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── hooks/
│   │   ├── usePermissions.ts
│   │   ├── usePatients.ts
│   │   ├── useSchedule.ts
│   │   ├── useVisit.ts
│   │   ├── useFinance.ts
│   │   └── useInventory.ts
│   ├── stores/
│   │   ├── authStore.ts            # Zustand: пользователь + права
│   │   └── uiStore.ts
│   ├── validations/                # Zod schemas
│   └── utils/
│       ├── fefo.ts                 # FEFO логика
│       ├── conflicts.ts            # Проверка конфликтов
│       └── pdf.ts                  # Генерация PDF
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_core.sql
│   │   ├── 002_patients.sql
│   │   ├── 003_crm.sql
│   │   ├── 004_schedule.sql
│   │   ├── 005_visits.sql
│   │   ├── 006_medcard.sql
│   │   ├── 007_lab.sql
│   │   ├── 008_finance.sql
│   │   ├── 009_inventory.sql
│   │   ├── 010_tasks.sql
│   │   ├── 011_notifications.sql
│   │   ├── 012_rls.sql
│   │   └── 013_seed_permissions.sql
│   ├── functions/
│   │   ├── send-notification/
│   │   ├── check-conflicts/
│   │   ├── close-visit/
│   │   ├── process-payment/
│   │   ├── auto-writeoff/
│   │   └── send-reminders/
│   └── seed.sql
│
└── types/
    ├── database.ts                 # Авто-генерация: supabase gen types
    └── app.ts                      # Бизнес-типы
```

---

## 4. API ROUTES

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

# Пациенты
GET    /api/patients                ?search=&status=&page=
POST   /api/patients
GET    /api/patients/[id]
PUT    /api/patients/[id]
DELETE /api/patients/[id]           # soft-delete, owner only

# CRM
GET    /api/deals                   ?funnel=&stage=&assigned=
POST   /api/deals
PUT    /api/deals/[id]
PATCH  /api/deals/[id]/stage        { to_stage, reason }
POST   /api/deals/[id]/convert      # лид → пациент
POST   /api/interactions
GET    /api/interactions            ?deal_id=&patient_id=

# Расписание
GET    /api/schedule                ?date=&doctor_id=
POST   /api/appointments
GET    /api/appointments/[id]
PUT    /api/appointments/[id]
PATCH  /api/appointments/[id]/status
GET    /api/appointments/conflicts  ?doctor_id=&date=&start=&end=&exclude=
POST   /api/schedule/blocks
DELETE /api/schedule/blocks/[id]

# Визиты
GET    /api/visits                  ?status=&date=
GET    /api/visits/[id]
PATCH  /api/visits/[id]/start
PATCH  /api/visits/[id]/close       # валидация + списание склада
GET    /api/visits/[id]/validate    # проверить готовность к закрытию

# Медкарта
GET    /api/patients/[id]/medical-card
PUT    /api/patients/[id]/medical-card
POST   /api/patients/[id]/allergies
PUT    /api/patients/[id]/allergies/[aid]
DELETE /api/patients/[id]/allergies/[aid]
POST   /api/patients/[id]/chronic
POST   /api/patients/[id]/vaccinations

# Медзапись (привязана к визиту)
GET    /api/visits/[id]/record
POST   /api/visits/[id]/record
PUT    /api/visits/[id]/record
POST   /api/visits/[id]/record/sign  # doctor only

# Лаборатория
GET    /api/lab/orders              ?status=&patient_id=
POST   /api/lab/orders
PATCH  /api/lab/orders/[id]/status
POST   /api/lab/results             # ввод результатов
PUT    /api/lab/results/[id]        # owner only
GET    /api/lab/compare             ?patient_id=&parameter=
GET    /api/lab/templates

# Финансы
GET    /api/charges                 ?visit_id=
POST   /api/charges
PUT    /api/charges/[id]
POST   /api/payments
GET    /api/payments                ?patient_id=&session_id=
POST   /api/payments/refund         { payment_id, reason } # owner/admin
GET    /api/balance/[patient_id]
POST   /api/cash-sessions           # open
PATCH  /api/cash-sessions/[id]      # close
GET    /api/finance/report          ?from=&to=&type=

# Склад
GET    /api/inventory/reagents
POST   /api/inventory/reagents
GET    /api/inventory/consumables
POST   /api/inventory/consumables
POST   /api/inventory/batches       # приход товара
POST   /api/inventory/movements     # ручное движение (owner)
GET    /api/inventory/stock         # текущие остатки
GET    /api/inventory/low-stock

# Задачи
GET    /api/tasks                   ?assigned_to=&status=&patient_id=
POST   /api/tasks
PUT    /api/tasks/[id]
PATCH  /api/tasks/[id]/status

# Аналитика
GET    /api/analytics/dashboard     ?date=
GET    /api/analytics/revenue       ?from=&to=&group_by=
GET    /api/analytics/doctors       ?from=&to=
GET    /api/analytics/crm           ?from=&to=
GET    /api/analytics/inventory     ?from=&to=
GET    /api/reports/export          ?type=&from=&to=&format=xlsx|pdf

# Настройки
GET/PUT         /api/settings/clinic
GET/POST/PUT    /api/settings/users
PUT             /api/settings/users/[id]/role
GET/POST/PUT    /api/settings/roles
PUT             /api/settings/roles/[id]/permissions
GET/POST/PUT/DELETE /api/settings/services
GET/POST/PUT    /api/settings/doctors
GET/POST/PUT    /api/settings/lab-templates
GET/POST/PUT    /api/settings/notifications
```

---

## 5. КАРТОЧКА ПАЦИЕНТА — 7 БЫСТРЫХ ДЕЙСТВИЙ

```typescript
// Кнопки в шапке карточки пациента (QuickActions.tsx)
const QUICK_ACTIONS = [
  { key: 'appointment', label: 'Записать',      icon: Calendar,  perm: 'schedule:create'   },
  { key: 'payment',     label: 'Оплата',         icon: CreditCard,perm: 'finance:create'    },
  { key: 'prepayment',  label: 'Депозит',        icon: Wallet,    perm: 'finance:create'    },
  { key: 'lab',         label: 'Анализы',        icon: Flask,     perm: 'lab:order'         },
  { key: 'procedure',   label: 'Процедура',      icon: Syringe,   perm: 'visit:create'      },
  { key: 'task',        label: 'Задача',         icon: CheckSquare,perm:'tasks:create'      },
  { key: 'compare',     label: 'Сравнить анализы',icon: TrendingUp,perm:'lab:view'          },
];
```

---

## 6. ДАШБОРД — ОПЕРАЦИОННЫЙ ДЕНЬ

```typescript
// app/(dashboard)/page.tsx — виджеты дашборда

interface DashboardData {
  today: {
    appointments_total: number;
    appointments_confirmed: number;
    appointments_completed: number;
    appointments_no_show: number;
    visits_open: number;
    visits_in_progress: number;
  };
  finance: {
    revenue_today: number;
    revenue_cash: number;
    revenue_card: number;
    revenue_vs_yesterday: number;  // %
    cash_session_open: boolean;
  };
  crm: {
    new_leads: number;
    tasks_overdue: number;
    tasks_today: number;
  };
  lab: {
    orders_pending: number;
    orders_ready: number;
  };
  inventory: {
    low_stock_count: number;
    expiring_soon_count: number;  // expires < 30 дней
  };
  by_doctor: DoctorStats[];
  by_service: ServiceStats[];
  hourly_load: { hour: number; count: number }[];
}
```

---

## 7. АНАЛИТИКА — KPI

```
Конверсия лидов:       booked / new_leads × 100%
Конверсия в лечение:   in_treatment / booked × 100%
Время реакции:         avg(time_to_response_s) / 60 → минут
Время до записи:       avg(time_to_booking_s) / 3600 → часов
No-show rate:          no_show / total_appointments × 100%
Выручка/менеджер:      revenue за период по closer_id
Выручка/врач:          sum(charges) по doctor_id
Средний чек:           avg(visit total charges)
Загруженность врача:   completed_visits / available_slots × 100%
Рентабельность услуги: revenue - inventory_cost (по service_templates)
```

---

## 8. ОПЕРАЦИОННЫЙ ЦИКЛ ДНЯ

```
УТРО
  1. Кассир открывает cash_session (внести начальную сумму)
  2. Администратор проверяет записи на сегодня
  3. Подтвердить pending → confirmed (можно автоматически за 2ч)

ДЕНЬ
  4. Пациент пришёл → visit.status = in_progress
  5. Врач заполняет медзапись (жалобы → осмотр → диагноз → назначения)
  6. Врач заказывает анализы (lab_order) / назначает процедуры
  7. Кассир создаёт Charge, принимает Payment
  8. При оплате → auto writeoff склада
  9. Врач подписывает запись → visit.close (валидация)

ВЕЧЕР
  10. Закрыть незакрытые визиты
  11. Лаборант вводит результаты, верифицирует
  12. Администратор закрывает cash_session
  13. Проверить overdue tasks
  14. Сверить остатки склада
```

---

## 9. НЕФУНКЦИОНАЛЬНЫЕ ТРЕБОВАНИЯ

| Требование | Реализация |
|-----------|-----------|
| RBAC | Роли + права + RLS в PostgreSQL |
| Audit log | activity_logs на все действия |
| Soft delete | deleted_at, только owner |
| No data loss | daily backup Supabase + pg_dump |
| Конфликты | SQL-функция + проверка на API |
| Performance | Индексы + React Query cache |
| Realtime | Supabase Realtime (расписание) |
| PDF | @react-pdf/renderer (чеки, выписки) |
| Excel | SheetJS (экспорт отчётов) |
| Уведомления | Twilio SMS + WhatsApp Business |
| Хранение файлов | Supabase Storage |
| Законодательство KZ | Сервер в KZ (PS.KZ/Kazteleport) |

---

## 10. ДОРОЖНАЯ КАРТА — СПРИНТЫ (2 нед.)

### Спринт 1 — Фундамент
- [ ] Все миграции (001–013)
- [ ] Seed: permissions, системные роли, ICD-10
- [ ] Auth: login, middleware, usePermissions, PermissionGuard
- [ ] Settings/roles — матрица прав (чекбоксы)
- [ ] Settings/users — управление пользователями
- [ ] Sidebar скрывает пункты по правам

### Спринт 2 — Пациенты + CRM
- [ ] Список пациентов (поиск, фильтры, пагинация)
- [ ] Карточка пациента (шапка + 7 быстрых действий + лента)
- [ ] CRM: канбан-доска 2 воронок
- [ ] Deal: смена стадий, история, взаимодействия
- [ ] Задачи: список, создание, статусы, просроченные

### Спринт 3 — Расписание + Визиты
- [ ] TimeGrid 08:00–20:00 по врачам
- [ ] Создание/редактирование записи + проверка конфликтов
- [ ] Realtime обновления расписания
- [ ] Экран визита (врач): старт → медзапись → завершение
- [ ] Валидатор закрытия визита

### Спринт 4 — Медкарта
- [ ] Базовые данные (группа крови, рост/вес)
- [ ] Аллергии, хронические, семейный анамнез, соц. анамнез
- [ ] Форма приёма: жалобы → осмотр (vitals) → диагноз (ICD-10) → назначения
- [ ] Шаблоны приёма (8 специализаций)
- [ ] Подпись врача, направления, вложения

### Спринт 5 — Лаборатория
- [ ] Справочник шаблонов анализов + панели
- [ ] Очередь анализов (8 статусов)
- [ ] Ввод результатов с референсными значениями
- [ ] Флаги: normal/low/high/critical
- [ ] Сравнение результатов (таблица + график)
- [ ] Уведомление при готовности

### Спринт 6 — Финансы + Касса
- [ ] Charges при добавлении услуг к визиту
- [ ] PaymentModal: смешанная оплата, методы
- [ ] Депозит: пополнение, списание
- [ ] Кассовые смены: открытие, закрытие, дневной отчёт
- [ ] Печать чека (PDF)
- [ ] Возврат (owner)

### Спринт 7 — Склад
- [ ] Справочник реагентов и расходников
- [ ] Приход партий (batches)
- [ ] Автосписание при закрытии визита (FEFO)
- [ ] Ручные движения (owner)
- [ ] Отчёт остатков + уведомление min_stock

### Спринт 8 — Аналитика + Автоматизация + Деплой
- [ ] Дашборд (все виджеты)
- [ ] Аналитика: выручка, врачи, CRM, склад
- [ ] Экспорт Excel/PDF
- [ ] Edge Functions: напоминания, триггеры
- [ ] Cron: overdue tasks, control_date, reminders
- [ ] Self-hosted Supabase на KZ-сервере
- [ ] CI/CD GitHub Actions → Vercel + VPS

---

## 11. ACCEPTANCE CRITERIA

Система считается **готовой к продакшн**, если выполнены все пункты:

| # | Критерий | Проверка |
|---|---------|---------|
| 1 | Пациент проходит путь: лид → запись → визит → диагноз → оплата | E2E тест |
| 2 | Нельзя создать 2 записи к врачу в одно время | Тест конфликтов |
| 3 | Нельзя закрыть визит без медзаписи и оплаты | Валидатор |
| 4 | Склад списывается автоматически при закрытии визита | Тест движений |
| 5 | Финансы сходятся: sum(charges) = sum(payments) + debt | Сверка |
| 6 | Депозит: пополнение и списание корректны | Тест баланса |
| 7 | Результаты лаборатории редактирует только owner | Роль-тест |
| 8 | Уведомление при готовности анализов отправляется | Интеграция-тест |
| 9 | Все действия фиксируются в activity_logs | Лог-тест |
| 10 | Задачи создаются автоматически по триггерам | Автоматизация |
| 11 | Разные роли видят разные данные (RLS работает) | Безопасность |
| 12 | Дашборд показывает корректные данные за день | Аналитика |
| 13 | Экспорт отчёта в Excel работает | PDF/Excel |
| 14 | Резервная копия БД настроена | DevOps |

---

## 12. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth
NEXTAUTH_SECRET=

# SMS / WhatsApp
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE=
WHATSAPP_PHONE_ID=
WHATSAPP_TOKEN=

# Email
RESEND_API_KEY=

# App
NEXT_PUBLIC_CLINIC_ID=
NEXT_PUBLIC_APP_URL=
```

---

*Конец MASTER SPEC v3.0. Следующий шаг: Спринт 1 — миграции БД.*
