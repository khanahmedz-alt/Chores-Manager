-- Chores Manager: fixed session times and "done at" timestamps.
--
-- Each chore already has a session length (hours per week ÷ the number of days it's on, rounded
-- to 5 minutes; e.g. Dishes, 7 hrs over 7 days = 1h 00m). From now on that session length IS the
-- time logged: the database sets an entry's minutes from its chore, whatever the app sends, and
-- the app asks only for the day and time the chore was done (done_at).
--
-- Safe to run on the live database before the new app goes live: older copies of the app still
-- work (their minutes are simply replaced by the chore's session), and entries already logged
-- keep their minutes and pay.

alter table public.time_entries add column done_at timestamptz;

-- A long once-a-week chore can have a session over 16 hours (e.g. 20 hrs once weekly).
alter table public.time_entries drop constraint if exists time_entries_minutes_check;
alter table public.time_entries add constraint time_entries_minutes_check check (minutes between 1 and 1440);

-- The session length of a chore, in minutes (matches sessionMins() in the app).
create function public.chore_session_minutes(p_hours numeric, p_days smallint[])
returns integer language sql immutable set search_path = '' as $$
  select least(1440, greatest(5, (round(p_hours * 60 / greatest(cardinality(p_days), 1) / 5) * 5)::integer))
$$;

create or replace function public.time_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := public.current_member_id(new.household_id);
  my_role  text;
  c        public.chores%rowtype;
  rate_now numeric;
  tz       text;
  trusted  boolean := coalesce(current_setting('chores.trusted', true), '') = 'on';
begin
  if me is null then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  select role into my_role from public.members where id = me;
  select timezone into tz from public.households where id = new.household_id;

  if not exists (select 1 from public.members m where m.id = new.member_id and m.household_id = new.household_id and m.role = 'child') then
    raise exception 'Time can only be logged for a child' using errcode = '22023';
  end if;

  if not trusted then
    if tg_op = 'INSERT' and (new.team_id is not null or new.split <> 1) then
      raise exception 'Log team chores with the team option' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if old.team_id is not null and (new.work_date, new.done_at, new.chore_id, new.note) is distinct from (old.work_date, old.done_at, old.chore_id, old.note) then
        raise exception 'Change a team chore for the whole team' using errcode = '42501';
      end if;
      new.team_id := old.team_id; new.team_members := old.team_members; new.split := old.split;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id or new.member_id <> old.member_id then
      raise exception 'An entry cannot move to another person' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := me;
    new.created_at := now();
  end if;

  -- The day comes from the "done at" time, in the family's time zone. Nobody can log a time that
  -- hasn't happened yet (a few minutes' grace for clocks that are slightly ahead).
  if new.done_at is not null and (tg_op = 'INSERT' or new.done_at is distinct from old.done_at) then
    if new.done_at > now() + interval '10 minutes' then
      raise exception 'That time hasn''t happened yet' using errcode = '22023';
    end if;
    new.work_date := (new.done_at at time zone tz)::date;
  end if;

  -- Chore name, rate and the time logged come from the chore. Rate and time are kept when an entry
  -- is edited without changing its chore, so later changes to the chore never change pay already logged.
  if tg_op = 'INSERT' or new.chore_id is distinct from old.chore_id then
    select * into c from public.chores where id = new.chore_id and household_id = new.household_id;
    if not found then
      raise exception 'Unknown chore' using errcode = '22023';
    end if;
    new.chore_name := c.name;
    rate_now := coalesce(c.rate, public.household_rate(new.household_id));
    new.rate := round(rate_now, 4);
    new.minutes := public.chore_session_minutes(c.hours_per_week, c.days);
  else
    new.chore_name := old.chore_name;
    new.rate := old.rate;
    new.minutes := old.minutes;
  end if;
  new.amount := round(new.minutes::numeric / 60 * new.rate * new.split, 2);

  if my_role = 'child' then
    if new.member_id <> me and not trusted then
      raise exception 'You can only log your own time' using errcode = '42501';
    end if;
    if new.work_date > public.household_today(new.household_id) then
      raise exception 'You can log a day once it has arrived' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and old.status = 'approved' then
      raise exception 'Approved time can only be changed by a parent' using errcode = '42501';
    end if;
    new.status := 'submitted';
    new.reviewed_by := null;
    new.reviewed_at := null;
  else
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      if new.status in ('approved', 'rejected') then
        new.reviewed_by := me;
        new.reviewed_at := now();
      else
        new.reviewed_by := null;
        new.reviewed_at := null;
      end if;
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.minutes, new.work_date, new.done_at, new.chore_id, new.note) is distinct from (old.minutes, old.work_date, old.done_at, old.chore_id, old.note) then
    new.edited_by := me;
    new.edited_at := now();
  elsif tg_op = 'UPDATE' then
    new.edited_by := old.edited_by;
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;

