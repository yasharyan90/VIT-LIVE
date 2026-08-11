-- Feature drop 2: announcement images + reactions + scheduled publishing,
-- academic calendar, mess menus, lost&found reports and full-text matching.

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url VARCHAR;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS broadcast_at TIMESTAMPTZ;
UPDATE announcements SET broadcast_at = created_at WHERE broadcast_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ann_scheduled ON announcements(publish_at) WHERE broadcast_at IS NULL;

CREATE TABLE IF NOT EXISTS announcement_reactions (
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS academic_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  kind VARCHAR NOT NULL DEFAULT 'other' CHECK (kind IN ('exam','holiday','deadline','other')),
  starts_on DATE NOT NULL,
  ends_on DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academic_start ON academic_events(starts_on);

CREATE TABLE IF NOT EXISTS mess_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_date DATE NOT NULL,
  meal VARCHAR NOT NULL CHECK (meal IN ('breakfast','lunch','snacks','dinner')),
  items TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (menu_date, meal)
);

CREATE TABLE IF NOT EXISTS lostfound_reports (
  item_id UUID NOT NULL REFERENCES lost_found_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

-- Keyword matching between lost and found posts.
CREATE INDEX IF NOT EXISTS idx_lf_fts ON lost_found_items
  USING GIN (to_tsvector('simple', title || ' ' || description));
