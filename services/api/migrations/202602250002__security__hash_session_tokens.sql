-- up migration
-- F-05: Hash existing session tokens in place.
-- After this migration, all session_token values are SHA-256 hex strings.
-- Any active sessions using plaintext tokens will be invalidated (staff must re-login).
UPDATE staff_sessions
SET session_token = encode(sha256(session_token::bytea), 'hex')
WHERE length(session_token) <> 64;  -- Skip already-hashed tokens (64 hex chars = 32 bytes)

-- down migration
-- Cannot reverse: original tokens are not recoverable after hashing.
-- If rollback is needed, revoke all sessions instead:
-- UPDATE staff_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;
