// ============================================================
// types/app.ts — бизнес-типы системы
// ============================================================

// ---------- RBAC ----------
export interface Permission {
  id: string
  module: string
  action: string
  name: string
  key: string // module:action
}

export interface Role {
  id: string
  clinic_id: string
  name: string
  slug: RoleSlug
  is_system: boolean
  color: string
  max_discount_percent: number | null
  permissions: string[] // ['patients:view', 'schedule:create', ...]
}

export type RoleSlug =
  | 'owner' | 'admin' | 'doctor'
  | 'nurse' | 'laborant' | 'cashier' | 'manager'

export interface UserProfile {
  id: string
  clinic_id: string
  role_id: string
  role: Role
  first_name: string
  last_name: string
  middle_name?: string
  phone?: string
  avatar_url?: string
  is_active: boolean
  extra_permissions: string[]
  denied_permissions: string[]
  last_login?: string
  created_at: string
  full_name: string // computed
}

// ---------- ПАЦИЕНТ ----------
export type PatientStatus =
  | 'new' | 'active' | 'in_treatment'
  | 'completed' | 'lost' | 'vip'

export interface Patient {
  id: string
  clinic_id: string
  full_name: string
  phones: string[]
  iin?: string
  gender: 'male' | 'female' | 'other'
  birth_date?: string
  city?: string
  email?: string
  patient_number: string
  status: PatientStatus
  tags: string[]
  balance_amount: number
  debt_amount: number
  is_vip: boolean
  notes?: string
  manager_id?: string
  doctor_id?: string
  created_at: string
}

// ---------- DEAL / CRM ----------
export type DealFunnel = 'leads' | 'medical'
export type LeadStage = 'new' | 'in_progress' | 'contact' | 'booked'
export type MedicalStage =
  | 'booked' | 'confirmed' | 'arrived'
  | 'in_visit' | 'completed' | 'follow_up' | 'repeat'

export interface Deal {
  id: string
  clinic_id: string
  patient_id: string
  patient?: Patient
  funnel: DealFunnel
  stage: LeadStage | MedicalStage
  source?: string
  priority: 'hot' | 'warm' | 'cold'
  status: 'open' | 'won' | 'lost'
  lost_reason?: string
  first_owner_id?: string
  closer_id?: string
  time_to_response_s?: number
  time_to_booking_s?: number
  created_at: string
  updated_at: string
}

// ---------- APPOINTMENT ----------
export type AppointmentStatus =
  | 'pending' | 'confirmed' | 'arrived'
  | 'rescheduled' | 'cancelled' | 'no_show' | 'completed'

export interface Appointment {
  id: string
  clinic_id: string
  patient_id: string
  patient?: Patient
  doctor_id: string
  doctor?: Doctor
  service_id?: string
  service?: Service
  deal_id?: string
  date: string
  time_start: string
  time_end: string
  duration_min: number
  status: AppointmentStatus
  arrived_at?: string
  is_walkin: boolean
  source: 'admin' | 'online' | 'whatsapp' | 'phone'
  notes?: string
  created_at: string
}

// ---------- VISIT ----------
export type VisitStatus = 'open' | 'in_progress' | 'completed' | 'partial'

export interface Visit {
  id: string
  clinic_id: string
  appointment_id?: string
  appointment?: Appointment
  patient_id: string
  patient?: Patient
  doctor_id: string
  doctor?: Doctor
  status: VisitStatus
  started_at?: string
  completed_at?: string
  has_charges: boolean
  finance_settled: boolean
  notes?: string
  created_at: string
}

// ---------- DOCTOR ----------
export interface Doctor {
  id: string
  clinic_id: string
  user_id: string
  first_name: string
  last_name: string
  middle_name?: string
  specialization_id?: string
  specialization?: { name: string }
  photo_url?: string
  phone?: string
  color: string
  working_hours: WorkingHours
  consultation_duration: number
  is_active: boolean
}

export type WorkingHours = {
  [day in 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun']?: { from: string; to: string }[]
}

// ---------- SERVICE ----------
export interface Service {
  id: string
  clinic_id: string
  category_id?: string
  name: string
  code?: string
  price: number
  duration_min: number
  is_active: boolean
}

// ---------- МЕДКАРТА ----------
export interface MedicalRecord {
  id: string
  visit_id: string
  patient_id: string
  doctor_id: string
  template?: string
  complaints?: string
  anamnesis?: string
  objective?: string
  vitals: Vitals
  icd10_code?: string
  icd10_secondary: string[]
  diagnosis_text?: string
  diagnosis_type: 'preliminary' | 'final'
  prescriptions: Prescription[]
  recommendations?: string
  treatment_plan?: string
  control_date?: string
  is_signed: boolean
  signed_at?: string
  prescription_number?: string
}

export interface Vitals {
  temperature?: number
  pulse?: number
  bp_systolic?: number
  bp_diastolic?: number
  spo2?: number
  weight?: number
  height?: number
  glucose?: number
}

export interface Prescription {
  drug_name: string
  dosage: string
  form?: string
  frequency: string
  duration?: string
  route?: string
  instructions?: string
}

// ---------- ФИНАНСЫ ----------
export type PaymentMethod = 'cash' | 'kaspi' | 'halyk' | 'credit' | 'balance'
export type PaymentType = 'payment' | 'prepayment' | 'refund' | 'writeoff'

export interface Charge {
  id: string
  visit_id?: string
  patient_id: string
  service_id?: string
  name: string
  quantity: number
  unit_price: number
  discount: number
  total: number
  status: 'pending' | 'pending_approval' | 'paid' | 'partial' | 'cancelled'
  procedure_status: 'pending' | 'in_progress' | 'done'
}

export interface Payment {
  id: string
  charge_id?: string
  patient_id: string
  amount: number
  method: PaymentMethod
  type: PaymentType
  refund_reason?: string
  status: 'pending_confirmation' | 'completed' | 'failed'
  paid_at: string
}

// ---------- ЗАДАЧИ ----------
export type TaskStatus = 'new' | 'in_progress' | 'done' | 'overdue' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task {
  id: string
  clinic_id: string
  title: string
  description?: string
  type?: string
  priority: TaskPriority
  status: TaskStatus
  assigned_to?: string
  patient_id?: string
  deal_id?: string
  visit_id?: string
  due_at?: string
  done_at?: string
  created_at: string
}

// ---------- ЛАБОРАТОРИЯ ----------
export type LabOrderStatus =
  | 'ordered' | 'agreed' | 'paid' | 'sample_taken'
  | 'in_progress' | 'rejected' | 'ready' | 'verified' | 'delivered'

export type ResultFlag = 'normal' | 'low' | 'high' | 'critical'

export interface LabResult {
  parameter: string
  value: string | number
  unit: string
  ref_min?: number
  ref_max?: number
  flag: ResultFlag
}
