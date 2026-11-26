-- usage: -v product_id=1
WITH ev AS (SELECT max(recorded_at) AS t FROM price_history WHERE product_id = :product_id)
SELECT count(*) AS notifications,
       round(extract(epoch FROM percentile_cont(0.50) WITHIN GROUP (ORDER BY n.created_at - ev.t))::numeric, 2) AS p50_seconds,
       round(extract(epoch FROM percentile_cont(0.95) WITHIN GROUP (ORDER BY n.created_at - ev.t))::numeric, 2) AS p95_seconds,
       round(extract(epoch FROM max(n.created_at - ev.t))::numeric, 2) AS max_seconds
  FROM notifications n, ev
 WHERE n.product_id = :product_id AND n.created_at >= ev.t;