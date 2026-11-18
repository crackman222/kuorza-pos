import { useCallback, useEffect, useMemo, useState } from 'react'
import { LanguageContext } from './language-context'
import {
  LANGUAGE_STORAGE_KEY,
  readStoredLanguage,
  setCurrentLanguage,
  translate,
  translateServiceName,
} from '../lib/i18n'

// Bahasa / English switch. Remembered per device, like the theme — the shop
// tablet and a supervisor's phone can each keep their own.
export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readStoredLanguage)

  // Keep the module-level copy in step during render, so non-React helpers
  // called while rendering (formatDateTime etc.) already see the new value.
  setCurrentLanguage(language)

  useEffect(() => {
    document.documentElement.lang = language
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Private mode / blocked storage: the choice just won't persist.
    }
  }, [language])

  const setLanguage = useCallback((next) => setLanguageState(next), [])
  const toggleLanguage = useCallback(
    () => setLanguageState((current) => (current === 'en' ? 'id' : 'en')),
    []
  )

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t: (text, vars) => translate(text, vars, language),
      // Service names from the database — see translateServiceName.
      tService: (name) => translateServiceName(name, language),
    }),
    [language, setLanguage, toggleLanguage]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
