import { Link, useLocation } from 'react-router-dom';
import { Brand } from '../../components/ui';

const updated = '1 November 2026';
const pages = {
  '/privacy': { title: 'Privacy policy', sections: [
    ['What we collect', 'Account identity, dairy and customer profiles, delivery records, bills, payment references, support messages, device/session security data, and audit events needed to operate GauAmrut.'],
    ['How we use it', 'We use data to provide dairy operations, authenticate users, calculate bills, reconcile customer-reported payments, prevent abuse, support users, and meet legal obligations. GauAmrut does not sell personal data.'],
    ['Storage and sharing', 'Production data is stored with contracted infrastructure providers. Access is limited by tenant and role. We disclose data only to service providers, when legally required, or with the account holder’s direction.'],
    ['Your choices', 'You may request access, correction, export, account closure, or deletion through support. Some financial and audit records may be retained when required for fraud prevention, disputes, or law.']
  ]},
  '/terms': { title: 'Terms of service', sections: [
    ['Service', 'GauAmrut provides dairy-delivery records, billing, reporting, communication, and payment-reconciliation tools. Dairy owners remain responsible for products, pricing, deliveries, customer relationships, taxes, and compliance.'],
    ['Accounts', 'Provide accurate information, protect account credentials, and promptly report suspected unauthorized access. Administrators may suspend accounts to protect users or the platform.'],
    ['Payments', 'GauAmrut does not hold money, initiate settlement, or guarantee UPI, cash, or bank transfers. Payment references and customer claims are reconciliation evidence that the dairy must verify against its own account before approval.'],
    ['Acceptable use', 'Do not misuse the service, access another tenant, upload unlawful content, interfere with availability, or use GauAmrut for fraud.'],
    ['Availability and liability', 'The service is subject to maintenance and third-party infrastructure. Keep independent business records and verify critical financial information.']
  ]},
  '/data-policy': { title: 'Data retention and deletion', sections: [
    ['Active accounts', 'Operational records are retained while an account is active and as needed for reports, disputes, security, and legal obligations.'],
    ['Closure requests', 'After identity verification, account data is scheduled for deletion or irreversible anonymization. Backups expire through their encrypted retention cycle rather than being edited in place.'],
    ['Protected records', 'Payment, invoice, reversal, security, and audit records may be retained for a documented legal or fraud-prevention period. Access remains restricted.'],
    ['Requests', 'Send the account email, dairy name, request type, and a safe contact method to the configured support address. Never send passwords or OTPs.']
  ]},
  '/support': { title: 'Support and account recovery', sections: [
    ['Contact', 'Use the support email shown in the application settings. Include your account email, dairy name, approximate incident time, and request ID if available.'],
    ['Account recovery', 'Support verifies ownership before changing account access. GauAmrut staff will never ask for your password, OTP, UPI PIN, or bank credentials.'],
    ['Security incidents', 'For suspected compromise, stop using the affected session, contact support immediately, and ask for all sessions to be revoked. Critical incidents are triaged, contained, investigated, and communicated to affected users.'],
    ['Payment disputes', 'Contact the dairy first. GauAmrut preserves application records but cannot reverse or confirm bank settlement. Use your UPI or bank provider for settlement disputes.']
  ]}
};
export const legalPaths = Object.keys(pages);
export default function LegalPage() {
  const page = pages[useLocation().pathname] || pages['/privacy'];
  return <div className="legal-shell"><header><Brand/><Link className="button" to="/">Back to GauAmrut</Link></header><main><span className="eyebrow">GAUAMRUT · UPDATED {updated.toUpperCase()}</span><h1>{page.title}</h1><p className="legal-intro">This page describes the production operating policy for the GauAmrut service.</p>{page.sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}<nav aria-label="Legal policies"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/data-policy">Data policy</Link><Link to="/support">Support</Link></nav></main></div>;
}
