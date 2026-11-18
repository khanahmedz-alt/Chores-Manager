#!/usr/bin/env bash
# Encrypted backup of the Chores Manager database.
#
# Dumps the app's own data (schema "public": families, members, chores, schedule, timesheets,
# bonuses, payments, contact messages) and the logins it depends on (auth.users and
# auth.identities, data only), then encrypts the lot with AES-256 using BACKUP_PASSPHRASE.
#
#   SUPABASE_DB_URL=postgresql://... BACKUP_PASSPHRASE=... app/scripts/backup-db.sh [out-dir]
#
# Optional: PG_BIN=/usr/lib/postgresql/17/bin to use a specific pg_dump (it must be at least
# as new as the server). Restore steps are in app/README.md ("Backups").
set -euo pipefail

out="${1:-backups}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the database connection string}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to the passphrase used to encrypt the backup}"
bin="${PG_BIN:+$PG_BIN/}"
stamp="$(date -u +%Y-%m-%dT%H%MZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

echo "pg_dump: $("${bin}pg_dump" --version)"

# 1. Everything the app stores: tables, functions, policies and their data.
"${bin}pg_dump" "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges \
  --schema=public --file="$work/public.dump"

# 2. Logins, so parents and linked child devices keep working after a restore.
"${bin}pg_dump" "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --data-only \
  --table=auth.users --table=auth.identities --file="$work/auth.dump"

# 3. Row counts, to check a restore against.
"${bin}psql" "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "
  select format('%s %s', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by 1" > "$work/counts.txt"
printf 'created %s\n' "$stamp" >> "$work/counts.txt"

tar -C "$work" -czf "$work/backup.tgz" public.dump auth.dump counts.txt
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --output "$out/chores-db-$stamp.tgz.gpg" "$work/backup.tgz" <<<"$BACKUP_PASSPHRASE"

echo "Backup written: $out/chores-db-$stamp.tgz.gpg ($(du -h "$out/chores-db-$stamp.tgz.gpg" | cut -f1))"
echo "Rows per table:"; sed 's/^/  /' "$work/counts.txt"
