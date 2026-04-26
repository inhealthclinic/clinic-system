# IN HEALTH МИС — CLAUDE.md
> Инструкция для Claude Code. Читай этот файл ПЕРВЫМ перед любой работой с проектом.

---

## ПРОЕКТ

Медицинская информационная система (МИС) для частной клиники.
Стек: **Next.js 16 (App Router) · Supabase (PostgreSQL 15) · TypeScript 5 · Tailwind CSS · shadcn/ui**
Репо: `inhealthclinic/clinic-system`

---

## ТЕКУЩЕЕ СОСТОЯНИЕ

### ✅ Создано и готово к интеграции

**База данных (14 миграций в `migrations/`):**
- `001_core.sql` — clinics, RBAC (roles, permissions, user_profiles)
- `002_doctors.sql` — specializations, doctors
- `003_patients.sql` — patients, consents, duplicates + merge function
- `004_crm.sql` — deals (2 воронки), interactions, whatsapp_messages, tasks, activity_logs
- `005_schedule.sql` — services, appointments + auto-create visit trigger
- `006_visits.sql` — visits + validate_visit_close() function
- `007_medcard.sql` — медкарта полная (allergies, chronic, ICD-10, medical_records, prescription_templates)
- `008_lab.sql` — lab_orders (8 статусов + rejected), lab_results (critical flag, edit_history)
- `009_finance.sql` — charges, payments, patient_balance, cash_sessions + triggers
- `010_packages.sql` — service_packages, patient_packages (с expires_at)
- `011_inventory.sql` — reagents, consumables, batches, movements (FEFO auto-writeoff)
- `012_salary.sql` — doctor_salary_settings, doctor_payroll
- `013_notifications.sql` — notification_templates, notifications_log
- `014_seed_permissions.sql` — все права + системные роли + drug_allergy_groups seed

**Frontend (`src/`):**

| Страница | Путь | Статус |
|---------|------|--------|
| Логин | `app/(auth)/login/page.tsx` | ✅ |
| Дашборд | `app/(dashboard)/page.tsx` | ✅ |
| Расписание | `app/(dashboard)/schedule/page.tsx` | ✅ |
| Список визитов | `app/(dashboard)/visits/page.tsx` | ✅ |
| Экран визита | `app/(dashboard)/visits/[id]/page.tsx` | ✅ |
| Список пациентов | `app/(dashboard)/patients/page.tsx` | ✅ |
| Новый пациент | `app/(dashboard)/patients/new/page.tsx` | ✅ |
| Карточка пациента | `app/(dashboard)/patients/[id]/page.tsx` | ✅ |
| CRM канбан | `app/(dashboard)/crm/page.tsx` | ✅ |
| Лаборатория | `app/(dashboard)/lab/page.tsx` | ✅ |
| Финансы | `app/(dashboard)/finance/page.tsx` | ✅ |
| Задачи | `app/(dashboard)/tasks/page.tsx` | ✅ |
| Аналитика | `app/(dashboard)/analytics/page.tsx` | ✅ |
| Настройки: роли | `app/(dashboard)/settings/roles/page.tsx` | ✅ |
| Настройки: сотрудники | `app/(dashboard)/settings/users/page.tsx` | ✅ |
| Настройки: клиника | `app/(dashboard)/settings/clinic/page.tsx` | ✅ |
| Настройки: врачи | `app/(dashboard)/settings/doctors/page.tsx` | ✅ |
| Настройки: услуги | `app/(dashboard)/settings/services/page.tsx` | ✅ |

### ⚠️ Нужно доделать (по приоритету)

1. **Supabase Edge Functions** (`supabase/functions/`) — ещё не созданы:
   - `send-notification/` — отправка SMS/WhatsApp (Twilio)
   - `whatsapp-webhook/` — входящие сообщения WhatsApp
   - `send-reminders/` — cron для напоминаний за 24ч/2ч
   - `auto-writeoff/` — списание склада при оплате (можно через DB trigger)

