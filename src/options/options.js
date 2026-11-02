/**
 * Options: the API key, caption size and model.
 *
 * All of it lives in `chrome.storage.local`, which is the only store the side
 * panel, the service worker and the offscreen document can all read. Nothing
 * here is uploaded anywhere — there is no server to upload it to.
 */

import {
  CAPTION_SIZE_MAX,
  CAPTION_SIZE_MIN,
  DEFAULTS,
  loadSettings,
  saveSettings,
} from "../lib/settings.js";
import { SIMUL_MODEL } from "../lib/languages.js";
import { listTranslationModels } from "../lib/models.js";
import { localize, t } from "../lib/i18n.js";
import { initTheme } from "../lib/theme.js";

const el = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };

init();

async function init() {
  // First, and before the first `await`: the page ships with empty elements, so
  // until this runs there is nothing on it to read.
  localize();
  initTheme();
  settings = await loadSettings();
  el("apiKey").value = settings.apiKey;
  loadCaptionSize();
  bind();
  renderKeyStatus();
  await loadModels();
}

function bind() {
  // `change` rather than `input`: saving on every keystroke would write a
  // trail of truncated keys through storage on the way to the real one.
  el("apiKey").addEventListener("change", saveKey);
  el("toggleKey").addEventListener("click", toggleKey);
  // `input`, not `change`: the overlay follows the store, so writing on every
  // drag step is what makes the size adjustable against the live video.
  el("captionSize").addEventListener("input", () => {
    const px = Number(el("captionSize").value);
    renderCaptionSize(px);
    saveSettings({ captionSize: px });
  });
  el("simulModel").addEventListener("change", saveModel);
}

async function saveKey() {
  settings.apiKey = el("apiKey").value.trim();
  el("apiKey").value = settings.apiKey;
  await saveSettings({ apiKey: settings.apiKey });
  renderKeyStatus();
  // A different key can reach a different set of models.
  await loadModels();
}

/**
 * There is no way to check a key short of opening a session, and doing that
 * here would bill the user for a connection they did not ask for. So this
 * reports what it can see — a key is present — and leaves the real verdict to
 * the first Start, where a rejection is already reported.
 *
 * What it does not do is guess at the format. This used to require
 * `^AIza[\w-]{30,}$`, which was true of every key Google issued for years and
 * is false of the `AQ.Ab8RN6…` ones it issues now — a different prefix and a
 * dot, rejected twice over — so it told people holding a working key that it
 * did not look like one. The shape is Google's to change and it changed;
 * `endpointUrl` already escapes the key on the assumption that its characters
 * are not ours to predict, and this is that assumption applied where the user
 * can see it. A warning that fires on a key that works is worse than no
 * warning, because the next thing to go wrong gets read as its consequence.
 *
 * So the check is narrowed to pastes that cannot be a key under any format:
 * something with a space in the middle, an address rather than a credential, or
 * too few characters to be a secret. Those are the actual mistakes — half a
 * selection, the URL of the page the key is on, the account it belongs to.
 */
function renderKeyStatus() {
  const node = el("apiKeyStatus");
  const key = settings.apiKey;
  if (!key) {
    setStatus(node, "");
  } else if (/\s/.test(key) || key.includes("://") || key.includes("@")) {
    setStatus(node, t("optKeyStray"));
  } else if (key.length < 20) {
    setStatus(node, t("optKeyShort"));
  } else {
    setStatus(node, "");
  }
}

function toggleKey() {
  const field = el("apiKey");
  const hidden = field.type === "password";
  field.type = hidden ? "text" : "password";
  el("toggleKey").textContent = t(hidden ? "optHide" : "optShow");
}

// Bumped on every load, so a slow answer for an old key cannot overwrite the
// list for the key typed after it.
let modelsRequest = 0;

/**
 * Fill the model menu with the translation models this key can use.
 *
 * Asked of Google with the key itself, so the menu is exactly what the key can
 * reach. The saved choice is kept when the key still has it; otherwise the
 * bundled model is picked if available, else the first one listed, and that
 * pick is saved so the menu always shows the model Start will use.
 */
async function loadModels() {
  const request = ++modelsRequest;
  const select = el("simulModel");
  const key = (settings.apiKey || "").trim();
  if (!key) {
    fillModels([]);
    setStatus(el("modelStatus"), t("optModelNoKey"));
    return;
  }
  select.disabled = true;
  setStatus(el("modelStatus"), t("optModelLoading"));
  let models;
  try {
    models = await listTranslationModels(key);
  } catch (err) {
    if (request !== modelsRequest) return;
    fillModels([]);
    setStatus(el("modelStatus"), t("optModelLoadFailed", [err.message]));
    return;
  }
  if (request !== modelsRequest) return;
  fillModels(models);
  if (!models.length) {
    setStatus(el("modelStatus"), t("optModelNone"));
    return;
  }
  setStatus(el("modelStatus"), "");
  if (select.value !== settings.simulModel) {
    settings.simulModel = select.value;
    await saveSettings({ simulModel: settings.simulModel });
  }
}

function fillModels(models) {
  const select = el("simulModel");
  select.innerHTML = "";
  for (const { id, label } of models) select.appendChild(new Option(label, id));
  select.disabled = !models.length;
  if (!models.length) return;
  const ids = models.map((m) => m.id);
  const saved = settings.simulModel || "";
  select.value = ids.includes(saved) ? saved : ids.includes(SIMUL_MODEL) ? SIMUL_MODEL : ids[0];
}

async function saveModel() {
  settings.simulModel = el("simulModel").value;
  await saveSettings({ simulModel: settings.simulModel });
  setStatus(el("modelStatus"), t("optModelSaved"), true);
}

function loadCaptionSize() {
  const slider = el("captionSize");
  slider.min = CAPTION_SIZE_MIN;
  slider.max = CAPTION_SIZE_MAX;
  const px = Math.min(
    CAPTION_SIZE_MAX,
    Math.max(CAPTION_SIZE_MIN, Number(settings.captionSize) || DEFAULTS.captionSize)
  );
  slider.value = px;
  renderCaptionSize(px);
}

/**
 * The preview is the point of the slider: a pixel count means nothing until it
 * is a line of text, and the same numbers are used here as in the overlay's own
 * stylesheet so what is shown is what lands on the page.
 */
function renderCaptionSize(px) {
  el("captionSizeOut").textContent = t("optSizePx", [px]);
  el("captionPreview").querySelector("span").style.fontSize = `${px}px`;
}

function setStatus(node, text, ok = false) {
  node.textContent = text;
  node.className = ok ? "note ok" : "note";
}
