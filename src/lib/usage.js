/**
 * How much audio a run has moved, for the usage line in the side panel.
 *
 * Counted from the audio this extension actually sends and plays rather than
 * from the `usageMetadata` the Live API attaches to its messages: Google bills
 * Live audio by its duration, and this extension owns both ends of it.
 */

import { t } from "./i18n.js";

/** A run's tally: seconds of audio, each way. */
export function emptyUsage() {
  return { inSeconds: 0, outSeconds: 0 };
}

/** Count audio sent to the model, in seconds. */
export function noteAudioIn(totals, seconds) {
  totals.inSeconds += Math.max(0, seconds) || 0;
  return totals;
}

/** Count audio the model sent back, in seconds. */
export function noteAudioOut(totals, seconds) {
  totals.outSeconds += Math.max(0, seconds) || 0;
  return totals;
}

/**
 * A duration, as the side panel says it: seconds under a minute, then minutes.
 */
export function formatDuration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return t("durationSeconds", [whole]);
  return t("durationMinutes", [Math.round(whole / 60)]);
}
