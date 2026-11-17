import { useState } from 'react';
import { supabase, errorText } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Confirm, Empty, Modal } from '../ui';
import type { Chore } from '../types';
import { DAYS, DAYS_LONG, addDays, dur, fmtDate, fmtRange, fmtRelease, isOpen, kidLoad, money, openSlots, pad, parse, sessionMins, slotFor, textOn, weekOf } from '../lib/util';

export function Schedule({ initialWeek }: { initialWeek?: string }) {
  const F = useFamily();
  const { household: h, isParent, me, today, activeChores: cs, slotIndex } = F;
  const cw = weekOf(today), nw = addDays(cw, 7);
  const [week, setWeek] = useState(initialWeek || (isOpen(h, nw) ? nw : cw));
  const [edit, setEdit] = useState<{ c: Chore; day: number } | null>(null);
  const [drop, setDrop] = useState<{ c: Chore; day: number } | null>(null);
  const w = week, open = isOpen(h, w);

  const take = async (c: Chore, day: number) => {
    const { error } = await supabase.rpc('claim_slot', { p_chore: c.id, p_week: w, p_day: day });
    if (error) { F.toast(errorText(error)); void F.reload('schedule_slots'); return; }
    await F.reload('schedule_slots'); F.toast(`${c.name} on ${DAYS_LONG[day]} is yours`);
  };

  const head = (
    <div className="page-head"><div><h1>Weekly schedule</h1><p className="muted">{isParent
      ? `Each week’s schedule goes up for the children on ${DAYS_LONG[h.release_dow]} at ${pad(h.release_hour)}:00 the week before. They pick the chores they’ll do; tap any slot to assign, change or remove it.`
      : 'Pick the chores you’ll do this week. Tap an open slot to take it. Your parents can change any slot.'}</p></div></div>
  );
  const nav = (
    <div className="weekbar">
      <button className="btn ghost icon" onClick={() => setWeek(addDays(w, -7))} aria-label="Previous week">‹</button>
      <span className="range num">{fmtRange(w)}</span>
      <button className="btn ghost icon" onClick={() => setWeek(addDays(w, 7))} aria-label="Next week">›</button>
      {w !== cw && <button className="btn ghost sm" onClick={() => setWeek(cw)}>This week</button>}
      {w === cw && isOpen(h, nw) && <button className="btn ghost sm" onClick={() => setWeek(nw)}>Next week</button>}
    </div>
  );
  if (!cs.length) return <>{head}<div className="stack">{nav}<Empty title="No chores to schedule"><p className="muted">{isParent ? 'Add chores on Chores & pay first.' : 'Your parents haven’t added any chores yet.'}</p></Empty></div></>;
  if (!isParent && !open) return <>{head}<div className="stack">{nav}<Empty title="Not up yet"><p className="muted">The schedule for {fmtRange(w)} goes up <b>{fmtRelease(h, w)}</b>. Come back then to pick your chores.</p></Empty></div></>;

  const n = openSlots(cs, slotIndex, w, today);
  let openMins = 0;
  cs.forEach(c => { for (let d = 0; d < 7; d++) { const s = slotFor(slotIndex, w, c, d); if (s.on && !s.kid) openMins += sessionMins(c); } });
  const myRows: { c: Chore; d: number; setBy: string | null }[] = [];
  if (!isParent) cs.forEach(c => { for (let d = 0; d < 7; d++) { const s = slotFor(slotIndex, w, c, d); if (s.on && s.kid === me.id) myRows.push({ c, d, setBy: s.slot?.set_by || null }); } });
  myRows.sort((a, b) => a.d - b.d);
  const myLoad = kidLoad(h, cs, slotIndex, w, me.id);

  return (
    <>
      {head}
      <div className="stack">
        {nav}
        {isParent && (open
          ? <div className="banner go"><span><b>Up for the children.</b> {n} open slot{n === 1 ? '' : 's'} not picked yet.</span></div>
          : <div className="banner"><span>The children see this week from <b>{fmtRelease(h, w)}</b>. You can assign slots now.</span></div>)}
        {!isParent && <section className="panel">
          <div className="panel-head"><h2>My chores this week</h2><span className="num"><b style={{ color: 'var(--heading)' }}>{dur(myLoad.mins)}</b> <span className="muted">· about {money(h, myLoad.pay)}</span></span></div>
          {myRows.length ? <div className="entries">{myRows.map(({ c, d, setBy }) => (
            <div className="entry" key={c.id + d}><span className="what">{DAYS_LONG[d]} · {c.name}</span><span className="amt">{dur(sessionMins(c))}</span>
              <div className="meta"><span>{setBy && setBy !== me.id ? `Set by ${F.member(setBy)?.display_name || 'a parent'}` : 'Picked by you'}</span></div></div>))}</div>
            : <p className="empty-note">You haven’t picked anything yet. Tap <b>Take</b> on an open slot below.</p>}
        </section>}
        <div className="loads">
          {F.kids.map(k => { const l = kidLoad(h, cs, slotIndex, w, k.id); return (
            <div className="load" key={k.id}><Avatar m={k} /><div><b>{k.display_name}</b><span className="cap num">{dur(l.mins)} · {money(h, l.pay)}</span></div></div>); })}
          <div className="load"><span className="av" style={{ ['--c' as string]: 'var(--card)', ['--t' as string]: 'var(--muted)', border: '1px dashed var(--line)' }} aria-hidden="true">?</span>
            <div><b>Open</b><span className="cap num">{dur(openMins)} not picked</span></div></div>
        </div>
        <div className="tbl-wrap"><table className="sched">
          <thead><tr><th>Chore</th>{DAYS.map((d, i) => <th key={d} className={addDays(w, i) === today ? 'today' : ''}>{d}<br /><span className="cap">{parse(addDays(w, i)).getDate()}</span></th>)}</tr></thead>
          <tbody>{cs.map(c => (
            <tr key={c.id}><td><span className="task">{c.name}</span><br /><span className="cap">{dur(sessionMins(c))} a session</span></td>
              {DAYS.map((_, i) => {
                const s = slotFor(slotIndex, w, c, i), who = s.kid ? F.member(s.kid) : undefined, past = addDays(w, i) < today;
                const style = who ? { ['--c' as string]: who.color, ['--t' as string]: textOn(who.color) } : undefined;
                const label = `${c.name}, ${DAYS_LONG[i]}: ${s.on ? (who ? who.display_name : 'open') : 'not scheduled'}`;
                if (isParent) return <td key={i}><button className={`slot ${s.on ? (who ? 'kid' : 'on') : ''}`} style={style} onClick={() => setEdit({ c, day: i })} aria-label={`${label}. Change`}>{s.on ? (who ? who.display_name : 'Open') : '+'}</button></td>;
                if (!s.on) return <td key={i} />;
                if (who) {
                  const isMe = who.id === me.id, byParent = !!s.slot?.set_by && s.slot.set_by !== who.id;
                  if (isMe && !byParent && !past) return <td key={i}><button className="slot kid mine" style={style} onClick={() => setDrop({ c, day: i })} aria-label={`${label}. Tap to drop`}>You ✕</button></td>;
                  return <td key={i}><span className={`slot kid ${isMe ? 'mine' : ''}`} style={style} title={byParent ? `Set by ${F.member(s.slot?.set_by)?.display_name || 'a parent'}` : undefined}>{isMe ? 'You' : who.display_name}</span></td>;
                }
                return <td key={i}>{past ? <span className="slot on">Open</span> : <button className="slot take" onClick={() => take(c, i)} aria-label={`${label}. Take it`}>Take</button>}</td>;
              })}</tr>))}</tbody>
        </table></div>
        <p className="cap">{isParent ? 'Open = any child can pick it. + = not usually on this day; tap to add it for this week only.'
          : 'Take = open for anyone. Tap “You ✕” to drop a chore you picked. Chores a parent gave you can only be changed by a parent.'}</p>
      </div>
      {edit && <SlotModal week={w} c={edit.c} day={edit.day} onClose={() => setEdit(null)} />}
      {drop && <Confirm title="Drop this chore?" action="Drop it" onClose={() => setDrop(null)}
        text={`${drop.c.name} on ${DAYS_LONG[drop.day]} goes back to open, so someone else can take it.`}
        onConfirm={async () => {
          const { error } = await supabase.rpc('drop_slot', { p_chore: drop.c.id, p_week: w, p_day: drop.day });
          if (error) F.toast(errorText(error)); else F.toast('Dropped');
          void F.reload('schedule_slots');
        }} />}
    </>
  );
}

