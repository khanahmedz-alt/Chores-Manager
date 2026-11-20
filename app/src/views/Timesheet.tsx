import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Modal, Pill, Confirm } from '../ui';
import type { Entry } from '../types';
import { DAYS, DAYS_LONG, addDays, choreTime, colDay, isLate, choreRate, clockIn, dur, fmtDate, fmtDay, fmtRange, money, nowTimeIn, r2, sessionMins, weekOf, zonedInstant } from '../lib/util';
import { t, count } from '../i18n';

/* ---------------- Log / edit time ---------------- */
export function EntryModal({ childId, week, date, choreId, entry, onClose }: {
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
  // When it was done: the day (within this week) and the time of day, in the family's time zone.
  const [time, setTime] = useState(entry?.done_at ? clockIn(entry.done_at, h.timezone) : nowTimeIn(h.timezone));
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
  // The time logged is fixed by the chore's session (an existing entry keeps the time it was logged with).
  const mins = entry && entry.chore_id === cid ? entry.minutes : (chore ? sessionMins(chore) : 0);
  const canDelete = entry && (isParent || (entry.status !== 'approved' && (!entry.team_id || entry.created_by === F.me.id)));

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!cid) { setErr(t('Pick a chore.')); return; }
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!m) { setErr(t('Enter the time it was done.')); return; }
    const doneAt = zonedInstant(day, Number(m[1]), h.timezone, Number(m[2]));
    if (doneAt.getTime() > Date.now() + 10 * 60 * 1000) { setErr(t('That time hasn’t happened yet.')); return; }
    const body = { chore_id: cid, work_date: day, done_at: doneAt.toISOString(), note: note.trim() };
    const ok = entry?.team_id
      ? await F.run(['time_entries'], () => supabase.rpc('update_team_time', { p_team: entry.team_id, p_chore: cid, p_date: day, p_note: body.note, p_done_at: body.done_at }), t('Saved for the whole team'))
      : !entry && partners.length
      ? await F.run(['time_entries'], () => supabase.rpc('log_team_time', { p_household: h.id, p_chore: cid, p_date: day, p_note: body.note, p_members: [childId, ...partners], p_done_at: body.done_at }),
          isParent ? t('Team time added and approved for {count}', { count: count('child', n) }) : t('Sent for approval. The pay is split {n} ways.', { n }))
      : entry
      ? await F.run(['time_entries'], () => supabase.from('time_entries').update(body).eq('id', entry.id), t('Saved'))
      : await F.run(['time_entries'], () => supabase.from('time_entries').insert({ ...body, household_id: h.id, member_id: childId, status: isParent ? 'approved' : 'submitted' }),
          isParent ? t('Time added and approved') : t('Sent to your parents for approval'));
    if (ok) onClose();
  }

  if (!chores.length) return (
    <Modal title={t('Log chore time')} onClose={onClose}><div className="sheet-body"><p>{t('There are no chores yet. A parent needs to add them on the Remuneration page first.')}</p></div></Modal>
  );
  if (confirmDel && entry) return <Confirm title={t('Delete this entry?')} text={t('{time} of {chore} on {day}.', { time: dur(entry.minutes), chore: entry.chore_name, day: fmtDay(entry.work_date) })} action={t('Delete')}
    onClose={() => setConfirmDel(false)} onConfirm={async () => {
      const ok = entry.team_id
        ? await F.run(['time_entries'], () => supabase.rpc('delete_team_time', { p_team: entry.team_id }), t('Team chore deleted for everyone'))
        : await F.run(['time_entries'], () => supabase.from('time_entries').delete().eq('id', entry.id), t('Entry deleted'));
      if (ok) onClose();
    }} />;

  return (
    <Modal title={entry ? t('Edit chore time') : t('Log chore time')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted"><Avatar m={kid} size="sm" /> <b style={{ color: 'var(--heading)' }}>{kid?.display_name}</b> · {t('week of {week}', { week: fmtRange(w) })}</p>
        <label className="field"><span>{t('Chore')}</span>
          <select value={cid} onChange={e => setCid(e.target.value)}>{chores.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {chore?.description && <span className="chore-standard"><b>{t('How to do it')}:</b> {chore.description}</span>}
          {chore && choreTime(chore) && <span className="cap when">⏰ {choreTime(chore)}</span>}</label>
        <div className="row2 when">
          <label className="field"><span>{t('Day done')}</span>
            <select value={day} onChange={e => setDay(e.target.value)}>{DAYS.map((_, i) => {
              const dd = addDays(w, i), dis = dd > today;
              return <option key={dd} value={dd} disabled={dis}>{DAYS_LONG[colDay(i)]} {fmtDate(dd)}{dis ? ` ${t('(not yet)')}` : ''}</option>;
            })}</select></label>
          <label className="field"><span>{t('Time done')}</span>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} required /></label>
        </div>
        <p className="session-note">{t('Session time: {time}', { time: dur(mins) })} <small>· {t('fixed for this chore')}</small></p>
        {entry?.team_id
          ? <div className="field"><span>{t('Team chore')}</span><p className="team-line">{entry.team_members.map(id => <Avatar key={id} m={F.member(id)} size="sm" />)} {entry.team_members.map(id => F.member(id)?.display_name).join(', ')}</p>
              <small>{t('Changes here apply to everyone in the team.')}</small></div>
          : !entry && siblings.length > 0 && <div className="field"><span>{t('Did it together?')} <small>{t('(optional)')}</small></span>
              <div className="chips">{siblings.map(k => (
                <button type="button" key={k.id} className="chip with-av" aria-pressed={partners.includes(k.id)}
                  onClick={() => setPartners(p => p.includes(k.id) ? p.filter(x => x !== k.id) : [...p, k.id])}><Avatar m={k} size="sm" />{k.display_name}</button>))}</div>
              <small>{t('Pick who helped. Everyone logs the same time and the pay is split equally.')}</small></div>}
        <label className="field"><span>{t('Note')} <small>{t('(optional)')}</small></span><input type="text" maxLength={280} placeholder={t('e.g. Also washed the mats')} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="preview">
          <span className="muted num">{dur(mins)} × {money(h, rate)}{t('/hr')}{n > 1 ? ` = ${money(h, r2(mins / 60 * rate))} ÷ ${n}` : ''}</span>
          <b className="num">{money(h, r2(mins / 60 * rate / n))}{n > 1 ? ` ${t('each')}` : ''}</b></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {canDelete && <button type="button" className="btn warn left" onClick={() => setConfirmDel(true)}>{t('Delete')}</button>}
          <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn primary">{entry ? t('Save') : isParent ? t('Add approved time') : t('Submit for approval')}</button>
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
  const approve = () => setStatus('approved', n > 1 ? t('Approved for all {n} in the team', { n }) : t('Approved'));
  const chore = F.chores.find(c => c.id === e.chore_id);
  const late = e.done_at ? isLate(chore, clockIn(e.done_at, F.household.timezone)) : false;
  const canEdit = F.isParent || (e.status !== 'approved' && (!e.team_id || e.created_by === F.me.id));
  return (
    <div className="entry">
      <span className="what">{e.chore_name}</span><span className="amt">{money(F.household, e.amount)}</span>
      <div className="meta">
        {e.done_at && <span className="num">{t('Done {time}', { time: clockIn(e.done_at, F.household.timezone) })}</span>}
        <span className="num">{dur(e.minutes)} × {money(F.household, e.rate)}{t('/hr')}{n > 1 ? ` ÷ ${n}` : ''}</span><Pill status={e.status} />
        {late && chore && <span className="pill late">{t('Late · due {when}', { when: choreTime(chore) })}</span>}
        {n > 1 && <span className="pill team">{t('Team · with {names}', { names: others })}</span>}
        {e.note && <span>“{e.note}”</span>}
        <span className="acts">
          {F.isParent && e.status === 'submitted' && <>
            <button className="btn go sm" onClick={approve}>{t('Approve')}</button>
            <button className="btn warn sm" onClick={() => setRejecting(true)}>{t('Reject')}</button></>}
          {canEdit && <button className="btn ghost sm" onClick={() => onEdit(e)}>{t('Edit')}</button>}
        </span>
      </div>
      {rejecting && <Confirm title={t('Reject this time?')} action={t('Reject')} onClose={() => setRejecting(false)}
        text={t('{who} logged {time} of {chore} on {day}. It won’t be paid. They can edit and resend it.', { who: n > 1 ? t('The team ({names})', { names: e.team_members.map(id => F.member(id)?.display_name).join('، ') }) : F.member(e.member_id)?.display_name, time: dur(e.minutes), chore: e.chore_name, day: fmtDay(e.work_date) })}
        onConfirm={() => setStatus('rejected', t('Marked as not approved'))} />}
    </div>
  );
}
