import { useState } from 'react';
import { supabase, errorText } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Confirm, Empty, Modal, ScrollBox } from '../ui';
import type { Chore } from '../types';
import { DAYS, DAYS_LONG, addDays, colDay, dayIdx, dur, fmtDate, fmtMonth, fmtRange, fmtRelease, fmtWhen, isOpen, kidLoad, money, openSlots, pad, parse, sessionMins, slotFor, textOn, weekOf } from '../lib/util';
import { EntryModal } from './Timesheet';
import { t, count } from '../i18n';

export function Schedule() {
  const F = useFamily();
  const { household: h, isParent, me, today, activeChores: cs, slotIndex } = F;
  const cw = weekOf(today), nw = addDays(cw, 7);
  const [week, setWeek] = useState(isOpen(h, nw) ? nw : cw);
  const [edit, setEdit] = useState<{ c: Chore; day: number } | null>(null);
  const [drop, setDrop] = useState<{ c: Chore; day: number } | null>(null);
  const [log, setLog] = useState<{ c?: Chore } | null>(null);
  const [busy, setBusy] = useState('');          // the slot being taken right now
  const [problem, setProblem] = useState('');    // why the last Take didn't work, shown on the page
  const w = week, open = isOpen(h, w);

  // Take an open slot. The button shows it's working, and any problem stays on screen (not just a toast).
  const take = async (c: Chore, day: number, wk = week) => {
    const key = `${c.id}_${wk}_${day}`;
    if (busy) return;
    setBusy(key); setProblem('');
    try {
      const { error } = await supabase.rpc('claim_slot', { p_chore: c.id, p_week: wk, p_day: day });
      if (error) { const msg = errorText(error); setProblem(msg); F.toast(msg); }
      else F.toast(t('{chore} on {day} is yours', { chore: c.name, day: DAYS_LONG[colDay(day)] }));
    } catch (e) {
      const msg = errorText(e); setProblem(msg); F.toast(msg);
    } finally {
      await F.reload('schedule_slots').catch(() => {});
      setBusy('');
    }
  };
  const takeBtn = (c: Chore, day: number, wk: string, cls: string, label?: string) => {
    const key = `${c.id}_${wk}_${day}`;
    return <button type="button" className={cls} disabled={!!busy} aria-busy={busy === key} onClick={() => void take(c, day, wk)} aria-label={label}>
      {busy === key ? t('Taking…') : t('Take')}</button>;
  };

  const head = (
    <div className="page-head"><div><h1>{t('Weekly schedule')}</h1><p className="muted">{isParent
      ? t('Each week’s schedule goes up for the children on {day} at {time} the week before. They pick the chores they’ll do; tap any slot to assign, change or remove it.', { day: DAYS_LONG[h.release_dow], time: `${pad(h.release_hour)}:00` })
      : t('Pick the chores you’ll do this week. Tap an open slot to take it. Your parents can change any slot.')}</p></div></div>
  );
  const nav = (
    <div className="weekbar">
      <button className="btn ghost icon" onClick={() => setWeek(addDays(w, -7))} aria-label={t('Previous week')}>‹</button>
      <span className="range num">{fmtRange(w)}</span>
      <button className="btn ghost icon" onClick={() => setWeek(addDays(w, 7))} aria-label={t('Next week')}>›</button>
      {w !== cw && <button className="btn ghost sm" onClick={() => setWeek(cw)}>{t('This week')}</button>}
      {w === cw && isOpen(h, nw) && <button className="btn ghost sm" onClick={() => setWeek(nw)}>{t('Next week')}</button>}
    </div>
  );
  if (!cs.length) return <>{head}<div className="stack">{nav}<Empty title={t('No chores to schedule')}><p className="muted">{isParent ? t('Add chores on the Remuneration page first.') : t('Your parents haven’t added any chores yet.')}</p></Empty></div></>;
  if (!isParent && !open) return <>{head}<div className="stack">{nav}<Empty title={t('Not up yet')}><p className="muted">{t('The schedule for {week} goes up {when}. Come back then to pick your chores.', { week: fmtRange(w), when: fmtRelease(h, w) })}</p></Empty></div></>;

  const n = openSlots(cs, slotIndex, w, today);
  let openMins = 0;
  cs.forEach(c => { for (let d = 0; d < 7; d++) { const s = slotFor(slotIndex, w, c, d); if (s.on && !s.kid) openMins += sessionMins(c); } });
  // Today, for a child: their chores today (with whether they've logged them) and the ones still open.
  const ti = dayIdx(today); // today's column in this week
  const todayRows = !isParent && ti >= 0 ? cs.map(c => ({ c, s: slotFor(slotIndex, cw, c, ti) })).filter(x => x.s.on && (!x.s.kid || x.s.kid === me.id)) : [];
  const loggedToday = new Set(F.entries.filter(e => e.member_id === me.id && e.work_date === today && e.status !== 'rejected').map(e => e.chore_id));
  const myToday = todayRows.filter(x => x.s.kid === me.id), openToday = todayRows.filter(x => !x.s.kid);

  return (
    <>
      {head}
      <div className="stack">
        {nav}
        {isParent && (open
          ? <div className="banner go"><span><b>{t('Up for the children.')}</b> {t('Not picked yet: {count}.', { count: count('slot', n) })}</span></div>
          : <div className="banner"><span>{t('The children see this week from {when}. You can assign slots now.', { when: fmtRelease(h, w) })}</span></div>)}
        {!isParent && ti >= 0 && <section className="panel today-panel">
          <div className="panel-head"><h2>{t('Today')} · {DAYS_LONG[colDay(ti)]} {parse(today).getDate()} {fmtMonth(today)}</h2>
            <button type="button" className="btn ghost sm" onClick={() => setLog({})}>{t('+ Log another chore')}</button></div>
          {myToday.length + openToday.length === 0
            ? <p className="empty-note">{t('Nothing on the schedule for you today.')}</p>
            : <div className="entries">
              {myToday.map(({ c, s }) => { const done = loggedToday.has(c.id); return (
                <div className={`entry today-row ${done ? 'is-done' : ''}`} key={c.id}>
                  <span className="what">{done && <span className="tick" aria-hidden="true">✓</span>}{c.name}</span>
                  <span className="amt">{dur(sessionMins(c))}</span>
                  <div className="meta">
                    {c.description && <span className="today-desc">{c.description}</span>}
                    <span>{s.slot?.set_by && s.slot.set_by !== me.id ? t('Set by {name}', { name: F.member(s.slot.set_by)?.display_name || t('a parent') }) : t('Picked by you')}</span>
                    <span className="acts">{done ? <span className="pill approved">{t('Logged')}</span>
                      : <button className="btn primary sm" onClick={() => setLog({ c })}>{t('Log it')}</button>}</span>
                  </div>
                </div>); })}
              {openToday.map(({ c }) => (
                <div className="entry today-row is-open" key={c.id}>
                  <span className="what">{c.name}</span><span className="amt">{dur(sessionMins(c))}</span>
                  <div className="meta">
                    {c.description && <span className="today-desc">{c.description}</span>}
                    <span>{t('Open: anyone can take it')}</span>
                    <span className="acts">{takeBtn(c, ti, cw, 'btn go sm')}</span>
                  </div>
                </div>))}
            </div>}
        </section>}
        {problem && <div className="banner warn" role="alert"><span>{problem}</span><button type="button" className="btn ghost sm" onClick={() => setProblem('')}>{t('OK')}</button></div>}
        <div className="loads">
          {F.kids.map(k => { const l = kidLoad(h, cs, slotIndex, w, k.id); return (
            <div className="load" key={k.id}><Avatar m={k} /><div><b>{k.display_name}</b><span className="cap num">{dur(l.mins)} · {money(h, l.pay)}</span></div></div>); })}
          <div className="load"><span className="av" style={{ ['--c' as string]: 'var(--card)', ['--t' as string]: 'var(--muted)', border: '1px dashed var(--line)' }} aria-hidden="true">?</span>
            <div><b>{t('Open')}</b><span className="cap num">{t('{time} not picked', { time: dur(openMins) })}</span></div></div>
        </div>
        <ScrollBox scrollToSelector="th.today"><table className="sched">
          <thead><tr><th>{t('Chore')}</th>{DAYS.map((_, i) => <th key={i} className={addDays(w, i) === today ? 'today' : ''}>{DAYS[colDay(i)]}<br /><span className="cap">{parse(addDays(w, i)).getDate()}</span></th>)}</tr></thead>
          <tbody>{cs.map(c => (
            <tr key={c.id}><td><span className="task">{c.name}</span><br /><span className="cap">{t('{time} a session', { time: dur(sessionMins(c)) })}</span></td>
              {DAYS.map((_, i) => {
                const s = slotFor(slotIndex, w, c, i), who = s.kid ? F.member(s.kid) : undefined, past = addDays(w, i) < today;
                const style = who ? { ['--c' as string]: who.color, ['--t' as string]: textOn(who.color) } : undefined;
                const label = `${c.name}, ${DAYS_LONG[colDay(i)]}: ${s.on ? (who ? who.display_name : t('open')) : t('not scheduled')}`;
                if (isParent) return <td key={i}><button className={`slot ${s.on ? (who ? 'kid' : 'on') : ''}`} style={style} onClick={() => setEdit({ c, day: i })} aria-label={`${label}. ${t('Change')}`}>{s.on ? (who ? who.display_name : t('Open')) : '+'}</button></td>;
                if (!s.on) return <td key={i} />;
                // A day that has passed is closed for children: greyed out, nothing to tap.
                if (past) return <td key={i}><span className={`slot past ${who ? 'kid' : ''} ${who?.id === me.id ? 'mine' : ''}`} style={style} aria-label={`${label}. ${t('Closed')}`}>{who ? (who.id === me.id ? t('You') : who.display_name) : t('Closed')}</span></td>;
                if (who) {
                  const isMe = who.id === me.id, byParent = !!s.slot?.set_by && s.slot.set_by !== who.id;
                  if (isMe && !byParent) return <td key={i}><button className="slot kid mine" style={style} onClick={() => setDrop({ c, day: i })} aria-label={`${label}. ${t('Tap to drop')}`}>{t('You')} ✕</button></td>;
                  return <td key={i}><span className={`slot kid ${isMe ? 'mine' : ''}`} style={style} title={byParent ? t('Set by {name}', { name: F.member(s.slot?.set_by)?.display_name || t('a parent') }) : undefined}>{isMe ? t('You') : who.display_name}</span></td>;
                }
                return <td key={i}>{takeBtn(c, i, w, 'slot take', `${label}. ${t('Take')}`)}</td>;
              })}</tr>))}</tbody>
        </table></ScrollBox>
        {isParent && <p className="cap">{t('Open = any child can pick it. + = not usually on this day; tap to add it for this week only.')}</p>}
      </div>
      {edit && <SlotModal week={w} c={edit.c} day={edit.day} onClose={() => setEdit(null)} />}
      {log && <EntryModal childId={me.id} week={cw} date={today} choreId={log.c?.id} onClose={() => setLog(null)} />}
      {drop && <Confirm title={t('Drop this chore?')} action={t('Drop it')} onClose={() => setDrop(null)}
        text={t('{chore} on {day} goes back to open, so someone else can take it.', { chore: drop.c.name, day: DAYS_LONG[colDay(drop.day)] })}
        onConfirm={async () => {
          const { error } = await supabase.rpc('drop_slot', { p_chore: drop.c.id, p_week: w, p_day: drop.day });
          if (error) F.toast(errorText(error)); else F.toast(t('Dropped'));
          void F.reload('schedule_slots');
        }} />}
    </>
  );
}

