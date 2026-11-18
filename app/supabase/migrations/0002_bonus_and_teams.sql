-- Chores Manager: performance bonus and team chores.
-- Safe to run on a live 0001 database: it only adds tables, columns and functions, and the
-- updated time-entry rule behaves exactly as before for ordinary (non-team) entries.
--
-- Performance bonus
--   bonus_metrics        what parents measure (e.g. school grades) with a max % and the
--                        conditions for each tier
--   performance_reviews  a parent's rating of one child for one week; the bonus is a % of
--                        that child's approved chore pay for the week:
--                        Meets = 0% of the metric's max, Good = 25%, Excelled = 100%
--
-- Team chores
--   Children can log a chore they did together. Each child gets a time entry for the full
--   time; the chore's pay is split equally between them (time_entries.split = 1/n).

-- ---------------------------------------------------------------------------------------------
-- Performance bonus
-- ---------------------------------------------------------------------------------------------

create table public.bonus_metrics (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  meets_text    text not null default '' check (char_length(meets_text) <= 200),
  good_text     text not null default '' check (char_length(good_text) <= 200),
  excelled_text text not null default '' check (char_length(excelled_text) <= 200),
  max_percent   numeric(5,2) not null check (max_percent > 0 and max_percent <= 100),
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (household_id, id)
);

