import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BarChart3, Cpu, Download, Hash, Leaf, LayoutDashboard, LogOut, Mail, Megaphone, Menu, MoreHorizontal, QrCode, Receipt, Scale, ScrollText, Send, Settings as SettingsIcon, ShieldCheck, ShoppingBag, Store, UserPlus, Users, Wallet, Wifi, WifiOff } from 'lucide-react';
import { Brand, Empty, Field, Heading, Modal, Notice, State } from '../../components/ui';
import useData from '../../hooks/useData';
import { api, message, serviceDate } from '../../lib';
import CommandPalette from '../../components/CommandPalette';
import LanguageSelect from '../../components/LanguageSelect';
import ThemeToggle from '../../components/ThemeToggle';
import AnnouncementBanner from '../../components/AnnouncementBanner';
import ShareToWhatsAppModal from '../../components/ShareToWhatsApp';
import { invalidatePlatformSettings } from '../../platform';

const sections = [
  { path: '/admin', name: 'Overview', short: 'Overview', icon: LayoutDashboard, permission: 'dashboard.read' },
  { path: '/admin/users', name: 'Users', short: 'Users', icon: Users, permission: 'users.read' },
  { path: '/admin/dairies', name: 'Dairies', short: 'Dairies', icon: Store, permission: 'dairies.read' },
  { path: '/admin/disputes', name: 'Disputes', short: 'Issues', icon: Scale, permission: 'disputes.read' },
  { path: '/admin/reports', name: 'Reports', short: 'Reports', icon: BarChart3, permission: 'reports.read' },
  { path: '/admin/settings', name: 'Settings', short: 'Settings', icon: SettingsIcon, permission: 'settings.read' },
  { path: '/admin/activity', name: 'Activity log', short: 'Activity', icon: ScrollText, permission: 'audit.read' }
];

