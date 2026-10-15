-- Run once when the DEMO becomes the PILOT, after the new MFA key is set:
--   npx wrangler d1 execute smart-ltc-security-demo --remote --file apps/gateway/pilot-reset.sql
-- Ends every DEMO session and removes TOTP secrets encrypted with the old key; each user sets up
-- their authenticator again at first sign-in. Security events are kept for the record.
DELETE FROM sessions;
DELETE FROM user_security;
INSERT INTO security_events (event_id, actor_id, event_type, reason, created_at)
VALUES (lower(hex(randomblob(16))), 'operator', 'PILOT_CUTOVER', 'DEMO sessions and TOTP removed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
