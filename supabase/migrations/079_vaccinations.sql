-- 079_vaccinations.sql
-- Календарь прививок пациентов.

-- Справочник вакцин (клинико-независимый)
CREATE TABLE IF NOT EXISTS vaccines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE,           -- КП/ВОЗ код, опционально
  name        TEXT NOT NULL,         -- «БЦЖ», «Пентаксим», «Приорикс»
  disease     TEXT,                  -- «Туберкулёз», «Коклюш-дифтерия-столбняк»
  schedule_hint TEXT,                -- подсказка расписания: «3 мес», «1 год»
  is_national BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Записи о прививках пациентов
CREATE TABLE IF NOT EXISTS patient_vaccinations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_id      UUID REFERENCES vaccines(id),
  vaccine_name    TEXT NOT NULL,      -- снимок на случай удаления справочника
  dose_number     INT,                -- 1, 2, 3...
  administered_at DATE NOT NULL,
  lot_number      TEXT,               -- серия вакцины
  manufacturer    TEXT,
  site            TEXT,               -- «левое плечо»
  route           TEXT,               -- «в/м», «п/к»
  doctor_id       UUID REFERENCES doctors(id),
  reaction        TEXT,               -- реакция / побочные эффекты
  next_due_date   DATE,               -- когда следующая доза
  notes           TEXT,
  created_by      UUID REFERENCES user_profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pvacc_patient ON patient_vaccinations(patient_id, administered_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvacc_due     ON patient_vaccinations(clinic_id, next_due_date) WHERE next_due_date IS NOT NULL;

-- RLS
ALTER TABLE vaccines                ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_vaccinations    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vaccines: read all auth" ON vaccines
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "vaccines: admin write" ON vaccines
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "patient_vaccinations: own clinic" ON patient_vaccinations
  FOR ALL USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());

-- Национальный календарь РК — seed самых частых
INSERT INTO vaccines (name, disease, schedule_hint, is_national) VALUES
  ('БЦЖ',            'Туберкулёз',                              'роддом',           true),
  ('Гепатит B',      'Вирусный гепатит B',                      '0-1-6 мес',        true),
  ('Пентаксим',      'Коклюш/дифтерия/столбняк/полио/Hib',       '2-3-4 мес',        true),
  ('ОПВ',            'Полиомиелит',                             '12-18 мес',        true),
  ('Приорикс (MMR)', 'Корь/краснуха/паротит',                   '12 мес, 6 лет',    true),
  ('АДС-М',          'Дифтерия/столбняк',                       '6 лет, 16 лет',    true),
  ('Пневмококк',     'Пневмококковая инфекция',                 '2-4-12 мес',       true),
  ('Ротавирус',      'Ротавирусная инфекция',                   '2-3-4 мес',        true),
  ('ВПЧ (HPV)',      'Вирус папилломы человека',                '9-14 лет',         false),
  ('Грипп',          'Сезонный грипп',                          'ежегодно',         false),
  ('COVID-19',       'Коронавирусная инфекция',                 'по эпид-показ.',   false)
ON CONFLICT DO NOTHING;
