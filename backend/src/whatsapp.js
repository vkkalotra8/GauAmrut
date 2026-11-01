// One shared WhatsApp session for the deployment (linked once from the admin
// console by scanning a QR code or entering a pairing code). Once linked, OTPs
// and PDF documents are sent over the linked device session — WhatsApp messages
// cost nothing. The auth state persists in backend/.wa-auth so restarts stay
// logged in.
const fs = require('fs');
const path = require('path');
const { AppError } = require('./domain');

let sock = null;
let connecting = false;
let connected = false;
let qrDataUrl = null;
let qrGeneratedAt = null;
let pairingCode = null;
let pairingRequestedAt = 0;
let pairingSocket = null;
let waPhone = null;
let shuttingDown = false;
let lastError = null;
let reconnectTimer = null;
let versionCache = { at: 0, version: null, source: 'bundled' };

// WhatsApp only honours a pairing code for a short window (Baileys rotates the
// first one after 60s and every 20s after that). A code older than this is
// replaced rather than re-served — the phone rejects an expired or already
// consumed one with "Couldn't link device".
const QR_MAX_AGE_MS = 15000;
// How long a typed pairing code stays usable before we ask for a fresh socket.
const PAIRING_CODE_TTL_MS = 60000;
// The live revision lives on whatsapp.com; only fall back when that is slow.
const VERSION_TTL_MS = 30 * 60000;
const VERSION_TIMEOUT_MS = 6000;

const authDir = () => path.join(__dirname, '..', '.wa-auth');

const unavailable = () => new AppError(503, 'WHATSAPP_UNAVAILABLE', 'WhatsApp is not connected yet. Ask your administrator to link the device in the admin console (Settings → WhatsApp connection) and retry.');

function normalizeNumber(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (n.length === 10) n = '91' + n;                            // bare 10-digit Indian number
  else if (n.length === 11 && n.startsWith('0')) n = '91' + n.slice(1);  // 0XXXXXXXXXX
  else if (n.length === 14 && n.startsWith('0091')) n = n.slice(2);      // 0091XXXXXXXXXX
  if (n.length < 10 || n.length > 15) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid WhatsApp number with country code, e.g. +919876543210.');
  return n;
}

function clearAuth() { fs.rmSync(authDir(), { recursive: true, force: true }); }

// A pairing code belongs to the socket that issued it; once that socket is gone
// the code is dead and must not be handed out again.
function clearPairing() {
  qrDataUrl = null;
  qrGeneratedAt = null;
  pairingCode = null;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// WhatsApp names each close reason; surfacing it is the difference between
// "it didn't work" and "the account refuses unofficial clients".
function reasonName(code, DisconnectReason) {
  const hit = Object.entries(DisconnectReason).find(([, value]) => typeof value === 'number' && value === code);
  return hit ? hit[0] : 'unknown';
}

function explainClose(code) {
  switch (code) {
    case 515: return 'WhatsApp finished the link and asked the client to reconnect — this is normal and is handled automatically.';
    case 401: return 'WhatsApp rejected the link. The session was revoked, or this account only accepts the official WhatsApp client.';
    case 403: return 'WhatsApp refused this client outright.';
    case 408: return 'The link attempt timed out before the phone confirmed it.';
    case 411: return 'The account is already signed in to a different multi-device session.';
    case 440: return 'Another client took over this connection.';
    case 500: return 'The stored session is no longer valid.';
    case 503: return 'WhatsApp reported the service as unavailable.';
    default: return 'The connection to WhatsApp dropped.';
  }
}

// The revision of WhatsApp Web we pretend to be. WhatsApp rejects link
// registration from clients speaking an old build, and the revision Baileys
// pins at release time drifts behind within weeks — so read the one the real
// web client is running right now and only fall back when that is unreachable.
async function resolveVersion() {
  if (Date.now() - versionCache.at < VERSION_TTL_MS) return versionCache;
  const entry = { at: Date.now(), version: null, source: 'bundled' };
  const { fetchLatestWaWebVersion, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
  try {
    const live = await fetchLatestWaWebVersion({ timeout: VERSION_TIMEOUT_MS });
    if (live?.isLatest && Array.isArray(live.version)) {
      entry.version = live.version;
      entry.source = 'whatsapp.com';
    }
  } catch { /* no outbound access — keep the bundled revision */ }
  if (!entry.version) {
    try {
      const pinned = await fetchLatestBaileysVersion();
      if (Array.isArray(pinned?.version)) { entry.version = pinned.version; entry.source = 'baileys-pinned'; }
    } catch { /* keep the bundled revision */ }
  }
  versionCache = entry;
  return entry;
}

async function connect() {
  if (sock || connecting) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  connecting = true;
  try {
    const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(authDir());
    const { version, source } = await resolveVersion();
    console.error(JSON.stringify({ event: 'whatsapp_connecting', waVersion: version ? version.join('.') : 'bundled', revisionSource: source }));
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      ...(version ? { version } : {}),
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    sock = socket;
    // A refresh tears the old socket down first; its late events must not
    // resurrect it or overwrite the code the replacement socket is issuing.
    const isCurrent = () => sock === socket;
    // Baileys 6.7.x emits 'creds.update' only — there is no 'creds.save' in the
    // package at all. Listen for the wrong one and saveCreds() never runs, the
    // session is never written to disk, and every reconnect starts blank, so the
    // phone's half-finished pairing has nothing to resume from.
    socket.ev.on('creds.update', () => { if (isCurrent()) saveCreds(); });
    socket.ev.on('connection.update', update => {
      if (!isCurrent()) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        QRCode.toDataURL(qr)
          .then(url => { if (isCurrent()) { qrDataUrl = url; qrGeneratedAt = Date.now(); } })
          .catch(() => {});
      }
      if (connection === 'open') {
        connected = true;
        clearPairing();
        lastError = null;
        // A link only survives a restart if it reaches disk; write it the
        // moment the session is confirmed rather than waiting for the next
        // credential change that may never come.
        try { saveCreds(); } catch { /* still linked in memory */ }
        try { waPhone = jidNormalizedUser(socket.user.id).split('@')[0]; } catch { waPhone = null; }
        console.error(JSON.stringify({ event: 'whatsapp_connected', phone: waPhone }));
      }
      if (connection === 'close') {
        connected = false;
        sock = null;
        clearPairing();
        const code = lastDisconnect?.error?.output?.statusCode;
        const name = reasonName(code, DisconnectReason);
        const message = lastDisconnect?.error?.message;
        lastError = { code: code ?? null, name, message: message || null, hint: explainClose(code), at: new Date().toISOString() };
        console.error(JSON.stringify({ event: 'whatsapp_closed', code: code ?? null, name, message: message || null }));
        if (code === DisconnectReason.loggedOut) {
          waPhone = null;
          clearAuth();
          console.error(JSON.stringify({ event: 'whatsapp_logged_out' }));
        } else if (!shuttingDown) {
          // 515 is WhatsApp telling a freshly paired client to reconnect with
          // its new credentials; waiting risks the phone invalidating the link.
          // One pending reconnect at a time — a second socket races the first
          // and both fight over the same pairing reference.
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect().catch(() => {});
          }, code === DisconnectReason.restartRequired ? 0 : 3000);
        }
      }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'whatsapp_start_failed', error: error.message }));
    sock = null;
  } finally { connecting = false; }
}

