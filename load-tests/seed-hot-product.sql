-- usage: -v n=20000 -v product_id=1
WITH new_users AS (
  INSERT INTO users (email, password_hash, full_name)
  SELECT 'load' || g || '@load.test',
         (SELECT password_hash FROM users WHERE email = 'demo@carrefour.test'),
         'Load User ' || g
    FROM generate_series(1, :n) g
  ON CONFLICT (email) DO NOTHING
  RETURNING id
), prefs AS (
  INSERT INTO user_preferences (user_id) SELECT id FROM new_users RETURNING user_id
), lists AS (
  INSERT INTO wishlists (user_id, name, is_default) SELECT id, 'My Wishlist', true FROM new_users RETURNING id, user_id
)
INSERT INTO wishlist_items (wishlist_id, user_id, product_id, added_price)
SELECT l.id, l.user_id, :product_id, p.current_price
  FROM lists l CROSS JOIN (SELECT current_price FROM products WHERE id = :product_id) p;