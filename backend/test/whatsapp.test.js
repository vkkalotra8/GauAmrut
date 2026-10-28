// The pairing code is the one thing an admin actually acts on, and WhatsApp
// rejects a stale or already-consumed code with "Couldn't link device" — which
// is exactly what the admin console was reporting. These tests pin the rules
// that keep the code on screen scannable: it comes from the socket that issued
// it, and one that has outlived its validity is replaced rather than served
// again.
jest.mock('@whiskeysockets/baileys', () => {
  const sockets = [];
  const DisconnectReason = { loggedOut: 401, connectionClosed: 406, timedOut: 408 };
  function makeWASocket() {
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
      sendMessage: jest.fn(async () => ({}))
    };
    sockets.push(socket);
    // Baileys hands the app a pairing code as soon as the socket is up.
    Promise.resolve().then(() => socket.ev.emit('connection.update', { qr: `QR${sockets.length}` }));
    return socket;
  }
  return {
    __esModule: true,
    default: makeWASocket,
    makeWASocket,
    sockets,
    DisconnectReason,
    useMultiFileAuthState: jest.fn(async () => ({ state: { creds: {}, keys: {} }, saveCreds: jest.fn() })),
    makeCacheableSignalKeyStore: jest.fn(keys => keys),
    jidNormalizedUser: jest.fn(jid => jid.split('@')[0]),
    fetchLatestBaileysVersion: jest.fn(async () => ({ version: [2, 3000, 1041] }))
  };
});
jest.mock('qrcode', () => ({ toDataURL: jest.fn(async value => `data:image/png;base64,${value}`) }));
jest.mock('pino', () => jest.fn(() => ({ level: 'silent' })));

describe('WhatsApp pairing code', () => {
  let baileys, whatsapp;

  beforeEach(() => {
    jest.resetModules();
    baileys = require('@whiskeysockets/baileys');
    whatsapp = require('../src/whatsapp');
  });

  test('serves the code the socket just issued', async () => {
    const qr = await whatsapp.getQr();
    expect(qr).toBe('data:image/png;base64,QR1');
    expect(await whatsapp.status()).toEqual({ connected: false, phone: null, qr });
    expect(baileys.sockets).toHaveLength(1);
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
      expect(await whatsapp.status()).toEqual({ connected: false, phone: null, qr: second });

      // A code that is still young is reused rather than churned.
      const third = await whatsapp.getQr();
      expect(third).toBe(second);
      expect(baileys.sockets).toHaveLength(2);
    } finally {
      shifted.mockRestore();
    }
  });

  test('reports no pairing code once the session is linked', async () => {
    await whatsapp.getQr();
    baileys.sockets[0].ev.emit('connection.update', { connection: 'open' });

    expect(await whatsapp.status()).toEqual({ connected: true, phone: '919876543210:1', qr: null });
    expect(await whatsapp.getQr()).toBeNull();
  });

  test('an unlinked session refuses to send, with a message worth showing', async () => {
    // The 503's wording is what tells an admin where to go; the API error
    // handler must pass it through instead of masking it as a generic 5xx.
    await expect(whatsapp.sendText('9876543210', 'hi')).rejects.toMatchObject({
      status: 503,
      code: 'WHATSAPP_UNAVAILABLE',
      message: expect.stringContaining('scan the QR code')
    });
  });
});
