import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { MessageSquare, AlertCircle, CheckCircle2, XCircle, Send, ShieldCheck, Clock } from 'lucide-react';
import { Heading, Notice, State, Empty, Modal, Field } from '../../components/ui';
import { api, message } from '../../lib';
import useData from '../../hooks/useData';
import { demoDisputes } from '../../demo';

export default function Disputes() {
  const { t } = useTranslation();
  const demo = useSelector(s => s.session.demo);

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = `/disputes?page=${page}${statusFilter ? `&status=${statusFilter}` : ''}${typeFilter ? `&type=${typeFilter}` : ''}`;
  const resource = useData(query, demoDisputes);

  const [activeDispute, setActiveDispute] = useState(null);
  const [resolvingModal, setResolvingModal] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Open dispute thread
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

  // Send reply
  async function handleSendReply(e) {
    e.preventDefault();
    if (!replyMessage.trim()) return;
    if (demo) {
      const newReply = {
        actor: 'owner',
        role: 'milkman',
        authorName: 'Dairy Owner',
        message: replyMessage.trim(),
        createdAt: new Date().toISOString()
      };
      setActiveDispute({
        ...activeDispute,
        status: 'under_review',
        replies: [...(activeDispute.replies || []), newReply]
      });
      setReplyMessage('');
      setNotice('Demo reply recorded.');
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
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // Resolve dispute
  async function handleResolve(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const notes = f.get('resolutionNotes');

    if (demo) {
      setActiveDispute({
        ...activeDispute,
        status: 'resolved',
        resolutionNotes: notes,
        resolvedAt: new Date().toISOString()
      });
      setResolvingModal(false);
      setNotice('Demo dispute marked resolved.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await api.patch(`/disputes/${activeDispute._id}/status`, {
        status: 'resolved',
        resolutionNotes: notes
      });
      setActiveDispute(res.data.data);
      setResolvingModal(false);
      setNotice(t('disputes.resolvedNotice', 'Dispute marked as resolved.'));
      resource.reload();
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
        eyebrow={t('disputes.eyebrow', 'CUSTOMER CARE & RESOLUTION')}
        title={t('disputes.title', 'Disputes & Support')}
        description={t('disputes.description', 'Review delivery discrepancies, billing questions, and quality feedback directly from your customers.')}
      />

      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}

      <div className="filter-bar" style={{ marginBottom: '16px' }}>
        <div className="field" style={{ minWidth: '160px' }}>
          <label style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
            {t('common.status', 'Status')}
          </label>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="open">Open (Needs review)</option>
            <option value="under_review">Under Review</option>
            <option value="resolved">Resolved</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="field" style={{ minWidth: '160px' }}>
          <label style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
            {t('disputes.type', 'Issue Category')}
          </label>
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All categories</option>
            <option value="quantity_mismatch">Quantity mismatch</option>
            <option value="quality">Quality issue</option>
            <option value="billing">Billing discrepancy</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div style={{ display: 'grid', gap: '14px', padding: '20px' }}>
              {resource.data.map(d => (
                <div
                  key={d._id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '18px 20px',
                    background: 'var(--surface)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '14px'
                  }}
                >
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span className="pill capitalize">{typeLabels[d.type] || d.type}</span>
                      <span className="pill" style={{ textTransform: 'uppercase' }}>Target: {d.targetType}</span>
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

                    <h3 style={{ fontSize: '15px', marginBottom: '4px' }}>{d.title}</h3>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                      {d.description}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>From: <b>{d.customerName || 'Customer'}</b></span>
                      {d.customerPhone && <span>· {d.customerPhone}</span>}
                      <span>· {new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span>· {d.replies?.length || 0} messages</span>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => openThread(d)}
                    >
                      <MessageSquare size={16} /> Open Thread
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              <ShieldCheck size={40} style={{ opacity: 0.5, marginBottom: '8px' }} />
              <p>{t('disputes.noDisputes', 'No disputes found. All customer accounts are settled cleanly.')}</p>
            </Empty>
          )}
        </State>
      </section>

      {/* Conversation Thread Modal */}
      {activeDispute && (
        <Modal
          title={`Dispute: ${activeDispute.title}`}
          close={() => setActiveDispute(null)}
        >
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
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0' }}>
              Customer: <b>{activeDispute.customerName || 'Customer'}</b>
            </p>
          </div>

          {/* Thread messages container */}
          <div
            style={{
              maxHeight: '340px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '12px 0',
              marginBottom: '16px'
            }}
          >
            {activeDispute.replies?.map((r, i) => {
              const isOwner = r.role === 'milkman' || r.role === 'admin';
              return (
                <div
                  key={i}
                  className={`chat-bubble ${isOwner ? 'me' : 'other'}`}
                  style={{
                    alignSelf: isOwner ? 'flex-end' : 'flex-start',
                    maxWidth: '82%'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '4px', fontSize: '10px', color: 'var(--muted)' }}>
                    <b>{r.authorName || (isOwner ? 'Dairy Owner' : 'Customer')} ({r.role})</b>
                    <span>{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p style={{ fontSize: '13px', margin: 0, whiteSpace: 'pre-wrap' }}>
                    {r.message}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Resolution banner if resolved */}
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

          {/* Reply form if dispute is active */}
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
                  placeholder={t('disputes.replyPlaceholder', 'Type a reply to the customer…')}
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
                  className="button success-ghost"
                  onClick={() => setResolvingModal(true)}
                  disabled={busy}
                >
                  <CheckCircle2 size={15} /> {t('disputes.resolveDispute', 'Resolve Dispute')}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px', color: 'var(--muted)', fontSize: '12px' }}>
              This dispute is closed. No further replies can be sent.
            </div>
          )}
        </Modal>
      )}

      {/* Resolve Modal */}
      {resolvingModal && (
        <Modal
          title={t('disputes.resolveDispute', 'Resolve Customer Dispute')}
          close={() => setResolvingModal(false)}
        >
          <form onSubmit={handleResolve}>
            <p className="form-note">
              Provide resolution notes for the customer. This will permanently mark the dispute as resolved.
            </p>
            <label className="field">
              <span>{t('disputes.resolutionNotes', 'Resolution Notes')}</span>
              <textarea
                name="resolutionNotes"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                placeholder="e.g., Verified delivery route records, issued ₹60 credit adjustment for missing 1L milk."
                style={{
                  width: '100%',
                  fontFamily: 'inherit',
                  fontSize: '13px'
                }}
              />
            </label>
            {error && <Notice error>{error}</Notice>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className="button"
                onClick={() => setResolvingModal(false)}
                disabled={busy}
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy}
              >
                {busy ? t('common.saving', 'Saving…') : t('disputes.resolveDispute', 'Confirm Resolution')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
