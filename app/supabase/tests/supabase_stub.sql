-- Minimal stand-in for the parts of Supabase the migration relies on, so it can be tested
-- against a plain Postgres. Not used in a real Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;

create schema extensions;
grant usage on schema extensions to anon, authenticated;
create publication supabase_realtime;
