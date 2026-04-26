# Приветственный бот (Salesbot)

Аналог сценария «Приветствие» из amoCRM, перенесённый внутрь clinic-system.
Работает 24/7, без проверки рабочих часов клиники.

## Машина состояний

Поля в таблице `deals`:

| Поле                    | Тип       | Назначение                                    |
|-------------------------|-----------|-----------------------------------------------|
| `bot_active`            | bool      | Бот ведёт сделку                              |
| `bot_state`             | text      | `greeted` / `followup_sent` / `done` / NULL   |
| `bot_greeting_sent_at`  | timestamp | Когда ушло приветствие                        |
| `bot_followup_sent_at`  | timestamp | Когда ушёл фоллоуап                           |
| `bot_failure_count`     | int       | Счётчик неуспешных отправок (лимит 5)         |

В `deal_messages` добавлена колонка `sender_type` (`bot` / NULL) — отличает
сообщения от автомата для UI и аналитики.

## Триггеры включения

1. **Webhook Green-API** (`/api/webhooks/greenapi`): новый входящий лид с
   неизвестного номера → создаётся сделка с `bot_active = clinics.settings.bot_enabled`.
2. **Ручное перемещение** в первый этап воронки — оставлено на следующий
   круг (текущий BEFORE-UPDATE триггер только выключает бота при смене этапа).

## Триггеры выключения

| Источник                                  | Что делает                                         |
|-------------------------------------------|----------------------------------------------------|
| `POST /api/deals/[id]/messages` (ответ менеджера) | `bot_active=false`, `bot_state='done'` ДО отправки |
| Смена `stage_id` (DB-триггер `fn_deal_stage_disable_bot`) | `bot_active=false`, `bot_state='done'`             |
| Cron-фоллоуап обнаруживает входящее сообщение клиента | `bot_active=false`, `bot_state='done'`             |

## Cron-эндпоинты

Запускаются GitHub Actions каждые 5 минут (`*/5 * * * *`).

### `GET /api/cron/bot-greeting`
1. Берёт сделки с `bot_active=true AND bot_greeting_sent_at IS NULL`.
2. Проверяет `clinics.settings.bot_enabled`. Если выключен — гасит бота.
3. Шлёт шаблон `bot_greeting` через Green-API.
4. Записывает `deal_messages` с `sender_type='bot'`, проставляет
   `bot_greeting_sent_at`, `bot_state='greeted'`, тэг `чатбот`.
5. На ошибке инкрементит `bot_failure_count`. На 5-м фейле — гасит бота
   и пишет в `webhook_errors`.

### `GET /api/cron/bot-followup`
1. Берёт сделки `bot_state='greeted' AND bot_greeting_sent_at < now()-1h
   AND bot_followup_sent_at IS NULL`.
2. Если есть `deal_messages.direction='in'` после приветствия — передаёт
   менеджеру (`bot_active=false`, `bot_state='done'`), фоллоуап **не** шлёт.
3. Иначе шлёт шаблон `bot_followup_no_answer` и завершает
   (`bot_state='followup_sent'`, `bot_active=false`).

Идемпотентность обеспечена NULL-фильтрами на timestamp-полях — повторный
вызов крона ничего не сломает.

## Шаблоны

Хранятся в `message_templates` с новой колонкой `key`:

- `bot_greeting` — текст приветствия.
- `bot_followup_no_answer` — текст фоллоуапа.

Уникальный partial-индекс `(clinic_id, key) WHERE key IS NOT NULL` гарантирует
один шаблон на ключ. Сидятся миграцией `084_bot_templates_seed.sql`.

## UI

- **CRM канбан** (`/crm`): зелёный бейдж 🤖 на карточке сделки, пока
  `bot_active=true`; серый 🤖 после `followup_sent`. Сообщения от бота —
  фиолетовый bubble с иконкой 🤖.
- **Настройки клиники** (`/settings/clinic`) → секция «Приветственный бот»:
  toggle `bot_enabled` и редактирование текстов обоих шаблонов.

## GitHub Actions secrets

В дополнение к существующим:

- `BOT_GREETING_URL` = `https://<host>/api/cron/bot-greeting`
- `BOT_FOLLOWUP_URL` = `https://<host>/api/cron/bot-followup`

Авторизация — общий `CRON_SECRET`.
