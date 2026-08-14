// Entity types — mirrors docs/API_CONTRACT.md exactly. Field names matter.

export interface User {
  id: string
  college_email: string
  full_name: string
  role: 'student' | 'club_admin' | 'dept_admin' | 'super_admin' | 'moderator'
  department_id: string | null
  department_code: string | null
  department_name: string | null
  year_of_study: number
  is_verified: boolean
  created_at: string
  avatar_url: string | null
  bio: string
  phone: string
  residence_type: 'hosteller' | 'day_scholar' | null
  hostel_block: string
  room_number: string
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
  reaction_count?: number
  my_reaction?: boolean
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
  status: 'open' | 'resolved'
  posted_by: string
  poster_name: string
  poster_email: string
  created_at: string
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

export interface Department {
  id: string
  name: string
  code: string
}

export interface ClubPost {
  id: string
  club_id: string
  club_name: string
  kind: 'announcement' | 'banner' | 'news'
  body: string
  image_url: string | null
  author_name: string
  created_at: string
  like_count: number
  my_like: boolean
  comment_count: number
}

export interface ClubPostComment {
  id: string
  post_id: string
  user_id: string
  user_name: string
  avatar_url: string | null
  body: string
  created_at: string
}

export interface ChatMessage {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
  read_at: string | null
  sender_name?: string
}

export interface ChatPerson {
  id: string
  full_name: string
  college_email: string
  avatar_url: string | null
  bio?: string
}

export interface Conversation {
  partner_id: string
  full_name: string
  college_email: string
  avatar_url: string | null
  last_body: string
  last_at: string
  last_from_me: boolean
  unread: number
  i_blocked: boolean
}

export interface AcademicEvent {
  id: string
  title: string
  kind: 'exam' | 'holiday' | 'deadline' | 'other'
  starts_on: string // YYYY-MM-DD
  ends_on: string | null
  created_at: string
}

export interface MessMenu {
  menu_date: string
  meal: 'breakfast' | 'lunch' | 'snacks' | 'dinner'
  items: string
  updated_at: string
}
