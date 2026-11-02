/**
 * Extension settings, in `chrome.storage.local`.
 *
 * `chrome.storage.local` is the one store every extension context can read — a
 * service worker cannot see `localStorage`, and an offscreen document does not
 * share one with the side panel — so everything lives here, including the API
 * key.
 *
 * The key is the user's own, on their own machine, and is sent to exactly one
 * place: the `key` query parameter of the Gemini Live WebSocket. Nothing in this
 * extension transmits it anywhere else, and there is no server to transmit it
 * to.
 */

import { t } from "./i18n.js";

export const DEFAULTS = {
  // Bring your own: https://aistudio.google.com/apikey
  apiKey: "",
  // Always the simultaneous-translation model: a tab plays whoever it plays,
  // and naming a source language up front is a promise the listener cannot
  // keep. Auto-detect is the only setting that fits, so it is not offered as a
  // choice — which is also why there is no source language.
  tabTarget: "en",
  tabCaptions: true,
  // Subtitle height in CSS pixels, deliberately absolute: the overlay lives on
  // someone else's page, and anything relative would be resized by whatever that
  // page does to its root font size. Sized for a video watched from across a
  // desk rather than for reading distance.
  captionSize: 32,
  // Original tab audio while a translation is speaking. 1.0 disables ducking.
  duckLevel: 0.15,
  // Drops the translated audio before it is played. Applied to a running
  // session without reopening it: muting is not stopping, and a muted run still
  // holds its socket and still shows the transcript.
  soundMuted: false,
  // Which Live model a session starts on, picked in Options from the models the
  // key can use, or "" for the bundled model. Tried first, with the bundled
  // model behind it as a fallback.
  simulModel: "",
};

/**
 * Bounds for `captionSize`, shared by the Options slider and the overlay.
 *
 * The floor is where the subtitles stop being readable over video at all; the
 * ceiling is where three wrapped rows start covering the picture they are
 * subtitling. `content/caption-overlay.js` clamps to the same numbers with its own
 * copy — it is injected as a classic script and cannot import this file.
 */
export const CAPTION_SIZE_MIN = 16;
export const CAPTION_SIZE_MAX = 64;

export async function loadSettings() {
  const stored = await chrome.storage.local.get([...Object.keys(DEFAULTS), "captions"]);
  // Subtitles used to be one switch for both directions. Carry that choice over
  // to the tab direction instead of silently turning them back on for someone
  // who had switched them off.
  if ("captions" in stored && !("tabCaptions" in stored)) stored.tabCaptions = stored.captions;
  delete stored.captions;
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** The one precondition for starting: an API key has been entered. */
export function requireApiKey(settings) {
  if (settings.apiKey && settings.apiKey.trim()) return settings.apiKey.trim();
  throw new Error(t("errNoKey"));
}
