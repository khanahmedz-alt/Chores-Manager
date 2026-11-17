-- Chores Manager: multi-family schema for Supabase.
--
-- Model
--   households      one family; holds pay settings and the weekly schedule release time
--   members         parents and children in a household; user_id links a member to a login
--   invites         one-time codes: a second parent joining, or a child linking their device
--   chores          the chores, their usual days and hours per week
--   schedule_slots  per-week overrides of who does a chore on a day (taken / open / off)
--   time_entries    timesheet lines; pay is worked out by the database, never by the client
--   payments        money paid to a child; the child confirms receipt
--
-- Access
--   Every table has row-level security. Parents manage their household. Children read their
--   household's chores and schedule, and only their own time entries and payments. Anything a
--   child may change beyond that (claiming a slot, confirming a payment) goes through a
--   security-definer function that checks the rules.
--
-- Children sign in on their own device with an anonymous Supabase session that a parent links
-- to their profile with a one-time code (Authentication > Sign In / Providers > "Allow anonymous sign-ins").

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  currency       text not null default '' check (char_length(currency) <= 6),
  monthly_budget numeric(12,2) not null default 0 check (monthly_budget >= 0),
  budget_hours   numeric(6,2) not null default 40 check (budget_hours > 0 and budget_hours <= 168),
  rate_mode      text not null default 'budget' check (rate_mode in ('budget', 'manual')),
  manual_rate    numeric(10,4) not null default 0 check (manual_rate >= 0),
  release_dow    smallint not null default 5 check (release_dow between 0 and 6),   -- 0 = Monday
  release_hour   smallint not null default 18 check (release_hour between 0 and 23),
  timezone       text not null default 'UTC',
  created_at     timestamptz not null default now()
);

create table public.members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  role         text not null check (role in ('parent', 'child')),
  color        text not null default '#41b883' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (household_id, user_id),
  unique (household_id, id)
);
create index members_user_idx on public.members (user_id);

create table public.invites (
  code         text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  role         text not null check (role in ('parent', 'child')),
  member_id    uuid references public.members (id) on delete cascade,  -- set: link this profile; null: create a new parent
  created_by   uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references auth.users (id) on delete set null
);
create index invites_household_idx on public.invites (household_id);

create table public.chores (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 60),
  hours_per_week numeric(6,2) not null check (hours_per_week > 0 and hours_per_week <= 168),
  frequency      text not null default 'Custom' check (char_length(frequency) <= 30),
  days           smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]::smallint[]),
  rate           numeric(10,4) check (rate is null or rate > 0),
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (household_id, id)
);

create table public.schedule_slots (
  household_id uuid not null references public.households (id) on delete cascade,
  week_start   date not null check (extract(isodow from week_start) = 1),
  chore_id     uuid not null,
  day          smallint not null check (day between 0 and 6),
  kind         text not null check (kind in ('kid', 'open', 'off')),
  member_id    uuid,
  set_by       uuid references public.members (id) on delete set null,
  set_at       timestamptz not null default now(),
  primary key (chore_id, week_start, day),
  foreign key (household_id, chore_id) references public.chores (household_id, id) on delete cascade,
  foreign key (household_id, member_id) references public.members (household_id, id) on delete cascade,
  check ((kind = 'kid') = (member_id is not null))
);
create index schedule_slots_week_idx on public.schedule_slots (household_id, week_start);

