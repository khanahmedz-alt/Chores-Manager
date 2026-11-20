-- Chores Manager: each family chooses the day its week starts (e.g. Monday in Europe, Sunday or
-- Saturday in the Middle East).
--
-- households.week_start_dow is the first day of the week, 0 = Monday ... 6 = Sunday (the same
-- numbering as release_dow and each chore's days). A schedule week (schedule_slots.week_start,
-- performance_reviews.week_start) is the date of that day, and a slot's `day` is 0-6 counted from
-- it. Chores keep their usual days as weekdays, so they don't change.
--
-- When a parent changes the setting, the schedule and the bonus reviews are moved into the new weeks
-- straight away: every slot keeps its real date, and each bonus review moves to the new week that
-- overlaps most of its old week. Pay already logged is not touched.
--
-- Safe to run on the live database: every family starts on Monday, exactly as before.

alter table public.households add column week_start_dow smallint not null default 0
  check (week_start_dow between 0 and 6);

-- The fixed "must be a Monday" checks become "must be the family's first day of the week".
do $$
declare r record;
begin
  for r in select conrelid::regclass as tbl, conname from pg_catalog.pg_constraint
            where contype = 'c' and conrelid in ('public.schedule_slots'::regclass, 'public.performance_reviews'::regclass)
              and pg_catalog.pg_get_constraintdef(oid) ilike '%isodow%' loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- The weekday of a date, 0 = Monday ... 6 = Sunday.
create function public.dow0(d date) returns integer
language sql immutable set search_path = '' as $$
  select extract(isodow from d)::integer - 1
$$;

-- The first day of the family's week that holds date d.
create function public.household_week_of(hh uuid, d date) returns date
language sql stable security definer set search_path = '' as $$
  select d - ((public.dow0(d) - h.week_start_dow + 7) % 7) from public.households h where h.id = hh
$$;

create function public.week_start_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.dow0(new.week_start) <> (select week_start_dow from public.households where id = new.household_id) then
    raise exception 'That date is not the first day of the family''s week' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger week_start_check before insert or update of week_start on public.schedule_slots
  for each row execute function public.week_start_check();
create trigger week_start_check before insert or update of week_start on public.performance_reviews
  for each row execute function public.week_start_check();

