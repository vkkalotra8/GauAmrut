import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { canShareFiles, extensionOf, fallbackNotice, sharedNotice, shareReportFile, toFile, waMeUrl } from './share';

// jsdom ships neither navigator.share nor URL.createObjectURL, so both are
// installed per test to model each browser we have to support.
function setNav(share, canShare) {
  Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(window.navigator, 'canShare', { configurable: true, value: canShare });
}

function clearNav() {
  delete window.navigator.share;
  delete window.navigator.canShare;
}

const pdf = (name = 'gauamrut-bill-2026-10.pdf', type = 'application/pdf') =>
  new Blob(['%PDF-1.4 report body'], { type });

let clickSpy;
let openSpy;

beforeEach(() => {
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  openSpy = vi.spyOn(window, 'open').mockReturnValue({ opener: window });
  vi.useFakeTimers();
});

afterEach(() => {
  clickSpy.mockRestore();
  openSpy.mockRestore();
  clearNav();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('native report sharing', () => {
  test('hands the real file to the share sheet on a supported browser', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNav(share, () => true);

    const outcome = await shareReportFile({ blob: pdf(), filename: 'gauamrut-bill-2026-10.pdf', text: 'October milk bill' });

    expect(outcome.status).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]).toBeInstanceOf(File);
    expect(payload.files[0].name).toBe('gauamrut-bill-2026-10.pdf');
    expect(payload.files[0].type).toBe('application/pdf');
    expect(payload.title).toBe('gauamrut-bill-2026-10.pdf');
    expect(payload.text).toBe('October milk bill');
    // The native path needs no download and no second tab.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  test.each([
    ['gauamrut-payments-2026-10.csv', 'text/csv'],
    ['gauamrut-bills-2026-10.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['gauamrut-deliveries-2026-10.pdf', 'application/pdf'],
    ['gauamrut-directory.png', 'image/png']
  ])('preserves %s with its own MIME type', async (filename, expectedType) => {
    // An untyped response still has to reach WhatsApp as a recognisable
    // document, so the extension is what identifies it.
    const blob = new Blob(['bytes'], { type: '' });
    setNav(vi.fn().mockResolvedValue(undefined), () => true);

    await shareReportFile({ blob, filename, text: filename });

    const [{ files: [file] }] = vi.mocked(window.navigator.share).mock.calls[0];
    expect(file.name).toBe(filename);
    expect(file.type).toBe(expectedType);
  });

  test('keeps the MIME type the backend already sent rather than guessing', async () => {
    setNav(vi.fn().mockResolvedValue(undefined), () => true);

    await shareReportFile({ blob: new Blob(['a,b'], { type: 'text/csv' }), filename: 'renamed.txt', text: 'x' });

    const [{ files: [file] }] = vi.mocked(window.navigator.share).mock.calls[0];
    expect(file.type).toBe('text/csv');
    expect(file.name).toBe('renamed.txt');
  });
});

describe('fallback when native file sharing is unavailable', () => {
  test('downloads once and opens wa.me when the browser has no navigator.share', async () => {
    clearNav();

    const outcome = await shareReportFile({ blob: pdf(), filename: 'gauamrut-bill-2026-10.pdf', text: 'October milk bill' });

    expect(outcome.status).toBe('fallback');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  test('falls back when navigator.share exists but cannot share files', async () => {
    const share = vi.fn();
    setNav(share, () => false);

    const outcome = await shareReportFile({ blob: pdf(), filename: 'r.pdf', text: 'x' });

    expect(outcome.status).toBe('fallback');
    // Asking canShare first means we never open a sheet that would reject.
    expect(share).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('falls back when canShare itself is missing', () => {
    setNav(vi.fn(), undefined);
    expect(canShareFiles(new File(['x'], 'r.pdf', { type: 'application/pdf' }))).toBe(false);
  });

  test('opens WhatsApp once and pins no recipient', async () => {
    clearNav();

    const { url } = await shareReportFile({ blob: pdf(), filename: 'r.pdf', text: 'October milk bill' });

    expect(url).toBe('https://wa.me/?text=October%20milk%20bill');
    expect(url).not.toMatch(/wa\.me\/\d/);
    expect(openSpy).toHaveBeenCalledTimes(1);
    // Exactly one tab: the download is a file, not a second window.
    expect(openSpy.mock.calls[0][1]).toBe('_blank');
  });

  test('releases the opened tab from the page that opened it', async () => {
    clearNav();
    const win = { opener: window };
    openSpy.mockReturnValue(win);

    await shareReportFile({ blob: pdf(), filename: 'r.pdf', text: 'x' });

    expect(win.opener).toBeNull();
  });
});

describe('cancellation and failures', () => {
  test('treats dismissing the share sheet as a decision, not a failure', async () => {
    const cancel = Object.assign(new Error('User cancelled'), { name: 'AbortError' });
    setNav(vi.fn().mockRejectedValue(cancel), () => true);

    const outcome = await shareReportFile({ blob: pdf(), filename: 'r.pdf', text: 'x' });

    expect(outcome.status).toBe('cancelled');
    // Declining must not silently download the file or open another tab.
    expect(clickSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  test('falls back when sharing fails for a reason other than cancellation', async () => {
    const denied = Object.assign(new Error('Share denied'), { name: 'NotAllowedError' });
    setNav(vi.fn().mockRejectedValue(denied), () => true);

    const outcome = await shareReportFile({ blob: pdf(), filename: 'r.pdf', text: 'x' });

    expect(outcome.status).toBe('fallback');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('flags a blocked popup so the caller can explain it', async () => {
    clearNav();
    openSpy.mockReturnValue(null);

    const outcome = await shareReportFile({ blob: pdf(), filename: 'r.pdf', text: 'x' });

    expect(outcome.blocked).toBe(true);
    expect(fallbackNotice(outcome.filename, true)).toMatch(/blocked/i);
  });
});

describe('the words shown after a fallback', () => {
  test('never claims wa.me attached the file', () => {
    const copy = fallbackNotice('gauamrut-bill-2026-10.pdf');
    expect(copy).toContain('gauamrut-bill-2026-10.pdf');
    expect(copy).toContain('saved to your downloads');
    expect(copy).toMatch(/cannot attach a file for you/i);
  });

  test('tells the native path how to choose a recipient', () => {
    expect(sharedNotice()).toMatch(/pick who receives/i);
  });
});

describe('helpers', () => {
  test('reads the extension including multi-dot names', () => {
    expect(extensionOf('gauamrut-bill.2026-10.pdf')).toBe('.pdf');
    expect(extensionOf('report')).toBe('');
  });

  test('wa.me encodes the message', () => {
    expect(waMeUrl('a & b')).toBe('https://wa.me/?text=a%20%26%20b');
  });

  test('toFile falls back to octet-stream for an unknown extension', () => {
    const file = toFile(new Blob(['x'], { type: '' }), 'notes.txt');
    expect(file.type).toBe('application/octet-stream');
  });
});
