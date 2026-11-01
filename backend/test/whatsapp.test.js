// The pairing code is the one thing an admin actually acts on, and WhatsApp
// rejects a stale or already-consumed code with "Couldn't link device" — which
// is exactly what the admin console was reporting. These tests pin the rules
// that keep the code on screen scannable: it comes from the socket that issued
// it, and one that has outlived its validity is replaced rather than served
// again.
jest.mock('@whiskeysockets/baileys', () => {
  const sockets = [];
  // Mirrors the real enum so close reasons resolve to the names WhatsApp uses.
  const DisconnectReason = { loggedOut: 401, forbidden: 403, timedOut: 408, connectionClosed: 428, restartRequired: 515 };
  const makeWASocket = jest.fn(() => {
    const handlers = {};
    const socket = {
      ev: {
        on: (event, fn) => { handlers[event] = (handlers[event] || []).concat(fn); },
        emit: (event, payload) => (handlers[event] || []).slice().forEach(fn => fn(payload)),
        removeAllListeners: event => { delete handlers[event]; }
      },
      user: { id: '919876543210:1@s.whatsapp.net' },
      // Baileys' end() closes the socket and announces it, so the real close
      // event has to be reproduced to prove superseded sockets stay ignored.
      end() {
        socket.ev.emit('connection.update', {
          connection: 'close',
          lastDisconnect: { error: Object.assign(new Error('ended'), { output: { statusCode: DisconnectReason.timedOut } }) }
        });
      },
      sendMessage: jest.fn(async () => ({})),
      requestPairingCode: jest.fn(async () => 'ABCDE123')
    };
    sockets.push(socket);
    // Baileys hands the app a pairing code as soon as the socket is up.
    Promise.resolve().then(() => socket.ev.emit('connection.update', { qr: `QR${sockets.length}` }));
    return socket;
  });
  return {
    __esModule: true,
    default: makeWASocket,
    makeWASocket,
    sockets,
    DisconnectReason,
    useMultiFileAuthState: jest.fn(async () => ({ state: { creds: {}, keys: {} }, saveCreds: jest.fn() })),
    makeCacheableSignalKeyStore: jest.fn(keys => keys),
    jidNormalizedUser: jest.fn(jid => jid.split('@')[0]),
    // The live revision is what the real web client is running; the pinned one
    // is only a fallback when whatsapp.com is unreachable.
    fetchLatestWaWebVersion: jest.fn(async () => ({ version: [2, 3000, 1052319678], isLatest: true })),
    fetchLatestBaileysVersion: jest.fn(async () => ({ version: [2, 3000, 1043857760], isLatest: false }))
  };
});
jest.mock('qrcode', () => ({ toDataURL: jest.fn(async value => `data:image/png;base64,${value}`) }));
jest.mock('pino', () => jest.fn(() => ({ level: 'silent' })));
// clearAuth() wipes the real session directory; nothing here may touch it.
jest.mock('fs', () => ({ rmSync: jest.fn() }));

