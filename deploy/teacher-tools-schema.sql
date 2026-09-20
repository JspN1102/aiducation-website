-- Administrative migration; the HTTP service never creates tables.
BEGIN;
CREATE TABLE IF NOT EXISTS teacher_analysis_records (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT, INSERT, UPDATE ON teacher_analysis_records TO maanshan_user;
COMMIT;