function SlotModal({ week, c, day, onClose }: { week: string; c: Chore; day: number; onClose: () => void }) {
  const F = useFamily();
  const s = slotFor(F.slotIndex, week, c, day), usual = c.days.includes(day);
  const cur = !s.on ? 'off' : (s.kid || '');
  const info = s.slot?.kind === 'kid' && s.slot.member_id
    ? `${s.slot.set_by === s.slot.member_id ? 'Picked by ' + F.member(s.slot.member_id)?.display_name : `Given to ${F.member(s.slot.member_id)?.display_name} by ${F.member(s.slot.set_by)?.display_name || 'a parent'}`} · ${new Date(s.slot.set_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
    : '';
  const choose = async (v: string) => {
    let ok: boolean;
    if (v === 'off') ok = await F.setSlot(week, c.id, day, usual ? 'off' : null);
    else if (v === '') ok = await F.setSlot(week, c.id, day, usual ? null : 'open');
    else ok = await F.setSlot(week, c.id, day, 'kid', v);
    if (ok) { F.toast(v === 'off' ? 'Removed for this week' : v ? `Given to ${F.member(v)?.display_name}` : 'Open for the children to pick'); onClose(); }
  };
  const Opt = ({ v, label, m }: { v: string; label: string; m?: ReturnType<typeof F.member> }) => (
    <button type="button" className="opt" aria-pressed={cur === v} onClick={() => choose(v)}>
      {m ? <Avatar m={m} /> : <span className="av" style={{ ['--c' as string]: 'var(--raised)', ['--t' as string]: 'var(--muted)' }} aria-hidden="true">{v === 'off' ? '–' : '?'}</span>}{label}
    </button>
  );
  return (
    <Modal title="Who does this?" onClose={onClose}>
      <div className="sheet-body">
        <p className="muted">{c.name} · {DAYS_LONG[day]} {fmtDate(addDays(week, day))} · {dur(sessionMins({ ...c, days: usual ? c.days : [...c.days, day] }))}{info && <><br />{info}</>}</p>
        <div className="optlist">
          {F.kids.map(k => <Opt key={k.id} v={k.id} label={k.display_name} m={k} />)}
          <Opt v="" label="Open: any child can pick it" />
          <Opt v="off" label={`Not on ${DAYS_LONG[day]} this week`} />
        </div>
        <p className="cap">This changes {fmtRange(week)} only. To change a chore’s usual days, edit it on Chores &amp; pay.</p>
      </div>
    </Modal>
  );
}