create table public.performance_reviews (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id    uuid not null,
  week_start   date not null check (extract(isodow from week_start) = 1),
  -- [{ "metric_id": uuid, "tier": "meets" | "good" | "excelled" }]; the database fills in
  -- each metric's name, max_percent and the earned percent at save time.
  ratings      jsonb not null default '[]'::jsonb check (jsonb_typeof(ratings) = 'array'),
  base_amount  numeric(12,2) not null default 0,
  bonus_percent numeric(7,3) not null default 0,
  bonus_amount numeric(12,2) not null default 0,
  note         text not null default '' check (char_length(note) <= 280),
  created_by   uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references public.members (id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (member_id, week_start),
  foreign key (household_id, member_id) references public.members (household_id, id) on delete cascade
);
create index performance_reviews_household_idx on public.performance_reviews (household_id, week_start);

create function public.tier_factor(t text) returns numeric
language sql immutable set search_path = '' as $$
  select case t when 'excelled' then 1.0 when 'good' then 0.25 when 'meets' then 0.0 end
$$;

create function public.bonus_metrics_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  return new;
end $$;
create trigger bonus_metrics_guard before insert or update on public.bonus_metrics
  for each row execute function public.bonus_metrics_guard();

-- Works out the bonus from the household's own metrics and the child's approved pay for the
-- week, whatever the client sends. Re-saving a review recalculates it.
create function public.performance_reviews_guard() returns trigger
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
create trigger performance_reviews_guard before insert or update on public.performance_reviews
  for each row execute function public.performance_reviews_guard();

alter table public.bonus_metrics       enable row level security;
alter table public.performance_reviews enable row level security;

create policy "members read bonus metrics" on public.bonus_metrics for select to authenticated using (public.is_member(household_id));
create policy "parents add bonus metrics" on public.bonus_metrics for insert to authenticated with check (public.is_parent(household_id));
create policy "parents update bonus metrics" on public.bonus_metrics for update to authenticated using (public.is_parent(household_id)) with check (public.is_parent(household_id));

create policy "parents and the child read reviews" on public.performance_reviews for select to authenticated
  using (public.is_parent(household_id) or member_id = public.current_member_id(household_id));
create policy "parents add reviews" on public.performance_reviews for insert to authenticated with check (public.is_parent(household_id));
create policy "parents update reviews" on public.performance_reviews for update to authenticated using (public.is_parent(household_id)) with check (public.is_parent(household_id));
create policy "parents delete reviews" on public.performance_reviews for delete to authenticated using (public.is_parent(household_id));

-- ---------------------------------------------------------------------------------------------
-- Team chores
-- ---------------------------------------------------------------------------------------------

alter table public.time_entries
  add column team_id      uuid,
  add column team_members uuid[] not null default '{}',
  add column split        numeric(6,5) not null default 1 check (split > 0 and split <= 1);
create index time_entries_team_idx on public.time_entries (team_id) where team_id is not null;

-- Same rules as before, plus: pay is multiplied by the entry's share (split), and team entries
-- can only be created or changed through the team functions below (which mark the
-- transaction as trusted after checking who is asking).
create or replace function public.time_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := public.current_member_id(new.household_id);
  my_role  text;
  c        public.chores%rowtype;
  rate_now numeric;
  trusted  boolean := coalesce(current_setting('chores.trusted', true), '') = 'on';
begin
  if me is null then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  select role into my_role from public.members where id = me;

  if not exists (select 1 from public.members m where m.id = new.member_id and m.household_id = new.household_id and m.role = 'child') then
    raise exception 'Time can only be logged for a child' using errcode = '22023';
  end if;

  if not trusted then
    if tg_op = 'INSERT' and (new.team_id is not null or new.split <> 1) then
      raise exception 'Log team chores with the team option' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if old.team_id is not null and (new.minutes, new.work_date, new.chore_id, new.note) is distinct from (old.minutes, old.work_date, old.chore_id, old.note) then
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

  if tg_op = 'INSERT' or new.chore_id is distinct from old.chore_id then
    select * into c from public.chores where id = new.chore_id and household_id = new.household_id;
    if not found then
      raise exception 'Unknown chore' using errcode = '22023';
    end if;
    new.chore_name := c.name;
    rate_now := coalesce(c.rate, public.household_rate(new.household_id));
    new.rate := round(rate_now, 4);
  else
    new.chore_name := old.chore_name;
    new.rate := old.rate;
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

  if tg_op = 'UPDATE' and (new.minutes, new.work_date, new.chore_id, new.note) is distinct from (old.minutes, old.work_date, old.chore_id, old.note) then
    new.edited_by := me;
    new.edited_at := now();
  elsif tg_op = 'UPDATE' then
    new.edited_by := old.edited_by;
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;

-- A child may delete their own pending entry, but not one share of a team chore.
drop policy "parents and the child delete entries" on public.time_entries;
create policy "parents and the child delete entries" on public.time_entries for delete to authenticated
  using (public.is_parent(household_id) or (member_id = public.current_member_id(household_id) and status <> 'approved' and team_id is null));

-- Log a chore done together. The caller (a child in the team, or a parent) gives the
-- total time; each child's share of the pay is 1/n.
create function public.log_team_time(p_household uuid, p_chore uuid, p_date date, p_minutes integer, p_note text, p_members uuid[])
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
    insert into public.time_entries (household_id, member_id, chore_id, work_date, minutes, note, status, team_id, team_members, split)
      values (p_household, k, p_chore, p_date, p_minutes, coalesce(p_note, ''),
              case when my_role = 'parent' then 'approved' else 'submitted' end, team, kids, round(1.0 / n, 5));
  end loop;
  perform set_config('chores.trusted', 'off', true);
  return team;
end $$;

-- Change the chore, day, time or note of a team chore for everyone in it.
create function public.update_team_time(p_team uuid, p_chore uuid, p_date date, p_minutes integer, p_note text)
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
  update public.time_entries set chore_id = p_chore, work_date = p_date, minutes = p_minutes, note = coalesce(p_note, '')
    where team_id = p_team;
  perform set_config('chores.trusted', 'off', true);
end $$;

-- Delete a team chore for everyone in it.
create function public.delete_team_time(p_team uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  hh uuid; creator uuid; any_approved boolean;
begin
  select household_id, created_by, bool_or(status = 'approved') into hh, creator, any_approved
    from public.time_entries where team_id = p_team group by household_id, created_by limit 1;
  if hh is null then return; end if;
  if not public.is_parent(hh) then
    if public.current_member_id(hh) is distinct from creator then
      raise exception 'Only the child who logged it, or a parent, can delete it' using errcode = '42501';
    end if;
    if any_approved then
      raise exception 'Approved time can only be changed by a parent' using errcode = '42501';
    end if;
  end if;
  delete from public.time_entries where team_id = p_team;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges and live updates
-- ---------------------------------------------------------------------------------------------

revoke all on public.bonus_metrics, public.performance_reviews from anon;
revoke all on function public.tier_factor(text), public.log_team_time(uuid, uuid, date, integer, text, uuid[]),
  public.update_team_time(uuid, uuid, date, integer, text), public.delete_team_time(uuid) from public, anon;
grant select, insert, update on public.bonus_metrics to authenticated;
grant select, insert, update, delete on public.performance_reviews to authenticated;
grant execute on function public.tier_factor(text), public.log_team_time(uuid, uuid, date, integer, text, uuid[]),
  public.update_team_time(uuid, uuid, date, integer, text), public.delete_team_time(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bonus_metrics, public.performance_reviews;
  end if;
end $$;
alter table public.performance_reviews replica identity full;