2. **Страницы настроек** — не созданы:
   - `/settings/lab-templates` — шаблоны анализов
   - `/settings/notifications` — шаблоны уведомлений

3. **Страницы** — не созданы:
   - `/patients/[id]/medical-card` — полная медкарта пациента (отдельная страница)
   - `/inventory` — склад (просмотр, приход, движения)

4. **PDF генерация** — не реализована:
   - Рецепт на бланке клиники (`lib/utils/pdf.ts`)
   - Чек/квитанция

5. **WhatsApp UI** — не создан:
   - Раздел "Сообщения" для менеджера (входящие диалоги)

6. **ICD-10 seed** — нужно загрузить 72k кодов:
   - Источник: https://icd.who.int или Минздрав РК
   - Формат: CSV → INSERT в таблицу `icd10_codes`

---

## КЛЮЧЕВЫЕ ПАТТЕРНЫ КОДА

### 1. Supabase клиент
```typescript
// В Server Components / API Routes:
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// В Client Components:
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()
```

### 2. Проверка прав
```typescript
// Hook (client):
const { can, canAny, isRole, user } = usePermissions()
if (!can('medcard:sign')) return

// Компонент:
<PermissionGuard permission="finance:approve_discount">
  <ApproveButton />
</PermissionGuard>

// Server-side (SQL):
SELECT has_permission(auth.uid(), 'lab:edit_result')
```

### 3. Текущий пользователь
```typescript
const { user, isLoading } = useCurrentUser() // загружает из Supabase + сохраняет в Zustand
const { user } = useAuthStore()              // читать из store (уже загружено)
```

### 4. API Route шаблон
```typescript
export async function GET(req: Request) {
  const supabase = await createClient()  // проверяет сессию через cookies
  // RLS автоматически фильтрует по clinic_id
  const { data } = await supabase.from('table').select('*')
  return NextResponse.json({ data })
}
```

### 5. Все таблицы имеют clinic_id
```typescript
// При создании записи ВСЕГДА передавать clinic_id:
const { user } = usePermissions()
await supabase.from('appointments').insert({
  clinic_id: user?.clinic_id,  // ← обязательно
  ...data
})
```

---

## БИЗНЕС-ПРАВИЛА (критичные)

| Правило | Где проверяется |
|---------|----------------|
| Нельзя закрыть визит без медзаписи + charge + оплаты | `validate_visit_close()` в БД + `/api/visits/[id]` |
| Врач не может иметь 2 записи одновременно | `check_doctor_conflict()` в БД + `/api/appointments/conflicts` |
| Скидка > лимита роли → pending_approval | `/api/charges` POST |
| Скидки одобряет ТОЛЬКО owner | `roles.slug = 'owner'` + `finance:approve_discount` |
| Возврат наличными требует подтверждения выдачи | `payments.cash_refund_confirmed_by` |
| Редактирование лаб-результатов — только owner | `/api/lab/results` PUT |
| При регистрации пациента — обязательно согласие ПДн | `/api/patients` POST |
| Аллергия при назначении — показать предупреждение | `AllergyAlert` компонент |
| Пакет услуг — проверять expires_at | `patient_packages.status` |
| Walk-in — appointment + visit создаются сразу | `is_walkin=true` → visit.status='in_progress' |
| Soft delete — только owner | `patients.deleted_at` + role check |

---

## РОЛИ И КЛЮЧЕВЫЕ ОГРАНИЧЕНИЯ

```
owner    → всё разрешено, max_discount=NULL
admin    → нет: удаления, одобрения скидок, редактирования лаб
doctor   → только свои пациенты (без schedule:view_all), подпись медкарт
nurse    → расписание всех, базовые данные пациента, процедуры
laborant → только лаборатория, свой склад реагентов
cashier  → только финансы (касса), max_discount=5%
manager  → CRM, пациенты (без медкарты)
```

---

## СТРУКТУРА ПРОЕКТА

