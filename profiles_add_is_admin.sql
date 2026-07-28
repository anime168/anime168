-- Run this against your anime-app-schema.sql database.
-- Lets the create-video-upload Edge Function check who is allowed
-- to upload episodes (content team), instead of every signed-in user.

alter table profiles
  add column if not exists is_admin boolean default false;

-- After running this, manually flip your own account to true, e.g.:
-- update profiles set is_admin = true where id = '<your-user-uuid>';
