export type Role = 'OWNER' | 'MANAGER' | 'STAFF' | 'CLIENT'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  phone?: string
  avatar_url?: string
  created_at: string
}

export interface Client {
  id: string
  profile_id: string
  client_since: string
  total_hours: number
  loyalty_tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'
  loyalty_points: number
  notes?: string
  profile?: Profile
}

export interface Session {
  id: string
  client_id: string
  staff_id?: string
  title: string
  started_at: string
  ended_at?: string
  duration_minutes?: number
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  notes?: string
  client?: Client
  staff?: Profile
}

export interface Project {
  id: string
  client_id: string
  name: string
  description?: string
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
  created_at: string
  client?: Client
}

export interface StudioFile {
  id: string
  project_id?: string
  session_id?: string
  client_id: string
  name: string
  file_type: 'RECORDING' | 'MIX' | 'MASTER' | 'OTHER'
  yandex_disk_url?: string
  internal_url?: string
  yandex_expires_at?: string
  size_mb?: number
  duration_seconds?: number
  created_at: string
  uploaded_by: string
}

export interface Offer {
  id: string
  client_id: string
  created_by: string
  title: string
  description: string
  price?: number
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
  expires_at?: string
  created_at: string
  creator?: Profile
}

export interface ScheduleEntry {
  id: string
  staff_id: string
  session_id?: string
  title: string
  date: string
  start_time: string
  end_time: string
  notes?: string
  session?: Session
}

export interface FinancialRecord {
  id: string
  client_id?: string
  record_type: 'INVOICE' | 'ACT' | 'PAYMENT'
  amount: number
  description?: string
  document_url?: string
  date: string
  created_by: string
  client?: Client
}
