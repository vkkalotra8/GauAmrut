import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Brand, Empty, Field, Heading, Modal, Notice, State } from '../../components/ui';
import useData from '../../hooks/useData';
import { api, message } from '../../lib';
import NotificationsDrawer from '../../components/NotificationsDrawer';

const sections = [
  { path: '/admin', name: 'Overview', permission: 'dashboard.read' },
  { path: '/admin/users', name: 'Users', permission: 'users.read' },
  { path: '/admin/dairies', name: 'Dairies', permission: 'dairies.read' },
  { path: '/admin/disputes', name: 'Disputes', permission: 'disputes.read' },
  { path: '/admin/settings', name: 'Settings', permission: 'settings.read' },
  { path: '/admin/activity', name: 'Activity log', permission: 'audit.read' }
];

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
              ['Recorded deliveries', 'deliveries']
            ].map(([label, key]) => (
              <article className="stat-card" key={key}>
                <span>{label}</span>
                <strong>{resource.data[key]}</strong>
              </article>
            ))}
          </div>
        )}
      </State>
    </>
  );
}

function UsersView({ canManage }) {
  const [page, setPage] = useState(1);
  const resource = useData(`/admin/users?page=${page}`);
  const [roleModalUser, setRoleModalUser] = useState(null);
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
        adminRole: f.adminRole || null
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
      <Heading title="User directory" description="Manage accounts, user access, and admin permissions across the GauAmrut platform." />
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
                    {canManage && <th>Actions</th>}
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
                          <span className="pill" style={{ background: '#eff6ff', color: '#1d4ed8', fontWeight: '600' }}>
                            {u.adminRole}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={`status ${u.active ? '' : 'neutral'}`}>
                          {u.active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      {canManage && (
                        <td>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                          </div>
                        </td>
                      )}
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

      {roleModalUser && (
        <Modal title={`Assign admin role: ${roleModalUser.name}`} close={() => setRoleModalUser(null)}>
          <form onSubmit={updateRole}>
            <p className="form-note">
              Email: <b>{roleModalUser.email}</b><br/>
              Select the administrative permissions assigned to this account.
            </p>
            <label className="field">
              <span>Admin Role</span>
              <select name="adminRole" defaultValue={roleModalUser.adminRole || ''}>
                <option value="">None (Standard Admin)</option>
                <option value="super_admin">Super Admin (All permissions)</option>
                <option value="support">Support (Users, dairies, disputes)</option>
                <option value="auditor">Auditor (Read-only)</option>
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

  return (
    <>
      <Heading title="Dairy directory" description="Review registered dairy businesses, verification status, and owner profiles." />
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
    </>
  );
}

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
        resolution: f.resolution || '',
        internalNotes: f.internalNotes || ''
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
      <Heading title="Platform disputes" description="Cross-tenant dispute mediation and resolution oversight." />
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
                      <td><b>{disp.subject}</b></td>
                      <td>{disp.customer_id?.slice(-6) || 'Customer'}</td>
                      <td>{disp.milkman_id?.slice(-6) || 'Dairy'}</td>
                      <td>
                        <span className="pill" style={{ textTransform: 'capitalize', fontWeight: '600' }}>
                          {disp.priority || 'medium'}
                        </span>
                      </td>
                      <td>
                        <span className={`status ${disp.status === 'resolved' ? '' : disp.status === 'rejected' ? 'neutral' : ''}`}>
                          {disp.status}
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
        <Modal title={`Manage Dispute: ${selectedDispute.subject}`} close={() => setSelectedDispute(null)}>
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
                  <option value="investigating">Investigating</option>
                  <option value="resolved">Resolved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
            </div>
            <Field
              label="Resolution summary"
              name="resolution"
              defaultValue={selectedDispute.resolution || ''}
              placeholder="Summary explaining the resolution..."
            />
            <Field
              label="Internal admin notes"
              name="internalNotes"
              defaultValue={selectedDispute.internalNotes || ''}
              placeholder="Internal notes visible only to admins..."
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

function SettingsView({ canManage }) {
  const resource = useData('/admin/settings');
  const [editingKey, setEditingKey] = useState(null);
  const [settingVal, setSettingVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function handleSaveSetting(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let parsed = settingVal;
      try {
        parsed = JSON.parse(settingVal);
      } catch {
        // Keep string if not valid JSON
      }
      await api.put(`/admin/settings/${editingKey}`, { value: parsed });
      setNotice(`Setting "${editingKey}" updated.`);
      setEditingKey(null);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading title="Platform settings" description="Global platform configurations and operational constants." />
      <Notice>{notice}</Notice>
      <Notice error>{error}</Notice>
      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Description</th>
                    <th>Last updated</th>
                    {canManage && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(s => (
                    <tr key={s._id || s.key}>
                      <td><code>{s.key}</code></td>
                      <td><b>{typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}</b></td>
                      <td>{s.description || '—'}</td>
                      <td>{new Date(s.updatedAt).toLocaleDateString('en-IN')}</td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setEditingKey(s.key);
                              setSettingVal(typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value));
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No settings configured.</Empty>
          )}
        </State>
      </section>

      {editingKey && (
        <Modal title={`Edit setting: ${editingKey}`} close={() => setEditingKey(null)}>
          <form onSubmit={handleSaveSetting}>
            <Field
              label="Value"
              value={settingVal}
              onChange={e => setSettingVal(e.target.value)}
              required
            />
            <Notice error>{error}</Notice>
            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? 'Saving…' : 'Save setting'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function ActivityView() {
  const [page, setPage] = useState(1);
  const resource = useData(`/admin/activity?page=${page}`);
  const columns = [['Action', 'action'], ['Actor ID', 'actor'], ['Target ID', 'target'], ['Timestamp', 'createdAt']];

  return (
    <>
      <Heading title="Activity log" description="Audit trails and security log entries." />
      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {columns.map(([label]) => <th key={label}>{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(row => (
                    <tr key={row._id}>
                      {columns.map(([, key]) => (
                        <td key={key}>{key === 'createdAt' ? new Date(row[key]).toLocaleString('en-IN') : (row[key] || '-')}</td>
                      ))}
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

export default function AdminPortal({ logout, error }) {
  const user = useSelector(s => s.session.user);
  const permissions = user.permissions || [];
  const allowed = sections.filter(s => permissions.includes(s.permission));

  const canManageUsers = permissions.includes('users.manage');
  const canManageDairies = permissions.includes('dairies.manage');
  const canManageDisputes = permissions.includes('disputes.manage');
  const canManageSettings = permissions.includes('settings.manage');

  return (
    <div className="admin-shell">
      <header className="topbar">
        <Brand />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <NotificationsDrawer />
          <span className="topbar-separator" />
          <span><b>{user.name}</b> <small style={{ color: 'var(--muted)' }}>({user.adminRole || 'Admin'})</small></span>
          <button className="button" onClick={logout}>Sign out</button>
        </div>
      </header>

      <nav className="admin-nav" aria-label="Admin navigation">
        {allowed.map(s => (
          <NavLink key={s.path} to={s.path} end={s.path === '/admin'} className="button">
            {s.name}
          </NavLink>
        ))}
      </nav>

      <main>
        <Notice error>{error}</Notice>
        <Routes>
          <Route path="/admin" element={<Overview />} />
          <Route path="/admin/users" element={<UsersView canManage={canManageUsers} />} />
          <Route path="/admin/dairies" element={<DairiesView canManage={canManageDairies} />} />
          <Route path="/admin/disputes" element={<DisputesView canManage={canManageDisputes} />} />
          <Route path="/admin/settings" element={<SettingsView canManage={canManageSettings} />} />
          <Route path="/admin/activity" element={<ActivityView />} />
          <Route path="*" element={allowed.length ? <Navigate to={allowed[0].path} replace /> : <Notice error>No admin permissions are assigned to this account.</Notice>} />
        </Routes>
      </main>
    </div>
  );
}
