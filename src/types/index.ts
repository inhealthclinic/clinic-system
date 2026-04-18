export type Role = {
  id: string
  clinic_id: string
  name: string
  slug: string
  is_system: boolean
  color: string
  max_discount_percent: number | null
}

export type UserProfile = {
  id: string
  clinic_id: string
  role_id: string
  first_name: string
  last_name: string
  middle_name: string | null
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  role: Role
}

export type Patient = {
  id: string
  clinic_id: string
  full_name: string
  phones: string[]
  iin: string | null
  gender: 'male' | 'female' | 'other'
  birth_date: string | null
  city: string | null
  email: string | null
  patient_number: string | null
  status: 'new' | 'active' | 'in_treatment' | 'completed' | 'lost' | 'vip'
  is_vip: boolean
  balance_amount: number
  debt_amount: number
  tags: string[]
  notes: string | null
  pregnancy_status: 'yes' | 'no' | 'unknown' | null
  pregnancy_weeks: number | null
  menopause_status: 'no' | 'peri' | 'post' | null
  lab_notes: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type Doctor = {
  id: string
  clinic_id: string
  user_id: string
  first_name: string
  last_name: string
  middle_name: string | null
  color: string
  consultation_duration: number
  is_active: boolean
  specialization?: { id: string; name: string } | null
}

export type Appointment = {
  id: string
  clinic_id: string
  patient_id: string | null
  doctor_id: string
  service_id: string | null
  date: string          // DATE  e.g. "2026-04-15"
  time_start: string    // TIME  e.g. "09:00:00"
  time_end: string      // TIME  e.g. "09:30:00"
  duration_min: number
  status: 'pending' | 'confirmed' | 'arrived' | 'rescheduled' | 'cancelled' | 'no_show' | 'completed'
  is_walkin: boolean
  source: 'admin' | 'online' | 'whatsapp' | 'phone'
  notes: string | null
  color: string | null
  appt_type: string | null
  patient?: Pick<Patient, 'id' | 'full_name' | 'phones'>
  doctor?: Pick<Doctor, 'id' | 'first_name' | 'last_name' | 'color'>
}

export type Visit = {
  id: string
  clinic_id: string
  appointment_id: string | null
  patient_id: string
  doctor_id: string
  status: 'open' | 'in_progress' | 'closed' | 'cancelled'
  opened_at: string
  closed_at: string | null
  patient?: Pick<Patient, 'id' | 'full_name'>
  doctor?: Pick<Doctor, 'id' | 'first_name' | 'last_name'>
}

export type Deal = {
  id: string
  clinic_id: string
  patient_id: string
  funnel: 'leads' | 'medical'
  stage: string
  source: string | null
  priority: 'hot' | 'warm' | 'cold'
  status: 'open' | 'won' | 'lost'
  notes: string | null
  created_at: string
  patient?: Pick<Patient, 'id' | 'full_name' | 'phones'>
}

export type Payment = {
  id: string
  clinic_id: string
  patient_id: string
  amount: number
  method: 'cash' | 'card' | 'transfer' | 'deposit'
  status: 'paid' | 'pending' | 'refunded'
  date: string
  patient?: Pick<Patient, 'id' | 'full_name'>
}

export type LabOrder = {
  id: string
  clinic_id: string
  patient_id: string
  doctor_id: string
  status: 'pending' | 'in_progress' | 'ready' | 'verified' | 'sent'
  priority: 'routine' | 'urgent' | 'stat'
  ordered_at: string
  patient?: Pick<Patient, 'id' | 'full_name'>
  doctor?: Pick<Doctor, 'id' | 'first_name' | 'last_name'>
}

export type Task = {
  id: string
  clinic_id: string
  title: string
  description: string | null
  type: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'new' | 'in_progress' | 'done' | 'overdue' | 'cancelled'
  assigned_to: string | null
  patient_id: string | null
  due_at: string | null
  created_at: string
  patient?: Pick<Patient, 'id' | 'full_name'> | null
  assignee?: Pick<UserProfile, 'id' | 'first_name' | 'last_name'> | null
}