```
src/
├── app/
│   ├── (auth)/login/          ← страница входа
│   ├── (dashboard)/           ← все защищённые страницы
│   │   ├── layout.tsx         ← Sidebar + Header + auth guard
│   │   ├── page.tsx           ← Дашборд
│   │   ├── schedule/
│   │   ├── visits/
│   │   ├── patients/
│   │   ├── crm/
│   │   ├── lab/
│   │   ├── finance/
│   │   ├── tasks/
│   │   ├── analytics/
│   │   └── settings/
│   ├── api/                   ← API routes (все проверяют сессию)
│   └── layout.tsx + globals.css
├── components/
│   ├── layout/                ← Sidebar, Header
│   ├── schedule/              ← TimeGrid, AppointmentModal, AppointmentCard
│   ├── visits/                ← MedicalRecordForm, LastVisitPanel
│   ├── medical-card/          ← AllergyAlert, ICD10Search
│   ├── lab/                   ← LabResultsForm, LabStockWidget
│   ├── finance/               ← PaymentModal, CashSessionBar, DepositWidget, PatientPaymentSummary
│   ├── patients/              ← QuickActions
│   └── shared/                ← PermissionGuard
├── lib/
│   ├── supabase/client.ts     ← browser client
│   ├── supabase/server.ts     ← server client + admin client
│   ├── stores/authStore.ts    ← Zustand: user + permissions Set
│   ├── hooks/usePermissions.ts ← can(), canAny(), isRole()
│   ├── hooks/useCurrentUser.ts ← загрузка профиля при старте
│   └── utils/schedule.ts      ← временные утилиты для расписания
├── middleware.ts               ← защита маршрутов
└── types/app.ts               ← все TypeScript типы
```

---

## ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ

Скопировать `.env.example` → `.env.local` и заполнить:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GREENAPI_INSTANCE_ID + GREENAPI_TOKEN + GREENAPI_WEBHOOK_TOKEN
CRON_SECRET
RESEND_API_KEY
```

---

## ЗАПУСК

```bash
npm install
cp .env.example .env.local   # заполнить ключи
supabase db push             # применить миграции
npm run dev                  # http://localhost:3000
```

**Первый вход:**
1. В Supabase Dashboard → Authentication → Users → создать пользователя
2. В SQL Editor выполнить:
```sql
-- Создать клинику
INSERT INTO clinics(name) VALUES('Моя клиника') RETURNING id;

-- Создать профиль владельца (подставить реальные UUID)
INSERT INTO user_profiles(id, clinic_id, role_id, first_name, last_name)
VALUES('auth-user-uuid', 'clinic-uuid', NULL, 'Имя', 'Фамилия');

-- Создать роли для клиники
SELECT seed_clinic_roles('clinic-uuid');

-- Назначить роль owner пользователю
UPDATE user_profiles
SET role_id = (SELECT id FROM roles WHERE clinic_id='clinic-uuid' AND slug='owner')
WHERE id = 'auth-user-uuid';
```

---

## ЧТО ДЕЛАТЬ ДАЛЬШЕ (порядок)

1. **Применить миграции** — `supabase db push`
2. **Загрузить ICD-10** — найти CSV Минздрава РК, загрузить seed
3. **Создать Edge Functions** — `send-notification`, `whatsapp-webhook`
4. **Настроить WhatsApp Business API** — подать заявку Meta (2-4 нед)
5. **Создать `/inventory` страницу** — склад
6. **Создать `/settings/lab-templates`** — шаблоны анализов
7. **Реализовать PDF** — рецепт + чек (`@react-pdf/renderer`)
8. **Деплой** — сервер в Казахстане (PS.KZ) + Vercel для фронта

---

## ВАЖНО ДЛЯ РАЗРАБОТКИ

- **Не удалять данные** — везде soft-delete (`deleted_at`)
- **clinic_id** — обязателен при создании ЛЮБОЙ записи
- **RLS** включён на всех таблицах — тестировать с реальным токеном
- **Supabase Realtime** используется на расписании и лаборатории
- **Zustand** хранит user + permissions — не дублировать в local state
- **Типы** — все в `src/types/app.ts`, не создавать inline интерфейсы
