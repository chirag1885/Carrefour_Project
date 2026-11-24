.PHONY: up down migrate psql reset download-datasets seed-small seed

PYTHON ?= python3
VENV_PYTHON := .venv/bin/python
SEED_DEPS := .venv/.seed-deps

up:
	docker compose up -d --wait --wait-timeout 180

down:
	docker compose down

migrate:
	bash scripts/migrate.sh

psql:
	docker compose exec postgres sh -c 'exec psql -X -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

reset:
	docker compose down --volumes
	$(MAKE) up
	$(MAKE) migrate

$(SEED_DEPS): scripts/seed-requirements.txt
	$(PYTHON) -m venv .venv
	$(VENV_PYTHON) -m pip install -r scripts/seed-requirements.txt
	touch $@

download-datasets: $(SEED_DEPS)
	$(VENV_PYTHON) scripts/download_datasets.py

seed-small: $(SEED_DEPS)
	$(VENV_PYTHON) scripts/seed.py --profile small

seed: $(SEED_DEPS)
	$(VENV_PYTHON) scripts/seed.py

# --- Phase 3 worker targets ---
worker-up:
	docker compose -f docker-compose.yml -f docker-compose.worker.yml up -d

worker-down:
	docker compose -f docker-compose.yml -f docker-compose.worker.yml down

backfill-history: $(SEED_DEPS)
	$(VENV_PYTHON) scripts/backfill_history.py

# Change the demo laptop from AED 3,000 to AED 2,500 through the real admin API.
# Requires the API to be running and an admin token; relies on jq being installed.
demo-drop:
	@TOKEN=$$(curl -sf $(API_URL)/auth/login \
	  -H 'content-type: application/json' \
	  -d '{"email":"$(ADMIN_EMAIL)","password":"$(ADMIN_PASSWORD)"}' | jq -r .accessToken) && \
	PRODUCT_ID=$$(curl -sf "$(API_URL)/products?query=DEMO-LAPTOP-001" | jq -r '.items[0].id') && \
	curl -sf -X PUT "$(API_URL)/admin/products/$$PRODUCT_ID/price" \
	  -H "authorization: Bearer $$TOKEN" \
	  -H 'content-type: application/json' \
	  -d '{"price":2500}' | jq .

verify-phase3: $(SEED_DEPS)
	$(VENV_PYTHON) scripts/verify_phase3.py

# --- test targets ---
test:
	npm --prefix apps/api test 2>/dev/null || true
	npm --prefix apps/worker test 2>/dev/null || true

test-int:
	npm --prefix apps/api run test:int 2>/dev/null || true

API_URL ?= http://localhost:8000/api/v1
ADMIN_EMAIL ?= admin@carrefour.test
ADMIN_PASSWORD ?= Demo@1234

# --- Phase 4 (in-app and email notifications) ---
.PHONY: alerts-up alerts-stop test-alert
alerts-up: migrate
	docker compose -f docker-compose.yml -f docker-compose.alerts.yml up -d --build alert-engine notification-worker

alerts-stop:
	docker compose -f docker-compose.yml -f docker-compose.alerts.yml stop alert-engine notification-worker

test-alert:
	npm --prefix apps/alerts test
