# amoCRM-style CRM module: rework + integrations + analytics

Branch: `claude/condescending-cerf` → `main`
Commits: 9 (since `a3a0747`)

## Что в PR

### 1. Базовый аппгрейд CRM-модуля (`4663f51`)
- Канбан с фильтрами / поиском / периодом / переключением list⇄kanban
- Аналитическая полоса, bulk-операции, расширенные карточки и drawer

### 2. Фикс критической ошибки `deals_source_check` (`8733d0e`, `f8c6b46`)
- Раньше форма создания лида отправляла русские лейблы прямо в `deals.source` («Таргет», «WhatsApp», «2GIS») → ошибка вставки.
- Введён единый словарь `src/lib/crm/constants.ts` (SOURCE_OPTIONS, PRIORITY_OPTIONS, LOST_REASON_OPTIONS, INTERACTION_TYPE_OPTIONS, TASK_TYPE/PRIORITY/STATUS_OPTIONS, STAGE_WHATSAPP_TEMPLATES) — все `value` совпадают с DB CHECK-констрейнтами.
- `normalizeSource()` страхует от любых старых значений из localStorage.
- Форма создания лида упрощена до 4 полей: имя · телефон · источник · заметка (как в amoCRM); всё остальное редактируется в карточке.
- Phone-нормализация: модуль `src/lib/utils/phone.ts` с залоченным префиксом `+77`, авто-форматированием при вводе, валидацией, дедупом по нормализованной форме. Применено в CRM (QuickAddForm + CreateDealModal), `/schedule` (быстрая регистрация пациента), `/patients/new`, `/patients/[id]`.
- Миграция `016_crm_source_backfill.sql` — бэкфилл уже сохранённых русских значений в канонические + добавляет `deals_source_enum_check`.

### 3. DealDrawer = центр сделки в стиле amoCRM (`be445e3`, `5111556`)
- **Финансы**: баланс / долг пациента в шапке drawer'а
- **Записи**: последние 5 приёмов пациента + кнопка «+ Создать запись» с deep-link `/schedule?patient=<uuid>`
- **Платежи**: последние 5 завершённых платежей с типом × методом × суммой (refund подсвечен красным, ведёт минус)
- **Quick links**: кнопки в карту пациента / медкарту / лабораторию / финансы
- `loadInteractions()` теперь параллельно запрашивает 5 источников (interactions, tasks, appointments, balance, payments)
- WhatsApp кнопка работает с нормализованным телефоном
- `/schedule` читает `?patient=` и пред-заполняет модалку «Новая запись»

### 4. STAGE_TASKS — рефакторинг + расширение (`5111556`)
- Было: `Record<string, string>` (только заголовок), 5 этапов, type/priority hard-coded в обработчике
- Стало: `Record<string, StageTaskTpl>` с `title + type + priority + hours-offset` per stage
- Покрытие: 5 → 14 этапов (tirzepatide_service, primary_done, secondary_*, treatment, tirzepatide_tx, control_tests, success, failed)
- Автозадачи теперь наследуют `assigned_to` сделки — не висят бесхозными

### 5. /crm/settings — источники теперь read-only (`5111556`)
- Убрана возможность добавлять произвольные строки (это и провоцировало баг)
- Канонический список с `value` ↔ `label` отображается как таблица + баннер «список зафиксирован в БД»

### 6. Schedule ↔ deal sync (`299c04c`)
- Новый модуль `src/lib/crm/sync.ts`:
  - `ensureMedicalDealForPatient()` — идемпотентный upsert открытой мед-сделки
  - `syncDealStageOnAppointmentStatus()` — статус записи → этап сделки:
    - `no_show` → `no_show`
    - `completed` → `primary_done` (или `secondary_done` если уже после первички)
    - `confirmed` → `primary_scheduled` (только если был `no_show`/без сделки)
- Каждый автоматический шаг логируется в `crm_interactions` (тип `note`, `outcome=appointment:<uuid>`)
- Best-effort: ловит ошибку и пишет `console.warn`, не валит UI

### 7. Payment → deal sync (`fddf323`)
- `syncDealOnPayment()` логирует каждый платёж в `crm_interactions` сделки
- Если `deal_value > 0` и сумма всех завершённых не-возвратных платежей покрывает `deal_value`: автоматически `status='won'`, `stage='success'` + лог-комментарий
- Refunds / writeoffs только логируются, не закрывают
- Подключено в `/finance` PaymentModal

### 8. /crm/analytics — новая страница (`75d7837`)
- Period filter (7 / 30 / 90 / all) + funnel toggle (Лиды vs Медицинская)
- KPI strip: всего сделок, конверсия, сумма won, среднее время до записи / реакции
- Funnel chart с drop-off % между этапами
- Breakdown «По источникам» (leads/won/lost/conversion/₸/доля)
- Breakdown «По менеджерам» (assigned_to ?? first_owner_id)
- Lost reasons bar-list

### 9. WhatsApp-шаблоны под стадии (`75d7837`)
- 13 стадий × 1-2 готовых сценария
- Подстановка `{name}`, `{fname}`, `{clinic}`
- Кнопка `▾` рядом с WA в DealDrawer → попап → клик → wa.me с готовым текстом

### 10. Прочее
- `tasks/page.tsx` переведён на центральный словарь
- Phone-display через `formatPhoneDisplay()` в карте пациента и списках
- Навигация в шапке `/crm`: добавлена «Аналитика»

## Контроль качества
- `npx tsc --noEmit` → EXIT=0
- `npx next build` → 25 страниц, EXIT=0

## ⚠ Конфликты при мердже

Ветка отделилась от `a3a0747` и за это время в `main` ушло 21 коммит, в основном по `/schedule`. При мердже будут конфликты в:
- `src/app/(dashboard)/crm/page.tsx` — крупный, оба тяжело правили
- `src/app/(dashboard)/schedule/page.tsx` — крупный, в main много правок (color types, week view, type filter)
- `src/app/(dashboard)/tasks/page.tsx` — myTasks/typeFilter из main vs наш scope/filter/bulk
- `src/app/(dashboard)/patients/[id]/page.tsx` — phone normalization vs валидация из main
- `src/app/(dashboard)/page.tsx` — оба переписали dashboard
- `postcss.config.js` — удалён в main, изменён у нас (взять версию из main)

Рекомендация: дать отдельной сессии задачу «rebase claude/condescending-cerf на origin/main и разрулить конфликты».

## Новые файлы
- `src/lib/crm/constants.ts`
- `src/lib/crm/sync.ts`
- `src/lib/utils/phone.ts`
- `src/app/(dashboard)/crm/analytics/page.tsx`
- `supabase/migrations/015_crm_amocrm.sql`
- `supabase/migrations/016_crm_source_backfill.sql`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
