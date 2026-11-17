import { useEffect, useRef, type ReactNode } from 'react';
import type { EntryStatus, Member } from './types';
import { textOn } from './lib/util';

export function Avatar({ m, size = '' }: { m?: Member | null; size?: '' | 'sm' | 'lg' }) {
  if (!m) return null;
  return <span className={`av ${size}`} style={{ ['--c' as string]: m.color, ['--t' as string]: textOn(m.color) }} aria-hidden="true">{m.display_name.slice(0, 1).toUpperCase()}</span>;
}

export function Pill({ status }: { status: EntryStatus }) {
  const label = { submitted: 'Awaiting approval', approved: 'Approved', rejected: 'Not approved' }[status];
  return <span className={`pill ${status}`}>{label}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const first = sheet.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, .opt');
    window.setTimeout(() => first?.focus(), 30);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={sheet}>
        <header><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button></header>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, text, action, onConfirm, onClose }: { title: string; text: ReactNode; action: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="sheet-body">
        <p>{text}</p>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn warn" onClick={() => { onClose(); onConfirm(); }}>{action}</button>
        </div>
      </div>
    </Modal>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h2>{title}</h2>{children}</div>;
}

export function WeekBar({ week, onStep, extra }: { week: string; onStep: (n: number) => void; extra?: ReactNode }) {
  return (
    <div className="weekbar">
      <button className="btn ghost icon" onClick={() => onStep(-1)} aria-label="Previous week">‹</button>
      <span className="range num">{week}</span>
      <button className="btn ghost icon" onClick={() => onStep(1)} aria-label="Next week">›</button>
      {extra}
    </div>
  );
}

export const Wave = () => (
  <svg viewBox="0 0 1200 48" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 22 C150 6 300 6 450 20 S750 36 900 20 S1100 6 1200 16 V48 H0Z" fill="var(--brand-mist)" />
    <path d="M0 30 C180 16 330 18 480 30 S780 44 960 30 S1120 18 1200 26 V48 H0Z" fill="var(--brand-sea)" />
    <path d="M0 38 C200 28 360 30 520 38 S820 48 1000 38 S1140 30 1200 36 V48 H0Z" fill="var(--brand)" />
  </svg>
);

export const Mark = () => (
  <div className="mark-badge" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#04281a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
  </div>
);
