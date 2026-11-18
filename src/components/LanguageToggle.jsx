import { useLanguage } from '../context/useLanguage'

const OPTIONS = [
  { value: 'id', label: 'ID', name: 'Bahasa Indonesia' },
  { value: 'en', label: 'EN', name: 'English' },
]

// Two-segment ID / EN switch. Used on the login card and in both app shells,
// so the language can be changed before and after signing in.
export function LanguageToggle({ className = '' }) {
  const { language, setLanguage, t } = useLanguage()

  return (
    <div className={`language-toggle ${className}`} role="radiogroup" aria-label={t('Bahasa')}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={language === option.value}
          aria-label={option.name}
          title={option.name}
          className={`language-toggle-option ${language === option.value ? 'active' : ''}`}
          onClick={() => setLanguage(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
