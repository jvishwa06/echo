/**
 * The Live translation models a given API key can use.
 *
 * Asked of `models.list` on the user's own key, so the Options menu shows what
 * that key can actually reach rather than a list shipped with the build.
 *
 * Two filters, both about whether a model can do this extension's job:
 *
 * - `bidiGenerateContent` among its methods: the model can run a Live session
 *   over the WebSocket the offscreen document opens.
 * - "translate" in its name: every session sends `translationConfig` (see
 *   `buildSetup`), which only the Live translation models accept. Other Live
 *   models open the socket and then reject the setup.
 */

const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Enough pages for any realistic list, and a stop for a server that loops. */
const MAX_PAGES = 10;

/** Is this `models.list` entry a Live model that can translate tab audio? */
export function isTranslationLiveModel(model) {
  const methods = model?.supportedGenerationMethods || [];
  const id = modelId(model);
  return methods.includes("bidiGenerateContent") && /translate/i.test(id);
}

/** `models/gemini-x` → `gemini-x`. */
export function modelId(model) {
  return String(model?.name || "").replace(/^models\//, "");
}

/**
 * Every suitable model the key can use, as `[{ id, label }]`, sorted by id.
 *
 * Rejects with the API's own message when the request fails, so the Options
 * page can say why the list is empty.
 */
export async function listTranslationModels(apiKey, { fetchImpl = fetch } = {}) {
  const found = new Map();
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(MODELS_URL);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetchImpl(url.toString());
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* handled below */
    }
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    for (const model of body?.models || []) {
      if (!isTranslationLiveModel(model)) continue;
      const id = modelId(model);
      const name = model.displayName && model.displayName !== id ? model.displayName : "";
      found.set(id, { id, label: name ? `${name} (${id})` : id });
    }
    pageToken = body?.nextPageToken || "";
    if (!pageToken) break;
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}
