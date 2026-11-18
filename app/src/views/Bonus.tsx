import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Confirm, Empty, Modal } from '../ui';
import type { BonusMetric, Member, Review, Tier } from '../types';
import { TIERS, addDays, fmtRange, money, pct, r2, tierFactor, weekOf } from '../lib/util';

const EXAMPLES = [
  { name: 'School grades', max_percent: 10, meets_text: 'Grades as expected', good_text: 'Improved or mostly Bs', excelled_text: 'Mostly As or top marks' },
  { name: 'Homework on time', max_percent: 5, meets_text: 'Handed in on time', good_text: 'Done without reminders', excelled_text: 'Done early and checked' },
  { name: 'Quality of chores', max_percent: 5, meets_text: 'Done as asked', good_text: 'Done well, no redo', excelled_text: 'Went beyond what was asked' },
];

/** The family's bonus metrics (parents edit; children read) and the reviews so far. */
export function Bonus() {
  const F = useFamily();
  const { household: h, isParent } = F;
  const [edit, setEdit] = useState<BonusMetric | 'new' | null>(null);
  const [award, setAward] = useState<Member | null>(null);
  const [showArch, setShowArch] = useState(false);
  const active = F.metrics.filter(m => m.active), arch = F.metrics.filter(m => !m.active);
  const totalMax = active.reduce((s, m) => s + m.max_percent, 0);
  const reviews = F.reviews.filter(r => isParent || r.member_id === F.me.id).slice(0, 12);

  const seed = () => F.run(['bonus_metrics'], () => supabase.from('bonus_metrics').insert(EXAMPLES.map((m, i) => ({ ...m, household_id: h.id, sort_order: i + 1 }))), 'Added the example metrics');

  return (
    <>
      <div className="page-head"><div><h1>Performance bonus</h1>
        <p className="muted">{isParent ? 'Set what you measure and the most each one can add. Award the bonus from Approvals (or here) when you review a week.'
          : 'How you can earn a bonus on top of your chore pay. Your parents rate each one when they review your week.'}</p></div>
        {isParent && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {F.kids.length > 0 && active.length > 0 && <button className="btn ghost" onClick={() => setAward(F.kids[0])}>Award a bonus</button>}
          <button className="btn primary" onClick={() => setEdit('new')}>+ New metric</button></div>}
      </div>
      <div className="stack">
        <div className="tiers">{TIERS.map(t => (
          <div key={t.id} className={`tier tier-${t.id}`}><b>{t.label}</b><span>{t.factor === 0 ? 'No bonus' : t.factor === 1 ? '100% of the max' : `${t.factor * 100}% of the max`}</span></div>))}
        </div>
        <p className="cap">The bonus is a percentage of that week’s approved chore pay. Example: School grades has a max of 10%. “Good” adds 2.5%, “Excelled” adds the full 10%. On {money(h, 100)} of chore pay, that’s {money(h, 2.5)} or {money(h, 10)}.</p>
        {active.length ? <div className="tbl-wrap"><table>
          <thead><tr><th>Metric</th><th className="r">Max</th><th>Meets <span className="cap">(0%)</span></th><th>Good <span className="cap">(25%)</span></th><th>Excelled <span className="cap">(100%)</span></th></tr></thead>
          <tbody>{active.map(m => (
            <tr key={m.id} className={isParent ? 'click' : ''} tabIndex={isParent ? 0 : undefined} onClick={isParent ? () => setEdit(m) : undefined}
              onKeyDown={isParent ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEdit(m); } } : undefined}>
              <td><span className="task">{m.name}</span></td><td className="r"><b>{pct(m.max_percent)}</b></td>
              <td>{m.meets_text || <span className="muted">–</span>}<br /><span className="cap">+0%</span></td>
              <td>{m.good_text || <span className="muted">–</span>}<br /><span className="cap">+{pct(m.max_percent * 0.25)}</span></td>
              <td>{m.excelled_text || <span className="muted">–</span>}<br /><span className="cap">+{pct(m.max_percent)}</span></td>
            </tr>))}</tbody>
          <tfoot><tr><td>Most a child can earn</td><td className="r">{pct(totalMax)}</td><td colSpan={3} className="cap">if they Excel at everything</td></tr></tfoot>
        </table></div>
          : <Empty title="No metrics yet"><p className="muted">{isParent ? 'Add what you’d like to reward, such as school grades, homework or the quality of chores, with the most each can add.' : 'Your parents haven’t set any bonus metrics yet.'}</p>
            {isParent && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><button className="btn primary" onClick={seed}>Add example metrics</button><button className="btn ghost" onClick={() => setEdit('new')}>+ New metric</button></div>}</Empty>}
        {isParent && arch.length > 0 && <section className="panel flat">
          <div className="panel-head"><h2>Archived metrics</h2><button className="link" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide' : `Show ${arch.length}`}</button></div>
          {showArch && <div className="entries">{arch.map(m => <div className="entry" key={m.id}><span className="what">{m.name} · {pct(m.max_percent)}</span>
            <span><button className="btn ghost sm" onClick={() => F.run(['bonus_metrics'], () => supabase.from('bonus_metrics').update({ active: true }).eq('id', m.id), 'Metric restored')}>Restore</button></span></div>)}</div>}
        </section>}
        <section className="stack" style={{ gap: 10 }}><h2>{isParent ? 'Bonuses awarded' : 'My bonuses'}</h2>
          {reviews.length ? <div className="tbl-wrap"><table>
            <thead><tr><th>Week</th>{isParent && <th>Child</th>}<th>Ratings</th><th className="r">Bonus</th></tr></thead>
            <tbody>{reviews.map(r => (
              <tr key={r.id} className={isParent ? 'click' : ''} onClick={isParent ? () => setAward(F.member(r.member_id) || null) : undefined}>
                <td>{fmtRange(r.week_start)}</td>{isParent && <td>{F.member(r.member_id)?.display_name}</td>}
                <td>{r.ratings.map(x => <span key={x.metric_id} className={`pill tierpill tier-${x.tier}`}>{x.name}: {TIERS.find(t => t.id === x.tier)?.label}</span>)}
                  {r.note && <><br /><span className="cap">“{r.note}”</span></>}</td>
                <td className="r"><b>{money(h, r.bonus_amount)}</b><br /><span className="cap">{pct(r.bonus_percent)} of {money(h, r.base_amount)}</span></td>
              </tr>))}</tbody></table></div>
            : <p className="empty-note">{isParent ? 'No bonuses yet.' : 'No bonuses yet. Keep it up!'}</p>}
        </section>
      </div>
      {edit && <MetricModal metric={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {award && <AwardModal kid={award} onClose={() => setAward(null)} />}
    </>
  );
}