create table public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id    uuid not null,
  chore_id     uuid references public.chores (id) on delete set null,
  chore_name   text not null default '',
  work_date    date not null,
  minutes      integer not null check (minutes between 1 and 960),
  rate         numeric(10,4) not null default 0,
  amount       numeric(12,2) not null default 0,
  note         text not null default '' check (char_length(note) <= 280),
  status       text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  created_by   uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  reviewed_by  uuid references public.members (id) on delete set null,
  reviewed_at  timestamptz,
  edited_by    uuid references public.members (id) on delete set null,
  edited_at    timestamptz,
  foreign key (household_id, member_id) references public.members (household_id, id) on delete cascade
);
create index time_entries_member_idx on public.time_entries (household_id, member_id, work_date);
create index time_entries_status_idx on public.time_entries (household_id, status);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id    uuid not null,
  amount       numeric(12,2) not null check (amount > 0),
  paid_on      date not null default current_date,
  method       text not null default 'Cash' check (char_length(method) between 1 and 40),
  note         text not null default '' check (char_length(note) <= 280),
  paid_by      uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.members (id) on delete set null,
  foreign key (household_id, member_id) references public.members (household_id, id) on delete cascade
);
create index payments_member_idx on public.payments (household_id, member_id);

-- ---------------------------------------------------------------------------------------------
-- Helpers (security definer so policies can call them without recursing through members' RLS)
-- ---------------------------------------------------------------------------------------------

create function public.current_member_id(hh uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.members m
  where m.household_id = hh and m.user_id = auth.uid() and m.active
  limit 1
$$;

create function public.is_member(hh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.household_id = hh and m.user_id = auth.uid() and m.active)
$$;

create function public.is_parent(hh uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.household_id = hh and m.user_id = auth.uid() and m.active and m.role = 'parent')
$$;

create function public.is_anonymous_user() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- Hourly rate: monthly budget x 12 / 52 weeks / budgeted hours, or the fixed rate.
create function public.household_rate(hh uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when h.rate_mode = 'manual' then h.manual_rate
              else h.monthly_budget * 12 / 52 / h.budget_hours end
  from public.households h where h.id = hh
$$;

-- Today's date in the household's time zone.
create function public.household_today(hh uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone h.timezone)::date from public.households h where h.id = hh
$$;

-- When the schedule for the week starting `wk` (a Monday) goes up for the children.
create function public.week_release_at(hh uuid, wk date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((wk - 7 + h.release_dow)::timestamp + make_interval(hours => h.release_hour)) at time zone h.timezone
  from public.households h where h.id = hh
$$;

create function public.random_code(len integer) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I
  bytes bytea := extensions.gen_random_bytes(len);
  out text := '';
begin
  for i in 0 .. len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Triggers: keep the data honest whatever the client sends
-- ---------------------------------------------------------------------------------------------

create function public.households_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone %', new.timezone using errcode = '22023';
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
create trigger households_guard before insert or update on public.households
  for each row execute function public.households_guard();

-- Logins are only attached to profiles through redeem_invite / create_household.
create function public.members_guard() returns trigger
language plpgsql set search_path = '' as $$
declare trusted boolean := coalesce(current_setting('chores.trusted', true), '') = 'on';
begin
  new.display_name := btrim(new.display_name);
  if tg_op = 'INSERT' then
    if new.user_id is not null and not trusted then
      raise exception 'Use an invite code to link a login' using errcode = '42501';
    end if;
  else
    if new.household_id <> old.household_id then
      raise exception 'Members cannot move household' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id and new.user_id is not null and not trusted then
      raise exception 'Use an invite code to link a login' using errcode = '42501';
    end if;
    if old.user_id = auth.uid() and (new.role <> old.role or not new.active) and not trusted then
      raise exception 'You cannot change your own role or remove yourself' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger members_guard before insert or update on public.members
  for each row execute function public.members_guard();

create function public.slots_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('chores.trusted', true), '') <> 'on' then
    new.set_by := public.current_member_id(new.household_id);
    new.set_at := now();
  end if;
  if new.kind = 'kid' and not exists (
    select 1 from public.members m where m.id = new.member_id and m.role = 'child') then
    raise exception 'Slots can only be given to a child' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger slots_guard before insert or update on public.schedule_slots
  for each row execute function public.slots_guard();

create function public.time_entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me       uuid := public.current_member_id(new.household_id);
  my_role  text;
  c        public.chores%rowtype;
  rate_now numeric;
begin
  if me is null then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  select role into my_role from public.members where id = me;

  if not exists (select 1 from public.members m where m.id = new.member_id and m.household_id = new.household_id and m.role = 'child') then
    raise exception 'Time can only be logged for a child' using errcode = '22023';
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

  -- Chore name and rate come from the chore. The rate is kept when an entry is edited,
  -- so changing the family rate later never changes pay already logged.
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
  new.amount := round(new.minutes::numeric / 60 * new.rate, 2);

  if my_role = 'child' then
    if new.member_id <> me then
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
create trigger time_entries_guard before insert or update on public.time_entries
  for each row execute function public.time_entries_guard();

create function public.payments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('chores.trusted', true), '') = 'on' then return new; end if;
  if not exists (select 1 from public.members m where m.id = new.member_id and m.role = 'child') then
    raise exception 'Payments are made to a child' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.paid_by := public.current_member_id(new.household_id);
    new.created_at := now();
    new.confirmed_at := null;
    new.confirmed_by := null;
  else
    new.paid_by := old.paid_by;
    new.created_at := old.created_at;
    new.confirmed_at := old.confirmed_at;   -- only the child confirms, via confirm_payment()
    new.confirmed_by := old.confirmed_by;
  end if;
  return new;
end $$;
create trigger payments_guard before insert or update on public.payments
  for each row execute function public.payments_guard();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table public.households     enable row level security;
alter table public.members        enable row level security;
alter table public.invites        enable row level security;
alter table public.chores         enable row level security;
alter table public.schedule_slots enable row level security;
alter table public.time_entries   enable row level security;
alter table public.payments       enable row level security;

create policy "members read their household" on public.households for select to authenticated using (public.is_member(id));
create policy "parents update their household" on public.households for update to authenticated using (public.is_parent(id)) with check (public.is_parent(id));

create policy "members read the family" on public.members for select to authenticated using (public.is_member(household_id));
create policy "parents add members" on public.members for insert to authenticated with check (public.is_parent(household_id));
create policy "parents update members" on public.members for update to authenticated using (public.is_parent(household_id)) with check (public.is_parent(household_id));
create policy "parents remove members" on public.members for delete to authenticated using (public.is_parent(household_id) and user_id is distinct from auth.uid());

create policy "parents read invites" on public.invites for select to authenticated using (public.is_parent(household_id));
create policy "parents delete invites" on public.invites for delete to authenticated using (public.is_parent(household_id));

create policy "members read chores" on public.chores for select to authenticated using (public.is_member(household_id));
create policy "parents add chores" on public.chores for insert to authenticated with check (public.is_parent(household_id));
create policy "parents update chores" on public.chores for update to authenticated using (public.is_parent(household_id)) with check (public.is_parent(household_id));
create policy "parents delete chores" on public.chores for delete to authenticated using (public.is_parent(household_id));

create policy "members read the schedule" on public.schedule_slots for select to authenticated using (public.is_member(household_id));
create policy "parents add slots" on public.schedule_slots for insert to authenticated with check (public.is_parent(household_id));
create policy "parents update slots" on public.schedule_slots for update to authenticated using (public.is_parent(household_id)) with check (public.is_parent(household_id));
create policy "parents delete slots" on public.schedule_slots for delete to authenticated using (public.is_parent(household_id));

create policy "parents and the child read entries" on public.time_entries for select to authenticated
  using (public.is_parent(household_id) or member_id = public.current_member_id(household_id));
create policy "parents and the child add entries" on public.time_entries for insert to authenticated
  with check (public.is_parent(household_id) or member_id = public.current_member_id(household_id));
create policy "parents and the child edit entries" on public.time_entries for update to authenticated
  using (public.is_parent(household_id) or (member_id = public.current_member_id(household_id) and status <> 'approved'))
  with check (public.is_parent(household_id) or member_id = public.current_member_id(household_id));
create policy "parents and the child delete entries" on public.time_entries for delete to authenticated
  using (public.is_parent(household_id) or (member_id = public.current_member_id(household_id) and status <> 'approved'));

create policy "parents and the child read payments" on public.payments for select to authenticated
  using (public.is_parent(household_id) or member_id = public.current_member_id(household_id));
create policy "parents add payments" on public.payments for insert to authenticated with check (public.is_parent(household_id));
create policy "parents update payments" on public.payments for update to authenticated using (public.is_parent(household_id)) with check (public.is_parent(household_id));
create policy "parents delete payments" on public.payments for delete to authenticated using (public.is_parent(household_id) and confirmed_at is null);

-- ---------------------------------------------------------------------------------------------
-- Functions the app calls (RPC)
-- ---------------------------------------------------------------------------------------------

-- A signed-in parent (not an anonymous child device) starts a new family.
create function public.create_household(p_name text, p_display_name text, p_currency text default '', p_timezone text default 'UTC')
returns uuid language plpgsql security definer set search_path = '' as $$
declare hh uuid;
begin
  if auth.uid() is null or public.is_anonymous_user() then
    raise exception 'Sign in with an email address to create a family' using errcode = '42501';
  end if;
  perform set_config('chores.trusted', 'on', true);
  insert into public.households (name, currency, timezone) values (p_name, coalesce(p_currency, ''), coalesce(p_timezone, 'UTC'))
    returning id into hh;
  insert into public.members (household_id, user_id, display_name, role, color, sort_order)
    values (hh, auth.uid(), p_display_name, 'parent', '#1e3a5f', 0);
  perform set_config('chores.trusted', 'off', true);
  return hh;
end $$;

-- A parent makes a one-time code: to invite another parent (p_member_id null, role parent)
-- or to link a child's device to that child's profile (p_member_id = the child).
create function public.create_invite(p_household uuid, p_role text, p_member_id uuid default null)
returns table (code text, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare c text; exp timestamptz;
begin
  if not public.is_parent(p_household) then
    raise exception 'Only a parent can make invite codes' using errcode = '42501';
  end if;
  if p_role not in ('parent', 'child') then raise exception 'Unknown role' using errcode = '22023'; end if;
  if p_member_id is not null and not exists (
    select 1 from public.members m where m.id = p_member_id and m.household_id = p_household and m.role = p_role) then
    raise exception 'Unknown family member' using errcode = '22023';
  end if;
  if p_role = 'child' and p_member_id is null then
    raise exception 'Add the child first, then make a device code for them' using errcode = '22023';
  end if;
  exp := now() + case when p_role = 'child' then interval '1 day' else interval '7 days' end;
  loop
    c := public.random_code(8);
    begin
      insert into public.invites (code, household_id, role, member_id, created_by, expires_at)
        values (c, p_household, p_role, p_member_id, public.current_member_id(p_household), exp);
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return query select c, exp;
end $$;

-- Use a code. A child's device (usually an anonymous session) is linked to their profile;
-- a parent's email account joins as a new parent.
create function public.redeem_invite(p_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites%rowtype; mid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into inv from public.invites where code = upper(btrim(p_code)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'That code is not valid. Ask a parent for a new one.' using errcode = '22023';
  end if;
  if inv.role = 'parent' and public.is_anonymous_user() then
    raise exception 'Parents join with an email account' using errcode = '42501';
  end if;
  if exists (select 1 from public.members m where m.household_id = inv.household_id and m.user_id = auth.uid() and (inv.member_id is null or m.id <> inv.member_id)) then
    raise exception 'This login is already in this family' using errcode = '22023';
  end if;

  perform set_config('chores.trusted', 'on', true);
  if inv.member_id is not null then
    update public.members set user_id = auth.uid(), active = true where id = inv.member_id returning id into mid;
  else
    insert into public.members (household_id, user_id, display_name, role, color, sort_order)
      values (inv.household_id, auth.uid(), coalesce(nullif(btrim(p_display_name), ''), 'Parent'), 'parent', '#35495e', 1)
      returning id into mid;
  end if;
  update public.invites set used_at = now(), used_by = auth.uid() where code = inv.code;
  perform set_config('chores.trusted', 'off', true);
  return mid;
end $$;

-- A child takes an open slot once that week's schedule is up. First tap wins.
create function public.claim_slot(p_chore uuid, p_week date, p_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chores%rowtype; me uuid; s public.schedule_slots%rowtype; n integer;
begin
  select * into c from public.chores where id = p_chore and active;
  if not found then raise exception 'Unknown chore' using errcode = '22023'; end if;
  me := public.current_member_id(c.household_id);
  if me is null or not exists (select 1 from public.members where id = me and role = 'child') then
    raise exception 'Only children pick chores' using errcode = '42501';
  end if;
  if extract(isodow from p_week) <> 1 or p_day not between 0 and 6 then
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
  elsif p_day = any (c.days) then
    insert into public.schedule_slots (household_id, week_start, chore_id, day, kind, member_id, set_by)
      values (c.household_id, p_week, p_chore, p_day, 'kid', me, me)
      on conflict (chore_id, week_start, day) do nothing;
    get diagnostics n = row_count;
  else n := 0;
  end if;
  perform set_config('chores.trusted', 'off', true);
  if n = 0 then raise exception 'Someone already took that one' using errcode = 'P0001', hint = 'taken'; end if;
end $$;

-- A child drops a slot they picked themselves (not one a parent gave them) before the day.
create function public.drop_slot(p_chore uuid, p_week date, p_day integer)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chores%rowtype; me uuid; s public.schedule_slots%rowtype;
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
  perform set_config('chores.trusted', 'on', true);
  if p_day = any (c.days) then
    delete from public.schedule_slots where chore_id = p_chore and week_start = p_week and day = p_day;
  else
    update public.schedule_slots set kind = 'open', member_id = null, set_by = me, set_at = now()
      where chore_id = p_chore and week_start = p_week and day = p_day;
  end if;
  perform set_config('chores.trusted', 'off', true);
end $$;

-- The child confirms they received a payment.
create function public.confirm_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.payments%rowtype;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or p.member_id is distinct from public.current_member_id(p.household_id) then
    raise exception 'That payment is not yours to confirm' using errcode = '42501';
  end if;
  perform set_config('chores.trusted', 'on', true);
  update public.payments set confirmed_at = coalesce(confirmed_at, now()), confirmed_by = p.member_id where id = p_payment;
  perform set_config('chores.trusted', 'off', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on function public.current_member_id(uuid), public.is_member(uuid), public.is_parent(uuid),
  public.household_rate(uuid), public.household_today(uuid), public.week_release_at(uuid, date),
  public.random_code(integer), public.create_household(text, text, text, text),
  public.create_invite(uuid, text, uuid), public.redeem_invite(text, text),
  public.claim_slot(uuid, date, integer), public.drop_slot(uuid, date, integer),
  public.confirm_payment(uuid), public.is_anonymous_user() from public, anon;

grant select, update on public.households to authenticated;
grant select, insert, update, delete on public.members, public.chores, public.schedule_slots,
  public.time_entries, public.payments to authenticated;
grant select, delete on public.invites to authenticated;
grant execute on function public.current_member_id(uuid), public.is_member(uuid), public.is_parent(uuid),
  public.household_rate(uuid), public.household_today(uuid), public.week_release_at(uuid, date),
  public.create_household(text, text, text, text), public.create_invite(uuid, text, uuid),
  public.redeem_invite(text, text), public.claim_slot(uuid, date, integer),
  public.drop_slot(uuid, date, integer), public.confirm_payment(uuid), public.is_anonymous_user() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Live updates (Supabase Realtime respects the policies above)
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.households, public.members, public.chores,
      public.schedule_slots, public.time_entries, public.payments;
  end if;
end $$;

-- Realtime needs the old row on delete to route the change to subscribers.
alter table public.schedule_slots replica identity full;
alter table public.time_entries   replica identity full;
alter table public.payments       replica identity full;
