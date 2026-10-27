import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Plus, Check, Search, Receipt, AlertCircle, FileText, CheckCircle2, XCircle, Printer, RotateCcw, Download, Send } from 'lucide-react';
import { CollectionsDonut } from '../../components/charts';
import { Heading, Notice, State, Empty, Modal, Field } from '../../components/ui';
import ShareToWhatsAppModal from '../../components/ShareToWhatsApp';
import { api, money, message, decimalUnits, serviceDate } from '../../lib';
import useData from '../../hooks/useData';
import { usePlatformSettings } from '../../platform';
import { demoBills, demoCustomers, demoClaims, demoAdjustments, demoPayments } from '../../demo';

export default function Payments() {
  const { t } = useTranslation();
  const demo = useSelector(s => s.session.demo);
  const platform = usePlatformSettings();
  const [activeTab, setActiveTab] = useState('bills');
  const [page, setPage] = useState(1);
  const bills = useData(`/bills?page=${page}`, demoBills);
  const customers = useData('/customers?limit=100', demoCustomers);
  const claims = useData('/payment-claims', demoClaims);
  const payments = useData('/payments?limit=50', demoPayments);
  const adjustments = useData('/adjustments?limit=50', demoAdjustments);

  const [modal, setModal] = useState(null);
  const [rejectingClaim, setRejectingClaim] = useState(null);
  const [reversingPayment, setReversingPayment] = useState(null);
  const [reversingAdjustment, setReversingAdjustment] = useState(null);
  const [adjustmentModal, setAdjustmentModal] = useState(false);
  const [selectedAdjCustomer, setSelectedAdjCustomer] = useState('');
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');

  const open = value => {
    setModal(value);
    setError('');
    setKey('pay-' + Math.floor(Math.random() * 1000000000));
  };

  const pendingClaimsCount = claims.data?.filter(c => c.status === 'pending').length || 0;

  async function handleBatchGenerate() {
    if (demo) {
      setNotice(t('payments.demoBatchNotice', 'Demo workspace: simulated batch bill generation completed for all active customers.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/bills/batch-generate', {});
      const d = res.data.data;
      setNotice(t('payments.batchSuccess', {
        generated: d.generated,
        updated: d.updated ?? 0,
        skipped: d.skipped,
        defaultValue: `Batch billing finished: ${d.generated} bills generated, ${d.updated ?? 0} updated, ${d.skipped} skipped.`
      }));
      bills.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    if (demo) {
      setError('Demo payments are read-only. Sign in to manage real bills.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      const body = modal === 'bill' ? f : { bill_id: modal._id, amountPaise: decimalUnits(f.amount), method: f.method, ...(f.reference ? { reference: f.reference } : {}) };
      const r = await api.post(modal === 'bill' ? '/bills' : '/payments', body, { headers: { 'Idempotency-Key': key } });
      setNotice(modal === 'bill' ? t('payments.billFinalized', 'Monthly bill generated with carry-forward accounting. It refreshes whenever entries change.') : `${t('payments.paymentRecorded', 'Payment recorded.')} ${t('payments.receiptLabel', 'Receipt')}: ${r.data.data.receipt}`);
      setModal(null);
      bills.reload();
      payments.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewClaim(claimId, action, reason = '') {
    if (demo) {
      setNotice(t('payments.demoClaimNotice', 'Demo workspace: payment claims are read-only preview.'));
      setRejectingClaim(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.patch(`/payment-claims/${claimId}/review`, { action, ...(reason ? { reason } : {}) });
      setRejectingClaim(null);
      claims.reload();
      bills.reload();
      payments.reload();
      if (action === 'approve') {
        setNotice(t('payments.claimApprovedNotice', 'Payment claim approved and receipt issued.'));
        if (res.data.data?.payment) {
          viewReceipt(res.data.data.payment._id);
        }
      } else {
        setNotice(t('payments.claimRejectedNotice', 'Payment claim rejected with reason.'));
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReversePayment(paymentId, reason) {
    if (demo) {
      setNotice(t('payments.paymentReversedNotice', 'Payment reversed successfully and bill balance restored.'));
      setReversingPayment(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/payments/${paymentId}/reverse`, { reason });
      setNotice(t('payments.paymentReversedNotice', 'Payment reversed successfully and bill balance restored.'));
      setReversingPayment(null);
      payments.reload();
      bills.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAdjustment(e) {
    e.preventDefault();
    if (demo) {
      setNotice(t('payments.adjustmentCreatedNotice', 'Adjustment applied and customer balance updated.'));
      setAdjustmentModal(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      await api.post('/adjustments', {
        customer_id: f.customer_id,
        bill_id: f.bill_id || undefined,
        type: f.type,
        amountPaise: decimalUnits(f.amount),
        reason: f.reason,
        reference: f.reference || ''
      });
      setNotice(t('payments.adjustmentCreatedNotice', 'Adjustment applied and customer balance updated.'));
      setAdjustmentModal(false);
      adjustments.reload();
      bills.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReverseAdjustment(adjId, reason) {
    if (demo) {
      setNotice(t('payments.adjustmentReversedNotice', 'Adjustment reversed successfully.'));
      setReversingAdjustment(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/adjustments/${adjId}/reverse`, { reason });
      setNotice(t('payments.adjustmentReversedNotice', 'Adjustment reversed successfully.'));
      setReversingAdjustment(null);
      adjustments.reload();
      bills.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function viewReceipt(paymentId) {
    if (demo) {
      const p = payments.data?.find(item => item._id === paymentId);
      setActiveReceipt({
        receipt: p?.receipt || 'GA-DEMO-2026-001',
        date: p?.createdAt || new Date().toISOString(),
        method: p?.method || 'upi',
        reference: p?.reference || 'DEMO-UTR-998877',
        amountPaise: p?.amountPaise || 50000,
        currency: 'INR',
        billMonth: '2026-08',
        reversed: p?.reversed || false,
        reversalReason: p?.reversalReason || null,
        dairy: { businessName: 'Aarav Organic Milk', ownerName: 'Aarav Patel', phone: '98250 12345', upiId: 'aarav@okaxis' },
        customer: { name: 'Meera Shah', phone: '98765 43210', address: '12, Green Park Society' },
        balanceAfterPaise: 98000,
        verified: true
      });
      return;
    }
    try {
      const res = await api.get(`/payments/${paymentId}/receipt`);
      setActiveReceipt(res.data.data);
    } catch (e) {
      setNotice(message(e));
    }
  }

  async function fetchBillPdf(billId, month) {
    const r = await api.get(`/bills/${billId}/pdf`, { responseType: 'blob' });
    return { blob: r.data, filename: `bill-${month}.pdf` };
  }

  const [shareBill, setShareBill] = useState(null);

  async function downloadBillPdf(billId, month) {
    try {
      const { blob, filename } = await fetchBillPdf(billId, month);
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

  async function shareBillPdf(billId, month) {
    try {
      const { blob, filename } = await fetchBillPdf(billId, month);
      setShareBill({ blob, filename });
    } catch (err) {
      setNotice(message(err));
    }
  }

  return (
    <>
      <Heading
        eyebrow={t('payments.eyebrow', 'CLEAR BOOKS. PEACE OF MIND.')}
        title={t('nav.payments', 'Bills & payments')}
        description={t('payments.description', 'Finalize monthly bills with carry-forward ledger, review payment claims, and issue immutable digital receipts.')}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="button" disabled={busy} onClick={handleBatchGenerate}>
            <FileText size={17} /> {busy ? t('common.loading', 'Processing…') : t('payments.batchRun', 'Batch generate bills')}
          </button>
          <button type="button" className="button" onClick={() => { setAdjustmentModal(true); setError(''); }}>
            <Plus size={17} /> {t('payments.applyAdjustment', 'Apply adjustment')}
          </button>
          <button type="button" className="button primary" onClick={() => open('bill')}>
            <Plus size={18} /> {t('payments.generateBill', 'Generate single bill')}
          </button>
        </div>
      </Heading>

      <Notice>{notice}</Notice>
      {error && <Notice error>{error}</Notice>}

      <div className="tab-nav">
        <button
          type="button"
          className={`button small ${activeTab === 'bills' ? 'primary' : ''}`}
          onClick={() => setActiveTab('bills')}
        >
          {t('payments.monthlyBillsTab', 'Monthly bills')}
        </button>
        <button
          type="button"
          className={`button small ${activeTab === 'claims' ? 'primary' : ''}`}
          onClick={() => setActiveTab('claims')}
          style={{ position: 'relative' }}
        >
          {t('payments.claimsTab', 'Customer payment claims')}
          {pendingClaimsCount > 0 && (
            <span className="count-badge">{pendingClaimsCount}</span>
          )}
        </button>
        <button
          type="button"
          className={`button small ${activeTab === 'receipts' ? 'primary' : ''}`}
          onClick={() => setActiveTab('receipts')}
        >
          {t('payments.receiptsTab', 'Receipts')}
        </button>
        <button
          type="button"
          className={`button small ${activeTab === 'adjustments' ? 'primary' : ''}`}
          onClick={() => setActiveTab('adjustments')}
        >
          {t('payments.adjustmentsTab', 'Adjustments & credits')}
        </button>
      </div>

      {activeTab === 'bills' && (
        <section className="card">
          <div className="card-heading">
            <h2>{t('payments.monthlyBillsHeading', 'Monthly customer bills')}</h2>
            <span className="pill">INR · ₹ (Paise Accounting)</span>
          </div>
          {bills.data?.length > 0 && <CollectionsDonut bills={bills.data}/>}
          <State resource={bills}>
            {bills.data?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('common.customer', 'Customer')}</th>
                      <th>{t('common.date', 'Month')}</th>
                      <th>{t('payments.openingBalance', 'Opening (Carried)')}</th>
                      <th>{t('payments.charges', 'Milk charges')}</th>
                      <th>{t('payments.paid', 'Paid')}</th>
                      <th>{t('payments.outstanding', 'Closing due')}</th>
                      <th>{t('common.actions', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.data.map(b => (
                      <tr key={b._id}>
                        <td><b>{customers.data?.find(c => c._id === b.customer_id)?.name || b.customer_id}</b></td>
                        <td>{b.month}</td>
                        <td>{money(b.openingPaise)}</td>
                        <td>{money(b.chargesPaise)}</td>
                        <td>{money(b.paidPaise)}</td>
                        <td><b>{money(b.closingPaise)}</b></td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="text-button"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              title="Download PDF Bill"
                              onClick={() => downloadBillPdf(b._id, b.month)}
                            >
                              <Download size={14} /> PDF
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              title="Share PDF bill on WhatsApp"
                              onClick={() => shareBillPdf(b._id, b.month)}
                            >
                              <Send size={14} /> WhatsApp
                            </button>
                            {b.closingPaise > 0 ? (
                              <button type="button" className="button small" onClick={() => open(b)}>
                                {t('payments.recordPayment', 'Record payment')}
                              </button>
                            ) : (
                              <span className="status"><Check size={13} /> {t('payments.paidStatus', 'Settled')}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{t('payments.noBills', 'No bills yet. Finalize a completed month to start collecting payments.')}</Empty>
            )}
          </State>
          {platform?.invoice?.footer && <p className="invoice-footer-note">{platform.invoice.footer}</p>}
        </section>
      )}

      {activeTab === 'claims' && (
        <section className="card">
          <div className="card-heading">
            <h2>{t('payments.claimsHeading', 'Customer payment claims')}</h2>
            <span className="pill">{claims.data?.length || 0} claims</span>
          </div>
          <State resource={claims}>
            {claims.data?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('common.customer', 'Customer')}</th>
                      <th>{t('common.date', 'Date')}</th>
                      <th>{t('common.amount', 'Amount')}</th>
                      <th>{t('payments.method', 'Method')}</th>
                      <th>{t('payments.reference', 'Reference (UTR)')}</th>
                      <th>{t('payments.notes', 'Notes')}</th>
                      <th>{t('common.status', 'Status')}</th>
                      <th>{t('common.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.data.map(c => (
                      <tr key={c._id}>
                        <td><b>{c.customerName || 'Customer'}</b></td>
                        <td>{new Date(c.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                        <td><b>{money(c.amountPaise)}</b></td>
                        <td className="capitalize">{c.method}</td>
                        <td><code>{c.reference}</code></td>
                        <td>{c.notes || '—'}</td>
                        <td>
                          <span className={`status ${c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'pending'}`}>
                            {c.status}
                          </span>
                          {c.rejectionReason && <small className="danger-text" style={{ display: 'block' }}>{c.rejectionReason}</small>}
                        </td>
                        <td>
                          {c.status === 'pending' && (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="button small primary"
                                disabled={busy}
                                onClick={() => handleReviewClaim(c._id, 'approve')}
                              >
                                <CheckCircle2 size={14} /> {t('payments.approveClaim', 'Approve')}
                              </button>
                              <button
                                type="button"
                                className="button small danger-ghost"
                                disabled={busy}
                                onClick={() => setRejectingClaim(c)}
                              >
                                <XCircle size={14} /> {t('payments.rejectClaim', 'Reject')}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{t('payments.noClaims', 'No customer payment claims have been submitted yet.')}</Empty>
            )}
          </State>
        </section>
      )}

      {activeTab === 'receipts' && (
        <section className="card">
          <div className="card-heading">
            <h2>{t('payments.receiptsHeading', 'Issued payment receipts')}</h2>
            <span className="pill">{payments.data?.length || 0} {t('nav.payments', 'payments')}</span>
          </div>
          <State resource={payments}>
            {payments.data?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('common.date', 'Received')}</th>
                      <th>{t('common.customer', 'Customer')}</th>
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
                        <td><b>{p.customerName || customers.data?.find(c => c._id === p.customer_id)?.name || 'Customer'}</b></td>
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
                                <small className="danger-text" style={{ display: 'block', fontSize: '11px', marginTop: '2px', maxWidth: '180px' }}>
                                  {p.reversalReason}
                                </small>
                              )}
                            </div>
                          ) : (
                            <span className="status"><Check size={13} /> {t('payments.paidStatus', 'Settled')}</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button type="button" className="button small" onClick={() => viewReceipt(p._id)}>
                              <Receipt size={14} /> {t('payments.viewReceipt', 'View receipt')}
                            </button>
                            {!p.reversed && (
                              <button
                                type="button"
                                className="button small danger-ghost"
                                onClick={() => { setReversingPayment(p); setError(''); }}
                              >
                                <RotateCcw size={14} /> {t('payments.reversePayment', 'Reverse')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{t('payments.noReceipts', 'No payments recorded yet. Settle a bill or approve a claim to issue receipts.')}</Empty>
            )}
          </State>
        </section>
      )}

      {activeTab === 'adjustments' && (
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>{t('payments.adjustmentsHeading', 'Customer ledger adjustments')}</h2>
              <p className="form-note" style={{ margin: 0, marginTop: '2px' }}>
                {t('payments.adjustmentsDescription', 'Apply approved credits, goodwill waivers, or debit adjustments with reasoned audit entries.')}
              </p>
            </div>
            <button type="button" className="button small primary" onClick={() => { setAdjustmentModal(true); setError(''); }}>
              <Plus size={15} /> {t('payments.applyAdjustment', 'Apply adjustment')}
            </button>
          </div>
          <State resource={adjustments}>
            {adjustments.data?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('common.date', 'Date')}</th>
                      <th>{t('common.customer', 'Customer')}</th>
                      <th>{t('payments.adjustmentType', 'Type')}</th>
                      <th>{t('common.amount', 'Amount')}</th>
                      <th>{t('payments.rejectionReasonLabel', 'Reason')}</th>
                      <th>{t('payments.billMonth', 'Target bill')}</th>
                      <th>{t('common.status', 'Status')}</th>
                      <th>{t('common.actions', 'Action')}</th>
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
                          <td><b>{adj.customerName || customers.data?.find(c => c._id === adj.customer_id)?.name || 'Customer'}</b></td>
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
                          <td style={{ maxWidth: '220px' }}>
                            <div>{adj.reason}</div>
                            {adj.reference && <small style={{ color: 'var(--muted)', display: 'block' }}>Ref: {adj.reference}</small>}
                          </td>
                          <td>{adj.billMonth ? <code>{adj.billMonth}</code> : <span style={{ color: 'var(--muted)' }}>Account</span>}</td>
                          <td>
                            {adj.status === 'reversed' ? (
                              <div>
                                <span className="status danger">
                                  {t('payments.reversedBadge', 'Reversed')}
                                </span>
                                {adj.reversalReason && (
                                  <small className="danger-text" style={{ display: 'block', fontSize: '11px', marginTop: '2px', maxWidth: '160px' }}>
                                    {adj.reversalReason}
                                  </small>
                                )}
                              </div>
                            ) : (
                              <span className="status"><Check size={13} /> {adj.status}</span>
                            )}
                          </td>
                          <td>
                            {adj.status !== 'reversed' && (
                              <button
                                type="button"
                                className="button small danger-ghost"
                                onClick={() => { setReversingAdjustment(adj); setError(''); }}
                              >
                                <RotateCcw size={14} /> {t('payments.reverseAdjustment', 'Reverse')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{t('payments.noAdjustments', 'No adjustments or credits have been recorded yet.')}</Empty>
            )}
          </State>
        </section>
      )}

      {/* Rejection Reason Modal */}
      {rejectingClaim && (
        <Modal title={t('payments.rejectModalTitle', 'Reject payment claim')} close={() => setRejectingClaim(null)}>
          <form onSubmit={e => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get('reason');
            handleReviewClaim(rejectingClaim._id, 'reject', reason);
          }}>
            <p className="form-note">
              {t('payments.rejectModalNote', 'Please provide a clear reason to the customer explaining why this payment claim could not be verified (e.g. invalid UTR or unreflected funds).')}
            </p>
            <Field label={t('payments.rejectionReasonLabel', 'Rejection reason')} name="reason" required minLength={3} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button type="button" className="button" onClick={() => setRejectingClaim(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button type="submit" className="button danger" disabled={busy}>
                {busy ? t('common.saving', 'Saving…') : t('payments.confirmReject', 'Confirm rejection')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reversing Payment Modal */}
      {reversingPayment && (
        <Modal title={t('payments.reversePaymentTitle', 'Reverse payment & restore balance')} close={() => setReversingPayment(null)}>
          <form onSubmit={e => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get('reason');
            handleReversePayment(reversingPayment._id, reason);
          }}>
            <div className="danger-note" style={{ marginBottom: '14px', fontSize: '13px' }}>
              <b>⚠️ {t('payments.reversePaymentWarning', "Reversing this payment will restore the customer's outstanding balance on their monthly bill.")}</b>
            </div>
            <div className="note-strip" style={{ marginBottom: '14px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('payments.receiptLabel', 'Receipt #')}: <code>{reversingPayment.receipt}</code></span>
              <span>{t('common.amount', 'Amount')}: <b>{money(reversingPayment.amountPaise)}</b></span>
            </div>
            <Field label={t('payments.reversePaymentReasonLabel', 'Reversal reason (audit log)')} name="reason" required minLength={3} placeholder="e.g. Cheque returned, duplicate payment entered" />
            {error && <Notice error>{error}</Notice>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button type="button" className="button" onClick={() => setReversingPayment(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button type="submit" className="button danger" disabled={busy}>
                {busy ? t('common.saving', 'Saving…') : t('payments.confirmReversePayment', 'Confirm payment reversal')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reversing Adjustment Modal */}
      {reversingAdjustment && (
        <Modal title={t('payments.reverseAdjustmentTitle', 'Reverse account adjustment')} close={() => setReversingAdjustment(null)}>
          <form onSubmit={e => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get('reason');
            handleReverseAdjustment(reversingAdjustment._id, reason);
          }}>
            <div className="danger-note" style={{ marginBottom: '14px', fontSize: '13px' }}>
              <b>⚠️ {t('payments.reverseAdjustmentWarning', "Reversing this adjustment will restore the previous balance on the customer's bill.")}</b>
            </div>
            <div className="note-strip" style={{ marginBottom: '14px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
              <span className="capitalize"><b>{reversingAdjustment.type}</b></span>
              <span><b>{money(reversingAdjustment.amountPaise)}</b></span>
            </div>
            <Field label={t('payments.reverseAdjustmentReasonLabel', 'Adjustment reversal reason')} name="reason" required minLength={3} placeholder="e.g. Applied to wrong customer account" />
            {error && <Notice error>{error}</Notice>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button type="button" className="button" onClick={() => setReversingAdjustment(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button type="submit" className="button danger" disabled={busy}>
                {busy ? t('common.saving', 'Saving…') : t('payments.confirmReverseAdjustment', 'Confirm adjustment reversal')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create Adjustment Modal */}
      {adjustmentModal && (
        <Modal title={t('payments.createAdjustmentTitle', 'Create account adjustment')} close={() => setAdjustmentModal(false)}>
          <form onSubmit={handleCreateAdjustment}>
            <label className="field">
              <span>{t('payments.selectCustomer', 'Customer')}</span>
              <select name="customer_id" required value={selectedAdjCustomer} onChange={e => setSelectedAdjCustomer(e.target.value)}>
                <option value="">{t('payments.selectCustomerPlaceholder', 'Select a customer')}</option>
                {customers.data?.map(c => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('payments.adjustmentType', 'Adjustment type')}</span>
              <select name="type" required>
                <option value="credit">{t('payments.typeCredit', 'Credit (Balance deduction)')}</option>
                <option value="waiver">{t('payments.typeWaiver', 'Goodwill waiver (Discount)')}</option>
                <option value="debit">{t('payments.typeDebit', 'Debit (Additional charge)')}</option>
                <option value="refund">{t('payments.typeRefund', 'Payment refund (Cash/UPI returned)')}</option>
              </select>
            </label>
            {selectedAdjCustomer && bills.data?.some(b => b.customer_id === selectedAdjCustomer) && (
              <label className="field">
                <span>{t('customerPortal.selectBill', 'Allocate to bill (optional)')}</span>
                <select name="bill_id">
                  <option value="">{t('customerPortal.oldestDueOption', 'Oldest outstanding bill (default)')}</option>
                  {bills.data.filter(b => b.customer_id === selectedAdjCustomer).map(b => (
                    <option key={b._id} value={b._id}>{b.month} — Balance: {money(b.closingPaise)}</option>
                  ))}
                </select>
              </label>
            )}
            <Field label={t('payments.adjustmentAmountLabel', 'Adjustment amount (₹)')} name="amount" type="number" min="0.01" step="0.01" required />
            <Field label={t('payments.adjustmentReasonLabel', 'Adjustment reason (required)')} name="reason" required minLength={3} placeholder="e.g. Courtesy waiver for delayed delivery, container charge" />
            <Field label={t('payments.adjustmentReferenceLabel', 'Reference (optional, e.g. Dispute # / UTR)')} name="reference" placeholder="Optional transaction or ticket ID" />
            {error && <Notice error>{error}</Notice>}
            <button type="submit" className="button primary full" disabled={busy} style={{ marginTop: '16px' }}>
              {busy ? t('common.saving', 'Saving…') : t('payments.confirmAdjustment', 'Confirm & apply adjustment')}
            </button>
          </form>
        </Modal>
      )}

      {/* Bill & Payment Modal */}
      {modal && (
        <Modal title={modal === 'bill' ? t('payments.finalizeBillTitle', 'Generate a monthly bill') : t('payments.recordPaymentTitle', 'Record a payment')} close={() => { setModal(null); setError(''); }}>
          <form onSubmit={save} onChange={() => setKey('pay-' + Math.floor(Math.random() * 1000000000))}>
            {modal === 'bill' ? (
              <>
                <p className="form-note">
                  {t('payments.carryForwardNote', 'Bills can be generated at any time and refresh with your latest deliveries. Unpaid balance from the prior month rolls into the opening balance.')}
                </p>
                <label className="field">
                  <span>{t('payments.selectCustomer', 'Customer')}</span>
                  <select name="customer_id" required>
                    <option value="">{t('payments.selectCustomerPlaceholder', 'Select a customer')}</option>
                    {customers.data?.map(c => (
                      <option key={c._id} value={c._id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <Field label={t('payments.billingMonthLabel', 'Billing month')} name="month" type="month" max={serviceDate().slice(0, 7)} required />
              </>
            ) : (
              <>
                <Notice>
                  {t('payments.outstandingNote', { amount: money(modal.closingPaise), defaultValue: `This records money received. Outstanding: ${money(modal.closingPaise)}.` })}
                </Notice>
                <Field label={t('payments.amountReceivedLabel', 'Amount received (₹)')} name="amount" type="number" min="0.01" max={modal.closingPaise / 100} step="0.01" required />
                <label className="field">
                  <span>{t('payments.paymentMethod', 'Payment method')}</span>
                  <select name="method">
                    <option value="cash">{t('payments.methodCash', 'Cash')}</option>
                    <option value="upi">{t('payments.methodUpi', 'UPI')}</option>
                    <option value="bank">{t('payments.methodBank', 'Bank transfer')}</option>
                  </select>
                </label>
                <Field label={t('payments.referenceLabel', 'Transaction reference (required for UPI / bank)')} name="reference" />
              </>
            )}
            {error && <Notice error>{error}</Notice>}
            <button className="button primary full" disabled={busy}>
              {busy ? t('common.saving', 'Saving…') : modal === 'bill' ? t('payments.confirmBill', 'Confirm & generate bill') : t('payments.confirmPayment', 'Confirm payment received')}
            </button>
          </form>
        </Modal>
      )}

      {/* Digital Receipt Modal */}
      {activeReceipt && (
        <Modal title={t('payments.receiptTitle', 'Payment Receipt')} close={() => setActiveReceipt(null)}>
          <div className="receipt-card">
            {activeReceipt.reversed && (
              <div className="danger-note" style={{ padding: '10px 14px', marginBottom: '14px', fontSize: '13px' }}>
                <b>⚠️ {t('payments.reversedBadge', 'REVERSED')}</b> — {activeReceipt.reversalReason || 'This payment receipt was reversed by the dairy.'}
                {activeReceipt.reversedAt && <small style={{ display: 'block', marginTop: '2px', opacity: 0.9 }}>{new Date(activeReceipt.reversedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</small>}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px dashed var(--border)', paddingBottom: '14px', marginBottom: '14px' }}>
              <div>
                <b style={{ fontSize: '18px', color: 'var(--green)' }}>{activeReceipt.dairy?.businessName}</b>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{activeReceipt.dairy?.ownerName} · {activeReceipt.dairy?.phone}</div>
                {activeReceipt.dairy?.upiId && <div style={{ fontSize: '12px', color: 'var(--muted)' }}>UPI: {activeReceipt.dairy.upiId}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className={`pill ${activeReceipt.reversed ? 'danger' : 'success'}`}>
                  {activeReceipt.reversed ? `✕ ${t('payments.reversedBadge', 'REVERSED')}` : `✓ ${t('payments.verifiedReceipt', 'VERIFIED RECEIPT')}`}
                </span>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}><code>{activeReceipt.receipt}</code></div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '16px' }}>
              <div>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: '11px' }}>{t('common.customer', 'Customer')}</span>
                <b>{activeReceipt.customer?.name}</b>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{activeReceipt.customer?.phone || 'No phone on file'}</div>
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
                <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--green)' }}>{money(activeReceipt.amountPaise)}</span>
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
                <Printer size={14} /> {t('payments.printReceipt', 'Print receipt')}
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
