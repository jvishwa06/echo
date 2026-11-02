/**
 * Side panel: controls and the running transcript.
 *
 * It holds no audio and no socket, so closing it does not stop a capture — it
 * reads the current state from the service worker on open and then follows the
 * offscreen document's broadcasts. Every control writes straight to
 * `chrome.storage.local`, which is what the service worker reads when Start is
 * pressed, so the panel never has to hand its state over.
 */

import { LIVE_KEYS } from "../lib/live-session.js";
import { DEFAULTS, loadSettings, saveSettings } from "../lib/settings.js";
import { formatDuration } from "../lib/usage.js";
import { SIMUL_LANGUAGES, SIMUL_POPULAR_LANGUAGES, simulLanguageCode } from "../lib/languages.js";
import { localize, setMessage, t } from "../lib/i18n.js";
import { currentTheme, initTheme, toggleTheme } from "../lib/theme.js";

const SIMUL = { langs: SIMUL_LANGUAGES, popular: SIMUL_POPULAR_LANGUAGES };

const el = (id) => document.getElementById(id);

/**
 * Everything that would edit a run, for the panels that are not the run's.
 *
 * There is one engine and one run, and the settings behind these controls are
 * global — so a checkbox pressed on a tab that is not the running one would
 * silently reconfigure and reconnect a translation the user is not looking at.
 * The Stop button is deliberately not in this list: stopping from any tab is
 * what the toolbar icon is for.
 */
const RUN_CONTROLS = ["tabCaptions", "tabTarget", "duckLevel"];

let settings = { ...DEFAULTS };
let running = false;
// The last usage tally the offscreen document sent, or null before the first
// one. Kept so a redraw for any other reason does not wipe it.
let usage = null;
// The bubble currently being appended to, per side, so streamed
// increments extend a line instead of starting a new one.
const openLines = new Map();
/**
 * The tab this panel belongs to, and the tab the current run belongs to.
 *
 * They are usually the same one and the panel is then an ordinary control
 * panel. When they differ, this panel is a bystander: the run is somebody
 * else's page, and all it may do is show it and stop it.
 *
 * Asked for once, on the way in. The panel is scoped to its tab — Chrome
 * destroys this document when the user switches away and builds a fresh one on
 * the way back — so the active tab at init is always this panel's own, and a
 * tab id does not change under a navigation.
 */
let myTabId = null;
let runTabId = null;
let runTabTitle = "";
init();

async function init() {
  // First, and before the first `await`: every label on this page is an empty
  // element until this fills it, so anything that paints before it is blank.
  localize();
  initTheme(renderThemeToggle);
  settings = await loadSettings();
  const myTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  myTabId = myTab?.id ?? null;
  await fillTabTarget();
  bind();
  render();
  const state = await send({ type: "getState" });
  running = !!state?.running;
  restore(state);
  render();
}

/**
 * Redraw what arrived while this panel did not exist.
 *
 * Opening the panel is no longer a once-per-session event: it belongs to the
 * tab it was opened on, so every switch to another tab destroys this document
 * and every switch back builds a fresh one. The two things that were otherwise
 * only ever broadcast come back with the running state — the transcript from
 * the offscreen document, the subtitle warning from session storage — and the
 * lines still being streamed into are adopted as open, so the next increment of
 * a half-finished sentence extends it instead of printing it again underneath.
 */
function restore(state) {
  runTabId = state?.runTabId ?? null;
  runTabTitle = state?.runTabTitle || "";
  // Why the last run ended by itself, for a panel that was not there to be told
  // — it is kept in session storage until the next Start for exactly this.
  if (state?.lastError) showError(state.lastError);
  for (const line of state?.lines || []) {
    const node = appendLine(line);
    if (line.open) openLines.set(`${line.direction}:${line.side}`, node);
  }
  // `below` and not `transcript`: that is the element that scrolls.
  el("below").scrollTop = el("below").scrollHeight;
  if (state?.usage) {
    usage = state.usage;
    renderUsage();
  }
  // One string, `${status}: ${detail}`, the shape the service worker
  // deduplicates on.
  const stored = state?.captionStatus;
  if (!stored) return;
  const at = stored.indexOf(": ");
  if (at < 0) onCaptionStatus({ status: stored, detail: "" });
  else onCaptionStatus({ status: stored.slice(0, at), detail: stored.slice(at + 2) });
}

/**
 * The list is bundled, so the dropdown fills before the first paint. Older
 * builds stored a few languages under different codes, so map before filling so
 * a stored `zh` lands on Chinese rather than silently resetting to the top of
 * the list.
 */
async function fillTabTarget() {
  let code = settings.tabTarget;
  if (!(code in SIMUL_LANGUAGES)) code = simulLanguageCode(code);
  fill(el("tabTarget"), SIMUL, code);
  if (el("tabTarget").value !== settings.tabTarget) {
    settings.tabTarget = el("tabTarget").value;
    await saveSettings({ tabTarget: settings.tabTarget });
  }
}

