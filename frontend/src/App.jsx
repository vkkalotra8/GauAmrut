import AdminPortal from './features/admin/AdminPortal';
import Records from './features/vendor/Records';
import Payments from './features/vendor/Payments';
import Products from './features/vendor/Products';
import Orders from './features/vendor/Orders';
import Disputes from './features/vendor/Disputes';
import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, BarChart3, Check, ChevronLeft, ChevronRight, Download, Droplets, LayoutDashboard, Leaf, LogOut, Menu, MessageSquare, MoreHorizontal, Package, Plus, Search, Settings, ShieldCheck, ShoppingBag, Sun, Users, Wallet, Wifi, WifiOff, X } from 'lucide-react';
import { api, decimalUnits, message, money, serviceDate, signOut, store } from './lib';
import { Brand, Notice, State, Empty, Heading, Modal, Field, AnimatedNumber } from './components/ui';
import { MilkTrend } from './components/charts';
import useData from './hooks/useData';
import Auth from './features/auth/Auth';
import { CustomerHome, CustomerHistory, CustomerPayments, CustomerProfile, CustomerOrders, CustomerDisputes } from './features/customer/Portal';
import CustomerEditor from './features/vendor/CustomerEditor';
import Profile from './features/vendor/DairyProfile';
import { demoBills, demoCustomers, demoDashboard } from './demo';
import { discard, queued, saveBatchItems, syncQueue } from './offline';
import LanguageSelect from './components/LanguageSelect';
import ThemeToggle from './components/ThemeToggle';
import CommandPalette from './components/CommandPalette';
import NotificationsDrawer from './components/NotificationsDrawer';
import AnnouncementBanner from './components/AnnouncementBanner';
import { usePlatformSettings } from './platform';

