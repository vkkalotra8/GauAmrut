import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { api, message, updateUser } from '../../lib';
import useData from '../../hooks/useData';
import { Brand, Field, Heading, Modal, Notice, State } from '../../components/ui';
import LanguageSelect from '../../components/LanguageSelect';
import { usePlatformSettings } from '../../platform';

const demoProfile = { businessName: 'Shree Krishna Dairy', name: 'Aarav Patel', phone: '9876543210', upiId: 'krishna@okhdfcbank', code: 'GAU8K2P4' };
export default function DairyProfile() {
  const { user, demo } = useSelector(s => s.session), dispatch = useDispatch(), resource = useData('/profile', demoProfile);
  const platform = usePlatformSettings();
  const [confirm, setConfirm] = useState(false), [editing, setEditing] = useState(false), [error, setError] = useState(''), [editError, setEditError] = useState(''), [busy, setBusy] = useState(false);
  async function regenerate() { if (demo) { setError('Sign in to regenerate your dairy code.'); return; } setBusy(true); setError(''); try { const r = await api.post('/profile/code'); dispatch(updateUser({ code: r.data.data.code })); resource.reload(); setConfirm(false); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function saveProfile(e) {
    e.preventDefault();
    if (demo) { setEditError('Sign in to edit your dairy details. Demo data is read-only.'); return; }
    setBusy(true); setEditError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      const r = await api.patch('/profile', {
        businessName: f.businessName.trim(),
        name: f.name.trim(),
        phone: f.phone.trim(),
        upiId: f.upiId.trim()
      });
      dispatch(updateUser({ name: r.data.data.name, businessName: r.data.data.businessName }));
      resource.reload();
      setEditing(false);
    } catch (err) {
      setEditError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return <><Heading title="Your dairy profile" description="The identity behind every fresh delivery."/><State resource={resource}>{resource.data && <section className="card profile-card"><Brand/><dl><dt>Business name</dt><dd>{resource.data.businessName}</dd><dt>Owner</dt><dd>{resource.data.name || user.name}</dd><dt>Email</dt><dd>{user.email || 'Demo account'}</dd><dt>Phone</dt><dd>{resource.data.phone || 'Not provided'}</dd><dt>UPI ID</dt><dd>{resource.data.upiId ? <code>{resource.data.upiId}</code> : 'Not configured'}</dd><dt>Dairy code</dt><dd><code>{resource.data.code}</code></dd><dt>Subscription</dt><dd><div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}><span className="pill success" style={{ textTransform: 'capitalize', fontWeight: '600' }}>{resource.data.subscription?.tier || 'Free'} Plan</span><span className="pill" style={{ textTransform: 'capitalize' }}>{resource.data.subscription?.status || 'Active'}</span></div>{resource.data.subscription?.status === 'trial' && resource.data.subscription?.trialEndsAt && <small style={{ display: 'block', color: 'var(--muted-foreground)', marginTop: '4px' }}>14-day free trial active until {new Date(resource.data.subscription.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small>}</dd><dt>Language</dt><dd><LanguageSelect /></dd>{(platform?.support?.email || platform?.support?.phone) && <><dt>Platform support</dt><dd>{[platform.support.email, platform.support.phone].filter(Boolean).join(' · ')}</dd></>}</dl><Notice>Share this code with your customers. They can choose “I’m a customer — join my dairy” on the sign-in page, verify their email, and connect their account.</Notice><p className="form-note">To help a customer claim existing history, add their email to their customer profile first. They must verify that same email before history is offered.</p><div className="heading-actions" style={{ marginTop: '20px', flexWrap: 'wrap', gap: '10px' }}><button className="button primary" onClick={() => { setEditError(''); setEditing(true); }}>Edit dairy details</button><button className="button" onClick={() => { setError(''); setConfirm(true); }}>Regenerate dairy code</button></div></section>}</State>{confirm && <Modal title="Replace your dairy code?" close={() => setConfirm(false)}><p className="form-note">The old code will stop accepting new connections immediately. Customers already linked to your dairy will keep their accounts and history. Pending registrations using the old code must restart.</p><Notice error>{error}</Notice><button className="button primary full" disabled={busy} onClick={regenerate}>{busy ? 'Replacing…' : 'Confirm new code'}</button></Modal>}{editing && resource.data && <Modal title="Edit dairy details" close={() => setEditing(false)}><form onSubmit={saveProfile}><Field label="Business name" name="businessName" defaultValue={resource.data.businessName} minLength={2} maxLength={120} required /><Field label="Owner name" name="name" defaultValue={resource.data.name || user.name} minLength={2} maxLength={100} required /><Field label="Phone number" name="phone" type="tel" defaultValue={resource.data.phone || ''} required /><Field label="UPI ID (for payments)" name="upiId" placeholder="e.g. yourname@bank" defaultValue={resource.data.upiId || ''} /><Notice error>{editError}</Notice><button className="button primary full" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></form></Modal>}</>;
}


