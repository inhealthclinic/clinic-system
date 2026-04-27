-- ============================================================
-- 095_deals_birth_date.sql — день рождения как встроенное поле сделки.
--
-- В amoCRM «День рождения» — стандартное поле карточки. Раньше у нас
-- ДР хранилась только в patients.birth_date — но «холодные» сделки
-- (без пациента) не могли его указать. Добавляем колонку прямо в deals,
-- чтобы менеджер мог записать ДР до того, как лид станет пациентом.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='deals' AND column_name='birth_date') THEN
    ALTER TABLE deals ADD COLUMN birth_date DATE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
