const permissions = {
  super_admin: ['dashboard.read', 'users.read', 'users.manage', 'dairies.read', 'dairies.manage', 'audit.read', 'disputes.read', 'disputes.manage', 'settings.read', 'settings.manage', 'reports.read'],
  operations: ['dashboard.read', 'users.read', 'users.manage', 'dairies.read', 'dairies.manage', 'disputes.read', 'disputes.manage', 'reports.read'],
  finance: ['dashboard.read', 'reports.read'],
  support: ['users.read', 'dairies.read', 'disputes.read']
};
const permissionsFor = user => user.role === 'admin' ? permissions[user.adminRole] || [] : [];
module.exports = { permissionsFor };
