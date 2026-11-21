CREATE TABLE wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);
CREATE UNIQUE INDEX one_default_wishlist ON wishlists (user_id) WHERE is_default;

CREATE TABLE wishlist_items (
    id BIGSERIAL PRIMARY KEY,
    wishlist_id UUID NOT NULL REFERENCES wishlists (id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    product_id BIGINT NOT NULL REFERENCES products (id),
    target_price NUMERIC(10, 2),
    notify_on_drop BOOLEAN NOT NULL DEFAULT true,
    notify_on_restock BOOLEAN NOT NULL DEFAULT true,
    notify_on_low_stock BOOLEAN NOT NULL DEFAULT false,
    low_stock_threshold INT NOT NULL DEFAULT 5,
    store_id INT REFERENCES stores (id),
    added_price NUMERIC(10, 2) NOT NULL,
    last_notified_price NUMERIC(10, 2),
    last_notified_at TIMESTAMPTZ,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (wishlist_id, product_id)
);
CREATE INDEX idx_wi_product ON wishlist_items (product_id, id);
CREATE INDEX idx_wi_user ON wishlist_items (user_id, added_at DESC);

CREATE TABLE wishlist_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wishlist_id UUID NOT NULL REFERENCES wishlists (id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    permission TEXT NOT NULL DEFAULT 'view',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wishlist_item_claims (
    item_id BIGINT PRIMARY KEY REFERENCES wishlist_items (id) ON DELETE CASCADE,
    claimed_by TEXT NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    product_id BIGINT REFERENCES products (id),
    payload JSONB NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    deliver_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ
);
CREATE INDEX idx_notif_user_time ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX idx_notif_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notif_deferred ON notifications (deliver_after) WHERE status = 'deferred';

CREATE TABLE notification_deliveries (
    id BIGSERIAL PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    UNIQUE (notification_id, channel)
);

CREATE TABLE carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_cart ON carts (user_id) WHERE status = 'active';

CREATE TABLE cart_items (
    cart_id UUID NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products (id),
    qty INT NOT NULL DEFAULT 1 CHECK (qty > 0),
    price_at_add NUMERIC(10, 2) NOT NULL,
    source TEXT NOT NULL DEFAULT 'direct',
    source_notification_id UUID,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE offers (
    id SERIAL PRIMARY KEY,
    product_id BIGINT REFERENCES products (id),
    category TEXT,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    value NUMERIC(6, 2) NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ NOT NULL
);

CREATE TABLE product_similarity (
    product_id BIGINT NOT NULL REFERENCES products (id),
    similar_product_id BIGINT NOT NULL REFERENCES products (id),
    score REAL NOT NULL,
    rank SMALLINT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, rank)
);
