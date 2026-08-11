export type Role = 'student' | 'club_admin' | 'dept_admin' | 'super_admin' | 'moderator'

export interface User {
  id: string
  college_email: string
  full_name: string
  role: Role
  department_id: string | null
  department_code: string | null
  department_name: string | null
  year_of_study: number
  is_verified: boolean
  created_at: string
  followed_club_ids?: string[]
}

export interface Announcement {
  id: string
  title: string
  body: string
  priority: 'normal' | 'high'
  image_url?: string | null
  audience_type: 'all' | 'department' | 'club' | 'year'
  audience_ref: string | null
  author_name: string
  created_at: string
  publish_at?: string
  scheduled?: boolean
  reaction_count?: number
  delivered_count?: number
}

export interface EmergencyAlert {
  id: string
  message: string
  triggered_by_name: string
  delivered_count: number
  total_target: number
  created_at: string
}

export interface LostFoundItem {
  id: string
  type: 'lost' | 'found'
  title: string
  description: string
  image_url: string | null
  location: string
  status: 'open' | 'resolved' | 'removed'
  posted_by: string
  poster_name: string
  poster_email: string
  created_at: string
  report_count?: number
}

export interface AppEvent {
  id: string
  title: string
  description: string
  banner_url: string | null
  venue: string
  start_time: string
  club_id: string | null
  club_name: string | null
  price_cents: number
  my_ticket_status: 'paid' | 'checked_in' | null
  rsvp_count: number
  my_rsvp: boolean
  created_at: string
}

export interface Attendee {
  full_name: string
  college_email: string
  status: 'rsvp' | 'paid' | 'checked_in'
  checked_in_at: string | null
}

export interface AttendeeList {
  event_title: string
  total: number
  paid: number
  checked_in: number
  items: Attendee[]
}

export interface Ticket {
  id: string
  event_id: string
  code: string
  amount_cents: number
  status: 'pending' | 'paid' | 'checked_in'
  created_at: string
  checked_in_at: string | null
  event_title: string
  venue: string
  start_time: string
  attendee_name: string
}

export interface PollOption {
  id: string
  option_text: string
  votes: number
}

export interface Poll {
  id: string
  question: string
  allow_multiple: boolean
  closes_at: string | null
  created_at: string
  total_votes: number
  has_voted: boolean
  is_closed: boolean
  options: PollOption[]
}

export interface Club {
  id: string
  name: string
  description: string
  member_count: number
  is_following: boolean
}

export interface AuditLog {
  id: string
  actor_name: string
  action: string
  target: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface Department {
  id: string
  name: string
  code: string
}

export interface AdminStats {
  total_users: number
  verified_users: number
  online_now: number
  announcements_today: number
  active_polls: number
  open_lostfound: number
  upcoming_events: number
}

export interface AcademicEvent {
  id: string
  title: string
  kind: 'exam' | 'holiday' | 'deadline' | 'other'
  starts_on: string
  ends_on: string | null
  created_at: string
}

export interface MessMenu {
  menu_date: string
  meal: 'breakfast' | 'lunch' | 'snacks' | 'dinner'
  items: string
  updated_at: string
}

export interface Analytics {
  signups_by_day: { day: string; count: number }[]
  announcement_reach: { id: string; title: string; delivered: number; target: number }[]
  poll_participation: { id: string; question: string; voters: number; eligible: number }[]
  popular_events: { id: string; title: string; rsvp_count: number }[]
}

export interface DeliveryUpdate {
  kind: 'emergency' | 'announcement'
  ref_id: string
  delivered: number
  total: number
}

export interface WSEnvelope {
  type: string
  topic: string
  payload: unknown
  ts: string
  id: string
}
