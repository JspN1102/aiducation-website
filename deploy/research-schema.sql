-- Explicit administrative migration; never executed by an HTTP handler.
BEGIN;
CREATE TABLE IF NOT EXISTS research_events (
  id bigserial PRIMARY KEY,
  research_id varchar(82) NOT NULL,
  event_id uuid NOT NULL,
  source varchar(24) NOT NULL CHECK (source IN ('client','server_verified')),
  session_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq BETWEEN 0 AND 10000000),
  received_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 6),
  cls char(1) NOT NULL CHECK (cls ~ '^[A-Z]$'),
  poem_id smallint CHECK (poem_id BETWEEN 1 AND 6),
  activity varchar(24) NOT NULL,
  event_checksum char(64) NOT NULL CHECK (event_checksum ~ '^[a-f0-9]{64}$'),
  record jsonb NOT NULL CHECK (record->>'schemaVersion' = '1'),
  UNIQUE(research_id,event_id,source)
);
CREATE INDEX IF NOT EXISTS research_events_cohort_date ON research_events(grade,cls,received_at);
CREATE INDEX IF NOT EXISTS research_events_received ON research_events(received_at,id);
CREATE INDEX IF NOT EXISTS research_events_student_session ON research_events(research_id,session_id,seq);
CREATE TABLE IF NOT EXISTS research_sync_state (
  key varchar(160) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS research_outbox_receipts (
  pathname varchar(512) PRIMARY KEY,
  checksum char(64) NOT NULL,
  event_count integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION research_deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'research_events is append only' USING ERRCODE = '55000'; END;
$$;
DROP TRIGGER IF EXISTS research_append_only ON research_events;
CREATE TRIGGER research_append_only BEFORE UPDATE OR DELETE ON research_events
  FOR EACH ROW EXECUTE FUNCTION research_deny_mutation();
COMMIT;
