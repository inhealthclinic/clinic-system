-- ============================================================
-- 090_pg_cron_automation.sql
--
-- Расписание автоматизаций через pg_cron + pg_net (Supabase native).
-- Обходит ограничение Vercel Hobby (только daily) и не требует
-- workflow-scope в GitHub PAT для cron.yml.
--
-- pg_cron живёт в схеме `cron`, обновляет внутреннюю джобу при
-- повторном INSERT — мы делаем UPSERT через cron.schedule(jobname,…).
--
-- Endpoint URL и CRON_SECRET хранятся в `automation_config` (1 строка).
-- Их подставляет в curl-запрос json-генерируемый wrapper-функция
-- `fn_call_cron(path)` — она читает текущие значения из таблицы.
--
-- Логи pg_cron — в `cron.job_run_details`. Проверять:
--   SELECT jobid, status, return_message, start_time
--     FROM cron.job_run_details
--    ORDER BY start_time DESC LIMIT 20;
-- ============================================================

-- Расширения (Supabase их разрешает)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Конфиг ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_config (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_url     TEXT NOT NULL DEFAULT 'https://pedantic-moore.vercel.app',
  cron_secret  TEXT NOT NULL DEFAULT '',
  is_enabled   BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- одиночная строка (если её нет — создаём)
INSERT INTO automation_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Wrapper: вызов cron-эндпоинта с Bearer-авторизацией ─────
CREATE OR REPLACE FUNCTION fn_call_cron(p_path TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_cfg   RECORD;
  v_req   BIGINT;
BEGIN
  SELECT base_url, cron_secret, is_enabled INTO v_cfg
    FROM automation_config WHERE id = 1;
  IF NOT v_cfg.is_enabled OR v_cfg.cron_secret = '' THEN
    RETURN NULL;  -- глушилка: пока секрет не задан, ничего не зовём
  END IF;
  SELECT INTO v_req net.http_get(
    url     := v_cfg.base_url || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cfg.cron_secret,
      'Content-Type',  'application/json'
    )
  );
  RETURN v_req;
END
$func$;

-- ── Расписание ──────────────────────────────────────────────
-- cron.schedule(jobname, schedule, command) — идемпотентно для нашего
-- кода: при повторном вызове с тем же jobname обновляет расписание.
SELECT cron.schedule('automation_5min',     '*/5 * * * *',  $$SELECT fn_call_cron('/api/cron/automation');$$);
SELECT cron.schedule('bot_greeting_5min',   '*/5 * * * *',  $$SELECT fn_call_cron('/api/cron/bot-greeting');$$);
SELECT cron.schedule('bot_followup_5min',   '*/5 * * * *',  $$SELECT fn_call_cron('/api/cron/bot-followup');$$);
SELECT cron.schedule('reminders_15min',     '*/15 * * * *', $$SELECT fn_call_cron('/api/cron/send-reminders');$$);
SELECT cron.schedule('generate_tasks_daily','0 6 * * *',    $$SELECT fn_call_cron('/api/cron/generate-tasks');$$);

NOTIFY pgrst, 'reload schema';
