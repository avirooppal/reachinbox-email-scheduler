CREATE OR REPLACE FUNCTION prevent_email_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'email_events table is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_events_immutable ON email_events;
CREATE TRIGGER trg_email_events_immutable
BEFORE UPDATE OR DELETE ON email_events
FOR EACH ROW EXECUTE FUNCTION prevent_email_events_modification();