const adminRoleLabels = {
  super_admin: 'Super admin',
  operations: 'Operations',
  finance: 'Finance',
  support: 'Support'
};
const roleLabel = role => adminRoleLabels[role] || 'Admin';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(max-width: 720px)');
    const onChange = e => setIsMobile(e.matches);
    setIsMobile(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/* ---------------- Shared human-readable audit helpers ---------------- */

function ActorCell({ row }) {
  const actor = row.actor;
  if (!actor) {
    return <span className="activity-actor system"><Cpu size={15} aria-hidden="true" /> System</span>;
  }
  const displayName = actor.name || actor.email || 'Unknown user';
  return (
    <span className="activity-actor">
      <span className="avatar">{displayName[0]}</span>
      <span>
        <b>{displayName}</b>
        <span className={`role-chip ${actor.role}`}>{actor.role === 'admin' ? roleLabel(actor.adminRole) : actor.role === 'milkman' ? 'Dairy' : 'Customer'}</span>
      </span>
    </span>
  );
}

const settingSectionNames = { platform: 'announcements & support', billing: 'billing defaults', operations: 'sign-up' };

function describeAction(row) {
  const { action, after, target, targetLabel } = row || {};
  switch (action) {
    case 'admin.bootstrapped': return 'created the platform admin account';
    case 'admin.user.status.updated': return `set a user account to ${after?.active ? 'active' : 'inactive'}`;
    case 'admin.user.role.updated': return `changed ${targetLabel ? `“${targetLabel}”` : 'a user'}’s admin role to ${roleLabel(after?.adminRole)}`;
    case 'admin.dairy.verified.updated': return `${after?.verified ? 'verified' : 'unverified'} the dairy ${targetLabel ? `“${targetLabel}”` : 'in the directory'}`;
    case 'admin.dispute.updated': return `updated the dispute${targetLabel ? ` for “${targetLabel}”` : ''}`;
    case 'billing.scheduler.run': return `generated bills for ${after?.month || target}${after ? ` (${after.generated ?? 0} generated, ${after.updated ?? 0} updated, ${after.skipped ?? 0} skipped)` : ''}`;
    case 'customer.registered': return 'joined through a dairy sign-up link';
    case 'customer.history.claimed': return 'claimed their past bill history';
    case 'customer.created': return 'added a customer to their dairy';
    case 'customer.updated': return 'edited a customer’s details';
    case 'customer.status.updated': return 'changed a customer’s service status';
    case 'customer.routes.reordered': return 'reorganized a delivery route';
    case 'customer.profile.updated': return 'updated a customer profile';
    case 'milkman.profile.updated': return 'updated their dairy profile';
    case 'milkman.code.regenerated': return 'regenerated their dairy join code';
    case 'delivery.corrected': return 'corrected a milk delivery entry';
    case 'delivery.deleted': return 'deleted a milk delivery entry';
    case 'payment.reversed': return 'reversed a payment';
    case 'adjustment.reversed': return 'reversed an adjustment';
    case 'product.created': return 'added a store product';
    case 'product.updated': return 'updated a store product';
    case 'product.deleted': return 'removed a store product';
    case 'order.placed': return 'received a new store order';
    case 'dispute.created': return 'raised a dispute';
    case 'dispute.reply': return 'replied to a dispute';
    case 'POST /records/batch': return 'recorded a batch of milk deliveries';
    default: break;
  }
  if (typeof action === 'string' && action.startsWith('admin.setting.')) {
    const sectionId = action.slice('admin.setting.'.length).replace(/\.updated$/, '');
    return `updated the ${settingSectionNames[sectionId] || sectionId} settings`;
  }
  if (typeof action === 'string' && /^(GET|POST|PATCH|PUT|DELETE) \//.test(action)) {
    const [verb, path] = action.split(' ');
    return `${verb.toLowerCase()} ${path.replace(/^\//, '').replace(/\//g, ' ')}`;
  }
  return String(action || 'performed an action').replace(/[._/]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function TargetCell({ row }) {
  const { target, targetLabel, targetType, action } = row || {};
  if (targetLabel) return <span className="activity-target"><b>{targetLabel}</b>{targetType && <small>{targetType}</small>}</span>;
  if (typeof target === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(target)) return `Bills for ${target}`;
  if (typeof action === 'string' && action.startsWith('admin.setting.')) return `Settings · ${target}`;
  if (typeof target === 'string' && /^[0-9a-fA-F]{24}$/.test(target)) return `reference …${target.slice(-6)}`;
  return target ? String(target) : '—';
}

/* ---------------- Overview ---------------- */

function Overview() {
  const resource = useData('/admin/dashboard');
  return (
    <>
      <Heading eyebrow="PLATFORM ADMINISTRATION" title="Admin dashboard" description="System metrics, operational activity, and platform oversight." />
      <State resource={resource}>
        {resource.data && (
          <div className="stats-grid">
            {[
              ['Dairies', 'dairies'],
              ['Customers', 'customers'],
              ['User accounts', 'users'],
              ['Active accounts', 'activeUsers'],
              ['Recorded deliveries', 'deliveries'],
              ['Open disputes', 'openDisputes']
            ].map(([label, key]) => (
              <article className="stat-card" key={key}>
                <span>{label}</span>
                <strong>{resource.data[key] ?? 0}</strong>
              </article>
            ))}
          </div>
        )}
      </State>
    </>
  );
}

/* ---------------- User detail modal ---------------- */

function UserDetailModal({ user, close }) {
  const resource = useData(`/admin/users/${user._id}`);
  const [requestBusy, setRequestBusy] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  async function sendVerificationRequest(channel) {
    setRequestBusy(channel);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/admin/users/${user._id}/verification-request`, { channels: [channel] });
      const delivered = data.data?.delivered || [];
      const skipped = data.data?.skipped || [];
      // The backend reports why a channel was skipped; say it in words the
      // admin can act on rather than echoing the raw code.
      const reasons = {
        WHATSAPP_UNAVAILABLE: 'WhatsApp is not connected — link it under Settings → WhatsApp connection, then retry.',
        EMAIL_UNAVAILABLE: 'the email service is not configured, so the code could not be sent.',
        NO_ACCOUNT: 'this profile has no sign-in account.',
        NO_MOBILE: 'this profile has no mobile number on file.',
        NO_EMAIL: 'this profile has no email address on file.',
        SEND_FAILED: 'the code could not be delivered, please retry.'
      };
      const parts = [];
      if (delivered.length) parts.push(`Code sent for ${delivered.join(' and ')}.`);
      for (const s of skipped) {
        const reason = reasons[s.reason] || `${String(s.reason || 'SEND_FAILED').replaceAll('_', ' ').toLowerCase()}.`;
        parts.push(`${s.channel === 'phone' ? 'Mobile' : 'Email'}: ${reason}`);
      }
      setNotice(parts.join(' ') || 'Request processed.');
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setRequestBusy('');
    }
  }
  const detail = resource.data && typeof resource.data === 'object' && !Array.isArray(resource.data) ? resource.data : null;
  const profile = detail?.profile && typeof detail.profile === 'object' && !Array.isArray(detail.profile) ? detail.profile : null;
  const stats = detail?.stats && typeof detail.stats === 'object' && !Array.isArray(detail.stats) ? detail.stats : null;
  const statLabels = { customers: 'Customers', deliveries: 'Deliveries', disputes: 'Disputes' };
  const formatDate = value => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  return (
    <Modal title={`Account details: ${user.name || user.email}`} close={close}>
      <Notice>{notice}</Notice>
      <Notice error>{error}</Notice>
      {resource.loading ? (
        <p className="form-note">Loading account details…</p>
      ) : (
        <>
          <div className="detail-grid">
            <div><small>Name</small><b>{user.name || '—'}</b></div>
            <div><small>Email</small><b>{user.email}</b></div>
            <div><small>Role</small><b className="capitalize">{user.role}</b></div>
            {user.adminRole && <div><small>Admin role</small><b>{roleLabel(user.adminRole)}</b></div>}
            <div><small>Status</small><span className={`status ${user.active ? '' : 'neutral'}`}>{user.active ? 'Active' : 'Deactivated'}</span></div>
            <div><small>Joined</small><b>{formatDate(user.createdAt)}</b></div>
          </div>
          {profile && (
            <div className="detail-section">
              <h3>{user.role === 'milkman' ? 'Dairy business' : 'Customer service'}</h3>
              {user.role === 'milkman' ? (
                <div className="detail-grid">
                  <div><small>Business</small><b>{profile.businessName || '—'}</b></div>
                  <div><small>Owner</small><b>{profile.name || '—'}</b></div>
                  <div><small>Phone</small><b>{profile.phone || '—'}</b></div>
                  <div><small>Dairy code</small><b><code>{profile.code || '—'}</code></b></div>
                  <div><small>UPI ID</small><b>{profile.upiId || 'Not configured'}</b></div>
                  <div><small>Verification</small><span className={`status ${profile.verified ? '' : 'neutral'}`}>{profile.verified ? 'Verified' : 'Pending review'}</span></div>
                  {profile.subscription && (
                    <div><small>Subscription</small><b className="capitalize">{profile.subscription.plan || 'starter'} · {profile.subscription.status || 'trial'}</b></div>
                  )}
                </div>
              ) : (
                <>
                  <div className="detail-grid">
                    <div><small>Dairy</small><b>{profile.dairyName || '—'}</b></div>
                    <div><small>Phone</small><b>{profile.phone || '—'}</b></div>
                    <div><small>Address</small><b>{profile.address || '—'}</b></div>
                    <div><small>Service since</small><b>{formatDate(profile.startDate)}</b></div>
                    <div><small>Cow milk rate</small><b>{(profile.cowRatePaise ?? 0) / 100} ₹ / L</b></div>
                    <div><small>Buffalo milk rate</small><b>{(profile.buffaloRatePaise ?? 0) / 100} ₹ / L</b></div>
                    <div><small>Email status</small><span className={`status ${profile.emailVerified ? '' : 'neutral'}`}>{profile.emailVerified ? 'Verified' : 'Not verified'}</span></div>
                    <div><small>Mobile status</small><span className={`status ${profile.phoneVerified ? '' : 'neutral'}`}>{profile.phoneVerified ? 'Verified' : 'Not verified'}</span></div>
                  </div>
                  <div className="heading-actions" style={{ marginTop: '12px' }}>
                    <button type="button" className="button small" disabled={Boolean(requestBusy) || profile.emailVerified} onClick={() => sendVerificationRequest('email')}>
                      <Mail size={14}/> {requestBusy === 'email' ? 'Sending…' : profile.emailVerified ? 'Email verified' : 'Request email verification'}
                    </button>
                    <button type="button" className="button small" disabled={Boolean(requestBusy) || profile.phoneVerified || !profile.phone} title={profile.phone ? undefined : 'Add a mobile number to the customer first'} onClick={() => sendVerificationRequest('phone')}>
                      <Send size={14}/> {requestBusy === 'phone' ? 'Sending…' : profile.phoneVerified ? 'Mobile verified' : 'Request mobile verification'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {stats && Object.keys(statLabels).some(k => Number.isFinite(stats[k])) && (
            <div className="detail-stats">
              {Object.entries(statLabels).filter(([k]) => Number.isFinite(stats[k])).map(([k, label]) => (
                <span key={k}><small>{label}</small><b>{stats[k]}</b></span>
              ))}
            </div>
          )}
          {Array.isArray(detail?.recentActions) && detail.recentActions.length > 0 && (
            <div className="detail-section">
              <h3>Recent activity</h3>
              <ul className="detail-activity">
                {detail.recentActions.map(a => (
                  <li key={a._id}>
                    <span>{describeAction({ action: a.action, target: a.target })}</span>
                    <small>{new Date(a.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ---------------- Users ---------------- */

function UsersView({ canManage }) {
  const [page, setPage] = useState(1);
  const resource = useData(`/admin/users?page=${page}`);
  const [roleModalUser, setRoleModalUser] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function toggleActive(u) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/users/${u._id}/status`, { active: !u.active });
      setNotice(`User ${u.name} is now ${!u.active ? 'active' : 'inactive'}.`);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      await api.patch(`/admin/users/${roleModalUser._id}/role`, {
        role: 'admin',
        adminRole: f.adminRole
      });
      setNotice(`Admin role updated for ${roleModalUser.name}.`);
      setRoleModalUser(null);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading eyebrow="PLATFORM ADMINISTRATION" title="User directory" description="Manage accounts, user access, and admin permissions across the GauAmrut platform." />
      <Notice>{notice}</Notice>
      <Notice error>{error}</Notice>
      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Admin role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(u => (
                    <tr key={u._id}>
                      <td><b>{u.name}</b></td>
                      <td>{u.email}</td>
                      <td className="capitalize">{u.role}</td>
                      <td>
                        {u.adminRole ? (
                          <span className="pill info" style={{ fontWeight: '600' }}>
                            {u.adminRole}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={`status ${u.active ? '' : 'neutral'}`}>
                          {u.active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <button type="button" className="text-button" onClick={() => setViewing(u)}>
                            View
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                className="text-button"
                                style={{ color: u.active ? '#a94d34' : 'var(--green)' }}
                                disabled={busy}
                                onClick={() => toggleActive(u)}
                              >
                                {u.active ? 'Deactivate' : 'Activate'}
                              </button>
                              {u.role === 'admin' && (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => setRoleModalUser(u)}
                                >
                                  Edit role
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No users found.</Empty>
          )}
        </State>
        <div className="pagination">
          <small>{resource.meta?.total || 0} users · Page {page}</small>
          <button className="button" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button>
          <button className="button" disabled={page * 25 >= (resource.meta?.total || 0)} onClick={() => setPage(n => n + 1)}>Next</button>
        </div>
      </section>

      {viewing && <UserDetailModal user={viewing} close={() => setViewing(null)} />}

      {roleModalUser && (
        <Modal title={`Assign admin role: ${roleModalUser.name}`} close={() => setRoleModalUser(null)}>
          <form onSubmit={updateRole}>
            <p className="form-note">
              Email: <b>{roleModalUser.email}</b><br />
              Select the administrative permissions assigned to this account.
            </p>
            <label className="field">
              <span>Admin Role</span>
              <select name="adminRole" defaultValue={roleModalUser.adminRole || 'support'}>
                <option value="super_admin">Super Admin (All permissions)</option>
                <option value="operations">Operations (Users, dairies, disputes)</option>
                <option value="finance">Finance (Dashboard only)</option>
                <option value="support">Support (Read-only directory access)</option>
              </select>
            </label>
            <Notice error>{error}</Notice>
            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? 'Saving…' : 'Save admin role'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Dairies ---------------- */

function DairiesView({ canManage }) {
  const [page, setPage] = useState(1);
  const resource = useData(`/admin/dairies?page=${page}`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function toggleVerify(d) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/dairies/${d._id}/verify`, { verified: !d.verified });
      setNotice(`Dairy "${d.businessName}" is now ${!d.verified ? 'verified' : 'unverified'}.`);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const [exportBusy, setExportBusy] = useState(''), [shareDir, setShareDir] = useState(null);

  async function fetchDirectoryPdf() {
    const r = await api.get('/admin/dairies.pdf', { responseType: 'blob' });
    return { blob: r.data, filename: 'gauamrut-dairy-directory.pdf' };
  }

  async function downloadDirectoryPdf() {
    setExportBusy('download');
    setError('');
    try {
      const { blob, filename } = await fetchDirectoryPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(message(err));
    } finally {
      setExportBusy('');
    }
  }

  async function shareDirectoryPdf() {
    setExportBusy('share');
    setError('');
    try {
      const { blob, filename } = await fetchDirectoryPdf();
      setShareDir({ blob, filename });
    } catch (err) {
      setError(message(err));
    } finally {
      setExportBusy('');
    }
  }

  return (
    <>
      <Heading eyebrow="PLATFORM ADMINISTRATION" title="Dairy directory" description="Review registered dairy businesses, verification status, and owner profiles.">
        <button type="button" className="button" disabled={Boolean(exportBusy)} onClick={downloadDirectoryPdf}>
          Download PDF
        </button>
        <button type="button" className="button" disabled={Boolean(exportBusy)} onClick={shareDirectoryPdf}>
          <Send size={16}/> {exportBusy === 'share' ? 'Preparing PDF…' : 'Share to WhatsApp'}
        </button>
      </Heading>
      <Notice>{notice}</Notice>
      <Notice error>{error}</Notice>
      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Owner</th>
                    <th>Phone</th>
                    <th>Dairy code</th>
                    <th>Verified</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(d => (
                    <tr key={d._id}>
                      <td><b>{d.businessName}</b></td>
                      <td>{d.name}</td>
                      <td>{d.phone || '—'}</td>
                      <td><code>{d.code}</code></td>
                      <td>
                        <span className={`status ${d.verified ? '' : 'neutral'}`}>
                          {d.verified ? 'Verified' : 'Pending review'}
                        </span>
                      </td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            style={{ color: d.verified ? '#a94d34' : 'var(--green)' }}
                            disabled={busy}
                            onClick={() => toggleVerify(d)}
                          >
                            {d.verified ? 'Revoke verification' : 'Verify dairy'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No dairies found.</Empty>
          )}
        </State>
        <div className="pagination">
          <small>{resource.meta?.total || 0} dairies · Page {page}</small>
          <button className="button" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button>
          <button className="button" disabled={page * 25 >= (resource.meta?.total || 0)} onClick={() => setPage(n => n + 1)}>Next</button>
        </div>
      </section>
      {shareDir && (
        <ShareToWhatsAppModal
          fileName={shareDir.filename}
          blob={shareDir.blob}
          caption="GauAmrut dairy directory"
          close={() => setShareDir(null)}
          onSent={() => setNotice('Dairy directory PDF sent to WhatsApp.')}
        />
      )}
    </>
  );
}

/* ---------------- Disputes ---------------- */

function DisputesView({ canManage }) {
  const [page, setPage] = useState(1);
  const resource = useData(`/admin/disputes?page=${page}`);
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function handleUpdateDispute(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      await api.patch(`/admin/disputes/${selectedDispute._id}`, {
        status: f.status,
        priority: f.priority,
        resolutionNotes: f.resolutionNotes || ''
      });
      setNotice('Dispute updated successfully.');
      setSelectedDispute(null);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading eyebrow="PLATFORM ADMINISTRATION" title="Platform disputes" description="Cross-tenant dispute mediation and resolution oversight." />
      <Notice>{notice}</Notice>
      <Notice error>{error}</Notice>
      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Customer</th>
                    <th>Dairy</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Created</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(disp => (
                    <tr key={disp._id}>
                      <td><b>{disp.title || disp.subject || 'Dispute'}</b></td>
                      <td>{disp.customerName || 'Customer'}</td>
                      <td>{disp.dairyName || 'Dairy'}</td>
                      <td>
                        <span className="pill" style={{ textTransform: 'capitalize', fontWeight: '600' }}>
                          {disp.priority || 'medium'}
                        </span>
                      </td>
                      <td>
                        <span className={`status ${disp.status === 'resolved' ? '' : disp.status === 'cancelled' ? 'neutral' : ''}`}>
                          {String(disp.status || 'open').replace('_', ' ')}
                        </span>
                      </td>
                      <td>{new Date(disp.createdAt).toLocaleDateString('en-IN')}</td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setSelectedDispute(disp)}
                          >
                            Manage dispute
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No disputes reported across the platform.</Empty>
          )}
        </State>
        <div className="pagination">
          <small>{resource.meta?.total || 0} disputes · Page {page}</small>
          <button className="button" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button>
          <button className="button" disabled={page * 25 >= (resource.meta?.total || 0)} onClick={() => setPage(n => n + 1)}>Next</button>
        </div>
      </section>

      {selectedDispute && (
        <Modal title={`Manage Dispute: ${selectedDispute.title || selectedDispute.subject || 'Dispute'}`} close={() => setSelectedDispute(null)}>
          <form onSubmit={handleUpdateDispute}>
            <p className="form-note">
              Description: <b>{selectedDispute.description}</b>
            </p>
            <div className="form-grid">
              <label className="field">
                <span>Priority</span>
                <select name="priority" defaultValue={selectedDispute.priority || 'medium'}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="field">
                <span>Status</span>
                <select name="status" defaultValue={selectedDispute.status || 'open'}>
                  <option value="open">Open</option>
                  <option value="under_review">Under review</option>
                  <option value="resolved">Resolved</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
            <Field
              label="Resolution notes"
              name="resolutionNotes"
              defaultValue={selectedDispute.resolutionNotes || ''}
              placeholder="Summary explaining the resolution…"
            />
            <Notice error>{error}</Notice>
            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? 'Saving…' : 'Update dispute'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ---------------- Settings ---------------- */

const settingsSections = [
  {
    id: 'platform',
    icon: Megaphone,
    title: 'Announcements & support',
    description: 'The banner at the top of every signed-in dairy and customer app, plus the support contacts shown on profile pages.',
    fields: [
      { key: 'announcementEnabled', label: 'Show the announcement banner to everyone', type: 'toggle' },
      { key: 'announcementMessage', label: 'Announcement message', type: 'textarea', placeholder: 'e.g. Diwali schedule: morning deliveries only, 24–26 October.' },
      { key: 'supportEmail', label: 'Support email', type: 'email', placeholder: 'help@gauamrut.example' },
      { key: 'supportPhone', label: 'Support phone', type: 'tel', placeholder: '+91 98765 43210' }
    ]
  },
  {
    id: 'billing',
    icon: Receipt,
    title: 'Billing defaults',
    description: 'Starting values used across the platform: new-customer forms open with these rates, and the invoice note appears under every bills table.',
    fields: [
      { key: 'cowRatePaise', label: 'Default cow milk rate (₹ / litre)', type: 'rupees' },
      { key: 'buffaloRatePaise', label: 'Default buffalo milk rate (₹ / litre)', type: 'rupees' },
      { key: 'invoiceFooter', label: 'Invoice footer note', type: 'text', placeholder: 'e.g. Payments due by the 10th of each month.' }
    ]
  },
  {
    id: 'operations',
    icon: UserPlus,
    title: 'Sign-ups',
    description: 'Controls whether new dairy owners can create accounts from the sign-in page. Customers joining with a dairy code are not affected.',
    fields: [
      { key: 'registrationOpen', label: 'Allow new dairy registrations', type: 'toggle' }
    ]
  }
];

const settingsDefaults = {
  platform: { announcementEnabled: false, announcementMessage: '', supportEmail: '', supportPhone: '' },
  billing: { cowRatePaise: 6000, buffaloRatePaise: 8000, invoiceFooter: '' },
  operations: { registrationOpen: true }
};

function SettingCard({ section, doc, canManage, onSaved }) {
  const draft = () => ({ ...settingsDefaults[section.id], ...(doc?.payload && typeof doc.payload === 'object' ? doc.payload : {}) });
  const [values, setValues] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValues({ ...settingsDefaults[section.id], ...(doc?.payload && typeof doc.payload === 'object' ? doc.payload : {}) }); }, [section.id, doc?.version, doc?.payload]);
  const setValue = (key, value) => setValues(v => ({ ...v, [key]: value }));
  const SectionIcon = section.icon;

  const renderField = field => {
    if (field.type === 'textarea') {
      return (
        <label className="field span-full" key={field.key}>
          <span>{field.label}</span>
          <textarea rows={2} maxLength={300} placeholder={field.placeholder} value={values[field.key] || ''} disabled={!canManage} onChange={e => setValue(field.key, e.target.value)} />
        </label>
      );
    }
    if (field.type === 'rupees') {
      return (
        <label className="field" key={field.key}>
          <span>{field.label}</span>
          <input type="number" min="0" step="0.01" value={(values[field.key] ?? 0) / 100} disabled={!canManage} onChange={e => { const n = Number(e.target.value); setValue(field.key, Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0); }} />
        </label>
      );
    }
    return (
      <label className="field" key={field.key}>
        <span>{field.label}</span>
        <input type={field.type} maxLength={field.type === 'email' ? 254 : 200} placeholder={field.placeholder} value={values[field.key] || ''} disabled={!canManage} onChange={e => setValue(field.key, e.target.value)} />
      </label>
    );
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put(`/admin/settings/${section.id}`, { payload: { ...values } });
      await invalidatePlatformSettings();
      onSaved();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card setting-card">
      <div className="card-heading setting-heading">
        <span className="setting-icon"><SectionIcon size={18} aria-hidden="true" /></span>
        <div>
          <h2>{section.title}</h2>
          <p>{section.description}</p>
        </div>
        {doc?.updatedAt && (
          <span className="pill">
            Updated {new Date(doc.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{doc.updatedByName ? ` by ${doc.updatedByName}` : ''}
          </span>
        )}
      </div>
      <form onSubmit={save}>
        {section.fields.filter(f => f.type === 'toggle').map(field => (
          <label className="switch-field" key={field.key}>
            <input type="checkbox" checked={Boolean(values[field.key])} disabled={!canManage} onChange={e => setValue(field.key, e.target.checked)} />
            <span>{field.label}</span>
          </label>
        ))}
        {section.fields.some(f => f.type !== 'toggle') && (
          <div className="form-grid">
            {section.fields.filter(f => f.type !== 'toggle').map(renderField)}
          </div>
        )}
        <div className="setting-actions">
          <Notice error>{error}</Notice>
          {canManage ? (
            <button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          ) : (
            <p className="form-note">You can review these settings, but changing them requires the settings manager permission.</p>
          )}
        </div>
      </form>
    </section>
  );
}

function WhatsAppCard({ canManage }) {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [qr, setQr] = useState('');
  const [method, setMethod] = useState('qr'), [pairNumber, setPairNumber] = useState(''), [pairingCode, setPairingCode] = useState('');
  const qrRef = useRef('');
  const watchRef = useRef(null);
  useEffect(() => { qrRef.current = qr; }, [qr]);

  async function loadStatus() {
    try {
      const { data } = await api.get('/admin/whatsapp/status');
      setStatus(data.data);
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    loadStatus();
    return () => clearInterval(watchRef.current);
  }, []);

  // Baileys rotates the QR roughly every 20 seconds while nobody has scanned
  // it, and a code that has already expired is rejected by the phone with
  // "Couldn't link device". Keep the image in step with the server so the code
  // on screen is always the one that is currently valid.
  function watchConnection() {
    clearInterval(watchRef.current);
    let withoutCode = 0;
    watchRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/admin/whatsapp/status');
        const next = data.data;
        setStatus(next);
        if (next.connected) { setQr(''); setPairingCode(''); clearInterval(watchRef.current); return; }
        setPairingCode(next.pairingCode || '');
        if (next.qr) {
          withoutCode = 0;
          if (next.qr !== qrRef.current) setQr(next.qr);
        } else if (++withoutCode >= 3) {
          // The socket dropped and has not issued a replacement yet; drop the
          // dead image so the button offers to show a new one.
          setQr('');
        }
      } catch {
        clearInterval(watchRef.current);
      }
    }, 1000);
  }

  async function showQr() {
    setBusy('qr');
    setError('');
    try {
      const { data } = await api.post('/admin/whatsapp/qr');
      setQr(data.data.qr);
      watchConnection();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  }

  // The same link without a camera. WhatsApp offers "Link with phone number
  // instead" on the Linked devices screen; some accounts pair more reliably
  // this way than by scanning a screen.
  async function requestCode(e) {
    e.preventDefault();
    setBusy('pair');
    setError('');
    try {
      const { data } = await api.post('/admin/whatsapp/pairing-code', { number: pairNumber });
      setPairingCode(data.data.code);
      watchConnection();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError('');
    clearInterval(watchRef.current);
    try {
      await api.post('/admin/whatsapp/disconnect');
      setQr('');
      setPairingCode('');
      await loadStatus();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  }

  const lastError = status?.lastError;

  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h2>WhatsApp connection</h2>
          <p className="form-note">Link a WhatsApp account once and verification codes and PDF documents go to customer numbers at no cost. Either scan a code from the phone, or have the phone type in a code — both live under WhatsApp → Linked devices → Link a device.</p>
        </div>
      </div>
      <Notice error>{error}</Notice>
      {status ? (
        <div className="detail-grid" style={{ marginBottom: qr || pairingCode ? '12px' : 0 }}>
          <div><small>Status</small><span className={`status ${status.connected ? '' : 'neutral'}`}>{status.connected ? 'Connected' : 'Not connected'}</span></div>
          {status.connected && status.phone && <div><small>Linked number</small><b>+{status.phone}</b></div>}
        </div>
      ) : (
        <p className="form-note">Loading connection status…</p>
      )}
      {!status?.connected && lastError && (
        <Notice>
          Last attempt was closed by WhatsApp ({lastError.name}{lastError.code ? ` ${lastError.code}` : ''}). {lastError.hint}
        </Notice>
      )}
      {qr && (
        <div style={{ textAlign: 'center' }}>
          <img src={qr} alt="WhatsApp linking QR code" style={{ width: 240, height: 240, borderRadius: 12, border: '1px solid var(--border, #e3ebe4)' }}/>
          <p className="form-note">Waiting for the phone to scan this code… It refreshes automatically, so scan it as soon as it appears.</p>
        </div>
      )}
      {pairingCode && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.18em', fontFamily: 'var(--font-mono, monospace)', margin: '4px 0' }}>
            {pairingCode.slice(0, 4)}-{pairingCode.slice(4)}
          </p>
          <p className="form-note">On the phone: WhatsApp → Linked devices → Link a device → <b>Link with phone number instead</b>, then enter this code.</p>
        </div>
      )}
      {canManage && !status?.connected && (
        <form className="heading-actions" style={{ flexWrap: 'wrap' }} onSubmit={method === 'code' ? requestCode : e => { e.preventDefault(); showQr(); }}>
          <button type="button" className={`button ${method === 'qr' ? '' : 'ghost'}`} onClick={() => setMethod('qr')}>
            <QrCode size={16}/> Scan a code
          </button>
          <button type="button" className={`button ${method === 'code' ? '' : 'ghost'}`} onClick={() => setMethod('code')}>
            <Hash size={16}/> Type a code
          </button>
          {method === 'qr' ? (
            <button type="submit" className="button primary" disabled={Boolean(busy)}>
              <QrCode size={16}/> {busy === 'qr' ? 'Preparing code…' : qr ? 'Refresh QR code' : 'Show QR code'}
            </button>
          ) : (
            <>
              <input type="tel" name="number" placeholder="+91 98765 43210" value={pairNumber} onChange={e => setPairNumber(e.target.value)} required style={{ maxWidth: 190 }} />
              <button type="submit" className="button primary" disabled={Boolean(busy) || !pairNumber.trim()}>
                {busy === 'pair' ? 'Requesting…' : pairingCode ? 'Get a new code' : 'Get code'}
              </button>
            </>
          )}
        </form>
      )}
      {canManage && status?.connected && (
        <div className="heading-actions">
          <button type="button" className="button" disabled={Boolean(busy)} onClick={disconnect}>
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      )}
    </section>
  );
}

function ReportsView() {
  const [month, setMonth] = useState(serviceDate().slice(0, 7));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Platform-wide exports spanning every dairy. Deliveries, payments, bills and
  // orders are month-scoped; the customer directory is all-time with till-date
  // balances, mirroring the dairy-facing reports but across all tenants.
  // The same lucide glyphs the dairy-facing reports use, so the platform cards
  // read as one family rather than a row of emoji.
  const reports = useMemo(() => [
    { id: 'deliveries', label: 'Deliveries', description: 'Every milk delivery across all dairies for the month, with dairy, customer, quantity, rate and charge.', monthScoped: true, icon: BarChart3 },
    { id: 'payments', label: 'Payments', description: 'All customer payments recorded across all dairies for the month, with mode, reference and amount.', monthScoped: true, icon: Wallet },
    { id: 'bills', label: 'Bills', description: 'Monthly bills raised across all dairies, with opening, charges, paid and closing balances.', monthScoped: true, icon: Receipt },
    { id: 'orders', label: 'Store orders', description: 'Product orders placed across all dairies for the month, with items, status and order value.', monthScoped: true, icon: ShoppingBag },
    { id: 'customers', label: 'Customer directory', description: 'Every registered customer across all dairies, with rates and till-date outstanding balances.', monthScoped: false, icon: Users }
  ], []);

  function endpointFor(report, format) {
    return `/admin/reports/${report.id}.${format}${report.monthScoped ? `?month=${month}` : ''}`;
  }

  async function downloadBlob(endpoint, filename) {
    const r = await api.get(endpoint, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload(report, format) {
    setBusy(`${report.id}-${format}`);
    setError('');
    try {
      const name = report.monthScoped ? `gauamrut-${report.id}-${month}.${format}` : `gauamrut-${report.id}.${format}`;
      await downloadBlob(endpointFor(report, format), name);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <Heading
        eyebrow="PLATFORM REPORTS"
        title="Reports"
        description="Download platform-wide reports spanning every dairy. Month-scoped reports reflect the selected reporting month; the customer directory is all-time with till-date balances."
      />

      <Notice error>{error}</Notice>

      <section className="card" style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
          <Field label="Reporting month" type="month" value={month} max={serviceDate().slice(0, 7)} onChange={e => setMonth(e.target.value)} />
          <p style={{ color: 'var(--muted)', fontSize: '13px', maxWidth: '420px', margin: 0 }}>
            Applies to deliveries, payments, bills and store orders. The customer directory always covers all registered customers.
          </p>
        </div>
      </section>

      <div className="reports-grid">
        {reports.map(report => {
          const Icon = report.icon;
          return (
            <section key={report.id} className="card report-card">
              <span className="report-icon"><Icon size={32}/></span>
              <h2>{report.label}</h2>
              <p>{report.description}</p>
              {report.monthScoped && (
                <div className="report-note"><small>Reporting month: {month}</small></div>
              )}
              <div className="heading-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={Boolean(busy) || (report.monthScoped && !month)}
                  onClick={() => handleDownload(report, 'csv')}
                >
                  <Download size={17} />{busy === `${report.id}-csv` ? 'Preparing…' : 'Download CSV'}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={Boolean(busy) || (report.monthScoped && !month)}
                  onClick={() => handleDownload(report, 'pdf')}
                >
                  <Download size={17} />{busy === `${report.id}-pdf` ? 'Preparing…' : 'Download PDF'}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function SettingsView({ canManage }) {
  const resource = useData('/admin/settings');
  const [notice, setNotice] = useState('');
  const docs = Array.isArray(resource.data) ? resource.data : [];
  const bySection = new Map(docs.map(d => [d.section, d]));
  const extras = docs.filter(d => !settingsSections.some(s => s.id === d.section));
  return (
    <>
      <Heading eyebrow="PLATFORM ADMINISTRATION" title="Platform settings" description="These values apply to every dairy and customer on GauAmrut the moment you save them." />
      <Notice>{notice}</Notice>
      <State resource={resource}>
        <>
          <div className="settings-grid">
            {settingsSections.map(section => (
              <SettingCard
                key={section.id}
                section={section}
                doc={bySection.get(section.id)}
                canManage={canManage}
                onSaved={() => { setNotice('Saved. Every signed-in user sees this change right away.'); resource.reload(); }}
              />
            ))}
          </div>
          {extras.length > 0 && (
            <section className="card">
              <div className="card-heading"><h2>Other stored sections</h2></div>
              {extras.map(s => (
                <p className="form-note" key={s.section || s._id}>
                  <code>{s.section}</code> · version {s.version || 1} · {JSON.stringify(s.payload)}
                </p>
              ))}
            </section>
          )}
        </>
      </State>
      <WhatsAppCard canManage={canManage}/>
    </>
  );
}

/* ---------------- Activity log ---------------- */

function ActivityView() {
  const [page, setPage] = useState(1);
  const resource = useData(`/admin/activity?page=${page}`);
  return (
    <>
      <Heading eyebrow="PLATFORM ADMINISTRATION" title="Activity log" description="Every platform action in plain language — who did it, what changed, and when." />
      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>What happened</th>
                    <th>Target</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(row => (
                    <tr key={row._id}>
                      <td><ActorCell row={row} /></td>
                      <td><b>{describeAction(row)}</b></td>
                      <td><TargetCell row={row} /></td>
                      <td>{new Date(row.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No activity recorded yet.</Empty>
          )}
        </State>
        <div className="pagination">
          <small>{resource.meta?.total || 0} records · Page {page}</small>
          <button className="button" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Previous</button>
          <button className="button" disabled={page * 25 >= (resource.meta?.total || 0)} onClick={() => setPage(n => n + 1)}>Next</button>
        </div>
      </section>
    </>
  );
}

/* ---------------- Shell ---------------- */

export default function AdminPortal({ logout, error }) {
  const user = useSelector(s => s.session.user);
  const permissions = user.permissions || [];
  const allowed = sections.filter(s => permissions.includes(s.permission));
  const [mobile, setMobile] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  const isMobile = useIsMobile();

  useEffect(() => { setMobile(false); }, [location.pathname]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const canManageUsers = permissions.includes('users.manage');
  const canManageDairies = permissions.includes('dairies.manage');
  const canManageDisputes = permissions.includes('disputes.manage');
  const canManageSettings = permissions.includes('settings.manage');
  const navItems = allowed.map(s => ({ to: s.path, label: s.name, icon: s.icon }));
  const bottomNavigation = allowed.slice(0, 4);

  return (
    <div className="app-layout admin-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      {mobile && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <Brand />
        <div className="workspace-label">PLATFORM ADMINISTRATION</div>
        <nav aria-label="Main navigation">
          {allowed.map(s => (
            <NavLink key={s.path} to={s.path} end={s.path === '/admin'}>
              <s.icon size={19} />{s.name}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="care-card">
            <Leaf size={25} />
            <b>Keeping the platform healthy.</b>
            <p>Oversight for every dairy<br />and customer on GauAmrut.</p>
          </div>
          <button className="profile-user" aria-label="Sign out" onClick={logout}>
            <span className="avatar">{user.name?.[0] || 'A'}</span>
            <span><b>{user.name}</b><small>{roleLabel(user.adminRole)}</small></span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu /></button>
            <span className="business-icon"><ShieldCheck size={17} /></span>
            <b>GauAmrut administration</b>
            <span className="workspace-badge">Platform admin</span>
          </div>
          <div className="topbar-actions">
            <CommandPalette navItems={navItems} />
            <span className="topbar-separator" />
            <LanguageSelect />
            <span className="topbar-separator" />
            <ThemeToggle />
            <span className="topbar-separator" />
            <span className={`connection ${!online ? 'offline' : ''}`}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{online ? 'Online' : 'Offline'}</span></span>
            <span className="avatar" aria-hidden="true">{user.name?.[0] || 'A'}</span>
          </div>
        </header>
        <main id="main">
          <Notice error>{error}</Notice>
          <AnnouncementBanner />
          <Routes>
            <Route path="/admin" element={<Overview />} />
            <Route path="/admin/users" element={<UsersView canManage={canManageUsers} />} />
            <Route path="/admin/dairies" element={<DairiesView canManage={canManageDairies} />} />
            <Route path="/admin/disputes" element={<DisputesView canManage={canManageDisputes} />} />
            <Route path="/admin/reports" element={<ReportsView />} />
            <Route path="/admin/settings" element={<SettingsView canManage={canManageSettings} />} />
            <Route path="/admin/activity" element={<ActivityView />} />
            <Route path="*" element={allowed.length ? <Navigate to={allowed[0].path} replace /> : <Notice error>No admin permissions are assigned to this account.</Notice>} />
          </Routes>
        </main>
      </div>
      {isMobile && (
        <nav className="bottom-nav" aria-label="Quick navigation">
          {bottomNavigation.map(s => (
            <NavLink key={s.path} to={s.path} end={s.path === '/admin'}>
              <s.icon size={20} /><span>{s.short}</span>
            </NavLink>
          ))}
          <button onClick={() => setMobile(true)}><MoreHorizontal size={20} /><span>More</span></button>
        </nav>
      )}
    </div>
  );
}