describe('WhatsApp device linking', () => {
  let baileys, whatsapp;

  beforeEach(() => {
    jest.resetModules();
    baileys = require('@whiskeysockets/baileys');
    whatsapp = require('../src/whatsapp');
  });

  test('serves the code the socket just issued', async () => {
    const qr = await whatsapp.getQr();
    expect(qr).toBe('data:image/png;base64,QR1');
    expect(await whatsapp.status()).toEqual({ connected: false, phone: null, qr, pairingCode: null, lastError: null });
    expect(baileys.sockets).toHaveLength(1);
  });

  test('speaks the revision of WhatsApp Web the real client is running', async () => {
    await whatsapp.getQr();
    // Not the revision Baileys pinned at release time — that drifts behind
    // within weeks and WhatsApp rejects stale clients at link registration.
    const [config] = baileys.makeWASocket.mock.calls[0];
    expect(config.version).toEqual([2, 3000, 1052319678]);
    expect(baileys.fetchLatestBaileysVersion).not.toHaveBeenCalled();
  });

  test('replaces a code past its validity instead of handing it back', async () => {
    const first = await whatsapp.getQr();
    expect(first).toBe('data:image/png;base64,QR1');

    const realNow = Date.now();
    const shifted = jest.spyOn(Date, 'now').mockImplementation(() => realNow + 60000);
    try {
      const second = await whatsapp.getQr();
      expect(second).toBe('data:image/png;base64,QR2');
      expect(second).not.toBe(first);
      expect(baileys.sockets).toHaveLength(2);
      expect(await whatsapp.status()).toEqual({ connected: false, phone: null, qr: second, pairingCode: null, lastError: null });

      // A code that is still young is reused rather than churned.
      const third = await whatsapp.getQr();
      expect(third).toBe(second);
      expect(baileys.sockets).toHaveLength(2);
    } finally {
      shifted.mockRestore();
    }
  });

  test('links by typed code too, asking WhatsApp only once', async () => {
    const code = await whatsapp.getPairingCode('+91 98765 43210');
    expect(code).toBe('ABCDE123');
    expect(baileys.sockets[0].requestPairingCode).toHaveBeenCalledWith('919876543210');
    expect((await whatsapp.status()).pairingCode).toBe('ABCDE123');

    // A second request on the same socket makes WhatsApp reject the link.
    expect(await whatsapp.getPairingCode('9876543210')).toBe('ABCDE123');
    expect(baileys.sockets[0].requestPairingCode).toHaveBeenCalledTimes(1);
  });

  test('reports why WhatsApp closed a link attempt', async () => {
    await whatsapp.getQr();
    baileys.sockets[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: Object.assign(new Error('link refused'), { output: { statusCode: 401 } }) }
    });

    const { lastError } = await whatsapp.status();
    expect(lastError).toMatchObject({ code: 401, name: 'loggedOut' });
    expect(lastError.hint).toMatch(/rejected the link/i);
  });

  test('reports no pairing code once the session is linked', async () => {
    await whatsapp.getQr();
    baileys.sockets[0].ev.emit('connection.update', { connection: 'open' });

    expect(await whatsapp.status()).toEqual({ connected: true, phone: '919876543210:1', qr: null, pairingCode: null, lastError: null });
    expect(await whatsapp.getQr()).toBeNull();
  });

  test('persists credentials, so a reconnect can resume the pairing', async () => {
    await whatsapp.getQr();
    const { saveCreds } = await baileys.useMultiFileAuthState.mock.results[0].value;
    expect(saveCreds).not.toHaveBeenCalled();

    // Baileys announces every credential change this way — including the
    // pairingCode and me that requestPairingCode() sets, and the registered
    // flag that pair-success sets. Baileys 6.7.x emits no 'creds.save', so a
    // handler on that event never fires and the session never reaches disk:
    // the next reconnect starts blank and the phone reports
    // "Couldn't link device" after its own 515 restart.
    baileys.sockets[0].ev.emit('creds.update', { pairingCode: 'ABCDE123', me: { id: '919876543210@s.whatsapp.net' } });
    expect(saveCreds).toHaveBeenCalledTimes(1);

    // A confirmed link is written immediately rather than waiting for a further
    // change that may never arrive.
    baileys.sockets[0].ev.emit('connection.update', { connection: 'open' });
    expect(saveCreds).toHaveBeenCalledTimes(2);
  });

  test('an unlinked session refuses to send, with a message worth showing', async () => {
    // The 503's wording is what tells an admin where to go; the API error
    // handler must pass it through instead of masking it as a generic 5xx.
    await expect(whatsapp.sendText('9876543210', 'hi')).rejects.toMatchObject({
      status: 503,
      code: 'WHATSAPP_UNAVAILABLE',
      message: expect.stringContaining('link the device')
    });
  });
});
