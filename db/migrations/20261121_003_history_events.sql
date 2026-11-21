CREATE TABLE price_history (
    product_id BIGINT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'AED',
    source TEXT NOT NULL DEFAULT 'simulator',
    event_id UUID NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('price_history', 'recorded_at', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_price_hist_product_time ON price_history (product_id, recorded_at DESC);

ALTER TABLE price_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'product_id'
);
SELECT add_compression_policy('price_history', INTERVAL '30 days');

CREATE MATERIALIZED VIEW price_daily
WITH (timescaledb.continuous) AS
SELECT
    product_id,
    time_bucket('1 day', recorded_at) AS day,
    min(price) AS min_price,
    max(price) AS max_price,
    avg(price) AS avg_price,
    last(price, recorded_at) AS close_price
FROM price_history
GROUP BY product_id, day
WITH NO DATA;
SELECT add_continuous_aggregate_policy(
    'price_daily',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes'
);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL,
    key TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
    consumer TEXT NOT NULL,
    event_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

CREATE TABLE analytics_events (
    id BIGSERIAL,
    event_type TEXT NOT NULL,
    user_id UUID,
    product_id BIGINT,
    notification_id UUID,
    amount NUMERIC(10, 2),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('analytics_events', 'occurred_at');
