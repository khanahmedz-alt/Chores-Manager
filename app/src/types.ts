export type Role = 'parent' | 'child';
export type EntryStatus = 'submitted' | 'approved' | 'rejected';
export type SlotKind = 'kid' | 'open' | 'off';

export interface Household {
  id: string;
  name: string;
  currency: string;
  monthly_budget: number;
  budget_hours: number;
  rate_mode: 'budget' | 'manual';
  manual_rate: number;
  release_dow: number;   // 0 = Monday
  release_hour: number;  // 0-23, household time zone
  timezone: string;
}

export interface Member {
  id: string;
  household_id: string;
  user_id: string | null;
  display_name: string;
  role: Role;
  color: string;
  active: boolean;
  sort_order: number;
}

export interface Chore {
  id: string;
  household_id: string;
  name: string;
  hours_per_week: number;
  frequency: string;
  days: number[];
  rate: number | null;
  active: boolean;
  sort_order: number;
}

export interface Slot {
  household_id: string;
  week_start: string;
  chore_id: string;
  day: number;
  kind: SlotKind;
  member_id: string | null;
  set_by: string | null;
  set_at: string;
}

export interface Entry {
  id: string;
  household_id: string;
  member_id: string;
  chore_id: string | null;
  chore_name: string;
  work_date: string;
  minutes: number;
  rate: number;
  amount: number;
  note: string;
  status: EntryStatus;
  created_by: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface Payment {
  id: string;
  household_id: string;
  member_id: string;
  amount: number;
  paid_on: string;
  method: string;
  note: string;
  paid_by: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export interface Invite {
  code: string;
  household_id: string;
  role: Role;
  member_id: string | null;
  expires_at: string;
  used_at: string | null;
}
