import { useState } from 'react';
import { Send } from 'lucide-react';
import { Modal, Notice, Field } from './ui';
import { api, message } from '../lib';

// Uploads a PDF the caller already fetched (with its own role-scoped request)
// to the backend, which forwards it over the linked WhatsApp session.
export default function ShareToWhatsAppModal({ fileName, caption = '', blob, defaultNumber = '', close, onSent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      const pdfBase64 = await toBase64(blob);
      await api.post('/whatsapp/send-document', { number: form.number, fileName, caption, pdfBase64 });
      onSent?.();
      close();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Share to WhatsApp" close={close}>
      <form onSubmit={submit}>
        <p className="form-note">Sending <b>{fileName}</b> as a document on WhatsApp. Your dairy's linked WhatsApp delivers it at no cost.</p>
        <Field label="WhatsApp number" name="number" type="tel" placeholder="+91 98765 43210" defaultValue={defaultNumber} required autoFocus />
        {error && <Notice error>{error}</Notice>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button type="button" className="button" onClick={close}>Cancel</button>
          <button type="submit" className="button primary" disabled={busy}><Send size={16}/>{busy ? ' Sending…' : ' Send to WhatsApp'}</button>
        </div>
      </form>
    </Modal>
  );
}
