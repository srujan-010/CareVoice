export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  bcp47: string;
  sarvamSupported: boolean;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN', sarvamSupported: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN', sarvamSupported: true },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', bcp47: 'mr-IN', sarvamSupported: true },
  { code: 'en', name: 'English', nativeName: 'English', bcp47: 'en-IN', sarvamSupported: true },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN', sarvamSupported: true },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', bcp47: 'kn-IN', sarvamSupported: true },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', bcp47: 'bn-IN', sarvamSupported: true },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', bcp47: 'ml-IN', sarvamSupported: true },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', bcp47: 'gu-IN', sarvamSupported: true },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', bcp47: 'pa-IN', sarvamSupported: true },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', bcp47: 'od-IN', sarvamSupported: true },
];

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

export function getLanguageMeta(codeOrName: string): SupportedLanguage {
  const normalized = codeOrName.trim().toLowerCase();
  const found = SUPPORTED_LANGUAGES.find(
    (l) =>
      l.code.toLowerCase() === normalized ||
      l.name.toLowerCase() === normalized ||
      l.bcp47.toLowerCase() === normalized
  );
  return found ?? SUPPORTED_LANGUAGES[3]; // English fallback
}

