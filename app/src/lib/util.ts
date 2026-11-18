import type { Chore, Household, Slot, Tier } from '../types';
import { lang, locale, subscribeLang } from '../i18n';

/* Day names follow the app language. These arrays are refilled in place when the language changes
   (the whole app re-renders then), so every DAYS[i] / DAYS_LONG[i] reads the current language. */
const DAY_NAMES = {
  en: { short: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], long: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], letter: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] },
  ar: { short: ['اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت', 'أحد'], long: ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'], letter: ['ن', 'ث', 'ر', 'خ', 'ج', 'س', 'ح'] },
};
export const DAYS: string[] = [];
export const DAYS_LONG: string[] = [];
export const DAY_LETTERS: string[] = [];
function fillDays() {
  const d = DAY_NAMES[lang()];
  DAYS.splice(0, 7, ...d.short); DAYS_LONG.splice(0, 7, ...d.long); DAY_LETTERS.splice(0, 7, ...d.letter);
}
fillDays();
subscribeLang(fillDays);
export const FREQ: Record<string, number[]> = {
  'Daily': [0, 1, 2, 3, 4, 5, 6],
  'Alternate day': [0, 2, 4, 6],
  'Twice weekly': [1, 4],
  'Once weekly': [5],
};
export const STARTER_CHORES = [
  { name: 'Car Wash & Cleaning', hours_per_week: 3, frequency: 'Once weekly' },
  { name: 'Gardening', hours_per_week: 8, frequency: 'Alternate day' },
  { name: 'Clean Pool', hours_per_week: 8, frequency: 'Alternate day' },
  { name: 'Cat Litter', hours_per_week: 1.5, frequency: 'Alternate day' },
];
export const MEMBER_COLORS = ['#41b883', '#ff6b6d', '#8e44ad', '#ffd166', '#58c091', '#1e3a5f', '#35495e', '#e67e22'];

/* ---------- dates (YYYY-MM-DD strings, Monday-first weeks) ---------- */
export const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const weekOf = (s: string) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const dayIdx = (s: string) => (parse(s).getDay() + 6) % 7;
export const fmtDay = (s: string) => parse(s).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDate = (s: string) => parse(s).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtRange = (w: string) =>
  `${parse(w).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(w, 6))}`;

/** Today's date in a time zone, as YYYY-MM-DD. */
export function todayIn(tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return iso(new Date()); }
}

/** The instant a wall-clock time (date + hour) happens in a time zone. */
export function zonedInstant(date: string, hour: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const offsetAt = (t: number) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t));
      const v = (k: string) => Number(parts.find(p => p.type === k)?.value);
      return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - t;
    } catch { return 0; }
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

/** When the schedule for the week starting `week` goes up for the children (matches the database's week_release_at). */
export const releaseAt = (h: Household, week: string) => zonedInstant(addDays(week, -7 + Number(h.release_dow)), Number(h.release_hour), h.timezone);
export const isOpen = (h: Household, week: string) => Date.now() >= releaseAt(h, week).getTime();
export const fmtRelease = (h: Household, week: string) =>
  releaseAt(h, week).toLocaleString(locale(), { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ---------- numbers ---------- */
export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const num = (n: number) => (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (h: Household, n: number) => { const c = (h.currency || '').trim(); return c ? `${c} ${num(n)}` : num(n); };
export const dur = (m: number) => {
  m = Math.round(Number(m) || 0); const h = Math.floor(m / 60), mm = m % 60;
  if (lang() === 'ar') return h ? `${h} س ${pad(mm)} د` : `${mm} د`;
  return h ? `${h}h ${pad(mm)}m` : `${mm}m`;
};
export const hrs = (h: number) => (Math.round((Number(h) || 0) * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });

/* ---------- pay ---------- */
export const weeklyBudget = (h: Household) => r2(Number(h.monthly_budget) * 12 / 52);
export const familyRate = (h: Household) => h.rate_mode === 'manual'
  ? Number(h.manual_rate) || 0
  : (Number(h.budget_hours) > 0 ? Number(h.monthly_budget) * 12 / 52 / Number(h.budget_hours) : 0);
export const choreRate = (h: Household, c?: Chore | null) => (c && Number(c.rate) > 0) ? Number(c.rate) : familyRate(h);
export const sessionMins = (c: Pick<Chore, 'days' | 'hours_per_week'>) =>
  c.days && c.days.length ? Math.round(Number(c.hours_per_week) * 60 / c.days.length / 5) * 5 : 0;
export const freqFor = (days: number[]) => {
  const s = [...days].sort((a, b) => a - b);
  for (const k in FREQ) if (FREQ[k].length === s.length && FREQ[k].every((v, i) => v === s[i])) return k;
  return 'Custom';
};

/* ---------- schedule ---------- */
export type SlotMap = Map<string, Slot>;
export const slotKey = (choreId: string, week: string, day: number) => `${choreId}_${week}_${day}`;
export const slotMap = (slots: Slot[]): SlotMap => new Map(slots.map(s => [slotKey(s.chore_id, s.week_start, s.day), s]));
export interface SlotState { on: boolean; kid: string | null; slot: Slot | null }
export function slotFor(map: SlotMap, week: string, c: Chore, day: number): SlotState {
  const s = map.get(slotKey(c.id, week, day)) || null;
  if (s && s.kind === 'off') return { on: false, kid: null, slot: s };
  if (s && (s.kind === 'kid' || s.kind === 'open')) return { on: true, kid: s.member_id, slot: s };
  return { on: c.days.includes(day), kid: null, slot: null };
}
export function kidLoad(h: Household, chores: Chore[], map: SlotMap, week: string, kid: string) {
  let mins = 0, pay = 0;
  for (const c of chores) for (let d = 0; d < 7; d++) {
    const s = slotFor(map, week, c, d);
    if (s.on && s.kid === kid) { mins += sessionMins(c); pay += sessionMins(c) / 60 * choreRate(h, c); }
  }
  return { mins, pay: r2(pay) };
}
export function openSlots(chores: Chore[], map: SlotMap, week: string, today: string) {
  let n = 0;
  for (const c of chores) for (let d = 0; d < 7; d++) {
    const s = slotFor(map, week, c, d);
    if (s.on && !s.kid && addDays(week, d) >= today) n++;
  }
  return n;
}

/** Short month name for a date, in the app language. */
export const fmtMonth = (s: string) => parse(s).toLocaleDateString(locale(), { month: 'short' });
/** Date and time of a stored timestamp, in the app language. */
export const fmtWhen = (isoTime: string, opts: Intl.DateTimeFormatOptions) => new Date(isoTime).toLocaleString(locale(), opts);

/** Dark or light text for a background colour. */
export function textOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return '#ffffff';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.5 ? '#0b1a10' : '#ffffff';
}
export const uniq = <T,>(a: T[]) => [...new Set(a)];

/* ---------- performance bonus ---------- */
export const TIERS: { id: Tier; label: string; factor: number }[] = [
  { id: 'meets', label: 'Meets', factor: 0 },
  { id: 'good', label: 'Good', factor: 0.25 },
  { id: 'excelled', label: 'Excelled', factor: 1 },
];
export const tierFactor = (t: Tier) => TIERS.find(x => x.id === t)?.factor ?? 0;
export const pct = (n: number) => `${(Math.round(Number(n) * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