/**
 * Ten popular languages first, then all of them alphabetically — the same
 * shape the web app's custom dropdown uses, expressed as `<optgroup>`s so the
 * side panel can stay on a native select. The popular codes appear twice on
 * purpose, once in each group, exactly as they do in the web app.
 */
function fill(select, { langs, popular }, selected) {
  select.innerHTML = "";
  const codes = Object.keys(langs).sort((a, b) => langs[a].localeCompare(langs[b]));
  const top = popular.filter((code) => code in langs);
  if (top.length) {
    select.appendChild(optgroup(t("panelLangPopular"), top, langs));
    select.appendChild(optgroup(t("panelLangAll"), codes, langs));
  } else {
    // A flat select reads better than one group holding everything.
    for (const code of codes) select.appendChild(option(code, langs[code]));
  }
  // Assigning `value` picks the first option with that code, which is the
  // popular copy where there is one; per-option `selected` would leave the
  // duplicate at the bottom of the list highlighted instead.
  select.value = codes.includes(selected) ? selected : top[0] || codes[0] || "";
}

function optgroup(label, codes, langs) {
  const group = document.createElement("optgroup");
  group.label = label;
  for (const code of codes) group.appendChild(option(code, langs[code]));
  return group;
}

function option(value, text) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  return opt;
}

function bind() {
  el("tabCaptions").addEventListener("change", () =>
    update({ tabCaptions: el("tabCaptions").checked })
  );
  el("tabTarget").addEventListener("change", () => update({ tabTarget: el("tabTarget").value }));
  el("duckLevel").addEventListener("input", () => {
    // A live key, so the slider can be dragged while listening.
    update({ duckLevel: Number(el("duckLevel").value) / 100 });
  });
  el("toggle").addEventListener("click", onToggle);
  el("soundMute").addEventListener("click", () => update({ soundMuted: !settings.soundMuted }));
  el("openOptions").addEventListener("click", openOptions);
  el("themeToggle").addEventListener("click", async () => {
    await toggleTheme();
    renderThemeToggle();
  });
  // The other way to the Options page is a link inside a sentence, and where in
  // that sentence it falls is the translator's business — so the link has no id
  // to bind to. `i18n.js` marks it `data-action` instead, and this catches it
  // wherever the message put it.
  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    if (action === "options") openOptions(event);
  });
}

/** The button's label names what a click switches to. */
function renderThemeToggle() {
  const dark = currentTheme() === "dark";
  const label = t(dark ? "panelThemeLight" : "panelThemeDark");
  el("themeToggle").title = label;
  el("themeToggle").setAttribute("aria-label", label);
}

function openOptions(event) {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
}

async function update(patch) {
  Object.assign(settings, patch);
  await saveSettings(patch);
  render();
  if (!running) return;
  // The target language is baked into the setup frame, so a change to it only
  // takes effect on reconnect. Cutting the audio to
  // apply a checkbox would be worse than the checkbox, so the rest are handed
  // over as a message instead — the offscreen document has no access to
  // `chrome.storage` and cannot pick them up on its own.
  if (Object.keys(patch).every((key) => LIVE_KEYS.includes(key))) {
    await send({ type: "live", patch });
  } else {
    await restart();
  }
}

function render() {
  el("tabCaptions").checked = settings.tabCaptions;
  el("tabTarget").value = settings.tabTarget;
  el("duckLevel").value = Math.round(settings.duckLevel * 100);
  el("duckLevelOut").textContent = `${Math.round(settings.duckLevel * 100)}%`;

  const hasKey = !!(settings.apiKey || "").trim();
  el("keyNeeded").hidden = hasKey;

  // One engine, one run, one tab. This panel is on a different tab from the run
  // whenever the user has switched away and clicked the icon somewhere else.
  // The controls here are wired to global settings and would reach into that
  // run, so they come off; the note says where it is, and Stop stays.
  const elsewhere = running && runTabId !== myTabId;
  if (runTabTitle) setMessage(el("elsewhereNote"), "panelRunningOn", [runTabTitle]);
  else setMessage(el("elsewhereNote"), "panelRunningElsewhere");
  el("elsewhereNote").hidden = !elsewhere;
  // Here and not above, because this is the line that owns `disabled` on all of
  // them: setting it earlier would be undone by the time anyone looked.
  for (const id of RUN_CONTROLS) {
    el(id).disabled = elsewhere;
  }

  renderMute("soundMute", settings.soundMuted, !elsewhere, ["panelMuteSound", "panelUnmuteSound"]);

  el("toggle").textContent = t(running ? "panelStop" : "panelStart");
  el("toggle").classList.toggle("running", running);
  // Stop is the exception to the paragraph above: it is the whole reason the
  // icon opens this panel on a tab that was never translating.
  el("toggle").disabled = elsewhere ? false : !hasKey;
  if (!running) setStatus("disconnected", t("statusIdle"));
}

