-- Chores Manager: messages sent from the Contact page.
--
-- Messages are written only by the "contact" Edge Function, which calls
-- submit_contact_message() with the service role. Row-level security is on with no policies,
-- and the app's own roles have no privileges, so no browser can read or write this table.
-- Safe to run on the live database: it only adds a table and a function.

create table public.contact_messages (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  email         text not null check (char_length(email) between 3 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic         text not null check (topic in ('Support', 'Billing', 'Feedback', 'Privacy / Data request', 'Other')),
  message       text not null check (char_length(btrim(message)) between 10 and 5000),
  user_id       uuid references auth.users (id) on delete set null,
  family_id     uuid references public.households (id) on delete set null,
  status        text not null default 'new' check (status in ('new', 'replied', 'closed', 'spam')),
  -- For the rate limit: a salted SHA-256 of the sender's IP address, never the address itself.
  ip_hash       text check (ip_hash is null or char_length(ip_hash) <= 128),
  -- Whether the notification email to the team went out.
  email_sent_at timestamptz,
  email_error   text
);
create index contact_messages_email_idx on public.contact_messages (lower(email), created_at desc);
create index contact_messages_ip_idx on public.contact_messages (ip_hash, created_at desc) where ip_hash is not null;
create index contact_messages_status_idx on public.contact_messages (status, created_at desc);

alter table public.contact_messages enable row level security;
-- No policies: nobody reads or writes through the API except the service role.
revoke all on public.contact_messages from public, anon, authenticated;

-- Checks a message, applies the rate limit (5 per email or per IP in any hour) and saves it.
-- Errors carry a hint the Edge Function maps to a friendly message:
--   invalid_email, invalid_topic, invalid_message, rate_limited.
create function public.submit_contact_message(
  p_email text, p_topic text, p_message text,
  p_user_id uuid default null, p_family_id uuid default null, p_ip_hash text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e   text := btrim(coalesce(p_email, ''));
  m   text := btrim(coalesce(p_message, ''));
  n   integer;
  id  uuid;
begin
  if char_length(e) not between 3 and 254 or e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023', hint = 'invalid_email';
  end if;
  if p_topic is null or p_topic not in ('Support', 'Billing', 'Feedback', 'Privacy / Data request', 'Other') then
    raise exception 'Choose a topic' using errcode = '22023', hint = 'invalid_topic';
  end if;
  if char_length(m) not between 10 and 5000 then
    raise exception 'The message must be 10 to 5,000 characters' using errcode = '22023', hint = 'invalid_message';
  end if;

  -- Serialise submissions from the same email or IP so parallel requests can't slip past the limit.
  perform pg_advisory_xact_lock(hashtext('contact-email:' || lower(e)));
  if p_ip_hash is not null then perform pg_advisory_xact_lock(hashtext('contact-ip:' || p_ip_hash)); end if;

  select count(*) into n from public.contact_messages c
   where c.created_at > now() - interval '1 hour'
     and (lower(c.email) = lower(e) or (p_ip_hash is not null and c.ip_hash = p_ip_hash));
  if n >= 5 then
    raise exception 'Too many messages. Please try again in an hour.' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.contact_messages (email, topic, message, user_id, family_id, ip_hash)
    values (e, p_topic, m, p_user_id, p_family_id, p_ip_hash)
    returning contact_messages.id into id;
  return id;
end $$;

revoke all on function public.submit_contact_message(text, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, uuid, uuid, text) to service_role;
grant select, update on public.contact_messages to service_role;
