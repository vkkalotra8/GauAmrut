const { Notification } = require('./models');

async function createNotification({ recipient, role, tenant, type, title, message, link = '', relatedId = null }) {
  try {
    if (!recipient || !role || !title || !message) return null;
    const [notif] = await Notification.create([{
      recipient,
      role,
      tenant: tenant || null,
      type,
      title,
      message,
      link,
      relatedId,
      read: false
    }]);
    return notif.toObject();
  } catch (err) {
    // Non-blocking: ledger writes must never fail due to notification dispatch
    console.warn(JSON.stringify({ event: 'notification_failed', error: err.message, type }));
    return null;
  }
}

async function getNotifications(user, { page = 1, limit = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const filter = { recipient: user._id };

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, read: false })
  ]);

  return {
    notifications,
    meta: { total, unreadCount, page: p, limit: l }
  };
}

async function markRead(user, notificationId) {
  const notif = await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: user._id },
    { $set: { read: true } },
    { new: true }
  ).lean();
  return notif;
}

async function markAllRead(user) {
  const res = await Notification.updateMany(
    { recipient: user._id, read: false },
    { $set: { read: true } }
  );
  return { updated: res.modifiedCount };
}

module.exports = {
  createNotification,
  getNotifications,
  markRead,
  markAllRead
};
