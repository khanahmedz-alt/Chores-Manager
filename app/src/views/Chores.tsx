import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Empty, Modal } from '../ui';
import type { Chore, Household } from '../types';
import { DAYS, DAYS_LONG, FREQ, STARTER_CHORES, choreRate, dur, familyRate, freqFor, hrs, money, num, pad, r2, sessionMins, slotFor, uniq, weekOf, weeklyBudget } from '../lib/util';

export function Chores() {
  const F = useFamily();
  const { household: h, isParent, activeChores: cs } = F;
  const [edit, setEdit] = useState<Chore | 'new' | null>(null);
  const [settings, setSettings] = useState(false);
  const [showArch, setShowArch] = useState(false);
  const wb = weeklyBudget(h), rate = familyRate(h);
  const totalHrs = cs.reduce((s, c) => s + c.hours_per_week, 0);
  const totalPay = r2(cs.reduce((s, c) => s + c.hours_per_week * choreRate(h, c), 0));
  const pct = wb > 0 ? Math.round(totalPay / wb * 100) : 0;
  const arch = F.chores.filter(c => !c.active);
  const cw = weekOf(F.today);

  const seed = () => F.run(['chores'], () => supabase.from('chores').insert(STARTER_CHORES.map((c, i) => ({
    household_id: h.id, name: c.name, hours_per_week: c.hours_per_week, frequency: c.frequency, days: FREQ[c.frequency], sort_order: i + 1,
  }))), 'Added the example chores');

  return (
    <>
      <div className="page-head"><div><h1>Chores &amp; pay</h1><p className="muted">{isParent ? 'Add chores, set the hours and days, and set the rate of pay. Tap a chore to change it.' : 'The family chores and what each one pays.'}</p></div>
        {isParent && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn ghost" onClick={() => setSettings(true)}>Settings</button><button className="btn primary" onClick={() => setEdit('new')}>+ New chore</button></div>}</div>
      <div className="stack">
        <section className="stack" style={{ gap: 10 }}>
          <div className="rate" aria-label="Pay rate">
            <div><small>/month</small><b>{num(h.monthly_budget)}</b></div>
            <div><small>/wk</small><b>{num(wb)}</b></div>
            <div><small>/hr</small><b>{num(rate)}</b></div>
          </div>
          <p className="cap">{h.rate_mode === 'manual' ? 'Fixed hourly rate set by parents.'
            : `${money(h, h.monthly_budget)} a month × 12 ÷ 52 weeks = ${money(h, wb)} a week, shared over ${hrs(h.budget_hours)} budgeted hours.`}</p>
        </section>
        {cs.length > 0 && <section className="panel flat">
          <div className="panel-head"><h2>Planned chores vs weekly budget</h2><span className="num"><b style={{ color: 'var(--heading)' }}>{money(h, totalPay)}</b> <span className="muted">of {money(h, wb)} · {hrs(totalHrs)} of {hrs(h.budget_hours)} hrs</span></span></div>
          <div className={`meter ${pct > 100 ? 'over' : ''}`} role="img" aria-label={`${pct}% of the weekly budget planned`}><i style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          <p className="cap" style={{ marginTop: 8 }}>{pct > 100 ? `Planned chores cost ${pct}% of the weekly budget.` : `${pct}% of the weekly budget is planned. ${money(h, r2(wb - totalPay))} a week is free for new chores.`}</p>
        </section>}
        {cs.length ? <div className="tbl-wrap"><table>
          <thead><tr><th>Task</th><th className="r">Hrs/wk</th><th className="r">Wk payment</th><th>Activity</th><th>Days</th><th>This week</th></tr></thead>
          <tbody>{cs.map(c => {
            const who = uniq(DAYS.map((_, d) => slotFor(F.slotIndex, cw, c, d).kid).filter((x): x is string => !!x)).map(F.member);
            return (
              <tr key={c.id} className={isParent ? 'click' : ''} tabIndex={isParent ? 0 : undefined}
                onClick={isParent ? () => setEdit(c) : undefined} onKeyDown={isParent ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEdit(c); } } : undefined}>
                <td><span className="task">{c.name}</span>{c.rate ? <><br /><span className="cap">Own rate {money(h, c.rate)}/hr</span></> : null}</td>
                <td className="r">{hrs(c.hours_per_week)}</td><td className="r">{money(h, c.hours_per_week * choreRate(h, c))}</td>
                <td>{c.frequency || freqFor(c.days)}<br /><span className="cap">{dur(sessionMins(c))} a session</span></td>
                <td><span className="daydots" aria-label={c.days.map(d => DAYS[d]).join(', ')}>{DAYS.map((d, i) => <i key={d} className={c.days.includes(i) ? 'on' : ''}>{d[0]}</i>)}</span></td>
                <td>{who.length ? <span style={{ display: 'inline-flex', gap: 3 }}>{who.map(m => <Avatar key={m!.id} m={m} size="sm" />)}</span> : <span className="cap">Open</span>}</td>
              </tr>);
          })}</tbody>
          <tfoot><tr><td>Total</td><td className="r">{hrs(totalHrs)}</td><td className="r">{money(h, totalPay)}</td><td colSpan={3} /></tr></tfoot>
        </table></div>
          : <Empty title="No chores yet"><p className="muted">{isParent ? 'Add your first chore, or start with four examples: car wash, gardening, pool and cat litter.' : 'Your parents will add the chores here.'}</p>
            {isParent && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><button className="btn primary" onClick={seed}>Add example chores</button><button className="btn ghost" onClick={() => setEdit('new')}>+ New chore</button></div>}</Empty>}
        {isParent && arch.length > 0 && <section className="panel flat">
          <div className="panel-head"><h2>Archived chores</h2><button className="link" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide' : `Show ${arch.length}`}</button></div>
          {showArch && <div className="entries">{arch.map(c => <div className="entry" key={c.id}><span className="what">{c.name}</span>
            <span><button className="btn ghost sm" onClick={() => F.run(['chores'], () => supabase.from('chores').update({ active: true }).eq('id', c.id), 'Chore restored')}>Restore</button></span></div>)}</div>}
        </section>}
      </div>
      {edit && <ChoreModal chore={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </>
  );
}

function ChoreModal({ chore, onClose }: { chore: Chore | null; onClose: () => void }) {
  const F = useFamily(); const h = F.household;
  const [name, setName] = useState(chore?.name || '');
  const [hours, setHours] = useState(String(chore?.hours_per_week ?? 2));
  const [days, setDays] = useState<number[]>(chore?.days || FREQ['Alternate day']);
  const [freq, setFreq] = useState(chore?.frequency || 'Alternate day');
  const [rate, setRate] = useState(chore?.rate ? String(chore.rate) : '');
  const [err, setErr] = useState('');
  const hNum = Number(hours) || 0, rNum = Number(rate) > 0 ? Number(rate) : familyRate(h);

  const toggle = (d: number) => { const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b); setDays(next); setFreq(freqFor(next)); };
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!name.trim()) { setErr('Give the chore a name.'); return; }
    if (!(hNum > 0)) { setErr('Hours per week must be more than 0.'); return; }
    if (!days.length) { setErr('Pick at least one day.'); return; }
    const body = { name: name.trim(), hours_per_week: hNum, frequency: freq, days, rate: Number(rate) > 0 ? r2(Number(rate)) : null };
    const ok = chore
      ? await F.run(['chores'], () => supabase.from('chores').update(body).eq('id', chore.id), 'Chore saved')
      : await F.run(['chores'], () => supabase.from('chores').insert({ ...body, household_id: h.id, sort_order: Math.max(0, ...F.chores.map(c => c.sort_order)) + 1 }), `${body.name} added`);
    if (ok) onClose();
  }
  return (
    <Modal title={chore ? 'Edit chore' : 'New chore'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>Chore name</span><input type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Take out the bins" /></label>
        <div className="row2">
          <label className="field"><span>Hours per week</span><input type="number" min={0.25} step={0.25} value={hours} onChange={e => setHours(e.target.value)} /></label>
          <label className="field"><span>Activity</span><select value={freq} onChange={e => { setFreq(e.target.value); if (FREQ[e.target.value]) setDays(FREQ[e.target.value]); }}>
            {[...Object.keys(FREQ), 'Custom'].map(f => <option key={f}>{f}</option>)}</select></label>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Days</legend>
          <div className="daypick">{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={days.includes(i)} onChange={() => toggle(i)} />{d}</label>)}</div></fieldset>
        <label className="field"><span>Own hourly rate <small>(optional)</small></span><input type="number" min={0} step={0.01} value={rate} onChange={e => setRate(e.target.value)} placeholder={`Family rate ${num(familyRate(h))}`} />
          <small>Leave blank to use the family rate.</small></label>
        <div className="preview"><span className="muted num">{hrs(hNum)} hrs × {money(h, rNum)}/hr{days.length ? ` · ${dur(Math.round(hNum * 60 / days.length / 5) * 5)} × ${days.length} days` : ''}</span><b className="num">{money(h, r2(hNum * rNum))} /wk</b></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {chore && <button type="button" className="btn warn left" onClick={async () => { if (await F.run(['chores'], () => supabase.from('chores').update({ active: false }).eq('id', chore.id), `${chore.name} archived`)) onClose(); }}>Archive</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{chore ? 'Save chore' : 'Add chore'}</button>
        </div>
      </form>
    </Modal>
  );
}

const TIMEZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone'); } catch { return []; } })();

function SettingsModal({ onClose }: { onClose: () => void }) {
  const F = useFamily(); const h = F.household;
  const [s, setS] = useState<Household>({ ...h });
  const set = <K extends keyof Household>(k: K, v: Household[K]) => setS(p => ({ ...p, [k]: v }));
  const wk = Number(s.monthly_budget) * 12 / 52;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { name: s.name.trim() || h.name, currency: s.currency.trim(), monthly_budget: Math.max(0, Number(s.monthly_budget) || 0), budget_hours: Math.max(1, Number(s.budget_hours) || 1),
      rate_mode: s.rate_mode, manual_rate: Math.max(0, r2(Number(s.manual_rate) || 0)), release_dow: Number(s.release_dow), release_hour: Number(s.release_hour), timezone: s.timezone };
    if (await F.run(['households'], () => supabase.from('households').update(body).eq('id', h.id), 'Settings saved')) onClose();
  }
  return (
    <Modal title="Settings" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>Family name</span><input type="text" maxLength={80} value={s.name} onChange={e => set('name', e.target.value)} /></label>
        <div className="field"><span>How the hourly rate is set</span>
          <div className="seg" role="group">
            <button type="button" aria-pressed={s.rate_mode !== 'manual'} onClick={() => set('rate_mode', 'budget')}>From monthly budget</button>
            <button type="button" aria-pressed={s.rate_mode === 'manual'} onClick={() => set('rate_mode', 'manual')}>Fixed hourly rate</button></div></div>
        {s.rate_mode === 'budget' ? <div className="row2">
          <label className="field"><span>Monthly budget</span><input type="number" min={0} value={s.monthly_budget} onChange={e => set('monthly_budget', e.target.value as unknown as number)} /></label>
          <label className="field"><span>Budgeted hours a week</span><input type="number" min={1} step={0.5} value={s.budget_hours} onChange={e => set('budget_hours', e.target.value as unknown as number)} /></label>
        </div> : <label className="field"><span>Hourly rate</span><input type="number" min={0} step={0.01} value={s.manual_rate} onChange={e => set('manual_rate', e.target.value as unknown as number)} /></label>}
        <div className="preview">
          <span className="muted num">{s.rate_mode === 'budget' ? `${num(Number(s.monthly_budget))}/month → ${num(wk)}/wk ÷ ${hrs(Number(s.budget_hours))} hrs` : 'Fixed rate'}</span>
          <b className="num">{num(s.rate_mode === 'budget' ? (Number(s.budget_hours) ? wk / Number(s.budget_hours) : 0) : Number(s.manual_rate))} /hr</b></div>
        <p className="cap">Changing the rate affects new time only. Time already logged keeps the rate it was logged at.</p>
        <div className="row2">
          <label className="field"><span>Currency symbol</span><input type="text" maxLength={6} value={s.currency} onChange={e => set('currency', e.target.value)} placeholder="e.g. SAR or £" /></label>
          <label className="field"><span>Time zone</span>{TIMEZONES.length
            ? <select value={s.timezone} onChange={e => set('timezone', e.target.value)}>{(TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES]).map(z => <option key={z}>{z}</option>)}</select>
            : <input type="text" value={s.timezone} onChange={e => set('timezone', e.target.value)} />}</label>
        </div>
        <div className="field"><span>Next week’s schedule goes up</span><div className="row2">
          <select aria-label="Day" value={s.release_dow} onChange={e => set('release_dow', Number(e.target.value))}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <select aria-label="Time" value={s.release_hour} onChange={e => set('release_hour', Number(e.target.value))}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{pad(i)}:00</option>)}</select></div>
          <small>Children can see and pick from the following week from this time.</small></div>
        <div className="sheet-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Save settings</button></div>
      </form>
    </Modal>
  );
}
