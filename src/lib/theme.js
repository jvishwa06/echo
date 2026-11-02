/**
 * Light and dark mode for the extension's own pages.
 *
 * The choice is stored as `theme` in `chrome.storage.local`: "light", "dark",
 * or "" to follow the system. It is applied as `data-theme` on `<html>`, which
 * is what `styles/common.css` keys its dark palette on. Every page that calls
 * `initTheme` follows the setting live, so toggling in the side panel also
 * switches an open Options tab.
 */

const KEY = "theme";
const systemDark = () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;

let stored = "";

/** "light" or "dark": what is actually showing. */
export function currentTheme() {
  if (stored === "light" || stored === "dark") return stored;
  return systemDark() ? "dark" : "light";
}

function apply() {
  document.documentElement.dataset.theme = currentTheme();
}

/**
 * Apply the theme now and keep it in step with the setting and the system.
 *
 * The system preference is applied before the stored one is read, so a dark
 * system does not flash white while storage answers.
 */
export async function initTheme(onChange = () => {}) {
  apply();
  try {
    stored = (await chrome.storage.local.get(KEY))[KEY] || "";
  } catch {
    stored = "";
  }
  apply();
  onChange();
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    apply();
    onChange();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEY in changes)) return;
    stored = changes[KEY].newValue || "";
    apply();
    onChange();
  });
}

/** Switch to the other theme and remember it. */
export async function toggleTheme() {
  stored = currentTheme() === "dark" ? "light" : "dark";
  apply();
  await chrome.storage.local.set({ [KEY]: stored });
}
