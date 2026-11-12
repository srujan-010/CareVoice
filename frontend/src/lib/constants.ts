import type { LanguageOption } from '@/types';

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
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

export const COMMON_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India Standard Time (Asia/Kolkata)' },
  { value: 'America/New_York', label: 'US Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'US Central (America/Chicago)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (America/Los_Angeles)' },
  { value: 'Europe/London', label: 'UK London (Europe/London)' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (Asia/Dubai)' },
  { value: 'Asia/Singapore', label: 'Singapore (Asia/Singapore)' },
  { value: 'Australia/Sydney', label: 'Sydney (Australia/Sydney)' },
];

export const RELATIONSHIP_OPTIONS = [
  'Mother',
  'Father',
  'Grandmother',
  'Grandfather',
  'Mother-in-law',
  'Father-in-law',
  'Spouse',
  'Relative',
  'Other',
];

export const DOSE_STATUS_META: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  PATIENT_REPORTED_TAKEN: {
    label: 'Patient Reported Taken',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
  PATIENT_REPORTED_NOT_TAKEN: {
    label: 'Patient Reported Not Taken',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
  },
  UNCONFIRMED: {
    label: 'Unconfirmed',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },
  PENDING: {
    label: 'Pending',
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
  },
  CALLBACK_REQUESTED: {
    label: 'Callback Requested',
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
  },
  ESCALATED: {
    label: 'Escalated',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
  },
};

export function getLanguageLabel(code: string): string {
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return found ? `${found.name} (${found.nativeName})` : code;
}

