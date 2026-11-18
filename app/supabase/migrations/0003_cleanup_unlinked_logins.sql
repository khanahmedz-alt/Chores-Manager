-- Chores Manager: clean up child-device logins that were never linked to a child.
--
-- A child's device signs in anonymously and is then linked to their profile with a parent's code.
-- Anonymous logins that never get linked (a mistyped code, or someone scripting sign-ins against the
-- public API) are useless and count towards Supabase's monthly active users. This deletes any that
-- are older than a day and not linked to a family member. It never touches parent (email) accounts
-- or linked child devices.
--
-- It runs nightly with pg_cron when that extension is available (Supabase: Database > Extensions >
-- pg_cron). Run it by hand any time with:  select public.cleanup_unlinked_child_logins();

create function public.cleanup_unlinked_child_logins(p_older_than interval default interval '1 day')
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.users u
   where u.is_anonymous
     and u.created_at < now() - p_older_than
     and not exists (select 1 from public.members m where m.user_id = u.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Only the database owner (and the scheduler) may run it; the app never calls it.
revoke all on function public.cleanup_unlinked_child_logins(interval) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('cleanup-unlinked-child-logins', '23 3 * * *', 'select public.cleanup_unlinked_child_logins()');
  else
    raise notice 'pg_cron is not available here; run public.cleanup_unlinked_child_logins() by hand or schedule it.';
  end if;
exception when others then
  raise notice 'Could not schedule the clean-up (%). Turn on pg_cron in Database > Extensions, then run: select cron.schedule(''cleanup-unlinked-child-logins'', ''23 3 * * *'', ''select public.cleanup_unlinked_child_logins()'');', sqlerrm;
end $$;