const vendorNav = [
  { to: '/', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', short: 'Customers', icon: Users },
  { to: '/records', label: 'Milk records', short: 'Records', icon: Droplets },
  { to: '/products', label: 'Products', short: 'Products', icon: Package },
  { to: '/orders', label: 'Orders', short: 'Orders', icon: ShoppingBag },
  { to: '/payments', label: 'Bills & payments', short: 'Bills', icon: Wallet },
  { to: '/disputes', label: 'Disputes', short: 'Issues', icon: MessageSquare },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: BarChart3 }
];
const customerNav = [
  { to: '/', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { to: '/records', label: 'Delivery history', short: 'History', icon: Droplets },
  { to: '/orders', label: 'Store & Orders', short: 'Store', icon: ShoppingBag },
  { to: '/payments', label: 'Bills & payments', short: 'Bills', icon: Wallet },
  { to: '/disputes', label: 'Disputes', short: 'Issues', icon: MessageSquare },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: BarChart3 }
];
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 720px)');
    const update = e => setIsMobile(e.matches);
    query.addEventListener('change', update);
    setIsMobile(query.matches);
    return () => query.removeEventListener('change', update);
  }, []);
  return isMobile;
}
function Dashboard() {
  const session = useSelector(s => s.session); const resource = useData('/dashboard', demoDashboard), navigate = useNavigate(); const data = resource.data; const isMobile = useIsMobile();
  const formattedDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  return <><Heading title={`A fresh day, ${session.user.name.split(' ')[0]}.`} description="Here’s how your dairy is doing. Let’s make today a good one."><span className="date-chip"><Sun size={17}/>{formattedDate}</span></Heading><State resource={resource}>{data && <><section className="welcome-banner"><div><span className="eyebrow">A LITTLE CARE. EVERY SINGLE DAY.</span><h2>Good milk. Happy homes.</h2><p>Keep your deliveries flowing and your business growing.</p><button className="button" onClick={() => navigate('/records')}>Start today’s entry <ArrowRight size={17}/></button></div><div className="banner-art" aria-hidden="true"><div className="sun-disc"/><div className="hill hill-back"/><div className="hill hill-front"/><div className="mini-bottle"><Droplets size={30}/><span>fresh daily</span></div><Leaf size={78} className="banner-leaf"/></div></section><div className="stats-grid">{[{ title: 'Today’s milk', value: <AnimatedNumber value={data.today.quantityMl / 1000} format={n => `${Math.round(n * 10) / 10} L`}/>, note: `${data.today.entries} delivery entries recorded`, icon: Droplets, color: 'green' }, { title: 'Active customers', value: <AnimatedNumber value={data.activeCustomers}/>, note: `${data.customerCount} customers in your dairy`, icon: Users, color: 'blue' }, { title: 'Collected this month', value: <AnimatedNumber value={data.collectedPaise} format={money}/>, note: 'Payments received & recorded', icon: Wallet, color: 'gold' }, { title: 'Outstanding balance', value: <AnimatedNumber value={data.outstandingPaise} format={money}/>, note: 'Across finalized monthly bills', icon: ArrowUpRight, color: 'orange' }].map((s, i) => <motion.article className="stat-card" key={s.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06, duration: 0.35, ease: 'easeOut' }}><div className="stat-top"><span>{s.title}</span><span className={`stat-icon ${s.color}`}><s.icon size={20}/></span></div><strong>{s.value}</strong><small>{s.note}</small></motion.article>)}</div><div className="dashboard-grid"><section className="card"><div className="card-heading"><div><h2>Milk delivery overview</h2><p>Your daily volume this month</p></div><span className="pill"><span className="dot"/> Litres delivered</span></div>{data.monthly.length ? <MilkTrend monthly={data.monthly}/> : <Empty>Record your first delivery to see the month take shape.</Empty>}<div className="chart-footer"><span>Total this month <b>{data.monthly.reduce((n, d) => n + d.quantityMl, 0) / 1000} L</b></span><span>Delivery value <b>{money(data.monthly.reduce((n, d) => n + d.totalPaise, 0))}</b></span></div></section><section className="card quick-card"><div className="card-heading"><div><h2>A little less clicking</h2><p>Your everyday essentials</p></div></div>{[{ icon: Plus, title: 'Add a customer', sub: 'Welcome another happy home', to: '/customers?add=1' }, { icon: Droplets, title: 'Record milk delivery', sub: 'Fresh milk, accurately recorded', to: '/records' }, { icon: Wallet, title: 'Collect a payment', sub: 'Keep your books up to date', to: '/payments' }, { icon: Download, title: 'Download a report', sub: 'Your numbers, ready to share', to: '/reports' }].map(a => <button className="quick-action" key={a.title} onClick={() => navigate(a.to)}><span className="quick-icon"><a.icon size={20}/></span><span><b>{a.title}</b><small>{a.sub}</small></span><ChevronRight size={17}/></button>)}</section></div><section className="card recent-card"><div className="card-heading"><div><h2>Fresh off the route</h2><p>Your most recent milk deliveries</p></div><button className="text-button" onClick={() => navigate('/records')}>View all records <ArrowRight size={16}/></button></div><DeliveryTable rows={data.recent}/></section><div className="page-footnote"><Leaf size={15}/> Bringing a little more simplicity to every dairy day.</div></>}{isMobile && !session.demo && <button className="fab" aria-label="Record milk delivery" onClick={() => navigate('/records')}><Plus size={24}/></button>}</State></>;
}
function DeliveryTable({ rows, customers = [] }) { return rows.length ? <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Service date</th><th>Milk & shift</th><th>Quantity</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map(r => <tr key={r._id}><td><span className="person"><span className="avatar">{(r.customerName || customers.find(c => c._id === r.customer_id)?.name || 'C').slice(0, 1)}</span><b>{r.customerName || customers.find(c => c._id === r.customer_id)?.name || 'Customer'}</b></span></td><td>{r.date}</td><td className="capitalize">{r.type} · {r.shift}</td><td>{r.quantityMl / 1000} L</td><td>{money(r.totalPaise)}</td><td><span className="status"><Check size={12}/> Recorded</span></td></tr>)}</tbody></table></div> : <Empty>No deliveries yet. Add a customer, then start your route.</Empty>; }
function Customers() {
  const demo = useSelector(s => s.session.demo), location = useLocation(); const [search, setSearch] = useState(''), [page, setPage] = useState(1), [open, setOpen] = useState(location.search.includes('add=1')), [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(null);
  const [reordering, setReordering] = useState(false), [reorderShift, setReorderShift] = useState('morning'), [routeList, setRouteList] = useState([]);
  const resource = useData(`/customers?q=${encodeURIComponent(search)}&page=${page}`, demoCustomers);
  const platform = usePlatformSettings();
  function openReorder(shift = 'morning') {
    setReorderShift(shift);
    const sorted = [...(resource.data || [])].sort((a, b) => (a[shift === 'evening' ? 'routeEvening' : 'routeMorning'] ?? 0) - (b[shift === 'evening' ? 'routeEvening' : 'routeMorning'] ?? 0) || a.name.localeCompare(b.name));
    setRouteList(sorted);
    setReordering(true);
  }
  function changeReorderShift(shift) {
    setReorderShift(shift);
    const sorted = [...(resource.data || [])].sort((a, b) => (a[shift === 'evening' ? 'routeEvening' : 'routeMorning'] ?? 0) - (b[shift === 'evening' ? 'routeEvening' : 'routeMorning'] ?? 0) || a.name.localeCompare(b.name));
    setRouteList(sorted);
  }
  function move(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= routeList.length) return;
    const copy = [...routeList];
    const [removed] = copy.splice(idx, 1);
    copy.splice(target, 0, removed);
    setRouteList(copy);
  }
  async function saveRouteOrder() {
    if (demo) { setNotice('Demo mode is read-only. Sign in to customize route order.'); setReordering(false); return; }
    setBusy(true); setError('');
    try {
      const orders = routeList.map((c, i) => ({ customer_id: c._id, order: i }));
      await api.patch('/customers/route-order', { shift: reorderShift, orders });
      setReordering(false);
      setNotice(`${reorderShift === 'evening' ? 'Evening' : 'Morning'} route sequence updated.`);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function save(e) { e.preventDefault(); if (demo) { setError('This is a read-only demo. Sign in to add your own customers.'); return; } setBusy(true); setError(''); try { const f = Object.fromEntries(new FormData(e.currentTarget)); const body = { name: f.name, phone: f.phone, email: f.email || '', address: f.address, startDate: f.startDate, cowRatePaise: decimalUnits(f.cowRate), buffaloRatePaise: decimalUnits(f.buffaloRate), morningCowMl: decimalUnits(f.morning, 1000), eveningCowMl: decimalUnits(f.evening, 1000) }; await api.post('/customers', body); setOpen(false); setNotice('Customer added. You can now record their deliveries.'); resource.reload(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function toggle(c) { if (demo) { setNotice('Sign in to manage your own customers. Demo data is read-only.'); return; } try { await api.patch(`/customers/${c._id}/status`, { status: c.status === 'active' ? 'inactive' : 'active' }); resource.reload(); } catch (e) { setNotice(message(e)); } }
  return <><Heading eyebrow="GOOD PEOPLE. GOOD BUSINESS." title="Your customers" description="A little care for every home on your route."><div className="heading-actions"><button className="button" onClick={() => openReorder('morning')}>Reorder route</button><button className="button primary" onClick={() => { setOpen(true); setError(''); }}><Plus size={18}/> Add customer</button></div></Heading><Notice>{notice}</Notice><section className="card"><div className="card-heading"><h2>Customer directory</h2><label className="search"><Search size={17}/><input aria-label="Search customers" placeholder="Search by name…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/></label></div><State resource={resource}>{resource.data?.length ? <div className="customer-grid">{resource.data.filter(c => !demo || c.name.toLowerCase().includes(search.toLowerCase())).map(c => <article className="customer-card" key={c._id}><div className="customer-card-top"><span className="avatar">{c.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><div className="card-badges"><span className="pill" title="Morning route stop">AM #{c.routeMorning ?? 0}</span><span className="pill" title="Evening route stop">PM #{c.routeEvening ?? 0}</span><span className={`status ${c.status === 'inactive' ? 'neutral' : ''}`}>{c.status}</span></div></div><h3>{c.name}</h3><p>{c.address || 'No address added'}</p><p>{c.phone}</p><div className="customer-rates"><span>Cow milk<b>{money(c.cowRatePaise)} / L</b></span><span>Buffalo milk<b>{money(c.buffaloRatePaise)} / L</b></span></div><button className="text-button" onClick={() => setEditing(c)}>Edit customer</button><button className="text-button" onClick={() => toggle(c)}>{c.status === 'active' ? 'Deactivate service' : 'Reactivate service'}<ArrowRight size={14}/></button></article>)}</div> : <Empty>Your directory is empty. Add your first customer to get started.</Empty>}</State><Pagination page={page} setPage={setPage} total={resource.meta?.total || resource.data?.length || 0}/></section>{editing && <CustomerEditor customer={editing} close={() => setEditing(null)} saved={() => { setEditing(null); resource.reload(); setNotice('Customer updated. Existing delivery rates were preserved.'); }}/>} {open && <Modal title="Welcome a new customer" close={() => setOpen(false)}><form onSubmit={save}><div className="form-grid"><Field label="Full name" name="name" required minLength={2}/><Field label="Phone number" name="phone" type="tel" required/><Field label="Customer email (for history linking)" name="email" type="email"/><Field label="Address" name="address"/><Field label="Service start date" name="startDate" type="date" defaultValue={serviceDate()} required/><Field label="Cow rate (₹ / litre)" name="cowRate" type="number" min="0" step="0.01" defaultValue={(platform?.defaults?.cowRatePaise ?? 6000) / 100} required/><Field label="Buffalo rate (₹ / litre)" name="buffaloRate" type="number" min="0" step="0.01" defaultValue={(platform?.defaults?.buffaloRatePaise ?? 8000) / 100} required/><Field label="Morning cow milk (litres)" name="morning" type="number" min="0" step="0.001" defaultValue="1" required/><Field label="Evening cow milk (litres)" name="evening" type="number" min="0" step="0.001" defaultValue="0" required/></div><Notice error>{error}</Notice><button className="button primary full" disabled={busy}>{busy ? 'Saving…' : 'Add customer'}</button></form></Modal>}{reordering && <Modal title="Organize delivery route" close={() => setReordering(false)}><div className="shift-switch"><button type="button" className={`button ${reorderShift === 'morning' ? 'primary' : ''}`} onClick={() => changeReorderShift('morning')}>Morning route</button><button type="button" className={`button ${reorderShift === 'evening' ? 'primary' : ''}`} onClick={() => changeReorderShift('evening')}>Evening route</button></div><p className="form-note">Arrange the order in which homes appear on your daily delivery route.</p><div className="route-scroll">{routeList.map((c, i) => <div className="route-row" key={c._id}><div><b>#{i + 1}. {c.name}</b><small>{c.address || 'No address'}</small></div><div className="modal-actions"><button type="button" className="button small" disabled={i === 0 || busy} onClick={() => move(i, -1)}>↑</button><button type="button" className="button small" disabled={i === routeList.length - 1 || busy} onClick={() => move(i, 1)}>↓</button></div></div>)}</div><Notice error>{error}</Notice><button type="button" className="button primary full" disabled={busy || !routeList.length} onClick={saveRouteOrder}>{busy ? 'Saving route…' : 'Save route order'}</button></Modal>}</>;
}
function Pagination({ page, setPage, total }) { return <div className="pagination"><small>{total} results · Page {page}</small><button className="icon-button" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={18}/></button><button className="icon-button" disabled={page * 50 >= total} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={18}/></button></div>; }
function Reports() {
  const demo = useSelector(s => s.session.demo), [month, setMonth] = useState(serviceDate().slice(0, 7)), [error, setError] = useState(''), [busyReport, setBusyReport] = useState('');
  async function download(type) {
    setError('');
    if (demo) { setError('Sign in to export your dairy’s records. Demo data is for preview only.'); return; }
    setBusyReport(type);
    try {
      let endpoint = '';
      let filename = '';
      if (type === 'deliveries') {
        endpoint = `/reports/deliveries.csv?month=${month}`;
        filename = `gauamrut-deliveries-${month}.csv`;
      } else if (type === 'payments') {
        endpoint = `/reports/payments.csv?startDate=${month}-01&endDate=${month}-31`;
        filename = `gauamrut-payments-${month}.csv`;
      } else if (type === 'customers') {
        endpoint = `/reports/customer-summary.csv`;
        filename = `gauamrut-customers.csv`;
      } else if (type === 'orders') {
        endpoint = `/reports/orders.csv?month=${month}`;
        filename = `gauamrut-orders-${month}.csv`;
      }
      const r = await api.get(endpoint, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e.response?.data instanceof Blob) {
        try { setError(JSON.parse(await e.response.data.text()).error.message); } catch { setError(message(e)); }
      } else setError(message(e));
    } finally {
      setBusyReport('');
    }
  }
  return <>
    <Heading eyebrow="THE DETAILS THAT MATTER." title="Your dairy, in numbers" description="Take accurate delivery records, payment ledgers, and customer summaries wherever you need them."/>
    <Notice error>{error}</Notice>
    <div className="reports-grid">
      <section className="card report-card">
        <span className="report-icon"><BarChart3 size={32}/></span>
        <h2>Monthly delivery report</h2>
        <p>Every delivery, quantity, rate snapshot, and charge for the selected month in paise.</p>
        <Field label="Reporting month" type="month" value={month} onChange={e => setMonth(e.target.value)}/>
        <button className="button primary" disabled={Boolean(busyReport) || !month} onClick={() => download('deliveries')}>
          <Download size={17}/>{busyReport === 'deliveries' ? 'Preparing report…' : 'Download Deliveries CSV'}
        </button>
      </section>

      <section className="card report-card">
        <span className="report-icon"><Wallet size={32}/></span>
        <h2>Payments & collections report</h2>
        <p>All finalized bills, customer payment receipts, and balance ledgers for the selected month.</p>
        <Field label="Reporting month" type="month" value={month} onChange={e => setMonth(e.target.value)}/>
        <button className="button primary" disabled={Boolean(busyReport) || !month} onClick={() => download('payments')}>
          <Download size={17}/>{busyReport === 'payments' ? 'Preparing report…' : 'Download Payments CSV'}
        </button>
      </section>

      <section className="card report-card">
        <span className="report-icon"><Users size={32}/></span>
        <h2>Customer directory summary</h2>
        <p>Complete customer roster, active service status, rates, route sequences, and phone numbers.</p>
        <div className="report-note">
          <small>Includes all active and inactive customer accounts.</small>
        </div>
        <button className="button primary" disabled={Boolean(busyReport)} onClick={() => download('customers')}>
          <Download size={17}/>{busyReport === 'customers' ? 'Preparing report…' : 'Download Customers CSV'}
        </button>
      </section>

      <section className="card report-card">
        <span className="report-icon"><ShoppingBag size={32}/></span>
        <h2>Store product orders report</h2>
        <p>Monthly orders, customer details, line items, fulfilment status, and collected values.</p>
        <Field label="Reporting month" type="month" value={month} onChange={e => setMonth(e.target.value)}/>
        <button className="button primary" disabled={Boolean(busyReport) || !month} onClick={() => download('orders')}>
          <Download size={17}/>{busyReport === 'orders' ? 'Preparing report…' : 'Download Orders CSV'}
        </button>
      </section>
    </div>
  </>;
}
function ConflictModal({ batch, close, refresh }) {
  const { t } = useTranslation();
  const session = useSelector(s => s.session);
  const [items, setItems] = useState(batch.body.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const updateItemQty = (index, litres) => {
    const val = Number(litres);
    if (isNaN(val) || val < 0) return;
    const next = [...items];
    next[index] = { ...next[index], quantityMl: Math.round(val * 1000) };
    setItems(next);
  };

  const removeItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSaveAndRetry = async () => {
    if (!items.length) {
      await discard(batch.key);
      close();
      refresh();
      return;
    }
    if (items.some(i => !i.quantityMl || i.quantityMl <= 0 || i.quantityMl > 100000)) {
      setError('Each delivery must have a quantity between 0.001 L and 100 L.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveBatchItems(batch.key, items);
      close();
      refresh();
      syncQueue(session.user.id, refresh);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (window.confirm('Discard this entire batch? Deliveries in this batch will be deleted from your device.')) {
      await discard(batch.key);
      close();
      refresh();
    }
  };

  return (
    <Modal title={t('queue.conflictTitle', 'Resolve delivery batch conflict')} close={close}>
      <Notice error>{batch.error || 'Server rejected this delivery batch.'}</Notice>
      {error && <Notice error>{error}</Notice>}
      <p className="form-note">
        {t('queue.conflictNote', 'Review the deliveries below. You can correct individual quantities or remove entries that cannot be fulfilled, then retry syncing.')}
      </p>
      <div className="table-scroll" style={{ maxHeight: '350px', overflowY: 'auto', marginBottom: '20px' }}>
        <table>
          <thead>
            <tr>
              <th>{t('nav.customers', 'Customer')}</th>
              <th>{t('records.shift', 'Shift')} &amp; {t('records.milkType', 'Milk')}</th>
              <th>{t('common.date', 'Date')}</th>
              <th>{t('records.correctQuantity', 'Quantity (L)')}</th>
              <th>{t('common.actions', 'Action')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td><b>{it.customerName || (it.customer_id ? it.customer_id.slice(-6) : 'Customer')}</b></td>
                <td className="capitalize">{it.shift} · {it.type}</td>
                <td>{it.date}</td>
                <td>
                  <input
                    aria-label={`${it.customerName || 'Customer'} quantity`}
                    className="inline-input"
                    type="number"
                    min="0.001"
                    max="100"
                    step="0.001"
                    value={it.quantityMl / 1000}
                    onChange={e => updateItemQty(idx, e.target.value)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => removeItem(idx)}
                  >
                    {t('common.remove', 'Remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-footer">
        <button type="button" className="button danger" onClick={handleDiscard}>
          {t('queue.discardBatch', 'Discard batch')}
        </button>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button type="button" className="button primary" disabled={busy || !items.length} onClick={handleSaveAndRetry}>
            {busy ? t('common.saving', 'Saving…') : t('queue.saveAndRetry', 'Save & retry sync')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function App() {
  const { t } = useTranslation();
  const session = useSelector(s => s.session), dispatch = useDispatch(), location = useLocation();
  const isCustomer = session.user?.role === 'customer';
  const navItems = isCustomer ? customerNav : vendorNav;
  const visibleNavigation = navItems.map(n => {
    let label = n.label, short = n.short;
    if (n.to === '/') { label = t('nav.overview', 'Overview'); short = t('nav.overview', 'Overview'); }
    else if (n.to === '/customers') { label = t('nav.customers', 'Customers'); short = t('nav.customers', 'Customers'); }
    else if (n.to === '/records') { label = isCustomer ? t('nav.deliveryHistory', 'Delivery history') : t('nav.records', 'Milk records'); short = isCustomer ? t('nav.historyShort', 'History') : t('nav.recordsShort', 'Records'); }
    else if (n.to === '/products') { label = t('nav.products', 'Products'); short = t('nav.products', 'Products'); }
    else if (n.to === '/orders') { label = isCustomer ? t('nav.store', 'Store & Orders') : t('nav.orders', 'Orders'); short = isCustomer ? t('nav.storeShort', 'Store') : t('nav.ordersShort', 'Orders'); }
    else if (n.to === '/payments') { label = t('nav.payments', 'Bills & payments'); short = t('nav.paymentsShort', 'Bills'); }
    else if (n.to === '/disputes') { label = t('nav.disputes', 'Disputes'); short = t('nav.disputesShort', 'Issues'); }
    else if (n.to === '/reports') { label = t('nav.reports', 'Reports'); short = t('nav.reports', 'Reports'); }
    return { ...n, label, short };
  });
  const [logoutError, setLogoutError] = useState('');
  async function logout() { try { if (!session.demo) await api.post('/auth/logout'); dispatch(signOut()); } catch (e) { setLogoutError(message(e)); } }
  const [mobile, setMobile] = useState(false), [online, setOnline] = useState(navigator.onLine), [queue, setQueue] = useState([]), [conflictBatch, setConflictBatch] = useState(null);
  const isMobile = useIsMobile();
  const refreshQueue = useCallback(() => { if (session.user && !session.demo) queued(session.user.id).then(items => { if (store.getState().session.user?.id === session.user.id) setQueue(items); }).catch(() => {}); else setQueue([]); }, [session.user, session.demo]);
  useEffect(() => { setMobile(false); }, [location.pathname]);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); if (session.user && !session.demo) syncQueue(session.user.id, refreshQueue); };
    window.addEventListener('online', update); window.addEventListener('offline', update); window.addEventListener('queuechange', refreshQueue); update(); refreshQueue();
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('queuechange', refreshQueue); };
  }, [session.user, session.demo, refreshQueue]);
  if (!session.user) return <Auth redirectPath={location.pathname}/>;
  if (session.user.role === 'admin') return <AdminPortal logout={logout} error={logoutError}/>;
  const bottomNavigation = visibleNavigation.slice(0, 4);
  return <div className="app-layout"><a className="skip-link" href="#main">{t('common.skipToContent', 'Skip to content')}</a>{mobile && <button className="sidebar-overlay" aria-label={t('nav.closeNavigation', 'Close navigation')} onClick={() => setMobile(false)}/>}<aside className={`sidebar ${mobile ? 'open' : ''}`}><Brand/><div className="workspace-label">{t('nav.yourWorkspace', 'YOUR WORKSPACE')}</div><nav aria-label="Main navigation">{visibleNavigation.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'}><n.icon size={19}/>{n.label}{n.to === '/' && <span className="nav-dot"/>}</NavLink>)}</nav><div className="sidebar-bottom"><div className="care-card"><Leaf size={25}/><b>Built around your day.</b><p>From the first morning pour<br/>to the last evening entry.</p></div><NavLink className="profile-link" to="/profile"><Settings size={19}/> {isCustomer ? t('nav.yourProfile', 'Your profile') : t('nav.dairyProfile', 'Dairy profile')}</NavLink><button className="profile-user" aria-label={t('nav.signOut', 'Sign out')} onClick={logout}><span className="avatar">{session.user.name[0]}</span><span><b>{session.user.name}</b><small>{session.demo ? t('common.demoWorkspace', 'Demo workspace') : isCustomer ? t('common.customer', 'Customer') : t('common.dairyOwner', 'Dairy owner')}</small></span><LogOut size={17}/></button></div></aside><div className="main-shell"><header className="topbar"><div><button className="icon-button mobile-menu" aria-label={t('nav.openNavigation', 'Open navigation')} onClick={() => setMobile(true)}><Menu/></button><span className="business-icon"><Leaf size={17}/></span><b>{session.user.businessName}</b><span className="workspace-badge">Dairy workspace</span></div><div className="topbar-actions"><CommandPalette navItems={visibleNavigation}/><NotificationsDrawer /><span className="topbar-separator"/><LanguageSelect /><span className="topbar-separator"/><ThemeToggle /><span className="topbar-separator"/><span className={`connection ${!online ? 'offline' : ''}`}>{online ? <Wifi size={15}/> : <WifiOff size={15}/>}<span>{online ? t('common.online', 'Online') : t('common.offline', 'Offline')}</span></span><span className="topbar-separator"/><NavLink to="/profile" className="avatar" aria-label={t('nav.yourProfile', 'Your profile')}>{session.user.name[0]}</NavLink></div></header><main id="main"><AnnouncementBanner/><Notice error>{logoutError}</Notice>{session.demo && <div className="demo-banner"><span><ShieldCheck size={16}/> Demo workspace · Sample data, read-only preview</span><button onClick={() => dispatch(signOut())}>Set up your dairy <ArrowRight size={14}/></button></div>}{queue.length > 0 && <div className="notice"><b>{t('queue.batchesOnDevice', { count: queue.length, defaultValue: `${queue.length} delivery batch(es) on this device` })}</b>{queue.map(item => <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}><span>{item.status}: {item.body.items.length} deliveries {item.error && `— ${item.error}`}</span>{item.status === 'conflicted' && <><button className="text-button" onClick={() => setConflictBatch(item)}>{t('queue.resolveConflict', 'Resolve conflict')}</button><button className="text-button danger" style={{ marginLeft: '10px' }} onClick={async () => { await discard(item.key); refreshQueue(); }}>{t('queue.discardFailedBatch', 'Discard failed batch')}</button></>}</div>)}<div style={{ marginTop: '8px' }}><button className="text-button" onClick={() => syncQueue(session.user.id, refreshQueue)}>{t('queue.retrySync', 'Retry sync')}</button></div></div>}{conflictBatch && <ConflictModal batch={conflictBatch} close={() => setConflictBatch(null)} refresh={refreshQueue}/>}<motion.div className="route-view" key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }}><Routes location={location}><Route path="/" element={isCustomer ? <CustomerHome/> : <Dashboard/>}/><Route path="/customers" element={isCustomer ? <Navigate to="/" replace/> : <Customers/>}/><Route path="/records" element={isCustomer ? <CustomerHistory/> : <Records/>}/><Route path="/products" element={isCustomer ? <Navigate to="/orders" replace/> : <Products/>}/><Route path="/orders" element={isCustomer ? <CustomerOrders/> : <Orders/>}/><Route path="/payments" element={isCustomer ? <CustomerPayments/> : <Payments/>}/><Route path="/disputes" element={isCustomer ? <CustomerDisputes/> : <Disputes/>}/><Route path="/reports" element={<Reports/>}/><Route path="/profile" element={isCustomer ? <CustomerProfile/> : <Profile/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></motion.div></main></div>{isMobile && <nav className="bottom-nav" aria-label={t('nav.quickNavigation', 'Quick navigation')}>{bottomNavigation.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'}><n.icon size={20}/><span>{n.short}</span></NavLink>)}<button onClick={() => setMobile(true)}><MoreHorizontal size={20}/><span>{t('nav.more', 'More')}</span></button></nav>}</div>;
}


