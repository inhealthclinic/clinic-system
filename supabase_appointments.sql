-- Таблица приёмов / записей
create table if not exists appointments (
  id           uuid default gen_random_uuid() primary key,
  patient_id   uuid references patients(id) on delete set null,
  patient_name text not null,
  patient_phone text,
  doctor_name  text not null,
  service      text,
  date         date not null,
  start_time   time not null,
  end_time     time,
  status       text not null default 'scheduled',
  notes        text,
  created_at   timestamptz default now()
);

-- Индексы
create index if not exists appointments_date_idx on appointments(date);
create index if not exists appointments_patient_id_idx on appointments(patient_id);

-- RLS (включить Row Level Security)
alter table appointments enable row level security;

-- Политика: аутентифицированные пользователи могут всё
create policy "Authenticated users manage appointments"
  on appointments
  for all
  to authenticated
  using (true)
  with check (true);
