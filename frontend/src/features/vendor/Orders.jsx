import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Plus, Check, X, Truck, ClipboardList, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { Heading, Notice, State, Empty, Modal, Field } from '../../components/ui';
import { api, money, message, serviceDate } from '../../lib';
import useData from '../../hooks/useData';
import { demoOrders, demoCustomers, demoProducts } from '../../demo';

export default function Orders() {
  const { t } = useTranslation();
  const demo = useSelector(s => s.session.demo);

  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = `/orders?page=${page}${statusFilter ? `&status=${statusFilter}` : ''}${dateFilter ? `&deliveryDate=${dateFilter}` : ''}`;
  const ordersResource = useData(query, demoOrders);
  const customersResource = useData('/customers?limit=100', demoCustomers);
  const productsResource = useData('/products', demoProducts);

  const [createModal, setCreateModal] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Status transitions
  async function handleStatusChange(order, newStatus, reason = '') {
    if (demo) {
      setNotice(`Demo mode: order status updated to ${newStatus}.`);
      setCancellingOrder(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = { status: newStatus };
      if (newStatus === 'cancelled') {
        payload.reason = reason;
      }
      await api.patch(`/orders/${order._id}/status`, payload);
      setNotice(t('orders.statusUpdated', `Order status updated to ${newStatus}.`));
      setCancellingOrder(null);
      ordersResource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // Create order
  function openCreate() {
    setCreateModal(true);
    setSelectedItems([{ product_id: productsResource.data?.[0]?._id || '', quantity: 1 }]);
    setError('');
  }

  function addItemRow() {
    if (!productsResource.data?.length) return;
    setSelectedItems([...selectedItems, { product_id: productsResource.data[0]._id, quantity: 1 }]);
  }

  function removeItemRow(index) {
    setSelectedItems(selectedItems.filter((_, idx) => idx !== index));
  }

  function updateItem(index, field, val) {
    const next = [...selectedItems];
    next[index] = { ...next[index], [field]: val };
    setSelectedItems(next);
  }

  async function handleCreateOrder(e) {
    e.preventDefault();
    if (demo) {
      setError('Demo orders are read-only. Sign in to place orders.');
      return;
    }
    if (!selectedItems.length) {
      setError('Please add at least one product item.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      const payload = {
        customer_id: f.customer_id,
        deliveryDate: f.deliveryDate,
        shift: f.shift,
        items: selectedItems.map(it => ({
          product_id: it.product_id,
          quantity: parseInt(it.quantity, 10)
        })),
        notes: f.notes ? f.notes.trim() : ''
      };

      await api.post('/orders', payload);
      setNotice(t('orders.orderSuccess', 'Order created successfully with snapshot prices!'));
      setCreateModal(false);
      ordersResource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // Compute live estimate for new order
  const orderEstimatePaise = selectedItems.reduce((sum, it) => {
    const prod = productsResource.data?.find(p => p._id === it.product_id);
    return sum + (prod ? prod.pricePaise * (parseInt(it.quantity, 10) || 0) : 0);
  }, 0);

  return (
    <>
      <Heading
        eyebrow={t('orders.eyebrow', 'ON-DEMAND FULFILMENT')}
        title={t('orders.title', 'Customer Orders')}
        description={t('orders.description', 'Confirm and fulfill custom dairy product orders with price freeze snapshots.')}
      >
        <button type="button" className="button primary" onClick={openCreate}>
          <Plus size={18} /> {t('orders.placeOrder', 'New Order')}
        </button>
      </Heading>

      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}

      <div className="filter-bar" style={{ marginBottom: '16px' }}>
        <div className="field" style={{ minWidth: '160px' }}>
          <label style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
            {t('orders.filterStatus', 'Status')}
          </label>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="placed">Placed (Pending)</option>
            <option value="confirmed">Confirmed</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="field" style={{ minWidth: '160px' }}>
          <label style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
            {t('orders.deliveryDate', 'Delivery Date')}
          </label>
          <input
            type="date"
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <section className="card">
        <State resource={ordersResource}>
          {ordersResource.data?.length ? (
            <div style={{ display: 'grid', gap: '16px', padding: '20px' }}>
              {ordersResource.data.map(order => (
                <div
                  key={order._id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '18px 20px',
                    background: '#fff'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="avatar" style={{ width: '32px', height: '32px', fontSize: '11px' }}>
                          {(order.customerName || 'C').slice(0, 1)}
                        </span>
                        <div>
                          <b style={{ fontSize: '14px' }}>{order.customerName || 'Customer'}</b>
                          {order.customerPhone && (
                            <small style={{ display: 'block', color: 'var(--muted)' }}>
                              {order.customerPhone}
                            </small>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="pill">
                        {order.deliveryDate} · <span className="capitalize">{order.shift}</span>
                      </span>
                      <span
                        className="status"
                        style={{
                          background:
                            order.status === 'fulfilled' ? '#e9f5e8' :
                            order.status === 'confirmed' ? '#e8edf8' :
                            order.status === 'cancelled' ? '#faeaea' : '#fcf5e7',
                          color:
                            order.status === 'fulfilled' ? '#2e7424' :
                            order.status === 'confirmed' ? '#28559a' :
                            order.status === 'cancelled' ? '#9a2828' : '#8c6b16',
                          borderColor: 'currentColor',
                          fontWeight: '600'
                        }}
                      >
                        {order.status === 'fulfilled' && <CheckCircle2 size={12} />}
                        {order.status === 'confirmed' && <Check size={12} />}
                        {order.status === 'placed' && <Clock size={12} />}
                        {order.status === 'cancelled' && <X size={12} />}
                        <span className="capitalize">{order.status}</span>
                      </span>
                    </div>
                  </div>

                  {/* Items list */}
                  <div className="table-scroll" style={{ margin: '12px 0' }}>
                    <table style={{ background: '#fafbf9', borderRadius: '6px', overflow: 'hidden' }}>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Unit Price (Freeze)</th>
                          <th>Qty</th>
                          <th>Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items?.map((it, idx) => (
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

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                    <div>
                      {order.notes && (
                        <p style={{ fontSize: '11px', color: 'var(--muted)', margin: 0 }}>
                          <b>Note:</b> {order.notes}
                        </p>
                      )}
                      {order.status === 'cancelled' && order.cancellationReason && (
                        <p style={{ fontSize: '11px', color: '#a94d34', margin: '4px 0 0' }}>
                          <b>Reason:</b> {order.cancellationReason}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <small style={{ color: 'var(--muted)', display: 'block', fontSize: '10px' }}>Total Amount</small>
                        <b style={{ fontSize: '16px', color: 'var(--green)' }}>{money(order.totalPaise)}</b>
                      </div>

                      {/* Action buttons */}
                      {order.status === 'placed' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="button small primary"
                            disabled={busy}
                            onClick={() => handleStatusChange(order, 'confirmed')}
                          >
                            <Check size={14} /> {t('orders.confirmOrder', 'Confirm')}
                          </button>
                          <button
                            type="button"
                            className="button small"
                            style={{ color: '#a94d34', borderColor: '#f4d9cf' }}
                            disabled={busy}
                            onClick={() => setCancellingOrder(order)}
                          >
                            <X size={14} /> {t('orders.cancelOrder', 'Cancel')}
                          </button>
                        </div>
                      )}

                      {order.status === 'confirmed' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="button small primary"
                            style={{ background: '#257348' }}
                            disabled={busy}
                            onClick={() => handleStatusChange(order, 'fulfilled')}
                          >
                            <Truck size={14} /> {t('orders.fulfillOrder', 'Mark Fulfilled')}
                          </button>
                          <button
                            type="button"
                            className="button small"
                            style={{ color: '#a94d34', borderColor: '#f4d9cf' }}
                            disabled={busy}
                            onClick={() => setCancellingOrder(order)}
                          >
                            <X size={14} /> {t('orders.cancelOrder', 'Cancel')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              <ClipboardList size={40} style={{ opacity: 0.5, marginBottom: '8px' }} />
              <p>{t('orders.noOrders', 'No orders match the selected filters.')}</p>
            </Empty>
          )}
        </State>
      </section>

      {/* Place New Order Modal */}
      {createModal && (
        <Modal title={t('orders.placeOrder', 'Create Customer Order')} close={() => setCreateModal(false)}>
          <form onSubmit={handleCreateOrder}>
            <label className="field">
              <span>{t('nav.customers', 'Customer')}</span>
              <select name="customer_id" required defaultValue="">
                <option value="" disabled>Select customer</option>
                {customersResource.data?.map(c => (
                  <option key={c._id} value={c._id}>
                    {c.name}{c.phone ? ` (${c.phone})` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid">
              <Field
                label={t('orders.deliveryDate', 'Delivery Date')}
                name="deliveryDate"
                type="date"
                required
                defaultValue={serviceDate()}
              />
              <label className="field">
                <span>{t('orders.shift', 'Shift')}</span>
                <select name="shift" defaultValue="morning">
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600' }}>Order Items</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={addItemRow}
                  disabled={!productsResource.data?.length}
                >
                  <Plus size={14} /> Add Item
                </button>
              </div>

              {selectedItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '8px',
                    padding: '8px 10px',
                    background: '#f9faf7',
                    borderRadius: '6px'
                  }}
                >
                  <select
                    style={{ flex: 1, padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }}
                    value={item.product_id}
                    onChange={e => updateItem(idx, 'product_id', e.target.value)}
                    required
                  >
                    {productsResource.data?.map(p => (
                      <option key={p._id} value={p._id}>
                        {p.name} ({money(p.pricePaise)} / {p.unit})
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="1"
                    max="100"
                    style={{ width: '65px', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px' }}
                    value={item.quantity}
                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                    required
                  />

                  {selectedItems.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      style={{ color: '#a94d34', minWidth: '32px', minHeight: '32px' }}
                      onClick={() => removeItemRow(idx)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: '10px 14px', background: '#eaf3e8', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span>Estimated Total:</span>
              <b style={{ color: 'var(--green)', fontSize: '15px' }}>{money(orderEstimatePaise)}</b>
            </div>

            <Field
              label="Notes (Optional)"
              name="notes"
              placeholder="Special delivery instructions..."
            />

            {error && <Notice error>{error}</Notice>}

            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? t('common.saving', 'Saving…') : t('orders.placeOrder', 'Place Order')}
            </button>
          </form>
        </Modal>
      )}

      {/* Cancellation Reason Modal */}
      {cancellingOrder && (
        <Modal
          title={t('orders.cancelOrder', 'Cancel Order')}
          close={() => setCancellingOrder(null)}
        >
          <form
            onSubmit={e => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              handleStatusChange(cancellingOrder, 'cancelled', f.get('reason'));
            }}
          >
            <p className="form-note">
              {t('orders.cancellationReasonPrompt', 'Please provide a clear reason for cancelling this order:')}
            </p>
            <Field
              label={t('orders.cancellationReason', 'Cancellation Reason')}
              name="reason"
              required
              minLength={3}
              maxLength={255}
              placeholder="e.g., Customer requested cancellation, out of stock..."
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
                className="button"
                style={{ background: '#a94d34', color: '#fff', borderColor: '#a94d34' }}
                disabled={busy}
              >
                {busy ? t('common.saving', 'Cancelling…') : t('orders.confirmCancellation', 'Confirm Cancellation')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
