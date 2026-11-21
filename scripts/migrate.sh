#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."

shopt -s nullglob
migrations=(db/migrations/*.sql)
if (("${#migrations[@]}" == 0)); then
    echo "No SQL migrations found." >&2
    exit 1
fi

# A single psql session holds the lock through all per-file transactions.
sql=$(mktemp)
trap 'rm -f "$sql"' EXIT
cat > "$sql" <<'SQL'
SELECT pg_advisory_lock(984661562);
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
for path in "${migrations[@]}"; do
    name=${path##*/}
    if [[ ! $name =~ ^[0-9]{8}_[0-9]{3}_[a-z0-9_]+\.sql$ ]]; then
        echo "Invalid migration filename: $name" >&2
        exit 1
    fi
    checksum=$(shasum -a 256 "$path")
    checksum=${checksum%% *}
    cat >> "$sql" <<SQL
SELECT EXISTS (
    SELECT 1 FROM schema_migrations WHERE filename = '$name'
) AS already_applied, EXISTS (
    SELECT 1 FROM schema_migrations WHERE filename = '$name' AND checksum <> '$checksum'
) AS modified \\gset
\\if :modified
DO \$\$ BEGIN RAISE EXCEPTION 'Applied migration $name has changed'; END \$\$;
\\endif
\\if :already_applied
\\echo Skipping $name
\\else
\\echo Applying $name
BEGIN;
\\i /migrations/$name
INSERT INTO schema_migrations (filename, checksum) VALUES ('$name', '$checksum');
COMMIT;
\\endif
SQL
done

docker compose exec -T postgres sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$sql"
