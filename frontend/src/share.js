// Free WhatsApp report sharing.
//
// The OS share sheet hands the report bytes straight to WhatsApp, so the file
// is attached by the person choosing the recipient — no paid API, no backend
// hop, no linked WhatsApp session, no message text carrying report data. The
// fallback exists only for browsers that cannot share files, and it is honest
// about wa.me's limits: it can open WhatsApp with a prepared line of text, it
// cannot attach a file for you.

// Shared report files keep their original extension and MIME type so WhatsApp
// recognises the document instead of treating it as a nameless blob. The blob
// already carries a type from the backend's Content-Type; this only fills the
// gap where a response arrived untyped.
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

export function extensionOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

export function toFile(blob, filename) {
  const type = blob.type || MIME_BY_EXT[extensionOf(filename)] || 'application/octet-stream';
  return new File([blob], filename, { type, lastModified: Date.now() });
}

// Some browsers ship navigator.share for text only. Asking canShare() first
// keeps us from opening a sheet that then rejects the attachment, and from
// falling into a share() rejection that looks like a user cancellation.
export function canShareFiles(file) {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return Boolean(navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

// The user dismissing the share sheet is a decision, not a failure: no
// fallback, no error, no retry prompt.
function isUserCancel(error) {
  return error?.name === 'AbortError';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously after click aborts the download in Firefox; give
  // the browser a moment to claim the bytes first.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// No phone number is pinned in: wa.me/?text= asks WhatsApp which chat to use,
// so the person tapping decides who receives the report.
export function waMeUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Shares a report file, preferring the native share sheet.
 *
 * @returns {{status: 'shared'|'cancelled'|'fallback', filename?: string, url?: string}}
 *   'shared'   – the OS sheet opened and completed; the user chose the target.
 *   'cancelled'– the user dismissed the sheet; nothing else happens.
 *   'fallback' – the file was downloaded and WhatsApp opened with a prepared
 *                line of text; the user must attach the file by hand.
 */
export async function shareReportFile({ blob, filename, text }) {
  const file = toFile(blob, filename);

  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: filename, ...(text ? { text } : {}) });
      return { status: 'shared', filename };
    } catch (error) {
      if (isUserCancel(error)) return { status: 'cancelled', filename };
      // Anything else (NotAllowedError, a file the app refuses, an unhandled
      // failure) means nothing left the device, so the fallback still applies.
    }
  }

  downloadBlob(blob, filename);
  const url = waMeUrl(text || filename);
  // window.open(..., 'noopener') reports null even when it succeeded, so open
  // plainly and sever the opener by hand — that keeps blocked popups
  // distinguishable from working ones.
  const win = typeof window === 'undefined' ? null : window.open(url, '_blank');
  if (win) { try { win.opener = null; } catch { /* cross-origin, already isolated */ } }
  return { status: 'fallback', filename, url, blocked: !win };
}

// Copy handed to <Notice> after the fallback, and deliberately explicit about
// what wa.me did not do.
export function fallbackNotice(filename, blocked = false) {
  const saved = `${filename} was saved to your downloads.`;
  const manual = 'Attach that file to your message there — wa.me opens WhatsApp with text only and cannot attach a file for you.';
  if (blocked) return `${saved} Your browser blocked WhatsApp from opening automatically, so open WhatsApp yourself and attach ${filename} to your message. wa.me cannot attach a file for you.`;
  return `${saved} WhatsApp was opened. ${manual}`;
}

export function sharedNotice() {
  return 'Choose WhatsApp, then pick who receives the report.';
}
