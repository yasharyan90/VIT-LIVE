-- Editable student profiles: avatar, bio, contact, residence (hosteller with
-- block/room, or day scholar). These fields also become the identity card for
-- the future student-to-student chat.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS residence_type VARCHAR
  CHECK (residence_type IN ('hosteller','day_scholar'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS hostel_block VARCHAR NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS room_number VARCHAR NOT NULL DEFAULT '';