/**
 * What this run has spent: how long, and how much, against a dial.
 *
 * Money is what the user is being asked about — the key is theirs and the bill
 * is theirs — so money is most of it. The token count is not shown: the tokens
 * are the thing measured rather than the thing wanted.
 *
 * What earns the second number is that the first one is not always about
 * anybody: a free-tier key is charged nothing, so the dollars are a rate card
 * rather than a bill, and "how long have I had this running" is the question
 * left. It is also the only figure here that is measured rather than estimated,
 * and it moves whether or not the rate table is still right.
 *
 * Which is why the dollars are shown only to a key that is being charged. The
 * tier cannot be detected — no Gemini API response carries it — so it is asked
 * for on the Options page, and a free-tier run gets the audio it has moved
 * instead of a price it will never pay. That is not a consolation figure: the
 * free tier is limited by rate rather than by money, so the seconds of audio
 * are what the limits are actually spent on, and the number that predicts the
 * run failing to reconnect.
 *
 * The figure is prefixed with a tilde and the sentence after it says "an
 * estimate, not your actual bill", in the markup rather than in the title
 * attribute. The prices behind it are a hardcoded table in `lib/usage.js` that
 * goes stale silently, and the tier it is priced at is whatever the Options
 * page was told, which nothing checks. A figure in dollars reads as a bill
 * unless it says otherwise, and a tooltip is not where a number disclaims
 * itself: nobody hovers. What is left for the tooltip is the arithmetic,
 * including the two audio times it is derived from — the thing that would have
 * made #16 legible from the panel instead of from a stopwatch.
 */
function renderUsage() {
  const note = el("usageNote");
  if (!usage?.total) {
    note.hidden = true;
    return;
  }
  const { inSeconds = 0, outSeconds = 0, elapsedSeconds = 0 } = usage.total;
  // The wall clock since Start, then the audio moved in both directions, which
  // is what the free tier's limits are spent on.
  setMessage(el("usageText"), "panelUsageFree", [
    formatDuration(elapsedSeconds),
    formatDuration(inSeconds + outSeconds),
  ]);
  const arithmetic = t("panelUsageTip", [
    formatDuration(elapsedSeconds),
    formatDuration(inSeconds),
    formatDuration(outSeconds),
  ]);
  note.title = `${arithmetic} ${t("panelUsageTipFree")}`;
  note.hidden = false;
}

/**
 * One mute button: the slash, the pressed state and the tooltip that names it.
 *
 * The tooltip is the whole label — the buttons carry an icon and no text — so it
 * says what pressing will do rather than what the state is, and `aria-pressed`
 * carries the state for anything reading the panel out. A greyed button says why
 * it is greyed instead: a control disabled by something the user cannot see
 * reads as a broken one.
 *
 * *labels* is `[mute, unmute]` as two whole messages rather than a verb and a
 * noun spliced together: a language that puts its object first cannot be built
 * out of the English halves.
 */
function renderMute(id, muted, applies, [mute, unmute], why = "panelMuteOffElsewhere") {
  const button = el(id);
  button.classList.toggle("off", muted);
  button.setAttribute("aria-pressed", String(muted));
  button.disabled = !applies;
  button.title = t(!applies ? why : muted ? unmute : mute);
}

async function onToggle() {
  el("toggle").disabled = true;
  clearError();
  try {
    if (running) {
      await send({ type: "stop" }, true);
      running = false;
      runTabId = null;
      runTabTitle = "";
    } else {
      // Cleared before the run, not after it. `start()` reports the subtitle
      // status from inside itself — a page that refuses injection is known
      // before it returns — so clearing on the way out raced that message and
      // usually won, wiping the one note the user needed. Nothing re-sends it:
      // the report is deduplicated against session storage, so every later
      // attempt on the same page is suppressed as a repeat of what was, by
      // then, already hidden.
      el("transcript").innerHTML = "";
      el("captionNote").hidden = true;
      // Cleared on the way in, not on the way out: what the last run cost is
      // worth reading after Stop, and this run has not spent anything yet.
      usage = null;
      renderUsage();
      openLines.clear();
      // Claimed before the run exists, not after it: the offscreen document
      // broadcasts `state` from inside Start, well before the service worker
      // has written down whose run it is, and a panel that had not claimed it
      // by then would draw its own run as a stranger's for as long as that took.
      runTabId = myTabId;
      // This panel's own tab, named rather than left to be guessed: the service
      // worker's other candidate is the last tab the icon was clicked on, which
      // is a different tab as soon as the user has switched between two that
      // both have a panel.
      await send({ type: "start", tabId: myTabId }, true);
      running = true;
    }
  } catch (err) {
    showError(err.message);
    running = false;
    runTabId = null;
    runTabTitle = "";
  }
  render();
  el("toggle").disabled = false;
}