-- The schedule for a week goes up on release_dow at release_hour, in the days before the week starts.
create or replace function public.week_release_at(hh uuid, wk date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((wk - 7 + ((h.release_dow - h.week_start_dow + 7) % 7))::timestamp + make_interval(hours => h.release_hour)) at time zone h.timezone
  from public.households h where h.id = hh
$$;

-- Picking and dropping a slot: the week must start on the family's day, and a slot's usual
-- weekday is counted from it.
create or replace function public.claim_slot(p_chore uuid, p_week date, p_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chores%rowtype; me uuid; s public.schedule_slots%rowtype; n integer; ws integer;
begin
  select * into c from public.chores where id = p_chore and active;
  if not found then raise exception 'Unknown chore' using errcode = '22023'; end if;
  me := public.current_member_id(c.household_id);
  if me is null or not exists (select 1 from public.members where id = me and role = 'child') then
    raise exception 'Only children pick chores' using errcode = '42501';
  end if;
  select week_start_dow into ws from public.households where id = c.household_id;
  if public.dow0(p_week) <> ws or p_day not between 0 and 6 then
    raise exception 'Bad week or day' using errcode = '22023';
  end if;
  if now() < public.week_release_at(c.household_id, p_week) then
    raise exception 'That week''s schedule is not up yet' using errcode = '22023';
  end if;
  if p_week + p_day < public.household_today(c.household_id) then
    raise exception 'That day has passed' using errcode = '22023';
  end if;

  perform set_config('chores.trusted', 'on', true);
  select * into s from public.schedule_slots where chore_id = p_chore and week_start = p_week and day = p_day for update;
  if found then
    if s.kind = 'kid' and s.member_id = me then n := 1;
    elsif s.kind = 'off' then
      perform set_config('chores.trusted', 'off', true);
      raise exception 'That chore is not on this week' using errcode = '22023';
    elsif s.kind = 'open' then
      update public.schedule_slots set kind = 'kid', member_id = me, set_by = me, set_at = now()
        where chore_id = p_chore and week_start = p_week and day = p_day;
      n := 1;
    else n := 0;
    end if;
  elsif (ws + p_day) % 7 = any (c.days) then
    insert into public.schedule_slots (household_id, week_start, chore_id, day, kind, member_id, set_by)
      values (c.household_id, p_week, p_chore, p_day, 'kid', me, me)
      on conflict (chore_id, week_start, day) do nothing;
    get diagnostics n = row_count;
  else n := 0;
  end if;
  perform set_config('chores.trusted', 'off', true);
  if n = 0 then raise exception 'Someone already took that one' using errcode = 'P0001', hint = 'taken'; end if;
end $$;

create or replace function public.drop_slot(p_chore uuid, p_week date, p_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chores%rowtype; me uuid; s public.schedule_slots%rowtype; ws integer;
begin
  select * into c from public.chores where id = p_chore;
  if not found then raise exception 'Unknown chore' using errcode = '22023'; end if;
  me := public.current_member_id(c.household_id);
  select * into s from public.schedule_slots where chore_id = p_chore and week_start = p_week and day = p_day for update;
  if not found or s.kind <> 'kid' or s.member_id is distinct from me then
    raise exception 'That chore is not yours to drop' using errcode = '42501';
  end if;
  if s.set_by is distinct from me then
    raise exception 'A parent gave you this one. Ask them to change it.' using errcode = '42501';
  end if;
  if p_week + p_day < public.household_today(c.household_id) then
    raise exception 'That day has passed' using errcode = '22023';
  end if;
  select week_start_dow into ws from public.households where id = c.household_id;
  perform set_config('chores.trusted', 'on', true);
  if (ws + p_day) % 7 = any (c.days) then
    delete from public.schedule_slots where chore_id = p_chore and week_start = p_week and day = p_day;
  else
    update public.schedule_slots set kind = 'open', member_id = null, set_by = me, set_at = now()
      where chore_id = p_chore and week_start = p_week and day = p_day;
  end if;
  perform set_config('chores.trusted', 'off', true);
end $$;

-- A bonus review keeps its ratings and amounts when it moves to another week (see below).
create or replace function public.performance_reviews_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me      uuid := public.current_member_id(new.household_id);
  r       jsonb;
  m       public.bonus_metrics%rowtype;
  t       text;
  out     jsonb := '[]'::jsonb;
  pct     numeric := 0;
  seen    uuid[] := '{}';
begin
  -- Moved to another week because the family changed the day its week starts: keep the review as it was.
  if tg_op = 'UPDATE' and coalesce(current_setting('chores.trusted', true), '') = 'on'
     and (new.household_id, new.member_id, new.ratings, new.note) is not distinct from (old.household_id, old.member_id, old.ratings, old.note) then
    return new;
  end if;
  if not exists (select 1 from public.members x where x.id = new.member_id and x.household_id = new.household_id and x.role = 'child') then
    raise exception 'A performance bonus is for a child' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (new.household_id <> old.household_id or new.member_id <> old.member_id) then
    raise exception 'A review cannot move to another child' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(new.ratings) loop
    t := r ->> 'tier';
    if t is null or t not in ('meets', 'good', 'excelled') then
      raise exception 'Each rating must be Meets, Good or Excelled' using errcode = '22023';
    end if;
    select * into m from public.bonus_metrics where id = (r ->> 'metric_id')::uuid and household_id = new.household_id;
    if not found then
      raise exception 'Unknown bonus metric' using errcode = '22023';
    end if;
    if m.id = any (seen) then
      raise exception 'A metric can only be rated once per review' using errcode = '22023';
    end if;
    seen := seen || m.id;
    pct := pct + m.max_percent * public.tier_factor(t);
    out := out || jsonb_build_object('metric_id', m.id, 'name', m.name, 'max_percent', m.max_percent,
                                     'tier', t, 'percent', round(m.max_percent * public.tier_factor(t), 3));
  end loop;

  new.ratings := out;
  new.bonus_percent := round(pct, 3);
  select coalesce(sum(e.amount), 0) into new.base_amount
    from public.time_entries e
    where e.member_id = new.member_id and e.status = 'approved'
      and e.work_date between new.week_start and new.week_start + 6;
  new.bonus_amount := round(new.base_amount * pct / 100, 2);

  if tg_op = 'INSERT' then
    new.created_by := me; new.created_at := now();
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.updated_by := me; new.updated_at := now();
  return new;
end $$;

-- When a parent changes the first day of the week, move the schedule and the reviews into the new weeks.
create function public.households_week_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('chores.trusted', 'on', true);
  -- Slots keep their real date (old week_start + day). Re-inserted, because two slots can swap keys.
  create temporary table if not exists pg_temp.moved_slots (like public.schedule_slots) on commit drop;
  delete from pg_temp.moved_slots;
  with gone as (delete from public.schedule_slots where household_id = new.id returning *)
  insert into pg_temp.moved_slots select * from gone;
  insert into public.schedule_slots (household_id, week_start, chore_id, day, kind, member_id, set_by, set_at)
    select household_id, public.household_week_of(new.id, week_start + day),
           chore_id, (week_start + day) - public.household_week_of(new.id, week_start + day), kind, member_id, set_by, set_at
      from pg_temp.moved_slots;
  -- Each review moves to the new week that overlaps most of its old week (the one holding its middle
  -- day), so it moves at most 3 days and switching back puts it where it was.
  update public.performance_reviews set week_start = public.household_week_of(new.id, week_start + 3)
   where household_id = new.id;
  perform set_config('chores.trusted', 'off', true);
  return new;
end $$;
create trigger households_week_moved after update of week_start_dow on public.households
  for each row when (new.week_start_dow is distinct from old.week_start_dow)
  execute function public.households_week_moved();

revoke all on function public.household_week_of(uuid, date) from public, anon;
grant execute on function public.dow0(date), public.household_week_of(uuid, date) to authenticated;
