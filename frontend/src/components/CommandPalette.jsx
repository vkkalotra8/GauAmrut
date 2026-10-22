import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft, Droplets, Plus, Search, UserPlus, Users, Wallet } from 'lucide-react';
import useData from '../hooks/useData';
import { demoCustomers } from '../demo';

function Palette({ navItems, close }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSelector(s => s.session);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const isCustomer = session.user?.role === 'customer';
  // Admins cannot query /customers (platform routes only), so the palette
  // searches a harmless admin endpoint for them instead of a guaranteed 403.
  const searchPath = isCustomer ? '/profile' : session.user?.role === 'admin' ? '/admin/dashboard' : '/customers?limit=100';
  const resource = useData(searchPath, session.demo ? demoCustomers : null);
  useEffect(() => { const dialog = document.getElementById('command-palette-dialog'); if (dialog?.showModal) dialog.showModal(); return () => { if (dialog?.close) dialog.close(); }; }, []);
  const q = query.trim().toLowerCase();
  const pages = navItems.filter(n => !q || n.label.toLowerCase().includes(q)).map(n => ({ id: `page-${n.to}`, label: n.label, icon: n.icon, run: () => navigate(n.to) }));
  const customers = !isCustomer && q && Array.isArray(resource.data) ? resource.data.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 5).map(c => ({ id: `customer-${c._id}`, label: c.name, sub: c.phone, icon: Users, run: () => navigate('/customers') })) : [];
  const actions = [
    !isCustomer && !session.demo && { id: 'add-customer', label: t('palette.addCustomer', 'Add a customer'), icon: UserPlus, run: () => navigate('/customers?add=1') },
    { id: 'record-delivery', label: t('palette.recordDelivery', 'Record milk delivery'), icon: Droplets, run: () => navigate('/records') },
    !isCustomer && { id: 'generate-bill', label: t('palette.generateBill', 'Generate a bill'), icon: Wallet, run: () => navigate('/payments') }
  ].filter(a => a && (!q || a.label.toLowerCase().includes(q)));
  const items = [...pages, ...customers, ...actions];
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].run(); close(); }
  }
  return (
    <dialog id="command-palette-dialog" className="cmdk" aria-label={t('palette.label', 'Command palette')} onCancel={close} onKeyDown={onKeyDown}>
      <div className="cmdk-input"><Search size={16} aria-hidden="true"/><input autoFocus aria-label={t('palette.search', 'Search pages and customers')} placeholder={t('palette.placeholder', 'Search or jump to…')} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }}/><kbd>Esc</kbd></div>
      <div className="cmdk-list">
        {items.length ? items.map((item, i) => (
          <button type="button" className={`cmdk-item ${i === active ? 'active' : ''}`} key={item.id} onMouseEnter={() => setActive(i)} onClick={() => { item.run(); close(); }}>
            <item.icon size={16} aria-hidden="true"/><span>{item.label}</span>{item.sub && <small>{item.sub}</small>}{i === active && <CornerDownLeft size={13} className="cmdk-enter" aria-hidden="true"/>}
          </button>
        )) : <div className="cmdk-empty">{t('palette.noResults', 'No matches. Try a customer name or a page.')}</div>}
      </div>
    </dialog>
  );
}

export default function CommandPalette({ navItems }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  useEffect(() => {
    const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(v => !v); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <button ref={triggerRef} type="button" className="icon-button palette-trigger" aria-label={t('palette.open', 'Open command palette')} title={`${t('palette.open', 'Open command palette')} (Ctrl+K)`} onClick={() => setOpen(true)}><Search size={17}/></button>
      {open && <Palette navItems={navItems} close={() => { setOpen(false); triggerRef.current?.focus(); }}/>}
    </>
  );
}
