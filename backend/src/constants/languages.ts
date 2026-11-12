export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  bcp47: string;
  sarvamSupported: boolean;
  sarvamInitialLanguageName: string;
  recommendedVoices: {
    FEMALE: string;
    MALE: string;
    NEUTRAL: string;
  };
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    bcp47: 'te-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Telugu',
    recommendedVoices: {
      FEMALE: 'Tanya - Telugu Mix Narrator',
      MALE: 'Aarav',
      NEUTRAL: 'Tanya - Telugu Mix Narrator',
    },
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    bcp47: 'hi-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Hindi',
    recommendedVoices: {
      FEMALE: 'Aanya',
      MALE: 'Aarav',
      NEUTRAL: 'Aanya',
    },
  },
  {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    bcp47: 'mr-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Marathi',
    recommendedVoices: {
      FEMALE: 'Ananya',
      MALE: 'Rohan',
      NEUTRAL: 'Ananya',
    },
  },
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    bcp47: 'en-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'English',
    recommendedVoices: {
      FEMALE: 'Aanya',
      MALE: 'Aarav',
      NEUTRAL: 'Aanya',
    },
  },
  {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    bcp47: 'ta-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Tamil',
    recommendedVoices: {
      FEMALE: 'Kavya',
      MALE: 'Arjun',
      NEUTRAL: 'Kavya',
    },
  },
  {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    bcp47: 'kn-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Kannada',
    recommendedVoices: {
      FEMALE: 'Nitya',
      MALE: 'Vikram',
      NEUTRAL: 'Nitya',
    },
  },
  {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    bcp47: 'bn-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Bengali',
    recommendedVoices: {
      FEMALE: 'Riya',
      MALE: 'Saurav',
      NEUTRAL: 'Riya',
    },
  },
  {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    bcp47: 'ml-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Malayalam',
    recommendedVoices: {
      FEMALE: 'Meera',
      MALE: 'Kiran',
      NEUTRAL: 'Meera',
    },
  },
  {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    bcp47: 'gu-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Gujarati',
    recommendedVoices: {
      FEMALE: 'Diya',
      MALE: 'Dev',
      NEUTRAL: 'Diya',
    },
  },
  {
    code: 'pa',
    name: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    bcp47: 'pa-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Punjabi',
    recommendedVoices: {
      FEMALE: 'Simran',
      MALE: 'Kabir',
      NEUTRAL: 'Simran',
    },
  },
  {
    code: 'or',
    name: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    bcp47: 'od-IN',
    sarvamSupported: true,
    sarvamInitialLanguageName: 'Odia',
    recommendedVoices: {
      FEMALE: 'Aanya',
      MALE: 'Aarav',
      NEUTRAL: 'Aanya',
    },
  },
  {
    code: 'ur',
    name: 'Urdu',
    nativeName: 'اردو',
    bcp47: 'ur-IN',
    sarvamSupported: false,
    sarvamInitialLanguageName: '',
    recommendedVoices: {
      FEMALE: 'Aanya',
      MALE: 'Aarav',
      NEUTRAL: 'Aanya',
    },
  },
];

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

export function tryGetSupportedLanguage(codeOrName?: string | null): SupportedLanguage | null {
  if (!codeOrName) return null;
  const normalized = codeOrName.trim().toLowerCase();
  if (!normalized) return null;
  return (
    SUPPORTED_LANGUAGES.find(
      (l) =>
        l.code.toLowerCase() === normalized ||
        l.name.toLowerCase() === normalized ||
        l.bcp47.toLowerCase() === normalized ||
        (l.sarvamInitialLanguageName &&
          l.sarvamInitialLanguageName.toLowerCase() === normalized)
    ) ?? null
  );
}

