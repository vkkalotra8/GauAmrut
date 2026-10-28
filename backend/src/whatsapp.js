// One shared WhatsApp session for the deployment (linked once from the admin
// console by scanning a QR code). Once linked, OTPs and PDF documents are sent
// over the linked device session — WhatsApp messages cost nothing. The auth
// state persists in backend/.wa-auth so restarts stay logged in.
const fs = require('fs');
const path = require('path');
const { AppError } = require('./domain');

let sock = null;
let connecting = false;
let connected = false;
let qrDataUrl = null;
let qrGeneratedAt = null;
let waPhone = null;
let shuttingDown = false;

// WhatsApp only honours a pairing code for a short window (Baileys rotates the
// first one after 60s and every 20s after that). A code older than this is
// replaced rather than re-served — the phone rejects an expired or already
// consumed one with "Couldn't link device".
const QR_MAX_AGE_MS = 15000;

const authDir = () => path.join(__dirname, '..', '.wa-auth');

const unavailable = () => new AppError(503, 'WHATSAPP_UNAVAILABLE', 'WhatsApp is not connected yet. Ask your administrator to scan the QR code in the admin console (Settings → WhatsApp connection) and retry.');

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
function clearQr() { qrDataUrl = null; qrGeneratedAt = null; }

async function connect() {
  if (sock || connecting) return;
  connecting = true;
  try {
    const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason, jidNormalizedUser, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(authDir());
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* use Baileys' bundled WhatsApp version */ }
    // Logged so a rejected pairing can be traced to a stale client version —
    // WhatsApp answers "Try again later" when the phone and the socket
    // disagree about which build of the protocol they are speaking.
    console.error(JSON.stringify({ event: 'whatsapp_connecting', version: Array.isArray(version) ? version.join('.') : 'bundled' }));
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
    socket.ev.on('creds.save', () => { if (isCurrent()) saveCreds(); });
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
        clearQr();
        try { waPhone = jidNormalizedUser(socket.user.id).split('@')[0]; } catch { waPhone = null; }
        console.error(JSON.stringify({ event: 'whatsapp_connected', phone: waPhone }));
      }
      if (connection === 'close') {
        connected = false;
        sock = null;
        clearQr();
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          waPhone = null;
          clearAuth();
          console.error(JSON.stringify({ event: 'whatsapp_logged_out' }));
        } else if (!shuttingDown) {
          setTimeout(() => connect().catch(() => {}), 3000);
        }
      }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'whatsapp_start_failed', error: error.message }));
    sock = null;
  } finally { connecting = false; }
}

async function status() {
  return { connected, phone: waPhone, qr: qrDataUrl };
}

// Drops the live socket (leaving the saved session untouched) so Baileys asks
// WhatsApp for a brand-new pairing code instead of re-showing the last one.
async function restartForQr() {
  const old = sock;
  sock = null;
  connecting = false;
  connected = false;
  clearQr();
  if (old) { try { old.end(); } catch { /* socket already gone */ } }
  await new Promise(resolve => setTimeout(resolve, 300));
}

// Starts the connection if needed and returns a code the phone can actually
// scan: one left over from an earlier attempt is replaced, because WhatsApp
// rejects anything already expired or already consumed with "Couldn't link
// device".
async function getQr() {
  if (connected) return null;
  if (qrDataUrl && Date.now() - qrGeneratedAt > QR_MAX_AGE_MS) await restartForQr();
  await connect();
  for (let i = 0; i < 40 && !connected && !qrDataUrl; i++) await new Promise(resolve => setTimeout(resolve, 250));
  return qrDataUrl;
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
  try { if (sock) await sock.logout(); } catch { /* session already gone */ }
  sock = null;
  connected = false;
  clearQr();
  waPhone = null;
  clearAuth();
}

module.exports = { status, getQr, sendText, sendDocument, disconnect, normalizeNumber };
