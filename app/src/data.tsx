import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, errorText } from './supabase';
import type { BonusMetric, Chore, Entry, Household, Member, Payment, Review, Slot, SlotKind } from './types';
import { addDays, setWeekStart, slotMap, todayIn, weekOf, type SlotMap } from './lib/util';
import { t } from './i18n';

type Table = 'households' | 'members' | 'chores' | 'schedule_slots' | 'time_entries' | 'payments' | 'bonus_metrics' | 'performance_reviews';

export interface FamilyData {
  household: Household;
  members: Member[];
  chores: Chore[];
  slots: Slot[];
  entries: Entry[];
  payments: Payment[];
  metrics: BonusMetric[];
  reviews: Review[];
}

interface FamilyCtx extends FamilyData {
  me: Member;
  isParent: boolean;
  kids: Member[];
  member: (id: string | null | undefined) => Member | undefined;
  activeChores: Chore[];
  slotIndex: SlotMap;
  today: string;
  reload: (t?: Table) => Promise<void>;
  toast: (msg: string) => void;
  /** Runs a write, shows the error as a toast, reloads the tables it touched. Returns true on success. */
  run: (tables: Table[], fn: () => PromiseLike<{ error: unknown }>, done?: string) => Promise<boolean>;
  setSlot: (week: string, choreId: string, day: number, kind: SlotKind | null, memberId?: string | null) => Promise<boolean>;
}

const Ctx = createContext<FamilyCtx | null>(null);
export const useFamily = () => { const c = useContext(Ctx); if (!c) throw new Error('useFamily outside provider'); return c; };

const num = <T extends object>(rows: T[] | null, keys: (keyof T)[]): T[] =>
  (rows || []).map(r => { const o = { ...r }; for (const k of keys) if (o[k] != null) (o as Record<string, unknown>)[k as string] = Number(o[k]); return o; });

async function fetchTable(t: Table, hh: string): Promise<Partial<FamilyData>> {
  switch (t) {
    case 'households': {
      const { data, error } = await supabase.from('households').select('*').eq('id', hh).single();
      if (error) throw error;
      return { household: num([data as Household], ['monthly_budget', 'budget_hours', 'manual_rate', 'release_dow', 'release_hour', 'week_start_dow'])[0] };
    }
    case 'members': {
      const { data, error } = await supabase.from('members').select('*').eq('household_id', hh).order('sort_order').order('created_at');
      if (error) throw error; return { members: data as Member[] };
    }
    case 'chores': {
      const { data, error } = await supabase.from('chores').select('*').eq('household_id', hh).order('sort_order').order('name');
      if (error) throw error; return { chores: num(data as Chore[], ['hours_per_week', 'rate']) };
    }
    case 'schedule_slots': {
      const since = addDays(weekOf(todayIn('UTC')), -56);
      const { data, error } = await supabase.from('schedule_slots').select('*').eq('household_id', hh).gte('week_start', since);
      if (error) throw error; return { slots: data as Slot[] };
    }
    case 'time_entries': {
      const { data, error } = await supabase.from('time_entries').select('*').eq('household_id', hh).order('work_date').order('created_at').limit(5000);
      if (error) throw error; return { entries: num(data as Entry[], ['minutes', 'rate', 'amount', 'split']).map(e => ({ ...e, team_members: e.team_members || [], split: e.split ?? 1 })) };
    }
    case 'payments': {
      const { data, error } = await supabase.from('payments').select('*').eq('household_id', hh).order('paid_on', { ascending: false }).limit(2000);
      if (error) throw error; return { payments: num(data as Payment[], ['amount']) };
    }
    case 'bonus_metrics': {
      const { data, error } = await supabase.from('bonus_metrics').select('*').eq('household_id', hh).order('sort_order').order('created_at');
      if (error) return { metrics: [] }; // not set up yet (migration 0002 not run): the rest of the app still works
      return { metrics: num(data as BonusMetric[], ['max_percent']) };
    }
    case 'performance_reviews': {
      const { data, error } = await supabase.from('performance_reviews').select('*').eq('household_id', hh).order('week_start', { ascending: false }).limit(2000);
      if (error) return { reviews: [] };
      return { reviews: num(data as Review[], ['base_amount', 'bonus_percent', 'bonus_amount']) };
    }
  }
}
const ALL: Table[] = ['households', 'members', 'chores', 'schedule_slots', 'time_entries', 'payments', 'bonus_metrics', 'performance_reviews'];

