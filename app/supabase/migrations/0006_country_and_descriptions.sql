-- Chores Manager: the family's country, and a description (the standard expected) for each chore.
-- Safe to run on the live database: it only adds two columns with defaults.

-- ISO 3166 country code chosen when the family is set up (e.g. 'SA', 'GB'); '' = not chosen.
alter table public.households add column country text not null default ''
  check (country = '' or country ~ '^[A-Z]{2}$');

-- What "done" looks like for this chore, written by a parent and shown to the children when they
-- log it. (Photos or an SOP document can be attached here in a later version.)
alter table public.chores add column description text not null default ''
  check (char_length(description) <= 1000);