function SlotModal({ week, c, day, onClose }: { week: string; c: Chore; day: number; onClose: () => void }) {
  const F = useFamily();
  const s = slotFor(F.slotIndex, week, c, day), usual = c.days.includes(colDay(day));
  const cur = !s.on ? 'off' : (s.kid || '');
  const info = s.slot?.kind === 'kid' && s.slot.member_id
    ? `${s.slot.set_by === s.slot.member_id ? t('Picked by {name}', { name: F.member(s.slot.member_id)?.display_name }) : t('Given to {name} by {by}', { name: F.member(s.slot.member_id)?.display_name, by: F.member(s.slot.set_by)?.display_name || t('a parent') })} · ${fmtWhen(s.slot.set_at, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
    : '';
  const choose = async (v: string) => {
    let ok: boolean;
    if (v === 'off') ok = await F.setSlot(week, c.id, day, usual ? 'off' : null);
    else if (v === '') ok = await F.setSlot(week, c.id, day, usual ? null : 'open');
    else ok = await F.setSlot(week, c.id, day, 'kid', v);
    if (ok) { F.toast(v === 'off' ? t('Removed for this week') : v ? t('Given to {name}', { name: F.member(v)?.display_name }) : t('Open for the children to pick')); onClose(); }
  };
  const Opt = ({ v, label, m }: { v: string; label: string; m?: ReturnType<typeof F.member> }) => (
    <button type="button" className="opt" aria-pressed={cur === v} onClick={() => choose(v)}>
      {m ? <Avatar m={m} /> : <span className="av" style={{ ['--c' as string]: 'var(--raised)', ['--t' as string]: 'var(--muted)' }} aria-hidden="true">{v === 'off' ? '–' : '?'}</span>}{label}
    </button>
  );
  return (
    <Modal title={t('Who does this?')} onClose={onClose}>
      <div className="sheet-body">
        <p className="muted">{c.name} · {DAYS_LONG[colDay(day)]} {fmtDate(addDays(week, day))} · {dur(sessionMins({ ...c, days: usual ? c.days : [...c.days, colDay(day)] }))}{info && <><br />{info}</>}</p>
        <div className="optlist">
          {F.kids.map(k => <Opt key={k.id} v={k.id} label={k.display_name} m={k} />)}
          <Opt v="" label={t('Open: any child can pick it')} />
          <Opt v="off" label={t('Not on {day} this week', { day: DAYS_LONG[colDay(day)] })} />
        </div>
        <p className="cap">{t('This changes {week} only. To change a chore’s usual days, edit it on the Remuneration page.', { week: fmtRange(week) })}</p>
      </div>
    </Modal>
  );
}
