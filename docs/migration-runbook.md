# Runbook переезда с amoCRM

## TL;DR

```bash
# 1. Снапшот ДО переезда (3 мин)
export SUPABASE_URL=https://ipvhpyclczbofjqpmisz.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...   # из Vercel env
node scripts/snapshot-db.mjs > snapshots/before-cutover-$(date +%Y%m%d-%H%M).json

# 2. Smoke-test проверки до cutover (см. ниже)

# 3. Импорт CSV из amoCRM (через UI в /crm → Импорт)

# 4. Снапшот ПОСЛЕ импорта (для сравнения)
node scripts/snapshot-db.mjs > snapshots/after-import-$(date +%Y%m%d-%H%M).json
```

## Резервные копии

### Что у нас есть

- **Supabase auto-backup**: ежедневный, retention 7 дней (Free tier).
  Восстановление — только через [dashboard → Database → Backups](https://supabase.com/dashboard/project/ipvhpyclczbofjqpmisz/database/backups).
- **PITR**: ❌ выключен (нужен Pro план + явное включение).
- **Локальный snapshot**: `scripts/snapshot-db.mjs` — JSON-дамп ключевых таблиц (без storage и auth).

### Откат при сбое

| Сценарий | Что делать |
|---|---|
| Импорт CSV пошёл криво (битые сделки) | В UI: `/crm/trash` → восстановить, либо `UPDATE deals SET deleted_at=NULL WHERE created_at > 'cutover-ts'` |
| Все сделки сегодняшние улетели | Supabase dashboard → Backups → Restore вчерашний snapshot |
| Случайный массовый DELETE | То же — restore через dashboard |
| Локальная отладка показала, что какая-то таблица повреждена | Из `snapshots/*.json` — селективный INSERT в Supabase SQL editor |

## Cron уведомлений

Запускается через `.github/workflows/cron.yml`:
- `*/15 * * * *` → `/api/cron/send-reminders` (за 24 ч и за 2 ч до приёма)
- `0 6 * * *` → `/api/cron/generate-tasks` (дни рождения, контроль, долги)

### Требуется в GitHub Actions secrets:

| Имя | Значение |
|---|---|
| `CRON_SECRET` | `ae05565d55a0f947116347d5efd31fb450be962d1ec5cdf06fbae3f342c38e70` (уже в Vercel env) |
| `REMINDER_URL` | `https://pedantic-moore.vercel.app/api/cron/send-reminders` |
| `GENERATE_TASKS_URL` | `https://pedantic-moore.vercel.app/api/cron/generate-tasks` |

### Ручной тест

```bash
SECRET="ae05565d55a0f947116347d5efd31fb450be962d1ec5cdf06fbae3f342c38e70"
curl -sS -H "Authorization: Bearer $SECRET" \
  https://pedantic-moore.vercel.app/api/cron/send-reminders
# → {"ok":true,"checked":0,"sent24":0,"sent2":0,...}

curl -sS -H "Authorization: Bearer $SECRET" \
  https://pedantic-moore.vercel.app/api/cron/generate-tasks
# → {"ok":true,"birthdays":0,...}
```

## Webhook ошибки

Зачем: webhook Green-API возвращает 200 даже при сбое БД (чтобы провайдер не штормил ретраями). Раньше ошибки молча терялись. Теперь пишутся в `webhook_errors` (миграция 082).

### Где смотреть

```sql
-- Свежие нерешённые
SELECT id, source, event_type, error_message, created_at
FROM webhook_errors
WHERE resolved_at IS NULL
ORDER BY created_at DESC
LIMIT 50;

-- По конкретной сделке (через payload)
SELECT id, error_message, created_at, payload
FROM webhook_errors
WHERE payload::text ILIKE '%77051234567%';

-- Закрыть как разобранное
UPDATE webhook_errors
SET resolved_at = now(), resolved_by = auth.uid()
WHERE id = $1;
```

В UI пока нет страницы — добавим, если ошибки реально пойдут. Доступ через RLS — owner и admin.

## Smoke-test перед cutover

Пройти ВСЕ шаги на проде перед массовым импортом. Время: ~15 мин.

| # | Шаг | Ожидание | Где смотреть |
|---|---|---|---|
| 1 | Отправить WhatsApp на номер клиники с тестового телефона | Появилась сделка в `/crm` (этап «Неразобранное»), сообщение в чате карточки | Канбан + карточка |
| 2 | Из сделки ответить «привет» через композер | Сообщение → клиенту, статус `sent` → `delivered` через ~3 сек | Бабл с галочками |
| 3 | Кликнуть «Записать на приём» → выбрать врача/время → создать | Появился appointment, в timeline сделки запись `appointment_created` | `/schedule` + таймлайн сделки |
| 4 | Открыть визит → завершить → принять оплату | `payments` запись, баланс пациента в карточке | `/finance` |
| 5 | Открыть карточку пациента | Видно сделку, визит, оплату | `/patients/[id]` |
| 6 | Проверить, что webhook_errors пуст после сценария | `SELECT count(*) FROM webhook_errors WHERE created_at > now() - interval '15 min'` = 0 | Supabase SQL editor |

### Если на любом шаге сбой

1. Зафиксировать в `notes/cutover-issues.md`
2. Если шаг 1, 2 или 3 — **STOP**, переезд откладывается
3. Если шаг 4-6 — переезд возможен, но функция требует фикса в течение суток

## Cutover

1. ✅ Снапшот «до»
2. ✅ Smoke-test пройден
3. Финальный экспорт CSV из amoCRM
4. В `/crm` → Импорт CSV → выбрать воронки → загрузить
5. Снапшот «после импорта»
6. Проверить 10 случайных сделок: amoCRM ↔ pedantic-moore (имя, телефон, этап)
7. Перенаправить webhook WhatsApp с amoCRM на pedantic-moore (Green-API)
8. amoCRM перевести в read-only для команды
9. День 1-7: мониторинг, amoCRM на чтение
10. День 14: отключение amoCRM-подписки

## Rollback план

Если в первые 24 часа после cutover критическая поломка (>5 потерянных лидов или сломан весь чат):

1. Webhook WhatsApp вернуть на amoCRM
2. Из `webhook_errors` достать список потерянных сообщений
3. Связаться с клиентами вручную
4. Откат не требует снапшота — данные за 1 день потерь минимальны
