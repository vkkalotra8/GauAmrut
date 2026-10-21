import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

function EmptyArt() {
  return (
    <svg className="empty-art" width="88" height="66" viewBox="0 0 96 72" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M26 20c-4-6-11-8-14-6 1 5 6 8 10 9" />
      <path d="M70 20c4-6 11-8 14-6-1 5-6 8-10 9" />
      <rect x="22" y="16" width="52" height="42" rx="19" />
      <circle cx="37" cy="34" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="59" cy="34" r="2.6" fill="currentColor" stroke="none" />
      <rect x="34" y="44" width="28" height="14" rx="7" />
      <circle cx="43" cy="51" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="53" cy="51" r="1.8" fill="currentColor" stroke="none" />
      <path d="M84 58c0-5 3-9 7-10 1 5-2 9-7 10z" fill="currentColor" opacity=".28" stroke="none" />
    </svg>
  );
}

export function LogoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 3c4.8 5.4 9 9.8 9 14.5A9 9 0 0 1 7 17.5C7 12.8 11.2 8.4 16 3z" fill="currentColor" opacity=".14"/>
      <path d="M16 3c4.8 5.4 9 9.8 9 14.5A9 9 0 0 1 7 17.5C7 12.8 11.2 8.4 16 3z" stroke="currentColor" strokeWidth="2"/>
      <path d="M16 25.5V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M16 17.5c.3-3.1 2.7-5.5 5.8-5.8.2 3.3-2.3 6-5.8 5.8z" fill="currentColor"/>
      <path d="M16 17.5c-.3-3.1-2.7-5.5-5.8-5.8-.2 3.3 2.3 6 5.8 5.8z" fill="currentColor" opacity=".68"/>
    </svg>
  );
}
export function Brand() { return <div className="brand"><span className="brand-icon"><LogoMark size={25}/></span><span>Gau<span className="brand-light">Amrut</span><small>PURE MILK. SIMPLE BUSINESS.</small></span></div>; }
export function Notice({ children, error = false }) {
  if (!children) return null;
  const Icon = error ? AlertTriangle : CheckCircle2;
  return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><Icon size={16} className="notice-icon" aria-hidden="true"/><span className="notice-body">{children}</span></div>;
}
export function State({ resource, children }) { return resource.loading ? <div className="loading-state" role="status"><span>Loading your dairy…</span><div className="skeleton"/><div className="skeleton sk-mid"/><div className="skeleton sk-short"/></div> : resource.error ? <div className="empty"><Notice error>{resource.error}</Notice><button className="button" onClick={resource.reload}>Try again</button></div> : children; }
export function Empty({ children }) { return <div className="empty"><EmptyArt/><p>{children}</p></div>; }
export function Heading({ eyebrow, title, description, children }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow || 'YOUR DAIRY, AT A GLANCE'}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>; }
export function AnimatedNumber({ value, format = Math.round }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(() => (reduced ? value : 0));
  useEffect(() => {
    if (reduced) { setDisplay(value); return; }
    let raf;
    const from = 0;
    const start = performance.now();
    const duration = 750;
    const tick = now => {
      const p = Math.min(1, (now - start) / duration);
      setDisplay(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <>{format(display)}</>;
}
export function Modal({ title, close, children }) {
  useEffect(() => { const previous = document.activeElement; const dialog = document.getElementById('app-dialog'); if (dialog?.showModal) dialog.showModal(); return () => { if (dialog?.close) dialog.close(); previous?.focus(); }; }, []);
  return <dialog id="app-dialog" aria-labelledby="dialog-title" onCancel={close}><div className="modal-title"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X/></button></div>{children}</dialog>;
}
export function Field({ label, ...props }) { return <label className="field"><span>{label}</span><input {...props}/></label>; }
export function ChartTip({ active, payload, label, format = String }) {
  if (!active || !payload?.length) return null;
  const first = payload[0];
  return <div className="chart-tip"><b>{first?.payload?.date || label}</b>{payload.map(p => <span key={p.dataKey}><i style={{ background: p.color || p.stroke || 'var(--green)' }}/>{format(p.value, p.dataKey)}</span>)}</div>;
}
