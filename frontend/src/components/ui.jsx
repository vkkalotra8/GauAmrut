import { useEffect } from 'react';
import { Droplets, X } from 'lucide-react';
export function Brand() { return <div className="brand"><span className="brand-icon"><Droplets size={25}/></span><span>Gau<span className="brand-light">Amrut</span><small>PURE MILK. SIMPLE BUSINESS.</small></span></div>; }
export function Notice({ children, error = false }) { return children ? <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div> : null; }
export function State({ resource, children }) { return resource.loading ? <div className="empty" role="status">Loading your dairy…</div> : resource.error ? <div className="empty"><Notice error>{resource.error}</Notice><button className="button" onClick={resource.reload}>Try again</button></div> : children; }
export function Empty({ children }) { return <div className="empty"><Droplets size={30}/><p>{children}</p></div>; }
export function Heading({ eyebrow, title, description, children }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow || 'YOUR DAIRY, AT A GLANCE'}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>; }
export function Modal({ title, close, children }) {
  useEffect(() => { const previous = document.activeElement; const dialog = document.getElementById('app-dialog'); if (dialog?.showModal) dialog.showModal(); return () => { if (dialog?.close) dialog.close(); previous?.focus(); }; }, []);
  return <dialog id="app-dialog" aria-labelledby="dialog-title" onCancel={close}><div className="modal-title"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X/></button></div>{children}</dialog>;
}
export function Field({ label, ...props }) { return <label className="field"><span>{label}</span><input {...props}/></label>; }
