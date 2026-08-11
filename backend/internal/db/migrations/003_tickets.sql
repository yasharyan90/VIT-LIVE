-- Paid events + QR tickets.

ALTER TABLE events ADD COLUMN IF NOT EXISTS price_cents INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The QR encodes this opaque secret; never guessable, unique per ticket.
  code VARCHAR NOT NULL UNIQUE,
  amount_cents INT NOT NULL DEFAULT 0,
  order_id VARCHAR,
  payment_id VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','checked_in')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
