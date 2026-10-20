import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

export default function LanguageSelect({ className = '', onChange }) {
  const { i18n } = useTranslation();

  const handleLanguageChange = (e) => {
    const nextLang = e.target.value;
    i18n.changeLanguage(nextLang);
    onChange?.(nextLang);
  };

  return (
    <div className={`lang-select-wrapper ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <Globe size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} aria-hidden="true" />
      <select
        aria-label="Select language"
        value={i18n.language}
        onChange={handleLanguageChange}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          fontWeight: '500',
          color: 'var(--muted)',
          cursor: 'pointer'
        }}
      >
        <option value="en">English</option>
        <option value="hi">हिन्दी</option>
        <option value="gu">ગુજરાતી</option>
      </select>
    </div>
  );
}
