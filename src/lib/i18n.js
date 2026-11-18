import { en } from './i18n-en'

// Bahasa Indonesia is the app's source language: every user-facing string is
// written in Indonesian in the code and passed through t(). The Indonesian
// text itself is the lookup key, so
//   - the code still reads in Indonesian, as it always has,
//   - Indonesian needs no dictionary at all, and
//   - a string nobody has translated yet just shows in Indonesian instead of
//     showing a raw key.
// English lives in i18n-en.js. Placeholders are {name}-style:
//   t('Promo berlaku untuk {count} layanan', { count: 3 })

export const LANGUAGES = ['id', 'en']
export const DEFAULT_LANGUAGE = 'id'
export const LANGUAGE_STORAGE_KEY = 'kuorza-language'

const dictionaries = { en }

// Module-level copy of the current language, kept in sync by
// LanguageProvider. It lets plain modules (date formatting, CSV/PDF exports,
// API error messages) translate without a hook. Components should still use
// useLanguage() so they re-render when the language changes.
let currentLanguage = readStoredLanguage()

export function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function getLanguage() {
  return currentLanguage
}

export function setCurrentLanguage(language) {
  currentLanguage = LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE
}

function interpolate(text, vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}

export function translate(text, vars, language = currentLanguage) {
  if (text == null) return text
  const dictionary = dictionaries[language]
  const translated = dictionary?.[text] ?? text
  return interpolate(translated, vars)
}

// Service names come from the database, so they can't be lookup keys like UI
// strings — but the menu follows a fixed shape ("Mobil Premium Wash - S",
// "Helm Spa - Branded"), so English mode can translate the Indonesian parts:
// the vehicle word in front and "Ojek Online". The five pre-migration-011
// generic services are fully Indonesian and are matched whole. Display only:
// treatment_items keeps the stored (Indonesian) name, and anything that
// doesn't match is shown exactly as stored.
const SERVICE_NAMES_EN = {
  'cuci motor': 'Motorbike Wash',
  'cuci mobil': 'Car Wash',
  'cuci helm': 'Helmet Wash',
  'poles body': 'Body Polish',
  'coating kaca': 'Glass Coating',
}

const SERVICE_VEHICLES_EN = { motor: 'Motorbike', mobil: 'Car', helm: 'Helmet' }

export function translateServiceName(name, language = currentLanguage) {
  if (language !== 'en' || !name) return name
  const trimmed = name.trim()
  const whole = SERVICE_NAMES_EN[trimmed.toLowerCase().replace(/\s+/g, ' ')]
  if (whole) return whole

  // "Base - Variant": only the base is Indonesian; sizes (S/M/L/XL) and
  // Branded / Non Branded are already English.
  const [base, ...variant] = trimmed.split(' - ')
  const words = base.split(/\s+/)
  const vehicle = SERVICE_VEHICLES_EN[words[0].toLowerCase()]
  if (vehicle) words[0] = vehicle
  const translatedBase = words.join(' ').replace(/\bOjek Online\b/i, 'Ride-Hailing')
  return [translatedBase, ...variant].join(' - ')
}

// Locale for dates and times. Money is deliberately NOT localized — Rupiah is
// always shown as "Rp 15.000" (see formatRupiah), whatever the UI language.
export function dateLocale(language = currentLanguage) {
  return language === 'en' ? 'en-GB' : 'id-ID'
}
