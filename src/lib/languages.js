/**
 * Language and model tables.
 *
 * Bundled with the extension rather than fetched from a server, so the side
 * panel can fill its dropdowns before the first frame instead of after a round
 * trip.
 */

/** Simultaneous translation: continuous, auto-detected source, no turns. */
export const SIMUL_MODEL = "gemini-3.5-live-translate-preview";

/** Targets for the simultaneous model, whose codes are BCP-47. */
export const SIMUL_LANGUAGES = {
  af: "Afrikaans",
  ak: "Akan",
  sq: "Albanian (Shqip)",
  am: "Amharic (አማርኛ)",
  ar: "Arabic (العربية)",
  hy: "Armenian (Հայերեն)",
  az: "Azerbaijani (Azərbaycan)",
  eu: "Basque (Euskara)",
  be: "Belarusian (Беларуская)",
  bn: "Bengali (বাংলা)",
  bg: "Bulgarian (Български)",
  my: "Burmese (မြန်မာ)",
  ca: "Catalan (Català)",
  "zh-Hans": "Chinese Simplified (简体中文)",
  "zh-Hant": "Chinese Traditional (繁體中文)",
  hr: "Croatian (Hrvatski)",
  cs: "Czech (Čeština)",
  da: "Danish (Dansk)",
  nl: "Dutch (Nederlands)",
  en: "English",
  et: "Estonian (Eesti)",
  fil: "Filipino",
  fi: "Finnish (Suomi)",
  fr: "French (Français)",
  gl: "Galician (Galego)",
  ka: "Georgian (ქართული)",
  de: "German (Deutsch)",
  el: "Greek (Ελληνικά)",
  gu: "Gujarati (ગુજરાતી)",
  ha: "Hausa",
  he: "Hebrew (עברית)",
  hi: "Hindi (हिन्दी)",
  hu: "Hungarian (Magyar)",
  is: "Icelandic (Íslenska)",
  id: "Indonesian (Bahasa Indonesia)",
  it: "Italian (Italiano)",
  ja: "Japanese (日本語)",
  jv: "Javanese (Basa Jawa)",
  kn: "Kannada (ಕನ್ನಡ)",
  kk: "Kazakh (Қазақ)",
  km: "Khmer (ខ្មែរ)",
  rw: "Kinyarwanda",
  ko: "Korean (한국어)",
  lo: "Lao (ລາວ)",
  lv: "Latvian (Latviešu)",
  lt: "Lithuanian (Lietuvių)",
  mk: "Macedonian (Македонски)",
  ms: "Malay (Bahasa Melayu)",
  ml: "Malayalam (മലയാളം)",
  mr: "Marathi (मराठी)",
  mn: "Mongolian (Монгол)",
  ne: "Nepali (नेपाली)",
  no: "Norwegian (Norsk)",
  fa: "Persian (فارسی)",
  pl: "Polish (Polski)",
  "pt-BR": "Portuguese - Brazil (Português)",
  "pt-PT": "Portuguese - Portugal (Português)",
  pa: "Punjabi (ਪੰਜਾਬੀ)",
  ro: "Romanian (Română)",
  ru: "Russian (Русский)",
  sr: "Serbian (Српски)",
  sd: "Sindhi (سنڌي)",
  si: "Sinhala (සිංහල)",
  sk: "Slovak (Slovenčina)",
  sl: "Slovenian (Slovenščina)",
  es: "Spanish (Español)",
  su: "Sundanese (Basa Sunda)",
  sw: "Swahili (Kiswahili)",
  sv: "Swedish (Svenska)",
  ta: "Tamil (தமிழ்)",
  te: "Telugu (తెలుగు)",
  th: "Thai (ไทย)",
  tr: "Turkish (Türkçe)",
  uk: "Ukrainian (Українська)",
  ur: "Urdu (اردو)",
  uz: "Uzbek (Oʻzbek)",
  vi: "Vietnamese (Tiếng Việt)",
  zu: "Zulu (isiZulu)",
};

export const SIMUL_POPULAR_LANGUAGES = [
  "en",
  "ja",
  "zh-Hans",
  "es",
  "fr",
  "de",
  "pt-BR",
  "ko",
  "hi",
  "ar",
];

const SIMUL_CODE_MAP = { iw: "he", zh: "zh-Hans", pt: "pt-BR" };

/**
 * Map an older stored language code to the simultaneous model's BCP-47 code,
 * so a saved `zh`, `pt` or `iw` still lands on the right language.
 */
export function simulLanguageCode(code) {
  return SIMUL_CODE_MAP[code] || code;
}

/** The Live API's own default voice, used for every session. */
export const DEFAULT_VOICE = "Puck";
