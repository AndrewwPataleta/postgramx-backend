export const SUPPORTED_LANGUAGES = [
  'en',
  'ru',
  'es',
  'tr',
  'fr',
  'pl',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
  if (!lang) {
    return 'en';
  }

  const normalized = lang.toLowerCase();

  if (SUPPORTED_LANGUAGES.includes(normalized as SupportedLanguage)) {
    return normalized as SupportedLanguage;
  }

  switch (normalized) {
    case 'eng':
    case 'english':
      return 'en';
    case 'rus':
    case 'ru-ru':
    case 'russian':
      return 'ru';
    case 'es-es':
    case 'es-mx':
    case 'spanish':
      return 'es';
    case 'tr-tr':
    case 'turkish':
      return 'tr';
    case 'pl-pl':
    case 'polish':
      return 'pl';
    case 'fr-fr':
    case 'french':
      return 'fr';
    default:
      return 'en';
  }
}
