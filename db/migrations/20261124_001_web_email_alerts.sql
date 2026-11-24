CREATE TABLE alert_consumed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_deliveries
ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX idx_delivery_due
ON notification_deliveries (next_attempt_at, id)
WHERE status = 'pending';

CREATE INDEX idx_notification_quota
ON notifications (user_id, deliver_after);
