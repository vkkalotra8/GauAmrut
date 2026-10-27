import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Bell, CheckCheck, Wallet, Droplets, ShoppingBag, MessageSquare, AlertCircle } from 'lucide-react';
import { api } from '../lib';

export default function NotificationsDrawer() {
  const session = useSelector(s => s.session);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const fetchNotifications = async () => {
    if (!session.user || session.demo) return;
    try {
      setLoading(true);
      const res = await api.get('/notifications');
      if (res.data?.data) {
        setNotifications(res.data.data);
      }
    } catch {
      // Non-blocking notification polling failure
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000); // Polling every 30s
    return () => clearInterval(interval);
  }, [session.user, session.demo]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = async (notification) => {
    if (!notification.read) {
      try {
        await api.patch(`/notifications/${notification._id}/read`);
        setNotifications(prev =>
          prev.map(n => n._id === notification._id ? { ...n, read: true } : n)
        );
      } catch {
        // Continue navigation even if status update fails
      }
    }
    if (notification.link) {
      setOpen(false);
      navigate(notification.link);
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      // Ignored
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'payment':
        return <Wallet size={16} className="notif-icon-payment" />;
      case 'delivery':
      case 'adjustment':
        return <Droplets size={16} className="notif-icon-delivery" />;
      case 'order':
        return <ShoppingBag size={16} className="notif-icon-order" />;
      case 'dispute':
        return <MessageSquare size={16} className="notif-icon-dispute" />;
      default:
        return <AlertCircle size={16} className="notif-icon-system" />;
    }
  };

  return (
    <div className="notifications-wrapper" ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="icon-button notification-bell-btn"
        aria-label="Notifications"
        onClick={() => {
          setOpen(prev => !prev);
          if (!open) fetchNotifications();
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notifications-popover" role="dialog" aria-label="Notifications Drawer">
          <div className="notifications-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <b>Notifications</b>
              {unreadCount > 0 && <span className="pill success">{unreadCount} new</span>}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={markAllRead}
                style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          <div className="notifications-list">
            {loading && !notifications.length ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                Loading notifications…
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                No notifications right now.
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n._id}
                  className={`notification-item ${!n.read ? 'unread' : ''}`}
                  onClick={() => markAsRead(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && markAsRead(n)}
                >
                  <div className="notification-icon-wrap">
                    {getIcon(n.type)}
                  </div>
                  <div className="notification-content">
                    <div className="notification-title-row">
                      <strong className="notification-title">{n.title}</strong>
                      {!n.read && <span className="unread-dot" />}
                    </div>
                    <p className="notification-msg">{n.message}</p>
                    <small className="notification-time">
                      {new Date(n.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
