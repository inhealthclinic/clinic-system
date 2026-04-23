# Настройка напоминаний о приёмах

Пайплайн: `appointments` → `/api/cron/send-reminders` → Twilio SMS / Meta WhatsApp → `notifications_log`.

## 1. Env-переменные на Vercel

В Vercel → Settings → Environment Variables:

```
CRON_SECRET             = <случайная строка, напр. openssl rand -hex 32>
TWILIO_ACCOUNT_SID      = ACxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN       = xxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE            = +7XXXXXXXXXX           (номер отправителя)
WHATSAPP_PHONE_ID       = 123456789012345         (Meta WA Business phone ID)
WHATSAPP_TOKEN          = EAAxxxxxxxxxxxxxxx
```

Если какой-то провайдер не подключён — пайплайн всё равно работает, просто
такие сообщения попадают в `notifications_log` со статусом `failed` и
ошибкой «twilio not configured» / «whatsapp not configured».

## 2. Крон через GitHub Actions

Vercel Hobby разрешает cron только раз в сутки — мало для 2-часовых
напоминаний. Используем GitHub Actions (бесплатно, каждые 15 минут).

**Создать файл `.github/workflows/send-reminders.yml` через GitHub Web UI:**

```yaml
name: Cron jobs
on:
  schedule:
    - cron: '*/15 * * * *'     # напоминания о приёмах — каждые 15 мин
    - cron: '0 6 * * *'        # генерация задач (ДР, контроль, долги) — раз в сутки
  workflow_dispatch:

jobs:
  reminders:
    if: github.event.schedule != '0 6 * * *'
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sSf -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
               "${{ secrets.REMINDER_URL }}" | tee r.json
          grep -q '"ok":true' r.json
  generate-tasks:
    if: github.event.schedule == '0 6 * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sSf -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
               "${{ secrets.GENERATE_TASKS_URL }}" | tee g.json
          grep -q '"ok":true' g.json
```

Дополнительный secret: `GENERATE_TASKS_URL` = `https://pedantic-moore.vercel.app/api/cron/generate-tasks`.

**В Settings → Secrets and variables → Actions добавить:**
- `CRON_SECRET` — то же значение, что в Vercel env
- `REMINDER_URL` — `https://pedantic-moore.vercel.app/api/cron/send-reminders`

Триггернуть руками: Actions → Send appointment reminders → Run workflow.

## 3. Шаблоны сообщений

Редактируются в UI: `/settings/notifications`. Хранятся в
`clinics.settings.notification_templates` (JSONB). Ключи, которые
читает крон:
- `appointment_reminder_24h` — шлётся за 23.5–24.5ч до приёма
- `appointment_reminder_2h` — шлётся за 1.5–2.5ч

Переменные в тексте: `{{ФИО}}`, `{{имя}}`, `{{дата}}`, `{{время}}`,
`{{врач}}`, `{{клиника}}`, `{{адрес}}`, `{{телефон}}`.

## 4. Идемпотентность

На `appointments` есть флаги `reminder_sent_24h` / `reminder_sent_2h` —
после успешной отправки ставятся в `true`, повторный прогон крона
эти приёмы пропустит. Если провайдер вернул ошибку — флаг не ставится,
при следующем прогоне будет новая попытка (до выхода из временного
окна).

## 5. Отладка

```sql
-- Последние попытки отправки
SELECT created_at, status, channel, recipient, error, body
FROM notifications_log
ORDER BY created_at DESC
LIMIT 20;

-- Какие приёмы не получили 24ч-напоминание
SELECT a.id, a.date, a.time_start, p.full_name, p.phones
FROM appointments a JOIN patients p ON p.id = a.patient_id
WHERE a.date >= CURRENT_DATE
  AND a.status IN ('pending','confirmed')
  AND NOT a.reminder_sent_24h;
```
