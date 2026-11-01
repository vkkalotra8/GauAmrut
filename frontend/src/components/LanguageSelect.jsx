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
    <div className={`lang-select-wrapper ${className}`}>
      <Globe size={15} aria-hidden="true" />
      <select
        aria-label="Select language"
        value={i18n.language}
        onChange={handleLanguageChange}
      >
        <option value="en">English</option>
        <option value="hi">हिन्दी</option>
        <option value="gu">ગુજરાતી</option>
      </select>
    </div>
  );
}
