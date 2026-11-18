#!/usr/bin/env bash
# Dumps the database schema (and the menu/config data) from a Supabase project
# so another project can be built from it.
#
# Writes:
#   supabase/migrations/000_baseline_schema.sql  everything in `public`: tables,
#                                                views, functions, triggers, RLS
#                                                policies, grants
#   supabase/seed/config_data.sql                rows of the menu/config tables
#                                                (services, shelf items, wage
#                                                settings and rates)
#
# Storage and the realtime publication are outside `public`; they're in
# supabase/baseline/extras.sql, maintained by hand.
#
# The server runs Postgres 17 and pg_dump refuses to dump a newer server than
# itself, so this uses pg_dump from the postgres:17 Docker image. Docker
# Desktop must be running.
#
# Connection string: put it in .env.dump.local (gitignored), e.g.
#   SOURCE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# Use the "Session pooler" string from the dashboard's Connect dialog — the
# direct db.<ref>.supabase.co host is IPv6-only, which Docker on Windows
# usually can't reach.
#
# Usage: bash scripts/dump-schema.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.dump.local
read_var() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r"'"'"
}

SOURCE_DB_URL="${SOURCE_DB_URL:-$(read_var SOURCE_DB_URL)}"
if [ -z "$SOURCE_DB_URL" ]; then
  echo "SOURCE_DB_URL is not set — add it to $ENV_FILE (see the comment at the top of this script)." >&2
  exit 1
fi

pg_dump17() {
  docker run --rm -i postgres:17-alpine pg_dump "$SOURCE_DB_URL" "$@"
}

mkdir -p supabase/migrations supabase/seed

schema_out=supabase/migrations/000_baseline_schema.sql
seed_out=supabase/seed/config_data.sql
stamp=$(date +%Y-%m-%d)

echo "Dumping schema…"
{
  echo "-- Baseline: the whole \`public\` schema as of $stamp, dumped with"
  echo "-- scripts/dump-schema.sh. It already includes migrations 001–023."
  echo "-- A fresh project gets this file, then supabase/baseline/extras.sql, then"
  echo "-- only the numbered migrations after 023. Apply with psql"
  echo "-- (scripts/apply-sql.sh), not the SQL Editor: the file holds psql"
  echo "-- meta-commands."
  echo
  # supabase_admin's default privileges can't be set by `postgres`, and
  # `public` already exists in every project.
  pg_dump17 --schema-only --schema=public --no-owner --quote-all-identifiers \
    | sed -E \
        -e '/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/d' \
        -e 's/^CREATE SCHEMA "public";/CREATE SCHEMA IF NOT EXISTS "public";/' \
        -e '/^COMMENT ON SCHEMA "public"/d'
} > "$schema_out"

echo "Dumping menu/config data…"
{
  echo "-- Menu and config rows as of $stamp (scripts/dump-schema.sh). No"
  echo "-- transactions, people or money in here. shelf_items carries its stock"
  echo "-- count at dump time — correct it in Katalog after loading if needed."
  echo
  pg_dump17 --data-only --no-owner --quote-all-identifiers \
    --table=public.services \
    --table=public.shelf_items \
    --table=public.wage_settings \
    --table=public.service_wage_rates
} > "$seed_out"

echo "Done:"
wc -l "$schema_out" "$seed_out"
