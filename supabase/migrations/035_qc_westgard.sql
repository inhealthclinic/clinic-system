-- ============================================================
-- 035_qc_westgard.sql — контроль качества (QC) с правилами Westgard
--
-- Схема:
--  • qc_materials     — контрольные материалы (лот × уровень × услуга).
--                       Фиксируем target_mean / target_sd для Levey-Jennings.
--  • qc_measurements  — ежедневные замеры контроля. На INSERT считаем z-score
--                       и проставляем массив нарушенных правил Westgard.
--
-- Правила (реализованы):
--  1_2s : |z|>2           — warning  (не блокирует, но подсвечивает)
--  1_3s : |z|>3           — reject
--  2_2s : 2 подряд >|2| с одной стороны        — reject
--  R_4s : разница двух подряд >4SD             — reject
--  4_1s : 4 подряд >|1| с одной стороны        — reject
--  10_x : 10 подряд с одной стороны от mean    — reject
--
-- status: 'accepted' | 'warning' | 'rejected' — выводится из rules.
-- Идемпотентно.
-- ============================================================

-- 1) Таблицы
CREATE TABLE IF NOT EXISTS qc_materials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,                      -- "Glucose control L2"
  level       TEXT NOT NULL CHECK (level IN ('low','normal','high')),
  lot_no      TEXT NOT NULL,
  target_mean DECIMAL(12,4) NOT NULL,
  target_sd   DECIMAL(12,4) NOT NULL CHECK (target_sd > 0),
  unit        TEXT,
  expires_at  DATE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qc_materials_clinic  ON qc_materials(clinic_id);
CREATE INDEX IF NOT EXISTS idx_qc_materials_service ON qc_materials(service_id);

CREATE TABLE IF NOT EXISTS qc_measurements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  material_id  UUID NOT NULL REFERENCES qc_materials(id) ON DELETE CASCADE,
  value        DECIMAL(12,4) NOT NULL,
  z_score      DECIMAL(8,4),                       -- (value-mean)/sd, считается триггером
  measured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  operator_id  UUID REFERENCES user_profiles(id),
  rules        TEXT[] NOT NULL DEFAULT '{}',       -- {'1_2s','2_2s'...}
  status       TEXT NOT NULL DEFAULT 'accepted'
               CHECK (status IN ('accepted','warning','rejected')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qc_measurements_material ON qc_measurements(material_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_qc_measurements_clinic   ON qc_measurements(clinic_id);

-- updated_at trigger для materials
DROP TRIGGER IF EXISTS trg_qc_materials_updated_at ON qc_materials;
CREATE TRIGGER trg_qc_materials_updated_at
  BEFORE UPDATE ON qc_materials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) Функция оценки Westgard для свежей точки
CREATE OR REPLACE FUNCTION fn_qc_evaluate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_mat     qc_materials%ROWTYPE;
  v_z       DECIMAL(8,4);
  v_rules   TEXT[] := '{}';
  v_status  TEXT   := 'accepted';
  v_prev    DECIMAL(8,4);
  v_count_2s INT;
  v_count_1s INT;
  v_count_10 INT;
  v_side     INT; -- знак последнего z
BEGIN
  SELECT * INTO v_mat FROM qc_materials WHERE id = NEW.material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qc_material % not found', NEW.material_id;
  END IF;

  v_z := (NEW.value - v_mat.target_mean) / NULLIF(v_mat.target_sd, 0);
  NEW.z_score := v_z;

  -- 1_2s / 1_3s
  IF ABS(v_z) > 3 THEN v_rules := array_append(v_rules,'1_3s'); END IF;
  IF ABS(v_z) > 2 AND ABS(v_z) <= 3 THEN v_rules := array_append(v_rules,'1_2s'); END IF;

  v_side := CASE WHEN v_z >= 0 THEN 1 ELSE -1 END;

  -- Берём предыдущую точку для R_4s
  SELECT z_score INTO v_prev
    FROM qc_measurements
   WHERE material_id = NEW.material_id
     AND measured_at < NEW.measured_at
   ORDER BY measured_at DESC
   LIMIT 1;

  IF v_prev IS NOT NULL AND ABS(v_z - v_prev) > 4 THEN
    v_rules := array_append(v_rules,'R_4s');
  END IF;

  -- 2_2s: эта и предыдущая обе |z|>2 с одной стороны
  IF v_prev IS NOT NULL
     AND ABS(v_z) > 2 AND ABS(v_prev) > 2
     AND SIGN(v_z) = SIGN(v_prev) THEN
    v_rules := array_append(v_rules,'2_2s');
  END IF;

  -- 4_1s: 4 подряд |z|>1 с одной стороны (включая текущую)
  SELECT COUNT(*) INTO v_count_1s
    FROM (
      SELECT z_score
        FROM qc_measurements
       WHERE material_id = NEW.material_id
         AND measured_at < NEW.measured_at
       ORDER BY measured_at DESC
       LIMIT 3
    ) t
    WHERE ABS(z_score) > 1 AND SIGN(z_score) = v_side;
  IF ABS(v_z) > 1 AND v_count_1s = 3 THEN
    v_rules := array_append(v_rules,'4_1s');
  END IF;

  -- 10_x: 10 подряд с одной стороны от среднего (включая текущую)
  SELECT COUNT(*) INTO v_count_10
    FROM (
      SELECT z_score
        FROM qc_measurements
       WHERE material_id = NEW.material_id
         AND measured_at < NEW.measured_at
       ORDER BY measured_at DESC
       LIMIT 9
    ) t
    WHERE SIGN(z_score) = v_side;
  IF v_count_10 = 9 THEN
    v_rules := array_append(v_rules,'10_x');
  END IF;

  -- status
  IF v_rules && ARRAY['1_3s','2_2s','R_4s','4_1s','10_x'] THEN
    v_status := 'rejected';
  ELSIF '1_2s' = ANY(v_rules) THEN
    v_status := 'warning';
  END IF;

  NEW.rules  := v_rules;
  NEW.status := v_status;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_qc_evaluate ON qc_measurements;
CREATE TRIGGER trg_qc_evaluate
  BEFORE INSERT ON qc_measurements
  FOR EACH ROW EXECUTE FUNCTION fn_qc_evaluate();

-- 3) RLS
ALTER TABLE qc_materials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qc_materials_clinic    ON qc_materials;
DROP POLICY IF EXISTS qc_measurements_clinic ON qc_measurements;

CREATE POLICY qc_materials_clinic ON qc_materials
  FOR ALL TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY qc_measurements_clinic ON qc_measurements
  FOR ALL TO authenticated
  USING (clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid()));

-- 4) Аудит (если fn_audit_trigger существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_trigger') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_qc_materials ON qc_materials';
    EXECUTE 'CREATE TRIGGER trg_audit_qc_materials
              AFTER INSERT OR UPDATE OR DELETE ON qc_materials
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_qc_measurements ON qc_measurements';
    EXECUTE 'CREATE TRIGGER trg_audit_qc_measurements
              AFTER INSERT OR UPDATE OR DELETE ON qc_measurements
              FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
