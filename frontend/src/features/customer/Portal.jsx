import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Check, X, Clock, CheckCircle2, MessageSquare, AlertCircle, ShoppingBag, Send, XCircle, Download, Calendar, PauseCircle } from 'lucide-react';
import { api, message, money, updateUser, decimalUnits, serviceDate } from '../../lib';
import useData from '../../hooks/useData';
import { usePlatformSettings } from '../../platform';
import { Empty, Field, Heading, Notice, State, Modal } from '../../components/ui';
import { MilkTrend } from '../../components/charts';
import { demoProducts, demoOrders, demoDisputes } from '../../demo';
import ShareToWhatsAppModal from '../../components/ShareToWhatsApp';

export function CustomerHome() {
  const { t } = useTranslation();
  const user = useSelector(s => s.session.user), resource = useData('/dashboard'), profile = useData('/profile');
  return <><Heading eyebrow={t('records.eyebrow', 'FRESH MILK. A CLEAR ACCOUNT.')} title={`${t('customerPortal.welcome', { name: user.name.split(' ')[0], defaultValue: `Hello, ${user.name.split(' ')[0]}.` })}`} description={`Your deliveries from ${user.businessName}.`}/>{profile.data?.status === 'inactive' && <Notice>Your delivery service is inactive. Your dairy can set your rates and activate it. Your existing records remain available.</Notice>}<State resource={resource}>{resource.data && <><div className="stats-grid"><article className="stat-card"><span>Today’s milk</span><strong>{resource.data.today.quantityMl / 1000} L</strong><small>{resource.data.today.entries} delivery entries</small></article><article className="stat-card"><span>Outstanding bills</span><strong>{money(resource.data.outstandingPaise)}</strong><small>For milk delivered till date</small></article><article className="stat-card"><span>Paid this month</span><strong>{money(resource.data.collectedPaise)}</strong><small>Recorded by your dairy</small></article></div>{resource.data.monthly?.length > 1 && <section className="card"><div className="card-heading"><div><h2>{t('customerPortal.monthlyTrendTitle', 'This month’s deliveries')}</h2><p>{t('customerPortal.monthlyTrendSub', 'Your daily milk, day by day')}</p></div></div><MilkTrend monthly={resource.data.monthly} gradientId="milkFillCustomer"/></section>}<section className="card profile-card"><h2>{t('customerPortal.yourMilkLedger', 'Your account, at a glance')}</h2><p className="form-note">{t('customerPortal.quickLook', 'Check each delivery and your finalized monthly bills. Contact your dairy if something needs correcting.')}</p><div className="heading-actions"><NavLink className="button primary" to="/records">{t('nav.deliveryHistory', 'Delivery history')}</NavLink><NavLink className="button" to="/records?tab=adjustments">Vacation & Extra Milk</NavLink><NavLink className="button" to="/payments">{t('nav.payments', 'Bills & payments')}</NavLink></div></section></>}</State></>;
}

