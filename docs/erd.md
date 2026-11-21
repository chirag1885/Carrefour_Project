# Database ERD

The [SQL migrations](../db/migrations) define the physical schema. This diagram shows foreign keys and cardinality. The migration ledger is independent of application data.

`price_history` and `analytics_events` are TimescaleDB hypertables. `price_daily` is a continuous aggregate over `price_history`, grouped by product and UTC day. The migrations keep historical event and aggregate identifiers as logical references.

```mermaid
erDiagram
    stores |o..o{ users : "home_store_id"
    users ||--o| user_preferences : "user_id"
    products ||--o{ inventory : "product_id"
    stores ||--o{ inventory : "store_id"
    users ||..o{ wishlists : "user_id"
    wishlists ||..o{ wishlist_items : "wishlist_id"
    products ||..o{ wishlist_items : "product_id"
    stores |o..o{ wishlist_items : "store_id"
    wishlists ||..o{ wishlist_shares : "wishlist_id"
    wishlist_items ||--o| wishlist_item_claims : "item_id"
    users ||..o{ notifications : "user_id"
    products |o..o{ notifications : "product_id"
    notifications ||..o{ notification_deliveries : "notification_id"
    users ||..o{ carts : "user_id"
    carts ||--o{ cart_items : "cart_id"
    products ||--o{ cart_items : "product_id"
    products |o..o{ offers : "product_id"
    products ||--o{ product_similarity : "product_id"
    products ||..o{ product_similarity : "similar_product_id"

    stores {
        serial id PK
        text code UK
        text name
        text city
        double_precision latitude
        double_precision longitude
        boolean click_and_collect
    }
    users {
        uuid id PK
        citext email UK
        text password_hash
        text full_name
        text locale
        text timezone
        int home_store_id FK
        text role
        timestamptz created_at
    }
    user_preferences {
        uuid user_id PK,FK
        boolean channel_in_app
        boolean channel_email
        boolean channel_push
        boolean channel_whatsapp
        text delivery_mode
        smallint digest_hour_local
        time quiet_start
        time quiet_end
        numeric min_drop_percent "NUMERIC(5, 2)"
        smallint max_alerts_per_day
        jsonb push_subscription
        text whatsapp_number
        timestamptz updated_at
    }
    products {
        bigserial id PK
        text sku UK
        text name_en
        text name_ar
        text description_en
        text category
        text subcategory
        text brand
        text image_url
        jsonb attributes
        numeric current_price "NUMERIC(10, 2)"
        char(3) currency
        numeric list_price "NUMERIC(10, 2)"
        int total_stock
        boolean is_active
        vector(384) embedding
        numeric rating "NUMERIC(2, 1)"
        timestamptz updated_at
        text source
        text external_id
        timestamptz created_at
    }
    inventory {
        bigint product_id PK,FK
        int store_id PK,FK
        int qty
        timestamptz updated_at
    }
    wishlists {
        uuid id PK
        uuid user_id FK
        text name
        boolean is_default
        text visibility
        timestamptz created_at
    }
    wishlist_items {
        bigserial id PK
        uuid wishlist_id FK
        uuid user_id
        bigint product_id FK
        numeric target_price "NUMERIC(10, 2)"
        boolean notify_on_drop
        boolean notify_on_restock
        boolean notify_on_low_stock
        int low_stock_threshold
        int store_id FK
        numeric added_price "NUMERIC(10, 2)"
        numeric last_notified_price "NUMERIC(10, 2)"
        timestamptz last_notified_at
        timestamptz added_at
    }
    wishlist_shares {
        uuid id PK
        uuid wishlist_id FK
        text token UK
        text permission
        timestamptz expires_at
        timestamptz created_at
    }
    wishlist_item_claims {
        bigint item_id PK,FK
        text claimed_by
        timestamptz claimed_at
    }
    notifications {
        uuid id PK
        uuid user_id FK
        text type
        bigint product_id FK
        jsonb payload
        text idempotency_key UK
        text status
        timestamptz deliver_after
        timestamptz created_at
        timestamptz read_at
        timestamptz clicked_at
    }
    notification_deliveries {
        bigserial id PK
        uuid notification_id FK
        text channel
        text status
        smallint attempts
        text last_error
        timestamptz sent_at
    }
    carts {
        uuid id PK
        uuid user_id FK
        text status
        timestamptz updated_at
    }
    cart_items {
        uuid cart_id PK,FK
        bigint product_id PK,FK
        int qty
        numeric price_at_add "NUMERIC(10, 2)"
        text source
        uuid source_notification_id
        timestamptz added_at
    }
    offers {
        serial id PK
        bigint product_id FK
        text category
        text kind
        text label
        numeric value "NUMERIC(6, 2)"
        timestamptz valid_from
        timestamptz valid_to
    }
    product_similarity {
        bigint product_id PK,FK
        bigint similar_product_id FK
        real score
        smallint rank PK
        timestamptz computed_at
    }
    price_history {
        bigint product_id
        numeric price "NUMERIC(10, 2)"
        char(3) currency
        text source
        uuid event_id
        timestamptz recorded_at
    }
    outbox_events {
        uuid id PK
        text topic
        text key
        jsonb payload
        timestamptz created_at
        timestamptz published_at
    }
    processed_events {
        text consumer PK
        uuid event_id PK
        timestamptz processed_at
    }
    analytics_events {
        bigserial id
        text event_type
        uuid user_id
        bigint product_id
        uuid notification_id
        numeric amount "NUMERIC(10, 2)"
        timestamptz occurred_at
    }
    price_daily {
        bigint product_id
        timestamptz day
        numeric min_price "NUMERIC(10, 2)"
        numeric max_price "NUMERIC(10, 2)"
        numeric avg_price
        numeric close_price "NUMERIC(10, 2)"
    }
```

- One default wishlist and one active cart per user are enforced with partial unique indexes.
- Inventory is unique per product and store. Wishlist items are unique per wishlist and product.
- Product identity is unique per `source` and `external_id` pair.
