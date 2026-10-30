import { useState } from 'react';
import { Send } from 'lucide-react';
import { message } from '../lib';
import { fallbackNotice, shareReportFile, sharedNotice } from '../share';

/**
 * "Share on WhatsApp" for a report the caller already knows how to fetch.
 *
 * `fetchReport` reuses each view's existing download code, so sharing pulls the
 * same authenticated blob with the same permissions as its download button —
 * nothing new is exposed and no second report path is written.
 */
export default function ShareReportButton({
  fetchReport,
  shareText,
  label = 'Share on WhatsApp',
  busyLabel = 'Preparing…',
  className = 'button primary',
  iconSize = 17,
  style,
  disabled = false,
  title,
  onNotice,
  onError,
  formatError = message
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const { blob, filename } = await fetchReport();
      const outcome = await shareReportFile({ blob, filename, text: shareText || filename });
      if (outcome.status === 'shared') {
        onNotice?.(sharedNotice());
      } else if (outcome.status === 'fallback') {
        onNotice?.(fallbackNotice(outcome.filename, outcome.blocked));
      }
      // 'cancelled' is the user declining the sheet: say nothing.
    } catch (err) {
      onError?.(await Promise.resolve(formatError(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={busy || disabled}
      onClick={handle}
      title={title || label}
      aria-label={label}
    >
      <Send size={iconSize}/>{busy ? busyLabel : label}
    </button>
  );
}