export function CustomerHistory() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'history';
  const [page, setPage] = useState(1), [date, setDate] = useState('');
  const resource = useData(`/records?page=${page}${date ? `&date=${date}` : ''}`);
  const adjustments = useData('/delivery-adjustments', []);
  const [modalOpen, setModalOpen] = useState(false);
  const [requestType, setRequestType] = useState('vacation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const today = serviceDate();
  const activeVacation = adjustments.data?.find(a =>
    a.type === 'vacation' && a.status === 'approved' && a.startDate <= today && a.endDate >= today
  );

  async function submitAdjustment(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      const payload = {
        type: requestType,
        startDate: f.startDate,
        endDate: requestType === 'vacation' ? (f.endDate || f.startDate) : f.startDate,
        shift: f.shift || 'both',
        reason: f.reason || ''
      };
      if (requestType === 'extra') {
        payload.milkType = f.milkType || 'cow';
        payload.quantityMl = decimalUnits(f.quantity, 1000);
      }
      await api.post('/delivery-adjustments', payload);
      setNotice(requestType === 'vacation' ? 'Vacation pause request submitted.' : 'Extra milk request submitted.');
      setModalOpen(false);
      adjustments.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelAdjustment(id) {
    if (!window.confirm('Cancel this delivery adjustment request?')) return;
    try {
      await api.patch(`/delivery-adjustments/${id}/status`, { status: 'cancelled' });
      setNotice('Request cancelled.');
      adjustments.reload();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <>
      <Heading
        title={t('nav.deliveryHistory', 'Your delivery history')}
        description="The milk delivered to your home, along with vacation pauses and extra milk requests."
      >
        <button
          type="button"
          className="button primary"
          onClick={() => { setRequestType('vacation'); setError(''); setModalOpen(true); }}
        >
          <Calendar size={17} /> Request vacation or extra milk
        </button>
      </Heading>

      <Notice>{notice}</Notice>

      {activeVacation && (
        <div className="notice warn">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PauseCircle size={18} />
            <b>Vacation delivery pause currently active:</b> {activeVacation.startDate} to {activeVacation.endDate} ({activeVacation.shift} shift). Daily delivery is paused.
          </div>
        </div>
      )}

      <div className="tab-nav">
        <button
          type="button"
          className={`button small ${activeTab === 'history' ? 'primary' : ''}`}
          onClick={() => setSearchParams({ tab: 'history' })}
        >
          Delivery records
        </button>
        <button
          type="button"
          className={`button small ${activeTab === 'adjustments' ? 'primary' : ''}`}
          onClick={() => setSearchParams({ tab: 'adjustments' })}
        >
          Vacation & extra milk requests ({adjustments.data?.length || 0})
        </button>
      </div>

      {activeTab === 'history' ? (
        <>
          <div className="filter-bar">
            <Field
              label={t('records.serviceDate', 'Filter service date')}
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setPage(1); }}
            />
          </div>
          <section className="card">
            <State resource={resource}>
              {resource.data?.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('common.date', 'Date')}</th>
                        <th>{t('records.shift', 'Shift')}</th>
                        <th>{t('records.milkType', 'Milk')}</th>
                        <th>{t('records.correctQuantity', 'Quantity')}</th>
                        <th>Rate / L</th>
                        <th>{t('common.amount', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resource.data.map(r => (
                        <tr key={r._id}>
                          <td>{r.date}</td>
                          <td className="capitalize">{r.shift}</td>
                          <td className="capitalize">{r.type}</td>
                          <td>{r.quantityMl / 1000} L</td>
                          <td>{money(r.ratePaise)}</td>
                          <td>{money(r.totalPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>{t('records.noRecorded', 'No deliveries match this date. Your dairy’s entries will appear here.')}</Empty>
              )}
            </State>
            <Pager page={page} setPage={setPage} total={resource.meta?.total || 0} />
          </section>
        </>
      ) : (
        <section className="card">
          <div className="card-heading">
            <h2>Scheduled vacation pauses & extra milk</h2>
            <span className="pill">{adjustments.data?.length || 0} requests</span>
          </div>
          <State resource={adjustments}>
            {adjustments.data?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Dates</th>
                      <th>Shift & details</th>
                      <th>Quantity</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.data.map(adj => (
                      <tr key={adj._id}>
                        <td>
                          <span
                            className={`pill ${adj.type === 'vacation' ? 'pending' : 'success'}`}
                            style={{ fontWeight: '600' }}
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
                            className={`status ${adj.status === 'approved' ? 'success' : adj.status === 'pending' ? 'pending' : 'neutral'}`}
                          >
                            {adj.status}
                          </span>
                        </td>
                        <td>
                          {adj.status === 'pending' && (
                            <button
                              type="button"
                              className="text-button danger-text"
                              onClick={() => cancelAdjustment(adj._id)}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No vacation pause or extra milk requests scheduled. Click the button above to add one.</Empty>
            )}
          </State>
        </section>
      )}

      {modalOpen && (
        <Modal
          title={requestType === 'vacation' ? 'Schedule a vacation delivery pause' : 'Request extra milk'}
          close={() => setModalOpen(false)}
        >
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <button
              type="button"
              className={`button small ${requestType === 'vacation' ? 'primary' : ''}`}
              onClick={() => setRequestType('vacation')}
            >
              Vacation pause
            </button>
            <button
              type="button"
              className={`button small ${requestType === 'extra' ? 'primary' : ''}`}
              onClick={() => setRequestType('extra')}
            >
              Extra milk request
            </button>
          </div>
          <form onSubmit={submitAdjustment}>
            <div className="form-grid">
              <Field
                label={requestType === 'vacation' ? 'From date' : 'Delivery date'}
                name="startDate"
                type="date"
                min={serviceDate()}
                defaultValue={serviceDate()}
                required
              />
              {requestType === 'vacation' && (
                <Field
                  label="To date"
                  name="endDate"
                  type="date"
                  min={serviceDate()}
                  defaultValue={serviceDate()}
                  required
                />
              )}
              <label className="field">
                <span>Shift</span>
                <select name="shift" defaultValue="both">
                  <option value="both">Both shifts (Morning & Evening)</option>
                  <option value="morning">Morning only</option>
                  <option value="evening">Evening only</option>
                </select>
              </label>
              {requestType === 'extra' && (
                <>
                  <label className="field">
                    <span>Milk type</span>
                    <select name="milkType" defaultValue="cow">
                      <option value="cow">Cow milk</option>
                      <option value="buffalo">Buffalo milk</option>
                    </select>
                  </label>
                  <Field
                    label="Extra quantity (litres)"
                    name="quantity"
                    type="number"
                    min="0.25"
                    max="50"
                    step="0.25"
                    defaultValue="1"
                    required
                  />
                </>
              )}
            </div>
            <Field
              label="Reason or notes (optional)"
              name="reason"
              placeholder={requestType === 'vacation' ? 'e.g. Out of town for family function' : 'e.g. Guests arriving tomorrow'}
            />
            <Notice error>{error}</Notice>
            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? 'Submitting…' : requestType === 'vacation' ? 'Schedule vacation pause' : 'Submit extra milk request'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function Pager({ page, setPage, total }) { return <div className="pagination"><small>{total} results · Page {page}</small><button className="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><button className="button" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next</button></div>; }

export function CustomerPayments() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1), [paymentPage, setPaymentPage] = useState(1);
  const bills = useData(`/bills?page=${page}`), payments = useData(`/payments?page=${paymentPage}`);
  const claims = useData('/payment-claims', []), adjustments = useData('/adjustments', []);
  const profile = useData('/profile');
  const platform = usePlatformSettings();
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const totalOutstanding = bills.data?.reduce((sum, b) => sum + (b.closingPaise || 0), 0) || 0;

  // Current month is viewable before it closes: fetch the till-date statement so
  // it can be listed alongside finalized bills (unless a bill already exists).
  const currentMonth = serviceDate().slice(0, 7);
  const statement = useData(`/bills/statement?month=${currentMonth}`);
  const currentBill = bills.data?.find(b => b.month === currentMonth);
  const currentMonthRow = currentBill || (statement.data && statement.data.month === currentMonth ? statement.data : null);

  async function submitClaim(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      await api.post('/payment-claims', {
        bill_id: f.bill_id || undefined,
        amountPaise: decimalUnits(f.amount),
        method: f.method,
        reference: f.reference,
        notes: f.notes || ''
      });
      setNotice(t('customerPortal.claimSubmittedNotice', 'Payment claim submitted. Your dairy owner will review and confirm it.'));
      setClaimModalOpen(false);
      claims.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function viewReceipt(paymentId) {
    try {
      const res = await api.get(`/payments/${paymentId}/receipt`);
      setActiveReceipt(res.data.data);
    } catch (err) {
      setNotice(message(err));
    }
  }

  async function fetchBillPdf(bill) {
    // A finalized bill downloads by id; the in-progress month uses the statement.
    const endpoint = bill._id ? `/bills/${bill._id}/pdf` : `/bills/statement.pdf?month=${bill.month}`;
    const r = await api.get(endpoint, { responseType: 'blob' });
    return { blob: r.data, filename: `bill-${bill.month}${bill.provisional ? '-till-date' : ''}.pdf` };
  }

  const [shareBill, setShareBill] = useState(null);

  async function downloadBillPdf(bill) {
    try {
      const { blob, filename } = await fetchBillPdf(bill);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(message(err));
    }
  }

  async function shareBillPdf(bill) {
    try {
      const { blob, filename } = await fetchBillPdf(bill);
      setShareBill({ blob, filename });
    } catch (err) {
      setNotice(message(err));
    }
  }

  function copyUpi(upiId) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <Heading
        title={t('customerPortal.paymentsTitle', 'Your bills & payments')}
        description={t('customerPortal.paymentsSubtitle', 'See your finalized bills, submit payment claims, and access digital receipts.')}
      >
        <button type="button" className="button primary" onClick={() => { setClaimModalOpen(true); setError(''); }}>
          {t('customerPortal.submitPaymentClaim', 'Submit payment claim')}
        </button>
      </Heading>

      <Notice>{notice}</Notice>

      {/* Monthly Bills */}
      <section className="card">
        <div className="card-heading">
          <h2>{t('customerPortal.monthlyBillsHeading', 'Monthly bills')}</h2>
          {totalOutstanding > 0 && (
            <span className="pill pending">
              {t('customerPortal.totalDue', 'Total due')}: {money(totalOutstanding)}
            </span>
          )}
        </div>
        <State resource={bills}>
          {(() => {
            const pastBills = (bills.data || []).filter(b => b.month !== currentMonth);
            if (!pastBills.length && !currentMonthRow) {
              return <Empty>{t('customerPortal.noBills', 'No finalized bills yet.')}</Empty>;
            }
            return (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.date', 'Month')}</th>
                    <th>{t('payments.openingBalance', 'Opening balance')}</th>
                    <th>{t('payments.charges', 'Milk charges')}</th>
                    <th>{t('payments.paid', 'Paid')}</th>
                    <th>{t('payments.outstanding', 'Closing balance')}</th>
                    <th>{t('common.status', 'Status')}</th>
                    <th>{t('common.actions', 'Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {currentMonthRow && (
                    <tr key="current-month">
                      <td>
                        <b>{currentMonthRow.month}</b>
                        {!currentBill && (
                          <span className="pill pending" style={{ marginLeft: '6px' }}>
                            {t('payments.tillDate', 'Till date')}
                          </span>
                        )}
                      </td>
                      <td>{money(currentMonthRow.openingPaise)}</td>
                      <td>{money(currentMonthRow.chargesPaise)}</td>
                      <td>{money(currentMonthRow.paidPaise)}</td>
                      <td><b>{money(currentMonthRow.closingPaise)}</b></td>
                      <td>
                        <span className={`status ${currentMonthRow.closingPaise === 0 ? '' : 'pending'}`}>
                          {currentMonthRow.closingPaise === 0 ? t('payments.paidStatus', 'Settled') : t('payments.dueStatus', 'Payment due')}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => downloadBillPdf(currentMonthRow)}
                        >
                          <Download size={14} /> PDF
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}
                          onClick={() => shareBillPdf(currentMonthRow)}
                        >
                          <Send size={14} /> WhatsApp
                        </button>
                      </td>
                    </tr>
                  )}
                  {pastBills.map(b => (
                    <tr key={b._id}>
                      <td><b>{b.month}</b></td>
                      <td>{money(b.openingPaise)}</td>
                      <td>{money(b.chargesPaise)}</td>
                      <td>{money(b.paidPaise)}</td>
                      <td><b>{money(b.closingPaise)}</b></td>
                      <td>
                        <span className={`status ${b.closingPaise === 0 ? '' : 'neutral'}`}>
                          {b.closingPaise === 0 ? t('payments.paidStatus', 'Settled') : t('payments.dueStatus', 'Payment due')}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => downloadBillPdf(b)}
                        >
                          <Download size={14} /> PDF
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}
                          onClick={() => shareBillPdf(b)}
                        >
                          <Send size={14} /> WhatsApp
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            );
          })()}
        </State>
        {platform?.invoice?.footer && <p className="invoice-footer-note">{platform.invoice.footer}</p>}
        <Pager page={page} setPage={setPage} total={bills.meta?.total || 0} />
      </section>

      {/* Payment Claims Submitted */}
      <section className="card section-gap">
        <div className="card-heading">
          <h2>{t('customerPortal.claimsHeading', 'Payment claims submitted')}</h2>
          <span className="pill">{claims.data?.length || 0} claims</span>
        </div>
        <State resource={claims}>
          {claims.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.date', 'Submitted')}</th>
                    <th>{t('common.amount', 'Amount')}</th>
                    <th>{t('payments.method', 'Method')}</th>
                    <th>{t('payments.reference', 'Reference (UTR)')}</th>
                    <th>{t('payments.notes', 'Notes')}</th>
                    <th>{t('common.status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.data.map(c => (
                    <tr key={c._id}>
                      <td>{new Date(c.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                      <td><b>{money(c.amountPaise)}</b></td>
                      <td className="capitalize">{c.method}</td>
                      <td><code>{c.reference}</code></td>
                      <td>{c.notes || '—'}</td>
                      <td>
                        <span className={`status ${c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'pending'}`}>
                          {c.status}
                        </span>
                        {c.rejectionReason && (
                          <small className="danger-text" style={{ display: 'block', marginTop: '2px' }}>
                            {c.rejectionReason}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t('customerPortal.noClaimsYet', 'You have not submitted any payment claims.')}</Empty>
          )}
        </State>
      </section>

      {/* Account Adjustments & Credits */}
      <section className="card section-gap">
        <div className="card-heading">
          <h2>{t('customerPortal.adjustmentsHeading', 'Account adjustments & credits')}</h2>
          <span className="pill">{adjustments.data?.length || 0}</span>
        </div>
        <State resource={adjustments}>
          {adjustments.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.date', 'Date')}</th>
                    <th>{t('payments.adjustmentType', 'Type')}</th>
                    <th>{t('common.amount', 'Amount')}</th>
                    <th>{t('payments.rejectionReasonLabel', 'Reason')}</th>
                    <th>{t('payments.billMonth', 'Target bill')}</th>
                    <th>{t('common.status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.data.map(adj => {
                    const typeClass = {
                      credit: 'success',
                      waiver: 'info',
                      debit: 'pending',
                      refund: 'info'
                    }[adj.type] || 'neutral';

                    return (
                      <tr key={adj._id}>
                        <td>{new Date(adj.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                        <td>
                          <span className={`pill ${typeClass}`} style={{ textTransform: 'capitalize', fontWeight: '600', fontSize: '11px' }}>
                            {adj.type}
                          </span>
                        </td>
                        <td>
                          <b style={{ color: adj.type === 'debit' || adj.type === 'refund' ? 'var(--danger)' : 'var(--green)' }}>
                            {adj.type === 'debit' || adj.type === 'refund' ? '+' : '-'}{money(adj.amountPaise)}
                          </b>
                        </td>
                        <td>{adj.reason}</td>
                        <td>{adj.billMonth ? <code>{adj.billMonth}</code> : <span style={{ color: 'var(--muted)' }}>Account</span>}</td>
                        <td>
                          {adj.status === 'reversed' ? (
                            <span className="status danger">
                              {t('payments.reversedBadge', 'Reversed')}
                            </span>
                          ) : (
                            <span className="status">{adj.status}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t('customerPortal.noAdjustmentsYet', 'No credits or adjustments recorded on your account.')}</Empty>
          )}
        </State>
      </section>

      {/* Payment History with Receipts */}
      <section className="card section-gap">
        <div className="card-heading">
          <h2>{t('customerPortal.paymentHistoryHeading', 'Payment history')}</h2>
        </div>
        <State resource={payments}>
          {payments.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.date', 'Received')}</th>
                    <th>{t('common.amount', 'Amount')}</th>
                    <th>{t('payments.method', 'Method')}</th>
                    <th>{t('payments.receiptLabel', 'Receipt #')}</th>
                    <th>{t('common.status', 'Status')}</th>
                    <th>{t('common.actions', 'Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.map(p => (
                    <tr key={p._id}>
                      <td>{new Date(p.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                      <td><b>{money(p.amountPaise)}</b></td>
                      <td className="capitalize">{p.method}</td>
                      <td><code>{p.receipt}</code></td>
                      <td>
                        {p.reversed ? (
                          <div>
                            <span className="status danger">
                              {t('payments.reversedBadge', 'Reversed')}
                            </span>
                            {p.reversalReason && (
                              <small className="danger-text" style={{ display: 'block', fontSize: '11px', marginTop: '2px' }}>
                                {p.reversalReason}
                              </small>
                            )}
                          </div>
                        ) : (
                          <span className="status">{t('payments.paidStatus', 'Settled')}</span>
                        )}
                      </td>
                      <td>
                        <button type="button" className="button small" onClick={() => viewReceipt(p._id)}>
                          {t('payments.viewReceipt', 'View receipt')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t('customerPortal.noPayments', 'No payments have been recorded yet.')}</Empty>
          )}
        </State>
        <Pager page={paymentPage} setPage={setPaymentPage} total={payments.meta?.total || 0} />
      </section>

      {/* Submit Payment Claim Modal */}
      {claimModalOpen && (
        <Modal title={t('customerPortal.claimModalTitle', 'Submit a payment claim')} close={() => setClaimModalOpen(false)}>
          <form onSubmit={submitClaim}>
            <div className="note-strip" style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                {t('customerPortal.payToDairy', 'Pay directly to your dairy owner via UPI:')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <b style={{ fontSize: '15px' }}>{profile.data?.upiId || 'Not configured by dairy'}</b>
                {profile.data?.upiId && (
                  <button type="button" className="button small" onClick={() => copyUpi(profile.data.upiId)}>
                    {copied ? '✓ Copied' : 'Copy UPI'}
                  </button>
                )}
              </div>
            </div>

            {bills.data?.some(b => b.closingPaise > 0) && (
              <label className="field">
                <span>{t('customerPortal.selectBill', 'Allocate to bill (optional)')}</span>
                <select name="bill_id">
                  <option value="">{t('customerPortal.oldestDueOption', 'Oldest outstanding bill (default)')}</option>
                  {bills.data.filter(b => b.closingPaise > 0).map(b => (
                    <option key={b._id} value={b._id}>{b.month} — Due: {money(b.closingPaise)}</option>
                  ))}
                </select>
              </label>
            )}

            <Field label={t('customerPortal.amountPaidLabel', 'Amount paid (₹)')} name="amount" type="number" min="0.01" step="0.01" required />
            <label className="field">
              <span>{t('payments.paymentMethod', 'Payment method')}</span>
              <select name="method" defaultValue="upi">
                <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                <option value="bank">Bank Transfer (IMPS / NEFT)</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <Field label={t('customerPortal.referenceLabel', 'UPI UTR / Bank Reference Number')} name="reference" required minLength={3} placeholder="e.g. 202609140012" />
            <Field label={t('payments.notes', 'Notes (optional)')} name="notes" placeholder="e.g. Paid via GPay" />

            {error && <Notice error>{error}</Notice>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button type="button" className="button" onClick={() => setClaimModalOpen(false)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? t('common.saving', 'Submitting…') : t('customerPortal.confirmClaim', 'Submit payment claim')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Customer Receipt Modal */}
      {activeReceipt && (
        <Modal title={t('payments.receiptTitle', 'Payment Receipt')} close={() => setActiveReceipt(null)}>
          <div className="receipt-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px dashed var(--border)', paddingBottom: '14px', marginBottom: '14px' }}>
              <div>
                <b style={{ fontSize: '18px', color: 'var(--green)' }}>{activeReceipt.dairy?.businessName}</b>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{activeReceipt.dairy?.ownerName} · {activeReceipt.dairy?.phone}</div>
                {activeReceipt.dairy?.upiId && <div style={{ fontSize: '12px', color: 'var(--muted)' }}>UPI: {activeReceipt.dairy.upiId}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="pill success">
                  ✓ {t('payments.verifiedReceipt', 'VERIFIED RECEIPT')}
                </span>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}><code>{activeReceipt.receipt}</code></div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '16px' }}>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>{t('common.customer', 'Customer')}</span>
                <b>{activeReceipt.customer?.name}</b>
              </div>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>{t('common.date', 'Payment Date')}</span>
                <b>{new Date(activeReceipt.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</b>
              </div>
            </div>

            <div className="note-strip" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span>{t('payments.method', 'Payment Method')}:</span>
                <b className="capitalize">{activeReceipt.method}</b>
              </div>
              {activeReceipt.reference && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span>{t('payments.reference', 'Reference / UTR')}:</span>
                  <code>{activeReceipt.reference}</code>
                </div>
              )}
              {activeReceipt.billMonth && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span>{t('payments.billMonth', 'Billing Month')}:</span>
                  <b>{activeReceipt.billMonth}</b>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '6px' }}>
                <span style={{ fontSize: '15px', fontWeight: '600' }}>{t('common.amount', 'Amount Paid')}:</span>
                <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--primary)' }}>{money(activeReceipt.amountPaise)}</span>
              </div>
              {activeReceipt.balanceAfterPaise !== null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                  <span>{t('payments.remainingDue', 'Remaining balance due')}:</span>
                  <b>{money(activeReceipt.balanceAfterPaise)}</b>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <small style={{ color: 'var(--muted)', fontSize: '11px' }}>
                {t('payments.receiptFootnote', 'Digital receipt generated by GauAmrut Platform.')}
              </small>
              <button type="button" className="button small" onClick={() => window.print()}>
                {t('payments.printReceipt', 'Print receipt')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {shareBill && (
        <ShareToWhatsAppModal
          fileName={shareBill.filename}
          blob={shareBill.blob}
          caption={`Monthly milk bill (${shareBill.filename.replace('bill-', '').replace('.pdf', '')})`}
          close={() => setShareBill(null)}
          onSent={() => setNotice('Bill PDF sent to WhatsApp.')}
        />
      )}
    </>
  );
}

function VerifyContactModal({ channel, close, reload }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('intro'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [devOtp, setDevOtp] = useState('');
  const isPhone = channel === 'phone';
  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/profile/verification/request', { channel });
      setDevOtp(data.data.developmentOtp || '');
      setStep('code');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const otp = new FormData(e.currentTarget).get('otp');
      await api.post('/profile/verification/confirm', { channel, otp });
      close();
      reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title={isPhone ? t('customerPortal.verifyMobileTitle', 'Verify mobile number') : t('customerPortal.verifyEmailTitle', 'Verify email')} close={close}>
    {step === 'intro' ? <>
      <p className="form-note">{isPhone
        ? t('customerPortal.verifyPhoneIntro', 'We will send a 6-digit code to your mobile number on WhatsApp. Enter it on this page to prove the number is yours.')
        : t('customerPortal.verifyEmailIntro', 'We will email a 6-digit code to your registered email address. Enter it on this page to confirm it.')}</p>
      {error && <Notice error>{error}</Notice>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
        <button type="button" className="button" onClick={close}>{t('common.cancel', 'Cancel')}</button>
        <button type="button" className="button primary" disabled={busy} onClick={sendCode}>{busy ? t('common.loading', 'Sending…') : t('customerPortal.sendCode', 'Send code')}</button>
      </div>
    </> : <form onSubmit={confirm}>
      <p className="form-note">{isPhone
        ? t('customerPortal.codeSentPhone', 'A 6-digit code was sent to your mobile number on WhatsApp. Enter it below.')
        : t('customerPortal.codeSentEmail', 'A 6-digit code was emailed to your registered email address. Enter it below.')}</p>
      {devOtp && <Notice>Development code: <b>{devOtp}</b></Notice>}
      <Field label={t('customerPortal.enterCode', '6-digit code')} name="otp" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus/>
      {error && <Notice error>{error}</Notice>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
        <button type="button" className="button" onClick={() => { setStep('intro'); setError(''); }}>{t('common.cancel', 'Cancel')}</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? t('common.saving', 'Saving…') : t('customerPortal.verifyNow', 'Verify')}</button>
      </div>
    </form>}
  </Modal>;
}

export function CustomerProfile() {
  const { t, i18n } = useTranslation();
  const resource = useData('/profile'), dispatch = useDispatch(), [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [verifyChannel, setVerifyChannel] = useState(null);
  const platform = usePlatformSettings();
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const formData = Object.fromEntries(new FormData(e.currentTarget));
      const { data } = await api.patch('/profile', formData);
      dispatch(updateUser({ name: data.data.name }));
      if (formData.language) {
        i18n.changeLanguage(formData.language);
      }
      setNotice(t('customerPortal.profileSaved', 'Your profile has been updated.'));
      resource.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return <><Heading title={t('customerPortal.profileTitle', 'Your profile')} description={t('customerPortal.profileDescription', 'Keep your name, delivery address, and language preference up to date.')}/><Notice>{notice}</Notice><Notice error>{error}</Notice><State resource={resource}>{resource.data && <section className="card profile-card"><form onSubmit={save} key={resource.data.updatedAt}><Field label="Your name" name="name" defaultValue={resource.data.name} minLength={2} required/><Field label="Delivery address" name="address" defaultValue={resource.data.address}/><label className="field"><span>{t('customerPortal.preferredLanguage', 'Preferred language')}</span><select name="language" defaultValue={resource.data.language || i18n.language}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="gu">ગુજરાતી (Gujarati)</option></select></label><div className="verify-list"><div className="verify-row"><span><b>{t('customerPortal.contactEmail', 'Email')}</b> · {resource.data.email || t('customerPortal.noEmailOnRecord', 'no email on record')}</span>{resource.data.emailVerifiedAt ? <span className="status"><Check size={13}/> {t('customerPortal.verified', 'Verified')}</span> : resource.data.email && <button type="button" className="text-button" onClick={() => setVerifyChannel('email')}>{t('customerPortal.verifyEmailCta', 'Verify email')}</button>}</div><div className="verify-row"><span><b>{t('customerPortal.contactMobile', 'Mobile number')}</b> · {resource.data.phone || t('customerPortal.noMobileOnRecord', 'ask your dairy to add your number')}</span>{resource.data.phoneVerifiedAt ? <span className="status"><Check size={13}/> {t('customerPortal.verified', 'Verified')}</span> : resource.data.phone && <button type="button" className="text-button" onClick={() => setVerifyChannel('phone')}>{t('customerPortal.verifyMobileCta', 'Verify mobile number')}</button>}</div></div><p className="form-note">Cow milk: {money(resource.data.cowRatePaise)} / L · Buffalo milk: {money(resource.data.buffaloRatePaise)} / L<br/>Service: {resource.data.status}</p>{(platform?.support?.email || platform?.support?.phone) && <p className="form-note">Platform support: {[platform.support.email, platform.support.phone].filter(Boolean).join(' · ')}</p>}<button className="button primary" disabled={busy}>{busy ? t('common.saving', 'Saving…') : t('customerPortal.saveProfile', 'Save profile')}</button></form></section>}</State>{verifyChannel && resource.data && <VerifyContactModal channel={verifyChannel} close={() => setVerifyChannel(null)} reload={resource.reload}/>}</>;
}

export function CustomerOrders() {
  const { t } = useTranslation();
  const demo = useSelector(s => s.session.demo);
  const products = useData('/products', demoProducts);
  const orders = useData('/orders', demoOrders);

  const [orderModal, setOrderModal] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  function openOrderModal(initialProductId = null) {
    setError('');
    const available = products.data?.filter(p => p.available) || [];
    if (!available.length) {
      setError('No products are currently available for ordering from your dairy.');
      return;
    }
    const prodId = initialProductId || available[0]._id;
    setSelectedItems([{ product_id: prodId, quantity: 1 }]);
    setOrderModal(true);
  }

  function addItemRow() {
    const available = products.data?.filter(p => p.available) || [];
    if (!available.length) return;
    setSelectedItems([...selectedItems, { product_id: available[0]._id, quantity: 1 }]);
  }

  function removeItemRow(index) {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  }

  function updateItem(index, field, val) {
    const next = [...selectedItems];
    next[index] = { ...next[index], [field]: val };
    setSelectedItems(next);
  }

  const liveTotalPaise = selectedItems.reduce((sum, it) => {
    const p = products.data?.find(prod => prod._id === it.product_id);
    return sum + (p ? p.pricePaise * (parseInt(it.quantity, 10) || 0) : 0);
  }, 0);

  async function handlePlaceOrder(e) {
    e.preventDefault();
    if (demo) {
      setError('Demo orders are read-only. Sign in to place orders.');
      return;
    }
    if (!selectedItems.length) {
      setError('Please add at least one item.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      await api.post('/orders', {
        deliveryDate: f.deliveryDate,
        shift: f.shift,
        items: selectedItems.map(it => ({
          product_id: it.product_id,
          quantity: parseInt(it.quantity, 10)
        })),
        notes: f.notes ? f.notes.trim() : ''
      });
      setNotice(t('orders.orderSuccess', 'Order placed successfully!'));
      setOrderModal(false);
      orders.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelOrder(e) {
    e.preventDefault();
    if (demo) {
      setNotice('Demo order cancelled.');
      setCancellingOrder(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = new FormData(e.currentTarget);
      await api.patch(`/orders/${cancellingOrder._id}/status`, {
        status: 'cancelled',
        reason: f.get('reason')
      });
      setNotice('Order cancelled successfully.');
      setCancellingOrder(null);
      orders.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        title={t('nav.store', 'Store & Orders')}
        description="Browse your dairy's farm-fresh products and track your custom orders."
      >
        <button
          type="button"
          className="button primary"
          onClick={() => openOrderModal()}
          disabled={!products.data?.some(p => p.available)}
        >
          <Plus size={18} /> {t('orders.placeOrder', 'Place Order')}
        </button>
      </Heading>

      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}

      {/* Available Products Showcase */}
      <section className="card" style={{ marginBottom: '25px' }}>
        <div className="card-heading">
          <div>
            <h2>Dairy Products Catalogue</h2>
            <p>Order fresh value-added products delivered alongside your daily milk</p>
          </div>
        </div>
        <State resource={products}>
          {products.data?.length ? (
            <div className="customer-grid">
              {products.data.map(p => (
                <article className="customer-card" key={p._id}>
                  <div className="customer-card-top">
                    <span className="pill capitalize">{p.type}</span>
                    <span className={`status ${p.available ? '' : 'neutral'}`}>
                      {p.available ? 'Available' : 'Out of stock'}
                    </span>
                  </div>
                  <h3>{p.name}</h3>
                  <p>{p.description || 'Pure farm product made with care.'}</p>
                  <div className="customer-rates">
                    <span>Price<b>{money(p.pricePaise)} / {p.unit}</b></span>
                    <span>Packaging<b>{p.unit}</b></span>
                  </div>
                  {p.available && (
                    <button
                      type="button"
                      className="button small primary"
                      style={{ marginTop: '12px', width: '100%' }}
                      onClick={() => openOrderModal(p._id)}
                    >
                      <Plus size={14} /> Order Now
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty>No products currently available from your dairy.</Empty>
          )}
        </State>
      </section>

      {/* Orders History */}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Your Placed Orders</h2>
            <p>Permanent price snapshots and fulfillment progress</p>
          </div>
        </div>
        <State resource={orders}>
          {orders.data?.length ? (
            <div style={{ display: 'grid', gap: '14px', padding: '20px' }}>
              {orders.data.map(ord => (
                <div
                  key={ord._id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '16px 18px',
                    background: 'var(--surface)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <span className="pill">
                        Delivery: <b>{ord.deliveryDate}</b> ({ord.shift})
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        className={`status ${ord.status === 'fulfilled' ? 'success' : ord.status === 'confirmed' ? 'info' : ord.status === 'cancelled' ? 'danger' : 'pending'}`}
                        style={{ fontWeight: '600' }}
                      >
                        {ord.status === 'fulfilled' && <CheckCircle2 size={12} />}
                        {ord.status === 'confirmed' && <Check size={12} />}
                        {ord.status === 'placed' && <Clock size={12} />}
                        {ord.status === 'cancelled' && <X size={12} />}
                        <span className="capitalize">{ord.status}</span>
                      </span>

                      {ord.status === 'placed' && (
                        <button
                          type="button"
                          className="button small danger-ghost"
                          onClick={() => setCancellingOrder(ord)}
                          disabled={busy}
                        >
                          Cancel Order
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Unit Price (Freeze)</th>
                          <th>Qty</th>
                          <th>Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ord.items?.map((it, idx) => (
                          <tr key={idx}>
                            <td><b>{it.name}</b> ({it.unit})</td>
                            <td>{money(it.unitPricePaise)}</td>
                            <td>{it.quantity}</td>
                            <td><b>{money(it.totalPaise)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                    <div>
                      {ord.notes && <small style={{ color: 'var(--muted)' }}>Note: {ord.notes}</small>}
                      {ord.status === 'cancelled' && ord.cancellationReason && (
                        <small className="danger-text" style={{ display: 'block' }}>Cancellation: {ord.cancellationReason}</small>
                      )}
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', color: 'var(--muted)', marginRight: '8px' }}>Total Amount:</span>
                      <b style={{ fontSize: '15px', color: 'var(--green)' }}>{money(ord.totalPaise)}</b>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>You have not placed any custom orders yet.</Empty>
          )}
        </State>
      </section>

      {/* Place Order Modal */}
      {orderModal && (
        <Modal title={t('orders.placeOrder', 'Place an Order')} close={() => setOrderModal(false)}>
          <form onSubmit={handlePlaceOrder}>
            <div className="form-grid">
              <Field
                label={t('orders.deliveryDate', 'Delivery Date')}
                name="deliveryDate"
                type="date"
                required
                defaultValue={serviceDate()}
              />
              <label className="field">
                <span>{t('orders.shift', 'Delivery Shift')}</span>
                <select name="shift" defaultValue="morning">
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                </select>
              </label>
            </div>

            <div style={{ margin: '14px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600' }}>Order Items</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={addItemRow}
                  disabled={!products.data?.filter(p => p.available).length}
                >
                  <Plus size={14} /> Add Item
                </button>
              </div>

              {selectedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="order-item-row"
                >
                  <select
                    value={item.product_id}
                    onChange={e => updateItem(idx, 'product_id', e.target.value)}
                    required
                  >
                    {products.data?.filter(p => p.available).map(p => (
                      <option key={p._id} value={p._id}>
                        {p.name} ({money(p.pricePaise)} / {p.unit})
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={item.quantity}
                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                    required
                  />

                  {selectedItems.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      style={{ color: 'var(--danger)', minWidth: '32px', minHeight: '32px' }}
                      onClick={() => removeItemRow(idx)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="total-strip" style={{ marginBottom: '16px' }}>
              <span>Order Total (Frozen at placement):</span>
              <b style={{ color: 'var(--green)', fontSize: '15px' }}>{money(liveTotalPaise)}</b>
            </div>

            <Field
              label="Delivery Instructions (Optional)"
              name="notes"
              placeholder="e.g. Leave outside door"
            />

            {error && <Notice error>{error}</Notice>}

            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? t('common.saving', 'Submitting…') : 'Confirm & Place Order'}
            </button>
          </form>
        </Modal>
      )}

      {/* Cancel Order Modal */}
      {cancellingOrder && (
        <Modal title="Cancel Order" close={() => setCancellingOrder(null)}>
          <form onSubmit={handleCancelOrder}>
            <p className="form-note">
              Are you sure you want to cancel this order? Please provide a reason:
            </p>
            <Field
              label={t('orders.cancellationReason', 'Cancellation Reason')}
              name="reason"
              required
              minLength={3}
              placeholder="e.g., Not required anymore"
            />
            {error && <Notice error>{error}</Notice>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setCancellingOrder(null)}
                disabled={busy}
              >
                {t('common.cancel', 'Back')}
              </button>
              <button
                type="submit"
                className="button danger"
                disabled={busy}
              >
                {busy ? t('common.saving', 'Cancelling…') : 'Cancel Order'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function CustomerDisputes() {
  const { t } = useTranslation();
  const demo = useSelector(s => s.session.demo);
  const disputes = useData('/disputes', demoDisputes);

  const [createModal, setCreateModal] = useState(false);
  const [activeDispute, setActiveDispute] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function openThread(d) {
    setError('');
    if (demo) {
      setActiveDispute(d);
      return;
    }
    try {
      const res = await api.get(`/disputes/${d._id}`);
      setActiveDispute(res.data.data);
    } catch {
      setActiveDispute(d);
    }
  }

  async function handleCreateDispute(e) {
    e.preventDefault();
    if (demo) {
      setError('Demo disputes are read-only. Sign in to submit disputes.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      await api.post('/disputes', {
        type: f.type,
        targetType: f.targetType || 'general',
        title: f.title.trim(),
        description: f.description.trim()
      });
      setNotice('Dispute raised successfully. Your dairy owner will review it.');
      setCreateModal(false);
      disputes.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendReply(e) {
    e.preventDefault();
    if (!replyMessage.trim()) return;
    if (demo) {
      const newReply = {
        actor: 'me',
        role: 'customer',
        authorName: 'You',
        message: replyMessage.trim(),
        createdAt: new Date().toISOString()
      };
      setActiveDispute({
        ...activeDispute,
        replies: [...(activeDispute.replies || []), newReply]
      });
      setReplyMessage('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/disputes/${activeDispute._id}/replies`, {
        message: replyMessage.trim()
      });
      setActiveDispute(res.data.data);
      setReplyMessage('');
      disputes.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelDispute() {
    if (demo) {
      setActiveDispute({ ...activeDispute, status: 'cancelled' });
      setNotice('Demo dispute cancelled.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.patch(`/disputes/${activeDispute._id}/status`, {
        status: 'cancelled'
      });
      setActiveDispute(res.data.data);
      setNotice('Dispute cancelled.');
      disputes.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const typeLabels = {
    quantity_mismatch: t('disputes.typeQuantity', 'Quantity mismatch'),
    quality: t('disputes.typeQuality', 'Quality issue'),
    billing: t('disputes.typeBilling', 'Billing discrepancy'),
    other: t('disputes.typeOther', 'Other concern')
  };

  return (
    <>
      <Heading
        title={t('disputes.title', 'Disputes & Inquiries')}
        description="Raise delivery mismatches, quality feedback, or billing concerns directly with your dairy."
      >
        <button
          type="button"
          className="button primary"
          onClick={() => { setCreateModal(true); setError(''); }}
        >
          <Plus size={18} /> {t('disputes.raiseDispute', 'Raise a Dispute')}
        </button>
      </Heading>

      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}

      <section className="card">
        <State resource={disputes}>
          {disputes.data?.length ? (
            <div style={{ display: 'grid', gap: '14px', padding: '20px' }}>
              {disputes.data.map(d => (
                <div
                  key={d._id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '16px 18px',
                    background: 'var(--surface)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span className="pill capitalize">{typeLabels[d.type] || d.type}</span>
                      <span
                        className={`status ${d.status === 'resolved' ? 'success' : d.status === 'under_review' ? 'info' : d.status === 'cancelled' ? 'neutral' : 'pending'}`}
                        style={{ fontWeight: '600' }}
                      >
                        {d.status === 'resolved' && <CheckCircle2 size={12} />}
                        {d.status === 'under_review' && <Clock size={12} />}
                        {d.status === 'open' && <AlertCircle size={12} />}
                        {d.status === 'cancelled' && <XCircle size={12} />}
                        <span className="capitalize">{d.status?.replace('_', ' ') || ''}</span>
                      </span>
                    </div>
                    <b style={{ fontSize: '14px' }}>{d.title}</b>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0' }}>{d.description}</p>
                    <small style={{ color: 'var(--muted)' }}>
                      {new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {d.replies?.length || 0} messages
                    </small>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() => openThread(d)}
                    >
                      <MessageSquare size={15} /> Open Thread
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>You have not raised any disputes. Everything looks good!</Empty>
          )}
        </State>
      </section>

      {/* Raise Dispute Modal */}
      {createModal && (
        <Modal title={t('disputes.raiseDispute', 'Raise a Dispute / Inquiry')} close={() => setCreateModal(false)}>
          <form onSubmit={handleCreateDispute}>
            <div className="form-grid">
              <label className="field">
                <span>{t('disputes.type', 'Issue Category')}</span>
                <select name="type" required defaultValue="quantity_mismatch">
                  <option value="quantity_mismatch">Quantity mismatch</option>
                  <option value="quality">Quality issue</option>
                  <option value="billing">Billing discrepancy</option>
                  <option value="other">Other concern</option>
                </select>
              </label>

              <label className="field">
                <span>Related To</span>
                <select name="targetType" defaultValue="general">
                  <option value="general">General</option>
                  <option value="delivery">Daily Delivery</option>
                  <option value="order">Store Order</option>
                  <option value="bill">Monthly Bill</option>
                </select>
              </label>
            </div>

            <Field
              label={t('disputes.disputeTitle', 'Summary / Title')}
              name="title"
              required
              minLength={3}
              maxLength={120}
              placeholder="e.g., Only received 500ml milk today"
            />

            <label className="field">
              <span>{t('disputes.disputeDescription', 'Detailed Description')}</span>
              <textarea
                name="description"
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                placeholder="Please describe the date, shift, or issue clearly so your dairy can resolve it quickly..."
                style={{
                  width: '100%',
                  fontFamily: 'inherit',
                  fontSize: '13px'
                }}
              />
            </label>

            {error && <Notice error>{error}</Notice>}

            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? t('common.saving', 'Submitting…') : 'Submit Dispute'}
            </button>
          </form>
        </Modal>
      )}

      {/* Thread Modal */}
      {activeDispute && (
        <Modal title={`Dispute: ${activeDispute.title}`} close={() => setActiveDispute(null)}>
          <div className="note-strip" style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span className="pill capitalize">{typeLabels[activeDispute.type] || activeDispute.type}</span>
              <span
                className={`status ${activeDispute.status === 'resolved' ? 'success' : activeDispute.status === 'under_review' ? 'info' : activeDispute.status === 'cancelled' ? 'neutral' : 'pending'}`}
                style={{ fontWeight: '600' }}
              >
                {activeDispute.status?.replace('_', ' ') || ''}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0' }}>{activeDispute.description}</p>
          </div>

          <div
            style={{
              maxHeight: '320px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '12px 0',
              marginBottom: '16px'
            }}
          >
            {activeDispute.replies?.map((r, i) => {
              const isMe = r.role === 'customer';
              return (
                <div
                  key={i}
                  className={`chat-bubble ${isMe ? 'me' : 'other'}`}
                  style={{
                    alignSelf: isMe ? 'flex-end' : 'flex-start',
                    maxWidth: '82%'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '4px', fontSize: '10px', color: 'var(--muted)' }}>
                    <b>{isMe ? 'You' : (r.authorName || 'Dairy')} ({r.role})</b>
                    <span>{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p style={{ fontSize: '13px', margin: 0, whiteSpace: 'pre-wrap' }}>
                    {r.message}
                  </p>
                </div>
              );
            })}
          </div>

          {activeDispute.status === 'resolved' && (
            <div className="resolved-banner" style={{ marginBottom: '14px' }}>
              <b className="resolved-title">
                <CheckCircle2 size={16} /> Resolved by Dairy
              </b>
              <p>
                {activeDispute.resolutionNotes}
              </p>
            </div>
          )}

          {error && <Notice error>{error}</Notice>}

          {['open', 'under_review'].includes(activeDispute.status) ? (
            <form onSubmit={handleSendReply}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <textarea
                  rows={2}
                  style={{
                    flex: 1,
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    fontFamily: 'inherit',
                    fontSize: '13px',
                    background: 'var(--surface)',
                    color: 'var(--ink)'
                  }}
                  placeholder="Type a message to your dairy..."
                  value={replyMessage}
                  onChange={e => setReplyMessage(e.target.value)}
                  disabled={busy}
                  required
                />
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy || !replyMessage.trim()}
                  style={{ alignSelf: 'flex-end', minHeight: '40px' }}
                >
                  <Send size={15} /> Send
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="button small danger-ghost"
                  onClick={handleCancelDispute}
                  disabled={busy}
                >
                  Cancel Dispute
                </button>
              </div>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px', color: 'var(--muted)', fontSize: '12px' }}>
              This dispute is {activeDispute.status}.
            </div>
          )}
        </Modal>
      )}
    </>
  );
}


