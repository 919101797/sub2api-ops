CREATE SCHEMA IF NOT EXISTS sub2api_ops AUTHORIZATION sub2api_ops_writer;

CREATE TABLE IF NOT EXISTS sub2api_ops.prompt_records (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(128) NOT NULL UNIQUE,
  endpoint VARCHAR(128) NOT NULL DEFAULT '/v1/responses',
  user_id BIGINT,
  user_email VARCHAR(255) NOT NULL DEFAULT '',
  api_key_id BIGINT,
  api_key_name VARCHAR(100) NOT NULL DEFAULT '',
  group_id BIGINT,
  group_name VARCHAR(255) NOT NULL DEFAULT '',
  model VARCHAR(255) NOT NULL DEFAULT '',
  prompt_text TEXT NOT NULL,
  prompt_hash CHAR(64) NOT NULL,
  char_count INTEGER NOT NULL,
  redacted BOOLEAN NOT NULL DEFAULT FALSE,
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  review_required BOOLEAN NOT NULL DEFAULT TRUE,
  capture_kind VARCHAR(32) NOT NULL DEFAULT 'user' CHECK (capture_kind IN ('user', 'assistant', 'developer', 'function_call', 'function_call_output', 'tool', 'other')),
  session_fingerprint CHAR(64) NOT NULL DEFAULT '',
  session_source VARCHAR(32) NOT NULL DEFAULT '' CHECK (session_source IN ('', 'header_session', 'header_conversation', 'body_prompt_cache')),
  risk_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (risk_status IN ('pending', 'clear', 'flagged', 'error', 'not_required')),
  risk_category VARCHAR(64) NOT NULL DEFAULT '',
  risk_score DECIMAL(8, 6),
  moderation_action VARCHAR(32) NOT NULL DEFAULT '',
  moderation_error TEXT NOT NULL DEFAULT '',
  matched_keyword VARCHAR(255) NOT NULL DEFAULT '',
  auto_banned BOOLEAN NOT NULL DEFAULT FALSE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enriched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

-- These statements also upgrade the first version of prompt_records, where
-- the full-input and session columns did not exist yet.
ALTER TABLE sub2api_ops.prompt_records
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS capture_kind VARCHAR(32) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS session_fingerprint CHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS session_source VARCHAR(32) NOT NULL DEFAULT '';

ALTER TABLE sub2api_ops.prompt_records
  DROP CONSTRAINT IF EXISTS prompt_records_risk_status_check,
  ADD CONSTRAINT prompt_records_risk_status_check
    CHECK (risk_status IN ('pending', 'clear', 'flagged', 'error', 'not_required'));

ALTER TABLE sub2api_ops.prompt_records
  DROP CONSTRAINT IF EXISTS prompt_records_capture_kind_check,
  ADD CONSTRAINT prompt_records_capture_kind_check
    CHECK (capture_kind IN ('user', 'assistant', 'developer', 'function_call', 'function_call_output', 'tool', 'other'));

ALTER TABLE sub2api_ops.prompt_records
  DROP CONSTRAINT IF EXISTS prompt_records_session_source_check,
  ADD CONSTRAINT prompt_records_session_source_check
    CHECK (session_source IN ('', 'header_session', 'header_conversation', 'body_prompt_cache'));

CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_captured_at ON sub2api_ops.prompt_records(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_risk_captured ON sub2api_ops.prompt_records(risk_status, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_review_captured ON sub2api_ops.prompt_records(review_required, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_expires_at ON sub2api_ops.prompt_records(expires_at);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_user_captured ON sub2api_ops.prompt_records(user_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_group_captured ON sub2api_ops.prompt_records(group_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_moderation_request ON sub2api_ops.prompt_records(
  (CASE WHEN endpoint = '/v1/responses#websocket' THEN SPLIT_PART(request_id, '.ws.', 1) ELSE request_id END),
  captured_at DESC
);
CREATE INDEX IF NOT EXISTS idx_ops_prompt_records_session_captured ON sub2api_ops.prompt_records(session_fingerprint, captured_at) WHERE session_fingerprint <> '';

CREATE TABLE IF NOT EXISTS sub2api_ops.prompt_media (
  id BIGSERIAL PRIMARY KEY,
  prompt_record_id BIGINT NOT NULL REFERENCES sub2api_ops.prompt_records(id) ON DELETE CASCADE,
  mime_type VARCHAR(32) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 CHAR(64) NOT NULL,
  relative_path VARCHAR(512) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prompt_record_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_ops_prompt_media_record ON sub2api_ops.prompt_media(prompt_record_id);

CREATE TABLE IF NOT EXISTS sub2api_ops.prompt_audit_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  purge_before TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sub2api_ops.prompt_audit_control (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION sub2api_ops.resolve_api_key(candidate TEXT)
RETURNS TABLE (
  user_id BIGINT,
  user_email VARCHAR,
  api_key_id BIGINT,
  api_key_name VARCHAR,
  group_id BIGINT,
  group_name VARCHAR
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    users.id,
    users.email,
    api_keys.id,
    api_keys.name,
    COALESCE(api_keys.group_id, subscription.group_id),
    COALESCE(api_key_group.name, subscription.group_name, '')
  FROM public.api_keys
  JOIN public.users ON users.id = api_keys.user_id
  LEFT JOIN public.groups api_key_group ON api_key_group.id = api_keys.group_id
  LEFT JOIN LATERAL (
    SELECT user_subscriptions.group_id, groups.name AS group_name
    FROM public.user_subscriptions
    JOIN public.groups ON groups.id = user_subscriptions.group_id
    WHERE user_subscriptions.user_id = api_keys.user_id
      AND user_subscriptions.status = 'active'
      AND user_subscriptions.deleted_at IS NULL
      AND user_subscriptions.expires_at > NOW()
    ORDER BY user_subscriptions.assigned_at DESC, user_subscriptions.id DESC
    LIMIT 1
  ) subscription ON api_keys.group_id IS NULL
  WHERE api_keys.key = candidate
    AND api_keys.status = 'active'
    AND api_keys.deleted_at IS NULL
    AND users.status = 'active'
    AND users.deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION sub2api_ops.resolve_user_status(candidate BIGINT)
RETURNS VARCHAR
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT users.status
  FROM public.users
  WHERE users.id = candidate
    AND users.deleted_at IS NULL
  LIMIT 1
$$;

ALTER TABLE sub2api_ops.prompt_records OWNER TO sub2api_ops_writer;
ALTER TABLE sub2api_ops.prompt_media OWNER TO sub2api_ops_writer;
ALTER TABLE sub2api_ops.prompt_audit_control OWNER TO sub2api_ops_writer;
GRANT USAGE ON SCHEMA sub2api_ops TO sub2api_ops_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON sub2api_ops.prompt_records TO sub2api_ops_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON sub2api_ops.prompt_media TO sub2api_ops_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON sub2api_ops.prompt_audit_control TO sub2api_ops_writer;
GRANT USAGE, SELECT ON SEQUENCE sub2api_ops.prompt_records_id_seq TO sub2api_ops_writer;
GRANT USAGE, SELECT ON SEQUENCE sub2api_ops.prompt_media_id_seq TO sub2api_ops_writer;
GRANT SELECT ON public.content_moderation_logs TO sub2api_ops_writer;
REVOKE ALL ON FUNCTION sub2api_ops.resolve_api_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sub2api_ops.resolve_api_key(TEXT) TO sub2api_ops_writer;
REVOKE ALL ON FUNCTION sub2api_ops.resolve_user_status(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sub2api_ops.resolve_user_status(BIGINT) TO sub2api_ops_writer;