-- Team chores take the "done at" time too. p_minutes stays for older copies of the app but is ignored.
drop function public.log_team_time(uuid, uuid, date, integer, text, uuid[]);
create function public.log_team_time(p_household uuid, p_chore uuid, p_date date, p_minutes integer default null, p_note text default '',
                                     p_members uuid[] default '{}', p_done_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.current_member_id(p_household);
  my_role text;
  kids uuid[];
  n integer;
  team uuid := gen_random_uuid();
  k uuid;
begin
  if me is null then raise exception 'Not a member of this household' using errcode = '42501'; end if;
  select role into my_role from public.members where id = me;
  select array_agg(distinct x) into kids from unnest(p_members) x;
  n := coalesce(cardinality(kids), 0);
  if n < 2 or n > 8 then
    raise exception 'A team chore needs 2 to 8 children' using errcode = '22023';
  end if;
  if (select count(*) from public.members m where m.id = any (kids) and m.household_id = p_household and m.role = 'child' and m.active) <> n then
    raise exception 'Everyone in the team must be a child in this family' using errcode = '22023';
  end if;
  if my_role = 'child' and not (me = any (kids)) then
    raise exception 'You can only log a team chore you were part of' using errcode = '42501';
  end if;

  perform set_config('chores.trusted', 'on', true);
  foreach k in array kids loop
    insert into public.time_entries (household_id, member_id, chore_id, work_date, done_at, note, status, team_id, team_members, split)
      values (p_household, k, p_chore, p_date, p_done_at, coalesce(p_note, ''),
              case when my_role = 'parent' then 'approved' else 'submitted' end, team, kids, round(1.0 / n, 5));
  end loop;
  perform set_config('chores.trusted', 'off', true);
  return team;
end $$;

drop function public.update_team_time(uuid, uuid, date, integer, text);
create function public.update_team_time(p_team uuid, p_chore uuid, p_date date, p_minutes integer default null, p_note text default '',
                                        p_done_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  hh uuid; creator uuid; any_approved boolean; me uuid;
begin
  select household_id, created_by, bool_or(status = 'approved') into hh, creator, any_approved
    from public.time_entries where team_id = p_team group by household_id, created_by limit 1;
  if hh is null then raise exception 'Unknown team chore' using errcode = '22023'; end if;
  me := public.current_member_id(hh);
  if not public.is_parent(hh) then
    if me is distinct from creator then
      raise exception 'Only the child who logged it, or a parent, can change it' using errcode = '42501';
    end if;
    if any_approved then
      raise exception 'Approved time can only be changed by a parent' using errcode = '42501';
    end if;
  end if;
  perform set_config('chores.trusted', 'on', true);
  update public.time_entries
     set chore_id = p_chore, work_date = p_date, done_at = coalesce(p_done_at, done_at), note = coalesce(p_note, '')
   where team_id = p_team;
  perform set_config('chores.trusted', 'off', true);
end $$;

revoke all on function public.log_team_time(uuid, uuid, date, integer, text, uuid[], timestamptz),
  public.update_team_time(uuid, uuid, date, integer, text, timestamptz) from public, anon;
grant execute on function public.log_team_time(uuid, uuid, date, integer, text, uuid[], timestamptz),
  public.update_team_time(uuid, uuid, date, integer, text, timestamptz),
  public.chore_session_minutes(numeric, smallint[]) to authenticated;
