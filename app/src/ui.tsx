import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { EntryStatus, Member } from './types';
import { textOn } from './lib/util';
import { t, lang, setLang, otherLangLabel } from './i18n';

export function Avatar({ m, size = '' }: { m?: Member | null; size?: '' | 'sm' | 'lg' }) {
  if (!m) return null;
  return <span className={`av ${size}`} style={{ ['--c' as string]: m.color, ['--t' as string]: textOn(m.color) }} aria-hidden="true">{m.display_name.slice(0, 1).toUpperCase()}</span>;
}

export function Pill({ status }: { status: EntryStatus }) {
  const label = t({ submitted: 'Awaiting approval', approved: 'Approved', rejected: 'Not approved' }[status]);
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
        <header><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label={t('Close')}>✕</button></header>
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
          <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
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
      <button className="btn ghost icon" onClick={() => onStep(-1)} aria-label={t('Previous week')}>‹</button>
      <span className="range num">{week}</span>
      <button className="btn ghost icon" onClick={() => onStep(1)} aria-label={t('Next week')}>›</button>
      {extra}
    </div>
  );
}

/** English / العربية switch for the header. Each device remembers its choice. */
export function LangToggle() {
  const other = lang() === 'ar' ? 'en' : 'ar';
  return (
    <button type="button" className="lang-toggle" lang={other} onClick={() => setLang(other)}
      aria-label={other === 'ar' ? 'التبديل إلى العربية' : 'Switch to English'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>
      <span className="lt-full">{otherLangLabel()}</span><span className="lt-short" aria-hidden="true">{other === 'ar' ? 'ع' : 'EN'}</span>
    </button>
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

/**
 * A table that may be wider than the screen. When it is, the side with more to see gets a fade,
 * and a short "swipe sideways" note appears above it, so children notice there are more columns.
 * `scrollToSelector` scrolls a cell into view on first show (e.g. today's column).
 */
export function ScrollBox({ children, className = '', scrollToSelector }: { children: ReactNode; className?: string; scrollToSelector?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const update = () => {
    const el = box.current; if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft); // negative in right-to-left layouts
    setEdges(prev => {
      const next = { start: max > 4 && pos > 4, end: max > 4 && pos < max - 4 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  };
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    if (scrollToSelector) {
      const target = el.querySelector<HTMLElement>(scrollToSelector);
      if (target && el.scrollWidth > el.clientWidth) {
        const rtl = getComputedStyle(el).direction === 'rtl';
        const offset = rtl ? -(el.clientWidth - (target.offsetLeft + target.offsetWidth)) : target.offsetLeft;
        el.scrollLeft = rtl ? Math.min(0, offset + 160) : Math.max(0, offset - 160);
      }
    }
    update();
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrollable = edges.start || edges.end;
  return (
    <div className={`scrollbox ${edges.start ? 'fade-start' : ''} ${edges.end ? 'fade-end' : ''}`}>
      {scrollable && <p className="swipe-hint" aria-hidden="true"><span className="swipe-arrow">↔</span> {t('Swipe sideways to see the whole table')}</p>}
      <div className={`tbl-wrap ${className}`} ref={box} onScroll={update} tabIndex={scrollable ? 0 : undefined}>{children}</div>
    </div>
  );
}
