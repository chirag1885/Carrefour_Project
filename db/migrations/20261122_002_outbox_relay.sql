CREATE SEQUENCE IF NOT EXISTS outbox_publish_order_seq AS BIGINT;

ALTER TABLE outbox_events
ADD COLUMN IF NOT EXISTS publish_order BIGINT,
ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

ALTER SEQUENCE outbox_publish_order_seq OWNED BY outbox_events.publish_order;

-- The ALTER TABLE lock prevents concurrent inserts during the legacy backfill.
WITH legacy AS (
    SELECT
        id,
        row_number() OVER (ORDER BY created_at, id) AS ordinal
    FROM outbox_events
    WHERE publish_order IS NULL
),

previous AS (
    SELECT coalesce(max(publish_order), 0) AS highest
    FROM outbox_events
)

UPDATE outbox_events AS o
SET publish_order = previous.highest + legacy.ordinal
FROM legacy CROSS JOIN previous
WHERE o.id = legacy.id;

SELECT setval(
    'outbox_publish_order_seq',
    greatest(
        (SELECT coalesce(max(publish_order), 0) + 1 FROM outbox_events),
        (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM outbox_publish_order_seq)
    ),
    false
);

ALTER TABLE outbox_events
ALTER COLUMN publish_order SET DEFAULT nextval('outbox_publish_order_seq'),
ALTER COLUMN publish_order SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_publish_order
ON outbox_events (publish_order);

CREATE INDEX IF NOT EXISTS idx_outbox_relay_pending
ON outbox_events (publish_order)
WHERE published_at IS NULL AND failed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_relay_quarantine
ON outbox_events (topic, key, publish_order)
WHERE failed_at IS NOT NULL;