async function restart() {
  await send({ type: "stop" }, true).catch(() => {});
  // The run comes back on this tab, which is the tab it was on: only the
  // owner's panel has controls to change, so only the owner gets here.
  await send({ type: "start", tabId: myTabId }, true);
  runTabId = myTabId;
}

async function send(message, throwOnError = false) {
  const reply = await chrome.runtime.sendMessage({ target: "sw", ...message });
  if (throwOnError && reply && !reply.ok) throw new Error(reply.error);
  return reply;
}

// The key is set on the Options page, which is a different document, so the
// panel only learns about it through storage. It gates the Start button.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.apiKey) return;
  settings.apiKey = changes.apiKey.newValue;
  if (settings.apiKey) clearError();
  render();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "ui") return;
  if (msg.type === "state") {
    running = msg.running;
    render();
  } else if (msg.type === "run") {
    // Whose run this is. It arrives separately from `state`, which the
    // offscreen document broadcasts and which cannot name a tab because that
    // document has none. Until this lands, a panel that did not press Start
    // itself has a run and no owner, which is drawn as somebody else's — the
    // safe way round.
    runTabId = msg.runTabId;
    runTabTitle = msg.runTabTitle || "";
    render();
  } else if (msg.type === "status") {
    onStatus(msg);
  } else if (msg.type === "transcript") {
    onTranscript(msg);
  } else if (msg.type === "turnComplete") {
    for (const key of [...openLines.keys()]) {
      if (key.startsWith(msg.direction)) openLines.delete(key);
    }
  } else if (msg.type === "usage") {
    usage = msg.usage;
    renderUsage();
  } else if (msg.type === "captions") {
    onCaptionStatus(msg);
  } else if (msg.type === "error") {
    // A run ending on its own, which until now it never did: a session loop
    // that has given up takes the whole run down with it, and the banner is
    // where the reason and what to do about it go. The Idle state arrives
    // separately, as the `state` message behind the stop this triggered.
    showError(msg.detail);
  }
});

/**
 * Whether the subtitles are reaching the page, in the panel rather than in a
 * console nobody has open.
 *
 * The checkbox says subtitles are on; whether Chrome let us put them there is a
 * different question, and until now the answer was only ever visible to
 * whoever thought to open the service worker's console.
 */
function onCaptionStatus({ status, detail }) {
  const note = el("captionNote");
  if (status === "ok" || status === "off") {
    note.hidden = true;
    return;
  }
  const lead = t(status === "unavailable" ? "panelCaptionsUnavailable" : "panelCaptionsStopped");
  note.textContent = detail ? `${lead} ${detail}` : lead;
  note.hidden = false;
}

function onStatus({ status, detail }) {
  if (status === "connected") setStatus("", t("statusConnected"));
  else if (status === "connecting") setStatus("connecting", t("statusConnecting"));
  else if (status === "error") setStatus("disconnected", detail || t("statusError"));
  else if (status === "disconnected") setStatus("disconnected", t("statusReconnecting"));
  // The detail of a `failed` is a paragraph and goes to the banner, not into
  // the one line of the header. This says only that the retrying has stopped.
  else if (status === "failed") setStatus("disconnected", t("statusStopped"));
}

function setStatus(cls, text) {
  el("statusDot").className = `dot ${cls}`;
  el("statusText").textContent = text;
}

function onTranscript({ direction, side, text, finished }) {
  const key = `${direction}:${side}`;
  let line = openLines.get(key);
  if (!line) {
    line = appendLine({ direction, side, text });
    openLines.set(key, line);
  }
  line.lastChild.textContent = text;
  if (finished) openLines.delete(key);
  el("below").scrollTop = el("below").scrollHeight;
}

/** One bubble, appended. Shared by the live feed and by `restore`. */
function appendLine({ direction, side, text }) {
  const line = document.createElement("div");
  line.className = `line ${side}`;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = t(side === "input" ? "panelHeard" : "panelTranslated");
  line.appendChild(tag);
  const body = document.createElement("span");
  body.className = "body";
  // The transcript is in the languages being translated, which have nothing to
  // do with the language the panel is in: Arabic in an English panel, English
  // in an Arabic one. `auto` lets each
  // bubble take its direction from its own first strong character, while the
  // tag above it stays in the interface's.
  body.dir = "auto";
  body.textContent = text;
  line.appendChild(body);
  el("transcript").appendChild(line);
  return line;
}

function showError(message) {
  el("error").textContent = message;
  el("error").hidden = false;
}

function clearError() {
  el("error").hidden = true;
}
