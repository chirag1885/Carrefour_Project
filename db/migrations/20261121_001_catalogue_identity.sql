CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    click_and_collect BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'en',
    timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
    home_store_id INT REFERENCES stores (id),
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    channel_in_app BOOLEAN NOT NULL DEFAULT true,
    channel_email BOOLEAN NOT NULL DEFAULT true,
    channel_push BOOLEAN NOT NULL DEFAULT false,
    channel_whatsapp BOOLEAN NOT NULL DEFAULT false,
    delivery_mode TEXT NOT NULL DEFAULT 'instant',
    digest_hour_local SMALLINT NOT NULL DEFAULT 9,
    quiet_start TIME,
    quiet_end TIME,
    min_drop_percent NUMERIC(5, 2) NOT NULL DEFAULT 2.0,
    max_alerts_per_day SMALLINT NOT NULL DEFAULT 5,
    push_subscription JSONB,
    whatsapp_number TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name_en TEXT NOT NULL,
    name_ar TEXT,
    description_en TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    brand TEXT,
    image_url TEXT,
    attributes JSONB NOT NULL DEFAULT '{}',
    current_price NUMERIC(10, 2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'AED',
    list_price NUMERIC(10, 2),
    total_stock INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    embedding VECTOR(384),
    rating NUMERIC(2, 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT,
    external_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
);

CREATE INDEX idx_products_category_price ON products (category, current_price);
CREATE INDEX idx_products_name_trgm ON products USING gin (name_en gin_trgm_ops);
CREATE INDEX idx_products_embedding ON products USING hnsw (embedding vector_cosine_ops);

CREATE TABLE inventory (
    product_id BIGINT NOT NULL REFERENCES products (id),
    store_id INT NOT NULL REFERENCES stores (id),
    qty INT NOT NULL CHECK (qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, store_id)
);
CREATE INDEX idx_inventory_store ON inventory (store_id, product_id);
