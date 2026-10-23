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
let waPhone = null;
let shuttingDown = false;

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
    sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      ...(version ? { version } : {}),
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    sock.ev.on('creds.save', saveCreds);
    sock.ev.on('connection.update', update => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) QRCode.toDataURL(qr).then(url => { qrDataUrl = url; }).catch(() => {});
      if (connection === 'open') {
        connected = true;
        qrDataUrl = null;
        try { waPhone = jidNormalizedUser(sock.user.id).split('@')[0]; } catch { waPhone = null; }
        console.error(JSON.stringify({ event: 'whatsapp_connected', phone: waPhone }));
      }
      if (connection === 'close') {
        connected = false;
        sock = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          waPhone = null; qrDataUrl = null;
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

// Starts the connection if needed and waits (up to ~10s) for a QR payload.
async function getQr() {
  if (connected) return null;
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
  qrDataUrl = null;
  waPhone = null;
  clearAuth();
}

module.exports = { status, getQr, sendText, sendDocument, disconnect, normalizeNumber };
