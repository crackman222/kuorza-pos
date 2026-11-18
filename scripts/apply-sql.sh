#!/usr/bin/env bash
# Runs one SQL file against the project in TARGET_DB_URL, all in one
# transaction: if any statement fails, nothing is applied.
#
# TARGET_DB_URL goes in .env.dump.local (gitignored), next to SOURCE_DB_URL.
# Use the Session pooler string of the project you mean to change. Check that
# it's the right project before running: this writes to that database.
#
# Usage: bash scripts/apply-sql.sh supabase/migrations/000_baseline_schema.sql
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:?usage: bash scripts/apply-sql.sh <file.sql>}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

ENV_FILE=.env.dump.local
if [ -z "${TARGET_DB_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  TARGET_DB_URL=$(grep -E '^TARGET_DB_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r"'"'")
fi
[ -n "${TARGET_DB_URL:-}" ] || { echo "TARGET_DB_URL is not set — add it to $ENV_FILE." >&2; exit 1; }

host=$(printf '%s' "$TARGET_DB_URL" | sed -E 's#^[^@]*@([^/]*)/.*#\1#')
user=$(printf '%s' "$TARGET_DB_URL" | sed -E 's#^[a-z]+://([^:]*):.*#\1#')
echo "Applying $file to $user@$host"

docker run --rm -i postgres:17-alpine \
  psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q < "$file"

echo "Applied."
