CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_email VARCHAR UNIQUE NOT NULL,
  full_name VARCHAR NOT NULL DEFAULT '',
  role VARCHAR NOT NULL DEFAULT 'student'
    CHECK (role IN ('student','club_admin','dept_admin','super_admin','moderator')),
  department_id UUID REFERENCES departments(id),
  year_of_study INT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email VARCHAR NOT NULL,
  otp_hash VARCHAR NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(user_email);

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token VARCHAR NOT NULL UNIQUE,
  platform VARCHAR NOT NULL DEFAULT 'unknown',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  admin_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  body TEXT NOT NULL,
  priority VARCHAR NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  audience_type VARCHAR NOT NULL DEFAULT 'all'
    CHECK (audience_type IN ('all','department','club','year')),
  audience_ref VARCHAR,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ann_feed ON announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ann_audience ON announcements(audience_type, audience_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  triggered_by UUID NOT NULL REFERENCES users(id),
  delivered_count INT NOT NULL DEFAULT 0,
  total_target INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lost_found_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR NOT NULL CHECK (type IN ('lost','found')),
  title VARCHAR NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url VARCHAR,
  location VARCHAR NOT NULL DEFAULT '',
  posted_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lf_feed ON lost_found_items(type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  banner_url VARCHAR,
  venue VARCHAR NOT NULL DEFAULT '',
  start_time TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  club_id UUID REFERENCES clubs(id),
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_time);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR NOT NULL DEFAULT 'going',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question VARCHAR NOT NULL,
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  audience_type VARCHAR NOT NULL DEFAULT 'all',
  audience_ref VARCHAR,
  created_by UUID NOT NULL REFERENCES users(id),
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_text VARCHAR NOT NULL,
  position INT NOT NULL DEFAULT 0
);

-- Anonymity-preserving vote storage: voter_token = HMAC(poll_id+user_id, secret).
-- No FK to users; never joined against users in any query.
CREATE TABLE IF NOT EXISTS poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voter_token VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_once ON poll_votes(poll_id, option_id, voter_token);

-- Proves only "did vote", never "voted what".
CREATE TABLE IF NOT EXISTS poll_voted_users (
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action VARCHAR NOT NULL,
  target VARCHAR NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
