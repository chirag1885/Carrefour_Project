-- Phase 6: keep at most 90 days of price history (older chunks are dropped automatically)
SELECT add_retention_policy('price_history', INTERVAL '90 days', if_not_exists => true);
SELECT add_retention_policy('price_daily', INTERVAL '90 days', if_not_exists => true);