export function FamilyProvider({ householdId, userId, children, fallback }: { householdId: string; userId: string; children: ReactNode; fallback: (state: { error?: string; retry: () => void }) => ReactNode }) {
  const [data, setData] = useState<FamilyData | null>(null);
  const [error, setError] = useState<string>();
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);
  const pending = useRef(new Set<Table>());
  const timer = useRef<number>(0);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg); window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const reload = useCallback(async (t?: Table) => {
    const tables = t ? [t] : ALL;
    try {
      const parts = await Promise.all(tables.map(x => fetchTable(x, householdId)));
      setData(prev => {
        const next = Object.assign({}, prev || {}, ...parts) as FamilyData;
        return next;
      });
      setError(undefined);
    } catch (e) {
      if (!t) setError(errorText(e)); else toast(errorText(e));
    }
  }, [householdId, toast]);

  // Coalesce bursts of realtime events into one fetch per table.
  const schedule = useCallback((t: Table) => {
    pending.current.add(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const ts = [...pending.current]; pending.current.clear();
      ts.forEach(x => void reload(x));
    }, 150);
  }, [reload]);

  useEffect(() => {
    setData(null); void reload();
    const ch = supabase.channel('family:' + householdId);
    for (const t of ALL) {
      const filter = t === 'households' ? `id=eq.${householdId}` : `household_id=eq.${householdId}`;
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter }, () => schedule(t));
      if (t !== 'households') ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: t }, () => schedule(t));
    }
    ch.subscribe();
    const onFocus = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { void supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onFocus); };
  }, [householdId, reload, schedule]);

  const value = useMemo<FamilyCtx | null>(() => {
    if (!data || !data.household || !data.members) return null;
    const me = data.members.find(m => m.user_id === userId && m.active);
    if (!me) return null;
    const run: FamilyCtx['run'] = async (tables, fn, done) => {
      try {
        const { error } = await fn();
        if (error) { toast(errorText(error)); return false; }
        await Promise.all(tables.map(t => reload(t)));
        if (done) toast(done);
        return true;
      } catch (e) { toast(errorText(e)); return false; }
    };
    const setSlot: FamilyCtx['setSlot'] = (week, choreId, day, kind, memberId = null) =>
      run(['schedule_slots'], () => kind === null
        ? supabase.from('schedule_slots').delete().match({ chore_id: choreId, week_start: week, day })
        : supabase.from('schedule_slots').upsert({ household_id: data.household.id, week_start: week, chore_id: choreId, day, kind, member_id: kind === 'kid' ? memberId : null }, { onConflict: 'chore_id,week_start,day' }));
    setWeekStart(data.household.week_start_dow); // every week calculation below and in the views uses it
    const active = data.members.filter(m => m.active);
    return {
      ...data,
      me,
      isParent: me.role === 'parent',
      kids: active.filter(m => m.role === 'child'),
      member: id => data.members.find(m => m.id === id),
      activeChores: data.chores.filter(c => c.active),
      slotIndex: slotMap(data.slots),
      today: todayIn(data.household.timezone),
      reload, toast, run, setSlot,
    };
  }, [data, userId, reload, toast]);

  if (!value) {
    const notMember = data && data.members && !data.members.some(m => m.user_id === userId && m.active);
    return <>{fallback({ error: error || (notMember ? t('You are no longer part of this family.') : undefined), retry: () => void reload() })}</>;
  }
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status" aria-live="polite">{toastMsg}</div>}
    </Ctx.Provider>
  );
}
