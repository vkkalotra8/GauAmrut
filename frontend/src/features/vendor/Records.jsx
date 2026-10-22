import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Check, Sun } from 'lucide-react';
import { api, decimalUnits, message, money, serviceDate } from '../../lib';
import { demoCustomers, demoRecords } from '../../demo';
import { enqueue, queued, syncQueue } from '../../offline';
import useData from '../../hooks/useData';
import { Empty, Field, Heading, Modal, Notice, State } from '../../components/ui';

export function defaultTypes(customer, shift) {
  const cow = customer[`${shift}CowMl`] || 0, buffalo = customer[`${shift}BuffaloMl`] || 0;
  return cow > 0 && buffalo > 0 ? 'both' : buffalo > 0 ? 'buffalo' : 'cow';
}
export function defaultLitres(customer, shift, type) { return String((customer[`${shift}${type === 'cow' ? 'Cow' : 'Buffalo'}Ml`] || 0) / 1000); }

export default function Records() {
  const { t } = useTranslation();
  const session = useSelector(s => s.session);
  const [date, setDate] = useState(serviceDate()), [shift, setShift] = useState('morning'), [types, setTypes] = useState({}), [values, setValues] = useState({}), [page, setPage] = useState(1);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState([]), [submitted, setSubmitted] = useState([]);
  const [correcting, setCorrecting] = useState(null), [correctionError, setCorrectionError] = useState(''), [deleteConfirm, setDeleteConfirm] = useState(null);
  const customers = useData(`/customers?page=${page}&shift=${shift}`, demoCustomers), records = useData(`/records?date=${date}&limit=100`, demoRecords);
  async function saveCorrection(e) {
    e.preventDefault();
    if (session.demo) { setCorrectionError('Demo mode is read-only.'); return; }
    setBusy(true); setCorrectionError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      const quantityMl = decimalUnits(f.quantity, 1000);
      await api.patch(`/records/${correcting._id}`, { quantityMl });
      setCorrecting(null);
      setNotice(t('records.entryCorrected', 'Delivery entry corrected.'));
      records.reload();
      window.dispatchEvent(new Event('delivery-synced'));
    } catch (err) {
      setCorrectionError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function deleteDelivery(rec) {
    if (session.demo) { setNotice('Demo mode is read-only.'); setDeleteConfirm(null); return; }
    setBusy(true); setError('');
    try {
      await api.delete(`/records/${rec._id}`);
      setDeleteConfirm(null);
      setNotice(t('records.entryDeleted', 'Delivery entry deleted.'));
      records.reload();
      window.dispatchEvent(new Event('delivery-synced'));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const dirty = Object.keys(values).length > 0 || Object.keys(types).length > 0;
  useEffect(() => {
    const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    const navigate = e => { if (dirty && e.target.closest('a[href]') && !window.confirm('Discard your unsaved delivery changes?')) { e.preventDefault(); e.stopPropagation(); } };
    const popstate = () => {
      if (dirty && !window.confirm('Discard your unsaved delivery changes?')) {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    window.addEventListener('popstate', popstate);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
      window.removeEventListener('popstate', popstate);
    };
  }, [dirty]);
  useEffect(() => {
    let active = true;
    const refresh = () => { if (!session.demo) queued(session.user.id).then(items => { if (active) setPending(items); }).catch(() => {}); };
    refresh(); window.addEventListener('queuechange', refresh); window.addEventListener('delivery-synced', refresh);
    return () => { active = false; window.removeEventListener('queuechange', refresh); window.removeEventListener('delivery-synced', refresh); };
  }, [session.demo, session.user.id]);
  const [activeTab, setActiveTab] = useState('route');
  const activeAdjustments = useData(`/delivery-adjustments/active?date=${date}`, []);
  const allAdjustments = useData('/delivery-adjustments', []);

  const getCustomerAdj = (customerId) => {
    return (activeAdjustments.data || []).find(a =>
      a.customer_id === customerId &&
      (a.shift === 'both' || a.shift === shift)
    );
  };

  const getEffectiveDefault = (customer, sft, typ) => {
    const adj = getCustomerAdj(customer._id);
    if (adj?.type === 'vacation') return '0';
    const base = Number(defaultLitres(customer, sft, typ));
    if (adj?.type === 'extra' && (adj.milkType === typ || adj.milkType === 'both')) {
      return String(base + (adj.quantityMl || 0) / 1000);
    }
    return String(base);
  };

  const pendingAdjustmentsCount = (allAdjustments.data || []).filter(a => a.status === 'pending').length;

  async function handleReviewAdjustment(id, newStatus) {
    if (session.demo) {
      setNotice('Demo workspace: simulated adjustment review.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/delivery-adjustments/${id}/status`, { status: newStatus });
      setNotice(`Request marked as ${newStatus}.`);
      allAdjustments.reload();
      activeAdjustments.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const matches = (r, customer, type) => r.customer_id === customer._id && r.date === date && r.shift === shift && r.type === type;
  function status(customer, type) {
    if (records.data?.some(r => matches(r, customer, type))) return 'Recorded';
    const waiting = pending.find(batch => batch.body.items.some(r => matches(r, customer, type)));
    if (waiting) return waiting.status === 'conflicted' ? 'Needs review' : 'Queued';
    return submitted.some(r => matches(r, customer, type)) ? 'Saved' : '';
  }
  function statusLabel(st) {
    if (st === 'Recorded') return t('records.recorded', 'Recorded');
    if (st === 'Queued') return t('records.queued', 'Queued');
    if (st === 'Needs review') return t('records.needsReview', 'Needs review');
    if (st === 'Saved') return t('records.saved', 'Saved');
    return st;
  }
  const eligible = (customers.data || []).filter(c => c.status === 'active' && c.startDate <= date && (!c.endDate || c.endDate >= date));
  const selected = c => types[c._id] || defaultTypes(c, shift);
  const milkTypes = c => selected(c) === 'both' ? ['cow', 'buffalo'] : [selected(c)];
  const quantity = (c, type) => values[`${c._id}:${type}`] ?? getEffectiveDefault(c, shift, type);
  const entries = eligible.flatMap(c => milkTypes(c).filter(type => !status(c, type) && (Number(quantity(c, type)) > 0 || values[`${c._id}:${type}`] !== undefined)).map(type => ({ customer_id: c._id, customerName: c.name, date, shift, type, value: quantity(c, type) })));
  const reset = () => { setValues({}); setTypes({}); setError(''); };
  async function save() {
    setError(''); setNotice('');
    if (session.demo) { setNotice('This is a read-only preview. Sign in to save your dairy’s deliveries.'); return; }
    setBusy(true);
    try {
      const items = entries.map(({ value, ...item }) => ({ ...item, quantityMl: decimalUnits(value, 1000) }));
      if (!items.length) throw new Error('No unsaved deliveries are ready for this route.');
      if (items.some(i => i.quantityMl > 100000)) throw new Error('Each delivery must be 100 litres or less.');
      const key = crypto.randomUUID();
      await enqueue(session.user.id, { items }, key);
      setSubmitted(previous => [...previous, ...items]); reset();
      await syncQueue(session.user.id);
      const queue = await queued(session.user.id); setPending(queue);
      const waiting = queue.find(i => i.key === key);
      if (waiting?.status === 'conflicted') setError(waiting.error);
      else setNotice(waiting ? t('records.savedOffline', 'Saved on this device. Delivery will sync when your connection returns.') : t('records.deliveriesSaved', 'Deliveries saved successfully.'));
      if (!waiting) records.reload();
      window.dispatchEvent(new Event('queuechange'));
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <><Heading eyebrow={t('records.eyebrow', 'FRESH MILK. EVERY DOORSTEP.')} title={t('records.title', 'Daily milk entry')} description={t('records.description', 'Your customers’ usual quantities are ready. Change only what is different today.')}/>
    <div className="tab-nav">
      <button
        type="button"
        className={`button small ${activeTab === 'route' ? 'primary' : ''}`}
        onClick={() => setActiveTab('route')}
      >
        Daily route entry
      </button>
      <button
        type="button"
        className={`button small ${activeTab === 'adjustments' ? 'primary' : ''}`}
        onClick={() => setActiveTab('adjustments')}
        style={{ position: 'relative' }}
      >
        Customer vacation & extra requests
        {pendingAdjustmentsCount > 0 && (
          <span style={{ marginLeft: '6px', background: '#d97706', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '10px' }}>
            {pendingAdjustmentsCount}
          </span>
        )}
      </button>
    </div>

    <Notice>{notice}</Notice><Notice error>{error}</Notice>

    {activeTab === 'route' ? (
      <>
        <div className="filter-bar"><Field label={t('records.serviceDate', 'Service date')} type="date" value={date} max={serviceDate()} disabled={dirty || busy} onChange={e => { setDate(e.target.value); reset(); }}/><label className="field"><span>{t('records.shift', 'Shift')}</span><select value={shift} disabled={dirty || busy} onChange={e => { setShift(e.target.value); reset(); }}><option value="morning">{t('common.morning', 'Morning')}</option><option value="evening">{t('common.evening', 'Evening')}</option></select></label></div>
        <section className="card"><div className="card-heading"><div><h2>{t('records.routeHeading', { shift: shift === 'morning' ? t('common.morning', 'Morning') : t('common.evening', 'Evening'), defaultValue: `${shift === 'morning' ? 'Morning' : 'Evening'} route` })}</h2><p>{t('records.routeNote', 'Litres come from each customer’s saved defaults and vacation schedules. Changes here apply only to this date and shift.')}</p></div>{customers.cached ? <span className="pill" title={t('records.offlineRouteTitle', 'Route loaded from local offline storage')}><Sun size={15}/> {t('records.offlineRoute', 'Offline route')}</span> : <Sun size={23}/>}</div>
        <State resource={customers}>{eligible.length ? <div className="entry-list">{eligible.map(c => {
          const adj = getCustomerAdj(c._id);
          return (
            <div className="customer-delivery" key={c._id}>
              <div className="delivery-person">
                <span className="avatar">{c.name[0]}</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <b>{c.name}</b>
                    {adj?.type === 'vacation' && (
                      <span className="pill" style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a', fontWeight: '600' }}>
                        Vacation Paused (0 L)
                      </span>
                    )}
                    {adj?.type === 'extra' && (
                      <span className="pill" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0', fontWeight: '600' }}>
                        Extra (+{(adj.quantityMl || 0) / 1000} L)
                      </span>
                    )}
                  </div>
                  <small>{c.address}</small>
                </div>
              </div>
              <label className="field delivery-type"><span>{t('records.milkType', 'Milk type')}</span><select aria-label={`${c.name} milk type`} value={selected(c)} disabled={busy} onChange={e => setTypes(v => ({ ...v, [c._id]: e.target.value }))}><option value="cow">{t('records.cowMilk', 'Cow milk')}</option><option value="buffalo">{t('records.buffaloMilk', 'Buffalo milk')}</option><option value="both">{t('records.cowAndBuffalo', 'Cow & buffalo')}</option></select></label>
              <div className="delivery-quantities">{milkTypes(c).map(type => <div className="delivery-quantity-row" key={type}><div><span className="capitalize">{type === 'cow' ? t('records.cowMilk', 'Cow milk') : t('records.buffaloMilk', 'Buffalo milk')}</span><small>{money(type === 'cow' ? c.cowRatePaise : c.buffaloRatePaise)} / L · {t('records.usual', 'Usual')}: {getEffectiveDefault(c, shift, type)} L</small></div>{status(c, type) ? <span className="status"><Check size={13}/>{statusLabel(status(c, type))}</span> : <label className="quantity"><input aria-label={selected(c) === 'both' ? `${c.name} ${type} quantity in litres` : `${c.name} quantity in litres`} type="number" min="0" max="100" step="0.001" inputMode="decimal" value={quantity(c, type)} disabled={busy} onChange={e => setValues(v => ({ ...v, [`${c._id}:${type}`]: e.target.value }))}/><span>L</span></label>}</div>)}</div>
            </div>
          );
        })}</div> : <Empty>{t('records.noEligible', 'No active customers on this page are eligible for this date.')}</Empty>}</State>
        <div className="save-bar"><span><b>{entries.length}</b> {t('records.entriesReady', 'entries ready to save')}</span><div className="heading-actions">{dirty && <button className="button" disabled={busy} onClick={reset}>{t('records.resetDefaults', 'Reset to defaults')}</button>}<button className="button primary" onClick={save} disabled={busy || !entries.length || customers.loading || records.loading || Boolean(customers.error) || Boolean(records.error)}>{busy ? t('common.saving', 'Saving…') : t('records.saveDeliveries', 'Save deliveries')}<Check size={18}/></button></div></div>
        <div className="pagination"><small>{t('records.paginationNote', { page, defaultValue: `Page ${page} · Defaults are saved only when you select Save deliveries.` })}</small><button className="button" disabled={dirty || busy || page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><button className="button" disabled={dirty || busy || page * 50 >= (customers.meta?.total || customers.data?.length || 0)} onClick={() => setPage(p => p + 1)}>Next</button></div></section>
        <section className="card section-gap"><div className="card-heading"><h2>{t('records.recordedHeading', { date, defaultValue: `Recorded deliveries · ${date}` })}</h2></div><State resource={records}>{records.data?.length ? <div className="table-scroll"><table><thead><tr><th>{t('nav.customers', 'Customer')}</th><th>{t('records.shift', 'Shift')}</th><th>{t('records.milkType', 'Milk')}</th><th>{t('records.correctQuantity', 'Quantity')}</th><th>{t('common.amount', 'Amount')}</th><th>{t('common.actions', 'Actions')}</th></tr></thead><tbody>{records.data.map(r => <tr key={r._id}><td>{customers.data?.find(c => c._id === r.customer_id)?.name || r.customerName || 'Customer'}</td><td className="capitalize">{r.shift}</td><td className="capitalize">{r.type}</td><td>{r.quantityMl / 1000} L</td><td>{money(r.totalPaise)}</td><td><button className="text-button" style={{ marginRight: '10px' }} onClick={() => { setCorrectionError(''); setCorrecting(r); }}>{t('common.edit', 'Edit')}</button><button className="text-button" style={{ color: '#a94d34' }} onClick={() => setDeleteConfirm(r)}>{t('common.delete', 'Delete')}</button></td></tr>)}</tbody></table></div> : <Empty>{t('records.noRecorded', 'No deliveries recorded for this date yet.')}</Empty>}</State></section>
      </>
    ) : (
      <section className="card">
        <div className="card-heading">
          <h2>Customer vacation pauses & extra milk requests</h2>
          <span className="pill">{allAdjustments.data?.length || 0} total requests</span>
        </div>
        <State resource={allAdjustments}>
          {allAdjustments.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Date range</th>
                    <th>Shift & milk</th>
                    <th>Quantity</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {allAdjustments.data.map(adj => {
                    const cust = customers.data?.find(c => c._id === adj.customer_id);
                    return (
                      <tr key={adj._id}>
                        <td><b>{cust?.name || adj.customerName || adj.customer_id?.slice(-6) || 'Customer'}</b></td>
                        <td>
                          <span
                            className="pill"
                            style={{
                              background: adj.type === 'vacation' ? '#fef3c7' : '#ecfdf5',
                              color: adj.type === 'vacation' ? '#92400e' : '#065f46',
                              fontWeight: '600'
                            }}
                          >
                            {adj.type === 'vacation' ? 'Vacation pause' : 'Extra milk'}
                          </span>
                        </td>
                        <td><b>{adj.startDate}</b>{adj.endDate && adj.endDate !== adj.startDate ? ` to ${adj.endDate}` : ''}</td>
                        <td className="capitalize">{adj.shift} {adj.milkType ? `· ${adj.milkType}` : ''}</td>
                        <td>{adj.type === 'extra' ? `${(adj.quantityMl || 0) / 1000} L` : 'Paused (0 L)'}</td>
                        <td>{adj.reason || '—'}</td>
                        <td>
                          <span
                            className={`status ${adj.status === 'approved' ? '' : adj.status === 'rejected' || adj.status === 'cancelled' ? 'neutral' : ''}`}
                            style={adj.status === 'pending' ? { background: '#fef3c7', color: '#92400e' } : {}}
                          >
                            {adj.status}
                          </span>
                        </td>
                        <td>
                          {adj.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                className="button small primary"
                                disabled={busy}
                                onClick={() => handleReviewAdjustment(adj._id, 'approved')}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="button small"
                                style={{ color: '#a94d34' }}
                                disabled={busy}
                                onClick={() => handleReviewAdjustment(adj._id, 'rejected')}
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <small style={{ color: 'var(--muted)' }}>Reviewed</small>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No vacation pause or extra milk requests submitted by customers yet.</Empty>
          )}
        </State>
      </section>
    )}

    {correcting && <Modal title={t('records.correctTitle', 'Correct delivery entry')} close={() => setCorrecting(null)}><form onSubmit={saveCorrection}><p className="form-note">Customer: <b>{customers.data?.find(c => c._id === correcting.customer_id)?.name || 'Customer'}</b><br/>Shift: <b className="capitalize">{correcting.shift}</b> · Milk: <b className="capitalize">{correcting.type}</b></p><Field label={t('records.correctQuantity', 'Correct quantity (litres)')} name="quantity" type="number" min="0" max="100" step="0.001" defaultValue={correcting.quantityMl / 1000} required /><Notice error>{correctionError}</Notice><button className="button primary full" disabled={busy}>{busy ? t('common.saving', 'Saving…') : t('records.saveCorrection', 'Save correction')}</button></form></Modal>}
    {deleteConfirm && <Modal title={t('records.deleteTitle', 'Delete delivery entry?')} close={() => setDeleteConfirm(null)}><p className="form-note">Are you sure you want to delete this delivery for <b>{customers.data?.find(c => c._id === deleteConfirm.customer_id)?.name || 'Customer'}</b> ({deleteConfirm.quantityMl / 1000} L {deleteConfirm.type} milk, {deleteConfirm.shift} shift)?</p><div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}><button type="button" className="button full" onClick={() => setDeleteConfirm(null)}>{t('common.cancel', 'Cancel')}</button><button type="button" className="button primary full" style={{ background: '#a94d34', borderColor: '#a94d34' }} disabled={busy} onClick={() => deleteDelivery(deleteConfirm)}>{busy ? t('common.saving', 'Deleting…') : t('records.confirmDelete', 'Confirm delete')}</button></div></Modal>}
  </>;
}


