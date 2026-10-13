-- Administrative migration (school62): what kind of question each AI 詩人 chat was.
-- New table only; research_events is not touched. The Guangzhou API also creates it
-- lazily (CREATE TABLE IF NOT EXISTS), so running this first is optional.
-- One row per chat event_id; no row means 未分類.
BEGIN;
CREATE TABLE IF NOT EXISTS chat_topics (
  event_id uuid PRIMARY KEY,
  topic varchar(16) NOT NULL,
  concern varchar(16),
  topic_model varchar(80),
  classified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT, INSERT, UPDATE ON chat_topics TO maanshan_user;
COMMIT;
