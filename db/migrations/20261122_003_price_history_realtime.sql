-- Turn on real-time aggregation for price_daily so the current partial day and the last hour
-- are always visible without waiting for the 15-minute scheduled refresh.
-- This cannot run inside a BEGIN/COMMIT block on some Timescale versions.
-- If migrate.sh wraps files in transactions, extract this into a startup hook.
ALTER MATERIALIZED VIEW price_daily
  SET (timescaledb.materialized_only = false);
