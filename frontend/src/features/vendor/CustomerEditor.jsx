import { useState } from 'react';
import { useSelector } from 'react-redux';
import { api, decimalUnits, message } from '../../lib';
import { Field, Modal, Notice } from '../../components/ui';
export default function CustomerEditor({ customer, close, saved }) {
  const demo = useSelector(s => s.session.demo), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setError('');
    if (demo) { setError('This is a read-only demo. Sign in to edit your customers.'); return; }
    setBusy(true);
    try {
      const f = Object.fromEntries(new FormData(event.currentTarget));
      const body = { name: f.name, email: f.email || '', phone: f.phone, address: f.address, startDate: f.startDate, endDate: f.endDate, status: f.status, cowRatePaise: decimalUnits(f.cowRate), buffaloRatePaise: decimalUnits(f.buffaloRate), routeMorning: Number(f.routeMorning ?? customer.routeMorning ?? 0), routeEvening: Number(f.routeEvening ?? customer.routeEvening ?? 0) };
      for (const key of ['morningCowMl', 'eveningCowMl', 'morningBuffaloMl', 'eveningBuffaloMl']) body[key] = decimalUnits(f[key], 1000);
      await api.put(`/customers/${customer._id}`, body); saved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title={`Edit ${customer.name}`} close={close}><form onSubmit={save}><div className="form-grid"><Field label="Full name" name="name" defaultValue={customer.name} required minLength={2}/><Field label="Phone number" name="phone" type="tel" defaultValue={customer.phone || ''} placeholder="Add when they get a phone"/><Field label="Customer email (for history linking)" name="email" type="email" defaultValue={customer.email || ''} readOnly={Boolean(customer.user_id)}/><Field label="Address" name="address" defaultValue={customer.address}/><Field label="Service start date" name="startDate" type="date" defaultValue={customer.startDate} required/><Field label="Service end date" name="endDate" type="date" defaultValue={customer.endDate || ''}/><Field label="Cow rate (₹ / litre)" name="cowRate" type="number" min="0" step="0.01" defaultValue={customer.cowRatePaise / 100} required/><Field label="Buffalo rate (₹ / litre)" name="buffaloRate" type="number" min="0" step="0.01" defaultValue={customer.buffaloRatePaise / 100} required/>{[['morningCowMl', 'Morning cow milk'], ['eveningCowMl', 'Evening cow milk'], ['morningBuffaloMl', 'Morning buffalo milk'], ['eveningBuffaloMl', 'Evening buffalo milk']].map(([key, label]) => <Field key={key} label={`${label} (litres)`} name={key} type="number" min="0" max="100" step="0.001" defaultValue={customer[key] / 1000} required/>)}<Field label="Morning route stop #" name="routeMorning" type="number" min="0" defaultValue={customer.routeMorning ?? 0} /><Field label="Evening route stop #" name="routeEvening" type="number" min="0" defaultValue={customer.routeEvening ?? 0} /><label className="field"><span>Service status</span><select name="status" defaultValue={customer.status}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div><Notice>Rate changes apply to new deliveries. Existing delivery and bill amounts stay unchanged.</Notice><Notice error>{error}</Notice><button className="button primary full" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button></form></Modal>;
}
