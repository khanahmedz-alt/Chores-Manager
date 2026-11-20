-- Chores Manager: an optional time of day for a chore.
--
-- Most chores can be done any time on their day. Some can't: "Feed the cat at 07:00" or "Bins out
-- by 20:00". A chore can now have one time, which either says when to do it ('at') or the latest
-- it should be done ('by'). It shows on the schedule, in Today and in the chore's details; a chore
-- logged after its 'by' time is marked late for the parents. It doesn't change pay.
--
-- Safe to run on the live database: it only adds two optional columns.

alter table public.chores add column time_of_day time;
alter table public.chores add column time_rule text not null default 'at' check (time_rule in ('at', 'by'));