export function checkSarvamLanguageSupport(
  requestedCodeOrName: string,
  allowedLanguagesCsv?: string
): {
  supported: boolean;
  language: SupportedLanguage | null;
  reason?: string;
  availableFallbackLanguages: Array<{ code: string; name: string; bcp47: string }>;
} {
  const allowedList = (allowedLanguagesCsv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isAllowedInConfig = (lang: SupportedLanguage) => {
    if (!lang.sarvamSupported) return false;
    if (allowedList.length === 0) return true;
    return (
      allowedList.includes(lang.code.toLowerCase()) ||
      allowedList.includes(lang.name.toLowerCase()) ||
      allowedList.includes(lang.bcp47.toLowerCase())
    );
  };

  const availableFallbackLanguages = SUPPORTED_LANGUAGES.filter(isAllowedInConfig).map((l) => ({
    code: l.code,
    name: l.name,
    bcp47: l.bcp47,
  }));

  const matched = tryGetSupportedLanguage(requestedCodeOrName);
  if (!matched) {
    return {
      supported: false,
      language: null,
      reason: `Requested language "${requestedCodeOrName}" is not supported for live voice calling.`,
      availableFallbackLanguages,
    };
  }

  if (!matched.sarvamSupported) {
    return {
      supported: false,
      language: matched,
      reason: `Requested language ${matched.name} (${matched.bcp47}) is not supported for live voice calling.`,
      availableFallbackLanguages,
    };
  }

  if (!isAllowedInConfig(matched)) {
    return {
      supported: false,
      language: matched,
      reason: `Requested language ${matched.name} (${matched.bcp47}) is not enabled for live voice calling.`,
      availableFallbackLanguages,
    };
  }

  return {
    supported: true,
    language: matched,
    availableFallbackLanguages,
  };
}

export function getLanguageMeta(codeOrName: string): SupportedLanguage {
  return tryGetSupportedLanguage(codeOrName) ?? SUPPORTED_LANGUAGES[3]; // English fallback for display only
}

export function buildLocalizedInitialGreeting(params: {
  languageCode: string;
  patientName: string;
  medicineName: string;
  dosage: string;
  callType: string;
  associatedMeal?: string;
}): string {
  const { languageCode, patientName, medicineName, dosage, callType } = params;
  const code = (tryGetSupportedLanguage(languageCode)?.code || 'en').toLowerCase();

  if (code === 'te') {
    if (callType === 'MEAL_REMINDER') {
      return `నమస్కారం ${patientName} గారు. నేను కేర్‌వాయిస్ నుండి మాట్లాడుతున్నాను. మీరు భోజనం చేశారా అని కనుక్కోవడానికి ఫోన్ చేశాను. ఆ తర్వాత మీరు ${medicineName} (${dosage}) వేసుకోవాల్సి ఉంది.`;
    }
    return `నమస్కారం ${patientName} గారు. నేను కేర్‌వాయిస్ ఆరోగ్య సహాయకురాలిని. మీరు భోజనం చేసి ${medicineName} (${dosage}) మందు వేసుకున్నారా అని కనుక్కోవడానికి ఫోన్ చేస్తున్నాను.`;
  }

  if (code === 'hi') {
    if (callType === 'MEAL_REMINDER') {
      return `नमस्ते ${patientName} जी। मैं केयरवॉइस से बोल रही हूँ। क्या आपने खाना खा लिया है? इसके बाद आपको ${medicineName} (${dosage}) लेनी है।`;
    }
    return `नमस्ते ${patientName} जी। मैं केयरवॉइस से आपकी दवा की याद दिलाने के लिए कॉल कर रही हूँ। क्या आपने ${medicineName} (${dosage}) ले ली है?`;
  }

  if (code === 'mr') {
    return `नमस्कार ${patientName}. मी केअरव्हॉइस मधून बोलत आहे. आपण जेवण करून ${medicineName} (${dosage}) गोळी घेतली का हे विचारण्यासाठी फोन केला आहे.`;
  }

  if (code === 'ta') {
    return `வணக்கம் ${patientName}. நான் கேர்-வாய்ஸ் உதவியாளர் பேசுகிறேன். நீங்கள் சாப்பிட்டு ${medicineName} (${dosage}) மருந்து எடுத்துக்கொண்டீர்களா என்று கேட்க அழைத்தேன்.`;
  }

  if (code === 'kn') {
    return `ನಮಸ್ಕಾರ ${patientName} ಅವರೇ. ನಾನು ಕೇರ್‌ವಾಯ್ಸ್‌ನಿಂದ ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ನೀವು ಊಟ ಮಾಡಿ ${medicineName} (${dosage}) ಮಾತ್ರೆ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ ಎಂದು ಕೇಳಲು ಕರೆ ಮಾಡಿದ್ದೇನೆ.`;
  }

  if (code === 'bn') {
    return `নমস্কার ${patientName}। আমি কেয়ারভয়েস থেকে বলছি। আপনি কি খাওয়া-দাওয়া করে ${medicineName} (${dosage}) ওষুধ খেয়েছেন?`;
  }

  if (code === 'ml') {
    return `നമസ്കാരം ${patientName}. ഞാൻ കെയർവോയിസിൽ നിന്ന് വിളിക്കുകയാണ്. നിങ്ങൾ ഭക്ഷണം കഴിച്ചതിന് ശേഷം ${medicineName} (${dosage}) മരുന്ന് കഴിച്ചോ എന്ന് ചോദിക്കാനാണ് വിളിച്ചത്.`;
  }

  if (code === 'gu') {
    return `નમસ્તે ${patientName}. હું કેરવોઇસમાંથી બોલું છું. શું તમે જમીને ${medicineName} (${dosage}) દવા લીધી છે?`;
  }

  if (code === 'pa') {
    return `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${patientName} ਜੀ। ਮੈਂ ਕੇਅਰਵੌਇਸ ਤੋਂ ਬੋਲ ਰਹੀ ਹਾਂ। ਕੀ ਤੁਸੀਂ ਖਾਣਾ ਖਾ ਕੇ ${medicineName} (${dosage}) ਦਵਾਈ ਲੈ ਲਈ ਹੈ?`;
  }

  if (code === 'or') {
    return `ନମସ୍କାର ${patientName}। ମୁଁ କେୟାରଭଏସ୍‌ରୁ କଲ୍ କରୁଛି। ଆପଣ ଖାଇସାରି ${medicineName} (${dosage}) ଔଷଧ ଖାଇଛନ୍ତି କି?`;
  }

  return `Hello ${patientName}, this is CareVoice calling to check on your ${medicineName} (${dosage}). Have you finished your meal and taken this dose yet?`;
}

