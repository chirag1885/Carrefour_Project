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
