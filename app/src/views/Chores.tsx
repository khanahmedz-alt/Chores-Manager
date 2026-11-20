import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Empty, Modal, ScrollBox } from '../ui';
import type { Chore, Household } from '../types';
import { COUNTRIES, DAY_LETTERS, DAYS, DAYS_LONG, FREQ, STARTER_CHORES, choreRate, countryName, dur, familyRate, freqFor, hrs, money, num, pad, r2, sessionMins, slotFor, uniq, weekOf, weeklyBudget } from '../lib/util';
import { t, lang } from '../i18n';

/** Chores and pay. Shown as a section of the Remuneration page. */
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
    household_id: h.id, name: t(c.name), hours_per_week: c.hours_per_week, frequency: c.frequency, days: FREQ[c.frequency], sort_order: i + 1,
  }))), t('Added the example chores'));

  return (
    <>
      <div className="page-head section-head" id="chores"><div><h2 className="section-title">{t('Chores & pay')}</h2><p className="muted">{isParent ? t('Add chores, set the hours and days, and set the rate of pay. Tap a chore to change it.') : t('The family chores and what each one pays.')}</p></div>
        {isParent && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn ghost" onClick={() => setSettings(true)}>{t('Settings')}</button><button className="btn primary" onClick={() => setEdit('new')}>{t('+ New chore')}</button></div>}</div>
      <div className="stack">
        <section className="stack" style={{ gap: 10 }}>
          <div className="rate" aria-label={t('Pay rate')}>
            <div><small>{t('/month')}</small><b>{num(h.monthly_budget)}</b></div>
            <div><small>{t('/wk')}</small><b>{num(wb)}</b></div>
            <div><small>{t('/hr')}</small><b>{num(rate)}</b></div>
          </div>
          <p className="cap">{h.rate_mode === 'manual' ? t('Fixed hourly rate set by parents.')
            : t('{month} a month × 12 ÷ 52 weeks = {week} a week, shared over {hours} budgeted hours.', { month: money(h, h.monthly_budget), week: money(h, wb), hours: hrs(h.budget_hours) })}</p>
        </section>
        {cs.length > 0 && <section className="panel flat">
          <div className="panel-head"><h2>{t('Planned chores vs weekly budget')}</h2><span className="num"><b style={{ color: 'var(--heading)' }}>{money(h, totalPay)}</b> <span className="muted">{t('of {budget} · {hours} of {max} hrs', { budget: money(h, wb), hours: hrs(totalHrs), max: hrs(h.budget_hours) })}</span></span></div>
          <div className={`meter ${pct > 100 ? 'over' : ''}`} role="img" aria-label={t('{p}% of the weekly budget planned', { p: pct })}><i style={{ width: `${Math.min(pct, 100)}%` }} /></div>
          <p className="cap" style={{ marginTop: 8 }}>{pct > 100 ? t('Planned chores cost {p}% of the weekly budget.', { p: pct }) : t('{p}% of the weekly budget is planned. {free} a week is free for new chores.', { p: pct, free: money(h, r2(wb - totalPay)) })}</p>
        </section>}
        {cs.length ? <ScrollBox><table>
          <thead><tr><th>{t('Task')}</th><th className="r">{t('Hrs/wk')}</th><th className="r">{t('Wk payment')}</th><th>{t('Activity')}</th><th>{t('Days')}</th><th>{t('This week')}</th></tr></thead>
          <tbody>{cs.map(c => {
            const who = uniq(DAYS.map((_, d) => slotFor(F.slotIndex, cw, c, d).kid).filter((x): x is string => !!x)).map(F.member);
            return (
              <tr key={c.id} className={isParent ? 'click' : ''} tabIndex={isParent ? 0 : undefined}
                onClick={isParent ? () => setEdit(c) : undefined} onKeyDown={isParent ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEdit(c); } } : undefined}>
                <td><span className="task">{c.name}</span>{c.description && <span className="chore-desc">{c.description}</span>}{c.rate ? <><br /><span className="cap">{t('Own rate {rate}/hr', { rate: money(h, c.rate) })}</span></> : null}</td>
                <td className="r">{hrs(c.hours_per_week)}</td><td className="r">{money(h, c.hours_per_week * choreRate(h, c))}</td>
                <td>{t(c.frequency || freqFor(c.days))}<br /><span className="cap">{t('{time} a session', { time: dur(sessionMins(c)) })}</span></td>
                <td><span className="daydots" aria-label={c.days.map(d => DAYS[d]).join(', ')}>{DAYS.map((d, i) => <i key={d} className={c.days.includes(i) ? 'on' : ''}>{DAY_LETTERS[i]}</i>)}</span></td>
                <td>{who.length ? <span style={{ display: 'inline-flex', gap: 3 }}>{who.map(m => <Avatar key={m!.id} m={m} size="sm" />)}</span> : <span className="cap">{t('Open')}</span>}</td>
              </tr>);
          })}</tbody>
          <tfoot><tr><td>{t('Total')}</td><td className="r">{hrs(totalHrs)}</td><td className="r">{money(h, totalPay)}</td><td colSpan={3} /></tr></tfoot>
        </table></ScrollBox>
          : <Empty title={t('No chores yet')}><p className="muted">{isParent ? t('Add your first chore, or start with four examples: car wash, gardening, pool and cat litter.') : t('Your parents will add the chores here.')}</p>
            {isParent && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><button className="btn primary" onClick={seed}>{t('Add example chores')}</button><button className="btn ghost" onClick={() => setEdit('new')}>{t('+ New chore')}</button></div>}</Empty>}
        {isParent && arch.length > 0 && <section className="panel flat">
          <div className="panel-head"><h2>{t('Archived chores')}</h2><button className="link" onClick={() => setShowArch(!showArch)}>{showArch ? t('Hide') : t('Show {n}', { n: arch.length })}</button></div>
          {showArch && <div className="entries">{arch.map(c => <div className="entry" key={c.id}><span className="what">{c.name}</span>
            <span><button className="btn ghost sm" onClick={() => F.run(['chores'], () => supabase.from('chores').update({ active: true }).eq('id', c.id), t('Chore restored'))}>{t('Restore')}</button></span></div>)}</div>}
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
  const [desc, setDesc] = useState(chore?.description || '');
  const [hours, setHours] = useState(String(chore?.hours_per_week ?? 2));
  const [days, setDays] = useState<number[]>(chore?.days || FREQ['Alternate day']);
  const [freq, setFreq] = useState(chore?.frequency || 'Alternate day');
  const [rate, setRate] = useState(chore?.rate ? String(chore.rate) : '');
  const [err, setErr] = useState('');
  const hNum = Number(hours) || 0, rNum = Number(rate) > 0 ? Number(rate) : familyRate(h);

  const toggle = (d: number) => { const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b); setDays(next); setFreq(freqFor(next)); };
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!name.trim()) { setErr(t('Give the chore a name.')); return; }
    if (!(hNum > 0)) { setErr(t('Hours per week must be more than 0.')); return; }
    if (!days.length) { setErr(t('Pick at least one day.')); return; }
    const body = { name: name.trim(), description: desc.trim(), hours_per_week: hNum, frequency: freq, days, rate: Number(rate) > 0 ? r2(Number(rate)) : null };
    const ok = chore
      ? await F.run(['chores'], () => supabase.from('chores').update(body).eq('id', chore.id), t('Chore saved'))
      : await F.run(['chores'], () => supabase.from('chores').insert({ ...body, household_id: h.id, sort_order: Math.max(0, ...F.chores.map(c => c.sort_order)) + 1 }), t('{name} added', { name: body.name }));
    if (ok) onClose();
  }
  return (
    <Modal title={chore ? t('Edit chore') : t('New chore')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>{t('Chore name')}</span><input type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={t('e.g. Take out the bins')} /></label>
        <label className="field"><span>{t('Description')} <small>{t('(optional)')}</small></span>
          <textarea rows={3} maxLength={1000} value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('What does “done properly” look like? e.g. Wash, dry and put away all dishes, then wipe the counter.')} />
          <small>{t('The children see this when they log the chore.')}</small></label>
        <div className="row2">
          <label className="field"><span>{t('Hours per week')}</span><input type="number" min={0.25} step={0.25} value={hours} onChange={e => setHours(e.target.value)} /></label>
          <label className="field"><span>{t('Activity')}</span><select value={freq} onChange={e => { setFreq(e.target.value); if (FREQ[e.target.value]) setDays(FREQ[e.target.value]); }}>
            {[...Object.keys(FREQ), 'Custom'].map(f => <option key={f} value={f}>{t(f)}</option>)}</select></label>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{t('Days')}</legend>
          <div className="daypick">{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={days.includes(i)} onChange={() => toggle(i)} />{d}</label>)}</div></fieldset>
        <label className="field"><span>{t('Own hourly rate')} <small>{t('(optional)')}</small></span><input type="number" min={0} step={0.01} value={rate} onChange={e => setRate(e.target.value)} placeholder={t('Family rate {rate}', { rate: num(familyRate(h)) })} />
          <small>{t('Leave blank to use the family rate.')}</small></label>
        <div className="preview"><span className="muted num">{t('{hours} hrs × {rate}/hr', { hours: hrs(hNum), rate: money(h, rNum) })}{days.length ? ' · ' + t('{time} × {n} days', { time: dur(Math.round(hNum * 60 / days.length / 5) * 5), n: days.length }) : ''}</span><b className="num">{money(h, r2(hNum * rNum))} {t('/wk')}</b></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {chore && <button type="button" className="btn warn left" onClick={async () => { if (await F.run(['chores'], () => supabase.from('chores').update({ active: false }).eq('id', chore.id), t('{name} archived', { name: chore.name }))) onClose(); }}>{t('Archive')}</button>}
          <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn primary">{chore ? t('Save chore') : t('Add chore')}</button>
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
    const body = { name: s.name.trim() || h.name, country: s.country || '', currency: s.currency.trim(), monthly_budget: Math.max(0, Number(s.monthly_budget) || 0), budget_hours: Math.max(1, Number(s.budget_hours) || 1),
      rate_mode: s.rate_mode, manual_rate: Math.max(0, r2(Number(s.manual_rate) || 0)), release_dow: Number(s.release_dow), release_hour: Number(s.release_hour), timezone: s.timezone };
    if (await F.run(['households'], () => supabase.from('households').update(body).eq('id', h.id), t('Settings saved'))) onClose();
  }
  return (
    <Modal title={t('Settings')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="row2">
          <label className="field"><span>{t('Family name')}</span><input type="text" maxLength={80} value={s.name} onChange={e => set('name', e.target.value)} /></label>
          <label className="field"><span>{t('Country')}</span>
            <select value={s.country || ''} onChange={e => set('country', e.target.value)}>
              <option value="">{t('Not set')}</option>
              {COUNTRIES.map(c => ({ code: c.code, label: countryName(c.code) })).sort((a, b) => a.label.localeCompare(b.label, lang())).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              <option value="ZZ">{t('Other')}</option>
            </select></label>
        </div>
        <div className="field"><span>{t('How the hourly rate is set')}</span>
          <div className="seg" role="group">
            <button type="button" aria-pressed={s.rate_mode !== 'manual'} onClick={() => set('rate_mode', 'budget')}>{t('From monthly budget')}</button>
            <button type="button" aria-pressed={s.rate_mode === 'manual'} onClick={() => set('rate_mode', 'manual')}>{t('Fixed hourly rate')}</button></div></div>
        {s.rate_mode === 'budget' ? <div className="row2">
          <label className="field"><span>{t('Monthly budget')}</span><input type="number" min={0} value={s.monthly_budget} onChange={e => set('monthly_budget', e.target.value as unknown as number)} /></label>
          <label className="field"><span>{t('Budgeted hours a week')}</span><input type="number" min={1} step={0.5} value={s.budget_hours} onChange={e => set('budget_hours', e.target.value as unknown as number)} /></label>
        </div> : <label className="field"><span>{t('Hourly rate')}</span><input type="number" min={0} step={0.01} value={s.manual_rate} onChange={e => set('manual_rate', e.target.value as unknown as number)} /></label>}
        <div className="preview">
          <span className="muted num">{s.rate_mode === 'budget' ? t('{month}/month → {week}/wk ÷ {hours} hrs', { month: num(Number(s.monthly_budget)), week: num(wk), hours: hrs(Number(s.budget_hours)) }) : t('Fixed rate')}</span>
          <b className="num">{num(s.rate_mode === 'budget' ? (Number(s.budget_hours) ? wk / Number(s.budget_hours) : 0) : Number(s.manual_rate))} {t('/hr')}</b></div>
        <p className="cap">{t('Changing the rate affects new time only. Time already logged keeps the rate it was logged at.')}</p>
        <div className="row2">
          <label className="field"><span>{t('Currency symbol')}</span><input type="text" maxLength={6} value={s.currency} onChange={e => set('currency', e.target.value)} placeholder={t('e.g. SAR or £')} /></label>
          <label className="field"><span>{t('Time zone')}</span>{TIMEZONES.length
            ? <select value={s.timezone} onChange={e => set('timezone', e.target.value)}>{(TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES]).map(z => <option key={z}>{z}</option>)}</select>
            : <input type="text" value={s.timezone} onChange={e => set('timezone', e.target.value)} />}</label>
        </div>
        <div className="field"><span>{t('Next week’s schedule goes up')}</span><div className="row2">
          <select aria-label={t('Day')} value={s.release_dow} onChange={e => set('release_dow', Number(e.target.value))}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <select aria-label={t('Time')} value={s.release_hour} onChange={e => set('release_hour', Number(e.target.value))}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{pad(i)}:00</option>)}</select></div>
          <small>{t('Children can see and pick from the following week from this time.')}</small></div>
        <div className="sheet-actions"><button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="btn primary">{t('Save settings')}</button></div>
      </form>
    </Modal>
  );
}
