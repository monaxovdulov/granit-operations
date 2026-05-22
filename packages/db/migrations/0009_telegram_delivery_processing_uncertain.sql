ALTER TABLE message_deliveries
  DROP CONSTRAINT IF EXISTS message_deliveries_status_check;

ALTER TABLE message_deliveries
  ADD CONSTRAINT message_deliveries_status_check
  CHECK (
    status IN (
      'pending',
      'processing',
      'sent',
      'failed',
      'retrying',
      'blocked_no_destination',
      'blocked',
      'uncertain'
    )
  );
