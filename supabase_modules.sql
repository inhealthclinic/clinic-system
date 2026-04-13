-- ============================================================
-- Лаборатория
-- ============================================================
create table if not exists lab_tests (
  id            uuid default gen_random_uuid() primary key,
  patient_id    uuid references patients(id) on delete set null,
  patient_name  text not null,
  patient_phone text,
  test_name     text not null,
  ordered_by    text,
  status        text not null default 'pending',  -- pending / in_progress / ready
  result_text   text,
  price         numeric(10,2),
  date_ordered  date not null default current_date,
  date_ready    date,
  notes         text,
  created_at    timestamptz default now()
);
alter table lab_tests enable row level security;
create policy "Auth users manage lab_tests" on lab_tests for all to authenticated using (true) with check (true);

-- ============================================================
-- Финансы
-- ============================================================
create table if not exists payments (
  id              uuid default gen_random_uuid() primary key,
  patient_id      uuid references patients(id) on delete set null,
  patient_name    text not null,
  appointment_id  uuid references appointments(id) on delete set null,
  service         text,
  doctor_name     text,
  amount          numeric(10,2) not null,
  method          text not null default 'cash',   -- cash / card / transfer
  status          text not null default 'paid',   -- paid / pending / refund
  date            date not null default current_date,
  notes           text,
  created_at      timestamptz default now()
);
alter table payments enable row level security;
create policy "Auth users manage payments" on payments for all to authenticated using (true) with check (true);

-- ============================================================
-- CRM
-- ============================================================
create table if not exists leads (
  id          uuid default gen_random_uuid() primary key,
  full_name   text not null,
  phone       text,
  source      text default 'Instagram',  -- Instagram / WhatsApp / Телефон / Лично / Сайт
  status      text not null default 'new', -- new / contacted / scheduled / converted / lost
  notes       text,
  assigned_to text,
  created_at  timestamptz default now()
);
alter table leads enable row level security;
create policy "Auth users manage leads" on leads for all to authenticated using (true) with check (true);