function MetricModal({ metric, onClose }: { metric: BonusMetric | null; onClose: () => void }) {
  const F = useFamily();
  const [name, setName] = useState(metric?.name || '');
  const [max, setMax] = useState(String(metric?.max_percent ?? 10));
  const [texts, setTexts] = useState({ meets_text: metric?.meets_text || '', good_text: metric?.good_text || '', excelled_text: metric?.excelled_text || '' });
  const [err, setErr] = useState('');
  const m = Number(max) || 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Give the metric a name, e.g. School grades.'); return; }
    if (!(m > 0 && m <= 100)) { setErr('The max must be between 0 and 100%.'); return; }
    const body = { name: name.trim(), max_percent: r2(m), ...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.trim()])) };
    const ok = metric
      ? await F.run(['bonus_metrics'], () => supabase.from('bonus_metrics').update(body).eq('id', metric.id), 'Metric saved')
      : await F.run(['bonus_metrics'], () => supabase.from('bonus_metrics').insert({ ...body, household_id: F.household.id, sort_order: Math.max(0, ...F.metrics.map(x => x.sort_order)) + 1 }), `${body.name} added`);
    if (ok) onClose();
  }
  return (
    <Modal title={metric ? 'Edit metric' : 'New bonus metric'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="row2">
          <label className="field"><span>Metric</span><input type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. School grades" /></label>
          <label className="field"><span>Max bonus</span><div className="suffix"><input type="number" min={0.5} max={100} step={0.5} value={max} onChange={e => setMax(e.target.value)} /><span>%</span></div><small>of the week’s chore pay</small></label>
        </div>
        {TIERS.map(t => (
          <label className="field" key={t.id}><span>{t.label} <small>· adds {pct(m * t.factor)}{t.id === 'meets' ? ' (no bonus)' : ''}</small></span>
            <input type="text" maxLength={200} value={texts[`${t.id}_text` as keyof typeof texts]} placeholder={EXAMPLES[0][`${t.id}_text` as 'meets_text']}
              onChange={e => setTexts(p => ({ ...p, [`${t.id}_text`]: e.target.value }))} /></label>))}
        <p className="cap">Describe what earns each level, so the children know what to aim for.</p>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {metric && <button type="button" className="btn warn left" onClick={async () => { if (await F.run(['bonus_metrics'], () => supabase.from('bonus_metrics').update({ active: false }).eq('id', metric.id), `${metric.name} archived`)) onClose(); }}>Archive</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{metric ? 'Save metric' : 'Add metric'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Rate a child's week against each metric. The bonus is worked out (again) by the database on save. */
export function AwardModal({ kid: kid0, week: week0, onClose }: { kid: Member; week?: string; onClose: () => void }) {
  const F = useFamily(); const h = F.household;
  const [kidId, setKidId] = useState(kid0.id);
  const [week, setWeek] = useState(week0 || weekOf(F.today));
  const existing: Review | undefined = F.reviews.find(r => r.member_id === kidId && r.week_start === week);
  const metrics = F.metrics.filter(m => m.active || existing?.ratings.some(x => x.metric_id === m.id));
  const initial = () => Object.fromEntries(metrics.map(m => [m.id, (existing?.ratings.find(x => x.metric_id === m.id)?.tier || 'meets') as Tier]));
  const [tiers, setTiers] = useState<Record<string, Tier>>(initial);
  const [note, setNote] = useState(existing?.note || '');
  const [del, setDel] = useState(false);
  const [loadedFor, setLoadedFor] = useState(kidId + week);
  if (loadedFor !== kidId + week) { setLoadedFor(kidId + week); setTiers(initial()); setNote(existing?.note || ''); }

  const base = r2(F.entries.filter(e => e.member_id === kidId && e.status === 'approved' && e.work_date >= week && e.work_date <= addDays(week, 6)).reduce((s, e) => s + e.amount, 0));
  const pending = F.entries.filter(e => e.member_id === kidId && e.status === 'submitted' && e.work_date >= week && e.work_date <= addDays(week, 6)).length;
  const total = metrics.reduce((s, m) => s + m.max_percent * tierFactor(tiers[m.id] || 'meets'), 0);
  const bonus = r2(base * total / 100);
  const kid = F.member(kidId)!;

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = { household_id: h.id, member_id: kidId, week_start: week, note: note.trim(), ratings: metrics.map(m => ({ metric_id: m.id, tier: tiers[m.id] || 'meets' })) };
    if (await F.run(['performance_reviews'], () => supabase.from('performance_reviews').upsert(body, { onConflict: 'member_id,week_start' }),
      bonus > 0 ? `${money(h, bonus)} performance bonus for ${kid.display_name}` : `Review saved for ${kid.display_name}`)) onClose();
  }
  if (del && existing) return <Confirm title="Remove this bonus?" action="Remove" onClose={() => setDel(false)}
    text={`${money(h, existing.bonus_amount)} for ${kid.display_name}, week of ${fmtRange(week)}. It comes off their balance.`}
    onConfirm={async () => { if (await F.run(['performance_reviews'], () => supabase.from('performance_reviews').delete().eq('id', existing.id), 'Bonus removed')) onClose(); }} />;

  return (
    <Modal title="Performance bonus" onClose={onClose}>
      <form onSubmit={save} noValidate>
        <div className="kidchips" role="group" aria-label="Child">{F.kids.map(k => (
          <button type="button" key={k.id} className="kidchip" aria-pressed={k.id === kidId} onClick={() => setKidId(k.id)}><Avatar m={k} />{k.display_name}</button>))}</div>
        <div className="weekbar">
          <button type="button" className="btn ghost icon" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</button>
          <span className="range num">{fmtRange(week)}</span>
          <button type="button" className="btn ghost icon" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</button>
        </div>
        <p className="muted">Approved chore pay this week: <b className="num" style={{ color: 'var(--heading)' }}>{money(h, base)}</b>
          {pending > 0 && <><br /><span className="warn-note">{pending} entr{pending === 1 ? 'y is' : 'ies are'} still awaiting approval and won’t count until approved.</span></>}
          {existing && Math.abs(existing.base_amount - base) > 0.005 && <><br /><span className="warn-note">Approved pay changed since this bonus was saved ({money(h, existing.base_amount)}). Saving updates it.</span></>}</p>
        {metrics.length === 0 && <p>Add metrics on the Bonus page first.</p>}
        <div className="ratings">{metrics.map(m => {
          const t = tiers[m.id] || 'meets'; const cond = m[`${t}_text` as 'meets_text'];
          return (
            <div className="rating" key={m.id}>
              <div className="rating-head"><b>{m.name}</b><span className="cap">max {pct(m.max_percent)}</span></div>
              <div className="seg tierseg" role="radiogroup" aria-label={m.name}>{TIERS.map(x => (
                <button type="button" key={x.id} role="radio" aria-checked={t === x.id} aria-pressed={t === x.id} className={`tier-${x.id}`}
                  onClick={() => setTiers(p => ({ ...p, [m.id]: x.id }))}>{x.label}<small>+{pct(m.max_percent * x.factor)}</small></button>))}</div>
              {cond && <p className="cap">{cond}</p>}
            </div>);
        })}</div>
        <label className="field"><span>Note to {kid.display_name} <small>(optional)</small></span><input type="text" maxLength={280} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Great report card!" /></label>
        <div className="preview"><span className="muted num">{money(h, base)} × {pct(total)}</span><b className="num">{money(h, bonus)}</b></div>
        <div className="sheet-actions">
          {existing && <button type="button" className="btn warn left" onClick={() => setDel(true)}>Remove</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!metrics.length}>{existing ? 'Update bonus' : 'Award bonus'}</button>
        </div>
      </form>
    </Modal>
  );
}
