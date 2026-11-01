import { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { usePlatformSettings } from '../platform';

// Platform-wide announcement published by the super admin from the admin
// console settings. Dismissing hides it for the current visit only; a newer
// message (or a reload) brings it back.
export default function AnnouncementBanner() {
  const settings = usePlatformSettings();
  const [dismissed, setDismissed] = useState('');
  const announcement = settings?.announcement;
  if (!announcement?.enabled || !announcement.message) return null;
  if (dismissed === announcement.message) return null;
  return (
    <div className="announcement-banner" role="status">
      <Megaphone size={16} aria-hidden="true" />
      <span>{announcement.message}</span>
      <button type="button" className="icon-button" aria-label="Dismiss announcement" onClick={() => setDismissed(announcement.message)}>
        <X size={15} />
      </button>
    </div>
  );
}
