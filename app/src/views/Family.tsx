import { useEffect, useState, type FormEvent } from 'react';
import { supabase, errorText } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Confirm, Modal } from '../ui';
import type { Invite, Member } from '../types';
import { MEMBER_COLORS, textOn } from '../lib/util';

export function Family() {
  const F = useFamily();
  const [edit, setEdit] = useState<Member | 'child' | null>(null);
  const [code, setCode] = useState<{ code: string; expires: string; who: string; role: 'child' | 'parent' } | null>(null);
  const [unlink, setUnlink] = useState<Member | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const parents = F.members.filter(m => m.active && m.role === 'parent');
  const inactive = F.members.filter(m => !m.active);

  const loadInvites = async () => {
    const { data } = await supabase.from('invites').select('*').eq('household_id', F.household.id).is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
    setInvites((data || []) as Invite[]);
  };
  useEffect(() => { void loadInvites(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [F.household.id]);

  const makeCode = async (role: 'child' | 'parent', m?: Member) => {
    const { data, error } = await supabase.rpc('create_invite', { p_household: F.household.id, p_role: role, p_member_id: m?.id ?? null });
    if (error) { F.toast(errorText(error)); return; }
    const row = (data as { code: string; expires_at: string }[])[0];
    setCode({ code: row.code, expires: row.expires_at, who: m?.display_name || 'the other parent', role });
    void loadInvites();
  };

  const Row = ({ m }: { m: Member }) => (
    <div className="member">
      <Avatar m={m} />
      <div className="member-main"><b>{m.display_name}{m.id === F.me.id && <span className="muted"> (you)</span>}</b>
        <span className="cap">{m.role === 'parent' ? 'Parent' : 'Child'} · {m.user_id ? (m.role === 'child' ? 'Device linked' : 'Signed in') : (m.role === 'child' ? 'No device linked yet' : 'Invite pending')}</span></div>
      <div className="member-acts">
        {m.role === 'child' && <button className="btn go sm" onClick={() => makeCode('child', m)}>{m.user_id ? 'New device code' : 'Device code'}</button>}
        {m.role === 'child' && m.user_id && <button className="btn ghost sm" onClick={() => setUnlink(m)}>Unlink</button>}
        {m.id !== F.me.id && <button className="btn ghost sm" onClick={() => setEdit(m)}>Edit</button>}
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head"><div><h1>Family</h1><p className="muted">Add the children and give each one a code to link their phone or tablet. Invite the other parent with a parent code.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn ghost" onClick={() => makeCode('parent')}>Invite a parent</button><button className="btn primary" onClick={() => setEdit('child')}>+ Add a child</button></div></div>
      <div className="stack">
        <section className="panel"><div className="panel-head"><h2>Parents</h2></div><div className="members">{parents.map(m => <Row key={m.id} m={m} />)}</div></section>
        <section className="panel"><div className="panel-head"><h2>Children</h2></div>
          {F.kids.length ? <div className="members">{F.kids.map(m => <Row key={m.id} m={m} />)}</div> : <p className="empty-note">No children yet. Use “Add a child” to start.</p>}</section>
        {invites.length > 0 && <section className="panel flat"><div className="panel-head"><h2>Codes not used yet</h2></div>
          <div className="entries">{invites.map(i => (
            <div className="entry" key={i.code}><span className="what num">{i.code}</span>
              <span><button className="btn ghost sm" onClick={async () => { await supabase.from('invites').delete().eq('code', i.code); void loadInvites(); }}>Cancel code</button></span>
              <div className="meta"><span>{i.role === 'child' ? `Device code for ${F.member(i.member_id)?.display_name}` : 'Parent invite'} · expires {new Date(i.expires_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            </div>))}</div></section>}
        {inactive.length > 0 && <section className="panel flat"><div className="panel-head"><h2>Removed from the family</h2></div>
          <div className="entries">{inactive.map(m => <div className="entry" key={m.id}><span className="what">{m.display_name}</span>
            <span><button className="btn ghost sm" onClick={() => F.run(['members'], () => supabase.from('members').update({ active: true }).eq('id', m.id), `${m.display_name} is back`)}>Restore</button></span></div>)}</div></section>}
      </div>
      {edit && <MemberModal member={edit === 'child' ? null : edit} onClose={() => setEdit(null)} />}
      {code && <Modal title={code.role === 'child' ? `Link ${code.who}’s device` : 'Invite a parent'} onClose={() => setCode(null)}>
        <div className="sheet-body">
          <div className="bigcode num" aria-label="Code">{code.code.slice(0, 4)} {code.code.slice(4)}</div>
          {code.role === 'child'
            ? <p>On {code.who}’s phone or tablet, open the app, choose <b>I’m a child</b> and type this code. It works once and expires {new Date(code.expires).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.</p>
            : <p>The other parent creates their own account with <b>New family</b>, then chooses <b>Join with a code</b> and types this code. It expires {new Date(code.expires).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}.</p>}
          <div className="sheet-actions"><button className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(code.code); F.toast('Code copied'); } catch { F.toast('Select the code to copy it'); } }}>Copy code</button><button className="btn primary" onClick={() => setCode(null)}>Done</button></div>
        </div></Modal>}
      {unlink && <Confirm title={`Unlink ${unlink.display_name}’s device?`} action="Unlink" onClose={() => setUnlink(null)}
        text="Use this if the phone is lost or replaced. That device signs out of the family. Their timesheets and balance stay. Make a new device code to link another phone."
        onConfirm={() => F.run(['members'], () => supabase.from('members').update({ user_id: null }).eq('id', unlink.id), 'Device unlinked')} />}
    </>
  );
}

function MemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const F = useFamily();
  const used = new Set(F.members.map(m => m.color));
  const [name, setName] = useState(member?.display_name || '');
  const [color, setColor] = useState(member?.color || MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[0]);
  const [err, setErr] = useState('');
  const [remove, setRemove] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Add a name.'); return; }
    const ok = member
      ? await F.run(['members'], () => supabase.from('members').update({ display_name: name.trim(), color }).eq('id', member.id), 'Saved')
      : await F.run(['members'], () => supabase.from('members').insert({ household_id: F.household.id, display_name: name.trim(), role: 'child', color, sort_order: 10 + F.kids.length }), `${name.trim()} added. Make a device code to link their phone.`);
    if (ok) onClose();
  }
  if (remove && member) return <Confirm title={`Remove ${member.display_name}?`} action="Remove" onClose={() => setRemove(false)}
    text="They lose access and drop out of the schedule and balances. Their history is kept, and you can restore them later."
    onConfirm={async () => { if (await F.run(['members'], () => supabase.from('members').update({ active: false }).eq('id', member.id), `${member.display_name} removed`)) onClose(); }} />;
  return (
    <Modal title={member ? `Edit ${member.display_name}` : 'Add a child'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>Name</span><input type="text" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ayesha" /></label>
        <div className="field"><span>Colour</span><div className="swatches">{MEMBER_COLORS.map(c => (
          <button type="button" key={c} className="swatch" aria-pressed={c === color} aria-label={`Colour ${c}`} style={{ background: c, color: textOn(c) }} onClick={() => setColor(c)}>{c === color ? '✓' : ''}</button>))}</div></div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions">
          {member && <button type="button" className="btn warn left" onClick={() => setRemove(true)}>Remove</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{member ? 'Save' : 'Add child'}</button>
        </div>
      </form>
    </Modal>
  );
}
