-- Врачи
create table if not exists doctors (
  id         uuid default gen_random_uuid() primary key,
  full_name  text not null,
  specialty  text,
  phone      text,
  color      text default '#0B63C2',
  is_active  boolean default true,
  created_at timestamptz default now()
);
alter table doctors enable row level security;
create policy "Auth manage doctors" on doctors for all to authenticated using (true) with check (true);

-- Услуги / прайс-лист
create table if not exists services (
  id               uuid default gen_random_uuid() primary key,
  name             text not null,
  category         text,
  price            numeric(10,2),
  duration_minutes int default 30,
  is_active        boolean default true,
  created_at       timestamptz default now()
);
alter table services enable row level security;
create policy "Auth manage services" on services for all to authenticated using (true) with check (true);