async function status() {
  return { connected, phone: waPhone, qr: qrDataUrl, pairingCode, lastError };
}

// Drops the live socket (leaving the saved session untouched) so Baileys asks
// WhatsApp for a brand-new pairing code instead of re-showing the last one.
async function restartForQr() {
  const old = sock;
  sock = null;
  connecting = false;
  connected = false;
  // A reconnect scheduled by the socket we are about to drop must not fire
  // behind our back and create a second live connection.
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearPairing();
  if (old) { try { old.end(); } catch { /* socket already gone */ } }
  await sleep(300);
}

// Starts the connection if needed and returns a code the phone can actually
// scan: one left over from an earlier attempt is replaced, because WhatsApp
// rejects anything already expired or already consumed with "Couldn't link
// device".
async function getQr() {
  if (connected) return null;
  if (qrDataUrl && Date.now() - qrGeneratedAt > QR_MAX_AGE_MS) await restartForQr();
  await connect();
  for (let i = 0; i < 40 && !connected && !qrDataUrl; i++) await sleep(250);
  return qrDataUrl;
}

// The same linking, without a camera: WhatsApp → Linked devices → Link a
// device → "Link with phone number instead". Some accounts pair more reliably
// this way, and it removes scanning a screen from the picture entirely.
async function getPairingCode(number) {
  const digits = normalizeNumber(number);
  if (connected) return null;
  // WhatsApp answers a second request on the same socket with "Couldn't link
  // device", so reuse a live code and otherwise start a clean socket.
  if (pairingCode && Date.now() - pairingRequestedAt < PAIRING_CODE_TTL_MS) return pairingCode;
  if (pairingSocket && pairingSocket === sock) await restartForQr();
  await connect();
  // The code can only be asked for once the socket is on the wire; the first
  // pairing payload is the signal that it is.
  for (let i = 0; i < 40 && !connected && !qrDataUrl; i++) await sleep(250);
  if (connected || !sock) {
    if (connected) return null;
    throw new AppError(503, 'WHATSAPP_UNAVAILABLE', 'WhatsApp could not reach its servers. Check this machine can reach web.whatsapp.com and retry.');
  }
  try {
    const raw = await sock.requestPairingCode(digits);
    pairingCode = String(raw || '').trim();
    pairingRequestedAt = Date.now();
    pairingSocket = sock;
    console.error(JSON.stringify({ event: 'whatsapp_pairing_code_issued' }));
    return pairingCode;
  } catch (error) {
    console.error(JSON.stringify({ event: 'whatsapp_pairing_code_failed', error: error.message }));
    throw new AppError(502, 'WHATSAPP_PAIRING_FAILED', 'WhatsApp did not issue a pairing code. Wait a moment and try again.');
  }
}

function ensureReady() {
  if (!connected || !sock) throw unavailable();
}

async function sendText(number, text) {
  ensureReady();
  const jid = normalizeNumber(number) + '@s.whatsapp.net';
  try {
    await sock.sendMessage(jid, { text });
  } catch (error) {
    console.error(JSON.stringify({ event: 'whatsapp_send_failed', error: error.message }));
    throw new AppError(502, 'WHATSAPP_SEND_FAILED', 'WhatsApp could not deliver the message. Check the number is on WhatsApp and try again.');
  }
}

async function sendDocument(number, buffer, fileName, caption = '') {
  ensureReady();
  const jid = normalizeNumber(number) + '@s.whatsapp.net';
  try {
    await sock.sendMessage(jid, { document: buffer, fileName, mimetype: 'application/pdf', ...(caption ? { caption } : {}) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'whatsapp_document_failed', error: error.message }));
    throw new AppError(502, 'WHATSAPP_SEND_FAILED', 'WhatsApp could not deliver the document. Check the number is on WhatsApp and try again.');
  }
}

async function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  shuttingDown = true;
  try { if (sock) await sock.logout(); } catch { /* session already gone */ }
  sock = null;
  connected = false;
  clearPairing();
  waPhone = null;
  lastError = null;
  clearAuth();
  shuttingDown = false;
}

module.exports = { status, getQr, getPairingCode, sendText, sendDocument, disconnect, normalizeNumber };
