-- Club social feed: public updates (announcements, banner reveals, news)
-- posted by club accounts, followed students see them in a social timeline.

CREATE TABLE IF NOT EXISTS club_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  kind VARCHAR NOT NULL DEFAULT 'announcement' CHECK (kind IN ('announcement','banner','news')),
  body TEXT NOT NULL DEFAULT '',
  image_url VARCHAR,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_club_posts_feed ON club_posts(club_id, created_at DESC);

CREATE TABLE IF NOT EXISTS club_post_likes (
  post_id UUID NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
