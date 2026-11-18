import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Modal, Pill, Confirm } from '../ui';
import type { Entry } from '../types';
import { DAYS, DAYS_LONG, addDays, choreRate, dur, fmtDate, fmtDay, fmtRange, fmtRelease, isOpen, kidLoad, money, openSlots, pad, parse, r2, sessionMins, slotFor, weekOf, familyRate } from '../lib/util';

/* ---------------- Log / edit time ---------------- */
export function EntryModal({ childId, week, date, choreId, minutes, entry, onClose }: {
  childId: string; week: string; date?: string; choreId?: string; minutes?: number; entry?: Entry; onClose: () => void;
}) {
  const F = useFamily();
  const { household: h, isParent, today } = F;
  const chores = [...F.activeChores];
  if (entry && entry.chore_id && !chores.some(c => c.id === entry.chore_id)) {
    const old = F.chores.find(c => c.id === entry.chore_id); if (old) chores.push(old);
  }
  const w = entry ? weekOf(entry.work_date) : week;
  const defDate = entry?.work_date || date || (today >= w && today <= addDays(w, 6) ? today : (w < today ? addDays(w, 6) : w));
  const [cid, setCid] = useState(entry?.chore_id || choreId || chores[0]?.id || '');
  const [day, setDay] = useState(defDate);
  const c0 = chores.find(c => c.id === cid);
  const [mins, setMins] = useState<number>(entry?.minutes ?? minutes ?? (c0 ? sessionMins(c0) || 30 : 30));
  const [note, setNote] = useState(entry?.note || '');
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [partners, setPartners] = useState<string[]>([]);
  const kid = F.member(childId);
  const team = entry?.team_id ? entry.team_members : partners.length ? [childId, ...partners] : [];
  const n = Math.max(1, team.length);
  const siblings = F.kids.filter(k => k.id !== childId);
  const chore = chores.find(c => c.id === cid);
  const rate = entry && entry.chore_id === cid ? entry.rate : choreRate(h, chore);
  const canDelete = entry && (isParent || (entry.status !== 'approved' && (!entry.team_id || entry.created_by === F.me.id)));

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!cid) { setErr('Pick a chore.'); return; }
    if (mins <= 0) { setErr('Enter the time spent, more than 0 minutes.'); return; }
    if (mins > 16 * 60) { setErr('That is more than 16 hours. Check the hours.'); return; }
    const body = { chore_id: cid, work_date: day, minutes: mins, note: note.trim() };
    const ok = entry?.team_id
      ? await F.run(['time_entries'], () => supabase.rpc('update_team_time', { p_team: entry.team_id, p_chore: cid, p_date: day, p_minutes: mins, p_note: body.note }), 'Saved for the whole team')
      : !entry && partners.length
      ? await F.run(['time_entries'], () => supabase.rpc('log_team_time', { p_household: h.id, p_chore: cid, p_date: day, p_minutes: mins, p_note: body.note, p_members: [childId, ...partners] }),
          isParent ? `Team time added and approved for ${n} children` : `Sent for approval. The pay is split ${n} ways.`)
      : entry
      ? await F.run(['time_entries'], () => supabase.from('time_entries').update(body).eq('id', entry.id), 'Saved')
      : await F.run(['time_entries'], () => supabase.from('time_entries').insert({ ...body, household_id: h.id, member_id: childId, status: isParent ? 'approved' : 'submitted' }),
          isParent ? 'Time added and approved' : 'Sent to your parents for approval');
    if (ok) onClose();
  }

  if (!chores.length) return (
    <Modal title="Log chore time" onClose={onClose}><div className="sheet-body"><p>There are no chores yet. A parent needs to add them on Chores &amp; pay first.</p></div></Modal>
  );
  if (confirmDel && entry) return <Confirm title="Delete this entry?" text={`${dur(entry.minutes)} of ${entry.chore_name} on ${fmtDay(entry.work_date)}.`} action="Delete"
    onClose={() => setConfirmDel(false)} onConfirm={async () => {
      const ok = entry.team_id
        ? await F.run(['time_entries'], () => supabase.rpc('delete_team_time', { p_team: entry.team_id }), 'Team chore deleted for everyone')
        : await F.run(['time_entries'], () => supabase.from('time_entries').delete().eq('id', entry.id), 'Entry deleted');
      if (ok) onClose();
    }} />;

  const chips = [15, 30, 45, 60, 90, 120, 180];
  return (
    <Modal title={entry ? 'Edit chore time' : 'Log chore time'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted"><Avatar m={kid} size="sm" /> <b style={{ color: 'var(--heading)' }}>{kid?.display_name}</b> · week of {fmtRange(w)}</p>
        <label className="field"><span>Chore</span>
          <select value={cid} onChange={e => setCid(e.target.value)}>{chores.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Day</span>
          <select value={day} onChange={e => setDay(e.target.value)}>{DAYS.map((_, i) => {
            const dd = addDays(w, i), dis = dd > today && !isParent;
            return <option key={dd} value={dd} disabled={dis}>{DAYS_LONG[i]} {fmtDate(dd)}{dis ? ' (not yet)' : ''}</option>;
          })}</select></label>
        <div className="field"><span>Time spent</span>
          <div className="chips">{chips.map(m => <button type="button" key={m} className="chip" aria-pressed={mins === m} onClick={() => setMins(m)}>{dur(m)}</button>)}</div>
          <div className="row2">
            <label className="field"><small>Hours</small><input type="number" min={0} max={16} inputMode="numeric" value={Math.floor(mins / 60)} onChange={e => setMins(Math.max(0, parseInt(e.target.value, 10) || 0) * 60 + (mins % 60))} /></label>
            <label className="field"><small>Minutes</small><select value={mins % 60 - (mins % 5)} onChange={e => setMins(Math.floor(mins / 60) * 60 + Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i * 5).map(m => <option key={m} value={m}>{pad(m)}</option>)}</select></label>
          </div>
        </div>
        {entry?.team_id
          ? <div className="field"><span>Team chore</span><p className="team-line">{entry.team_members.map(id => <Avatar key={id} m={F.member(id)} size="sm" />)} {entry.team_members.map(id => F.member(id)?.display_name).join(', ')}</p>
              <small>Changes here apply to everyone in the team.</small></div>
          : !entry && siblings.length > 0 && <div className="field"><span>Did it together? <small>(optional)</small></span>
              <div className="chips">{siblings.map(k => (
                <button type="button" key={k.id} className="chip with-av" aria-pressed={partners.includes(k.id)}
                  onClick={() => setPartners(p => p.includes(k.id) ? p.filter(x => x !== k.id) : [...p, k.id])}><Avatar m={k} size="sm" />{k.display_name}</button>))}</div>
              <small>Pick who helped. Everyone logs the same time and the pay is split equally.</small></div>}
        <label className="field"><span>Note <small>(optional)</small></span><input type="text" maxLength={280} placeholder="e.g. Also washed the mats" value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="preview">
          <span className="muted num">{dur(mins)} × {money(h, rate)}/hr{n > 1 ? ` = ${money(h, r2(mins / 60 * rate))} ÷ ${n}` : ''}</span>
          <b className="num">{money(h, r2(mins / 60 * rate / n))}{n > 1 ? ' each' : ''}</b></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {canDelete && <button type="button" className="btn warn left" onClick={() => setConfirmDel(true)}>Delete</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{entry ? 'Save' : isParent ? 'Add approved time' : 'Submit for approval'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- One entry line ---------------- */
export function EntryRow({ e, onEdit }: { e: Entry; onEdit: (e: Entry) => void }) {
  const F = useFamily();
  const [rejecting, setRejecting] = useState(false);
  const n = e.team_id ? e.team_members.length : 1;
  const others = e.team_members.filter(id => id !== e.member_id).map(id => F.member(id)?.display_name).filter(Boolean).join(', ');
  const setStatus = (status: 'approved' | 'rejected', msg: string) => F.run(['time_entries'], () => e.team_id
    ? supabase.from('time_entries').update({ status }).eq('team_id', e.team_id)
    : supabase.from('time_entries').update({ status }).eq('id', e.id), msg);
  const approve = () => setStatus('approved', n > 1 ? `Approved for all ${n} in the team` : 'Approved');
  const canEdit = F.isParent || (e.status !== 'approved' && (!e.team_id || e.created_by === F.me.id));
  return (
    <div className="entry">
      <span className="what">{e.chore_name}</span><span className="amt">{money(F.household, e.amount)}</span>
      <div className="meta">
        <span className="num">{dur(e.minutes)} × {money(F.household, e.rate)}/hr{n > 1 ? ` ÷ ${n}` : ''}</span><Pill status={e.status} />
        {n > 1 && <span className="pill team">Team · with {others}</span>}
        {e.note && <span>“{e.note}”</span>}
        <span className="acts">
          {F.isParent && e.status === 'submitted' && <>
            <button className="btn go sm" onClick={approve}>Approve</button>
            <button className="btn warn sm" onClick={() => setRejecting(true)}>Reject</button></>}
          {canEdit && <button className="btn ghost sm" onClick={() => onEdit(e)}>Edit</button>}
        </span>
      </div>
      {rejecting && <Confirm title="Reject this time?" action="Reject" onClose={() => setRejecting(false)}
        text={`${n > 1 ? `The team (${e.team_members.map(id => F.member(id)?.display_name).join(', ')})` : F.member(e.member_id)?.display_name} logged ${dur(e.minutes)} of ${e.chore_name} on ${fmtDay(e.work_date)}. It won’t be paid. They can edit and resend it.`}
        onConfirm={() => setStatus('rejected', 'Marked as not approved')} />}
    </div>
  );
}

/* ---------------- The 7-day timesheet ---------------- */
export function Timesheet({ kidId, week, setWeek }: { kidId: string; week: string; setWeek: (w: string) => void }) {
  const F = useFamily();
  const { household: h, today, isParent, activeChores: chores, slotIndex } = F;
  const [modal, setModal] = useState<null | { date?: string; choreId?: string; minutes?: number; entry?: Entry }>(null);
  const w = week;
  const es = F.entries.filter(e => e.member_id === kidId && weekOf(e.work_date) === w);
  const live = es.filter(e => e.status !== 'rejected');
  const wkMins = live.reduce((s, e) => s + e.minutes, 0);
  const sum = (a: Entry[]) => r2(a.reduce((s, e) => s + e.amount, 0));
  const approved = sum(es.filter(e => e.status === 'approved')), pending = sum(es.filter(e => e.status === 'submitted'));
  const showPlan = isParent || isOpen(h, w);
  const planned = kidLoad(h, chores, slotIndex, w, kidId).mins;
  const kid = F.member(kidId);
  const bonus = F.reviews.find(r => r.member_id === kidId && r.week_start === w);

  return (
    <>
      <div className="weekbar">
        <button className="btn ghost icon" onClick={() => setWeek(addDays(w, -7))} aria-label="Previous week">‹</button>
        <span className="range num">{fmtRange(w)}</span>
        <button className="btn ghost icon" onClick={() => setWeek(addDays(w, 7))} aria-label="Next week">›</button>
        {w !== weekOf(today) && <button className="btn ghost sm" onClick={() => setWeek(weekOf(today))}>This week</button>}
      </div>
      <div className="stats">
        <div className="stat"><span className="eyebrow">Hours logged</span><b>{dur(wkMins)}</b><span className="cap">Planned {dur(planned)}</span></div>
        <div className="stat"><span className="eyebrow">Approved</span><b>{money(h, approved)}</b><span className="cap">Counts toward balance</span></div>
        <div className="stat"><span className="eyebrow">Awaiting approval</span><b>{money(h, pending)}</b><span className="cap">{es.filter(e => e.status === 'submitted').length} entries</span></div>
        <div className="stat"><span className="eyebrow">Pay rate</span><b>{money(h, familyRate(h))}</b><span className="cap">per hour</span></div>
      </div>
      <div className="days">
        {DAYS_LONG.map((name, i) => {
          const date = addDays(w, i), future = date > today;
          const dayEs = es.filter(e => e.work_date === date);
          const mins = dayEs.filter(e => e.status !== 'rejected').reduce((s, e) => s + e.minutes, 0);
          const plan = showPlan ? chores.filter(c => { const s = slotFor(slotIndex, w, c, i); return s.on && (!s.kid || s.kid === kidId); }) : [];
          const done = new Set(dayEs.filter(e => e.status !== 'rejected').map(e => e.chore_id));
          const canLog = !future || isParent;
          return (
            <article key={date} className={`day ${date === today ? 'today' : ''} ${future ? 'future' : ''}`}>
              <header><b>{name} <span className="muted" style={{ fontWeight: 500 }}>{parse(date).getDate()} {parse(date).toLocaleDateString('en-GB', { month: 'short' })}</span></b>
                <span className="cap num">{mins ? dur(mins) : date === today ? 'Today' : ''}</span></header>
              <div className="day-body">
                {plan.length > 0 && <div className="plan">{plan.map(c => {
                  const mine = slotFor(slotIndex, w, c, i).kid === kidId, isDone = done.has(c.id);
                  return <span key={c.id} className={`plan-chip ${mine ? 'mine' : ''} ${isDone ? 'done' : ''}`} title={mine ? `${kid?.display_name}’s` : 'Open to anyone'}>
                    {c.name} · {dur(sessionMins(c))}
                    {canLog && !isDone && <button onClick={() => setModal({ date, choreId: c.id, minutes: sessionMins(c) })} aria-label={`Log ${c.name} on ${fmtDay(date)}`}>Log</button>}
                  </span>;
                })}</div>}
                {!plan.length && !dayEs.length && <p className="empty-note">No chores planned.</p>}
                {dayEs.length > 0 && <div className="entries">{dayEs.map(e => <EntryRow key={e.id} e={e} onEdit={en => setModal({ entry: en })} />)}</div>}
                {canLog ? <button className="link add-line" onClick={() => setModal({ date })}>+ Add chore time</button>
                  : <p className="empty-note">You can log this day once it arrives.</p>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="weektotal"><span>Week total for {kid?.display_name}{bonus ? ` · includes ${money(h, bonus.bonus_amount)} performance bonus` : ''}</span><b>{dur(wkMins)} · {money(h, r2(sum(live) + (bonus?.bonus_amount || 0)))}</b></div>
      {modal && <EntryModal childId={kidId} week={w} {...modal} onClose={() => setModal(null)} />}
    </>
  );
}

/* ---------------- Child: My week ---------------- */
export function MyWeek({ go }: { go: (view: string, week?: string) => void }) {
  const F = useFamily();
  const [week, setWeek] = useState(weekOf(F.today));
  const [adding, setAdding] = useState(false);
  const nw = addDays(weekOf(F.today), 7);
  const open = isOpen(F.household, nw);
  const load = kidLoad(F.household, F.activeChores, F.slotIndex, nw, F.me.id);
  const n = openSlots(F.activeChores, F.slotIndex, nw, F.today);
  return (
    <>
      <div className="page-head"><div><h1>{F.me.display_name}’s timesheet</h1><p className="muted">Log the time you spend on each chore. A parent approves it, then it’s added to your balance.</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Log chore time</button></div>
      <div className="stack">
        {open
          ? <button className="banner go" onClick={() => go('schedule', nw)}><span><b>Next week’s schedule is up.</b> {load.mins ? `You’ve picked ${dur(load.mins)} (${money(F.household, load.pay)}).` : 'You haven’t picked any chores yet.'} {n ? `${n} open slot${n === 1 ? '' : 's'} left.` : ''}</span><span className="banner-cta">Pick chores ›</span></button>
          : <div className="banner"><span>Next week’s schedule goes up <b>{fmtRelease(F.household, nw)}</b>. You can pick your chores then.</span></div>}
        <Timesheet kidId={F.me.id} week={week} setWeek={setWeek} />
      </div>
      {adding && <EntryModal childId={F.me.id} week={week} onClose={() => setAdding(false)} />}
    </>
  );
}

/* ---------------- Parent: Timesheets ---------------- */
export function Timesheets() {
  const F = useFamily();
  const [kid, setKid] = useState(F.kids[0]?.id || '');
  const [week, setWeek] = useState(weekOf(F.today));
  if (!F.kids.length) return <><div className="page-head"><div><h1>Timesheets</h1></div></div><div className="empty"><h2>No children yet</h2><p className="muted">Add the children on the Family page.</p></div></>;
  const k = F.kids.some(x => x.id === kid) ? kid : F.kids[0].id;
  return (
    <>
      <div className="page-head"><div><h1>Timesheets</h1><p className="muted">Each child’s week. Approve entries here or on Approvals. Time you add yourself is approved straight away.</p></div></div>
      <div className="stack">
        <div className="kidchips" role="group" aria-label="Choose a child">{F.kids.map(c => {
          const p = F.entries.filter(e => e.member_id === c.id && e.status === 'submitted').length;
          return <button key={c.id} className="kidchip" aria-pressed={c.id === k} onClick={() => setKid(c.id)}><Avatar m={c} />{c.display_name}{p > 0 && <span className="count">{p}</span>}</button>;
        })}</div>
        <Timesheet kidId={k} week={week} setWeek={setWeek} />
      </div>
    </>
  );
}
