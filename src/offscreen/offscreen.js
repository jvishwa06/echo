/**
 * The engine: every MediaStream, AudioContext and WebSocket lives here.
 *
 * Nothing else in the extension has a long enough life to hold them. A service
 * worker is torn down after ~30s idle; a side panel or popup dies when it is
 * closed. An offscreen document created with USER_MEDIA and AUDIO_PLAYBACK
 * outlives both, which is why the capture keeps running when the panel is shut.
 *
 * Audio graph — three AudioContexts, one per sample rate:
 *
 *   tabStream ─┬─► ctxPass (native) ─► duckGain ─► speakers
 *              └─► ctxUp (16 kHz) ─► recorder worklet ─► Live session
 *   session audio ─► ctxDown (24 kHz) ─► player worklet ─► speakers
 *
 * ctxPass is not optional: capturing a tab mutes it for the user, and this is
 * the graph that gives the sound back. It runs at the stream's native rate
 * because pushing 48 kHz tab audio through the 24 kHz player context would
 * resample it down and audibly dull anything musical.
 */

import { buildSetup, LIVE_KEYS, modelsFor, UPLINK_RATE } from "../lib/live-session.js";
import { SessionLoop } from "../lib/session-loop.js";
import { cleanCJKSpaces } from "../lib/text.js";
import { emptyUsage, noteAudioIn, noteAudioOut } from "../lib/usage.js";
import { t } from "../lib/i18n.js";

const DOWNLINK_RATE = 24000; // what Gemini returns

// Ducking. The ramp is short enough to be under the first syllable and long
// enough not to click; the release keeps the original down through the gaps
// between phrases instead of pumping on every pause.
const DUCK_RAMP_SEC = 0.12;
const VOICE_RELEASE_SEC = 0.4;

// Simultaneous translation never sends `turnComplete` — there are no turns in a
// continuous feed. Without a second signal the transcript accumulator would run
// for the whole session and the on-page caption would be one line that grows
// until it covers the video. A gap in the increments is the only turn boundary
// on offer, so it is the one used.
const SIMUL_IDLE_MS = 2000;

// How many transcript lines are kept for a side panel that is not currently
// open. Enough to scroll back through a meeting, short enough that an hour of
// continuous subtitling cannot grow this document without bound.
const HISTORY_LIMIT = 200;

// The whole transcript of the run, for the minutes of meeting (see
// `lib/minutes.js`). Unlike the panel history it has to reach back to Start, so
// it is capped only as a guard against a run left going for days: text is
// cheap, and this is many hours of continuous speech.
const RECORD_LIMIT = 20000;

// How often the running token tally is pushed to the panel. Usage frames can
// arrive with every turn, and a figure that moves faster than it can be read is
// a distraction rather than information — a second is slow enough to read and
// fast enough to answer "is this counting?".
const USAGE_POST_MS = 1000;

const state = {
  settings: null,
  // Held only for the life of a run, and only so a reconnect can reopen the
  // socket without waking the service worker for the key again.
  apiKey: null,
  ctxPass: null,
  ctxUp: null,
  ctxDown: null,
  duckGain: null,
  tabStream: null,
  tab: null, // {session, player, node, acc}
  // Wall-clock second at which the last enqueued translated audio finishes
  // playing. Audio arrives from the model far faster than realtime, so "are we
  // speaking right now" cannot be answered by "did a frame just arrive" — it has
  // to be tracked as a play-out deadline.
  playoutEndsAt: 0,
  duckTimer: null,
  ducked: false,
  // The transcript, kept here because this is the only context that outlives
  // both the side panel and the service worker — see `noteLine`.
  lines: [],
  openLines: new Map(),
  // Every line since Start, in order — the same objects as `lines`, so a
  // streamed increment updates both. Read by `record()`.
  record: [],
  // The trailing-edge timer behind USAGE_POST_MS. The tally itself lives on the
  // session's accumulator, which is where the events arrive.
  usageTimer: null,
  // When Start was pressed, for the clock beside the cost. Kept here and not in
  // the panel: the panel can be closed and reopened mid-run, and a timer that
  // restarted with it would say the run began when the user last looked at it.
  startedAt: 0,
  // Set once the session loop has given up and the run is being taken down, so
  // the failure is reported once — see `failRun`.
  failed: false,
  // What the service worker's preflight learned about the key, phrased for a
  // socket that then closes on 1006 with no reason of its own. Empty unless the
  // preflight had an opinion — see `lib/preflight.js`.
  closeHint: "",
  active: false,
};

// Declared here, above the message listener, and deliberately not as a
// `const` initialised at the end of the module: the service worker retries
// `sendMessage` every 50ms until the listener below exists, so a `start` can
// arrive in the window between that listener being registered and the last
// statement of this module running. A trailing `const` would still be in its
// temporal dead zone at that point, and `start` would throw reading it.
let contextsReady = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false;
  const done = (result) => sendResponse({ ok: true, ...result });
  const fail = (err) => sendResponse({ ok: false, error: String(err?.message || err) });
  if (msg.type === "start") start(msg).then(done).catch(fail);
  else if (msg.type === "stop") stop().then(done).catch(fail);
  else if (msg.type === "live") {
    try {
      applyLive(msg.patch);
      done({});
    } catch (err) {
      fail(err);
    }
  } else if (msg.type === "history") done({ lines: history(), usage: usageSnapshot() });
  else if (msg.type === "transcript") done({ lines: record() });
  else return false;
  return true;
});

/**
 * The settings that take effect without reopening the sessions.
 *
 * The duck level is a knob people reach for while listening, and the subtitle
 * switch is a filter on the fan-out at the bottom of this file — reconnecting to
 * apply either would cut the audio the user is adjusting.
 *
 * They are pushed in over `chrome.runtime` rather than read out of storage,
 * which is not a style choice. **An offscreen document is granted the messaging
 * API and nothing else: `chrome.storage` is undefined here.** This used to be a
 * `chrome.storage.onChanged` listener at module scope, and it threw on every
 * evaluation of this file — after the message listener above was registered and
 * with every function below it hoisted, so start/stop and all the audio worked
 * and the only casualty was the listener itself. The symptom was that ticking
 * *Subtitles on the page* mid-session did nothing at all, for the rest of the
 * session, in silence. `tests/assets.test.js` now fails the build if anything
 * in this file reaches past `chrome.runtime` again.
 */
function applyLive(patch = {}) {
  if (!state.settings) return;
  for (const key of LIVE_KEYS) {
    if (key in patch) state.settings[key] = patch[key];
  }
  if ("duckLevel" in patch) applyDuck(state.ducked, true);
  if (patch.soundMuted) dropQueuedVoice();
}

/**
 * Throw away the translated audio already queued, not only the audio still to
 * come.
 *
 * The model returns a sentence far faster than it takes to say it, so at any
 * moment the player holds seconds of speech nobody has heard yet. Muting the
 * incoming frames alone would leave all of it to play out, and the button would
 * look broken for as long as the sentence lasted. Clearing the play-out deadline
 * with it lets the duck release on the next tick instead of holding the tab
 * audio down for a translation that is no longer coming.
 */
function dropQueuedVoice() {
  if (!state.tab) return;
  state.tab.player.port.postMessage({ command: "endOfAudio" });
  state.playoutEndsAt = 0;
}

async function start({ apiKey, streamId, settings, closeHint }) {
  await ensureContexts();
  await stop();
  state.settings = settings;
  state.apiKey = apiKey;
  // Before the session opens rather than after, so the clock beside the cost
  // covers the whole run.
  state.startedAt = performance.now();
  state.failed = false;

  // What the service worker's preflight learned about this key, if anything —
  // it runs there rather than here because it has to happen before the tab is
  // captured, and by the time a `start` reaches this document it already has
  // been. Empty unless the API had an opinion.
  state.closeHint = closeHint || "";

  // A failure part-way leaves nothing running behind a panel that says Idle.
  try {
    await openTab(streamId);
  } catch (err) {
    await stop();
    throw err;
  }

  startDuckLoop();
  state.active = true;
  post({ type: "state", running: true });
}

/** Capture the tab, keep it audible, and give it its own Live session. */
async function openTab(streamId) {
  if (!streamId) throw new Error(t("errNoStreamId"));
  state.tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });
  startPassthrough(state.tabStream);
  state.tab = openSession(state.tabStream);
}

/** Restore the captured tab's audibility, through the gain node that ducks it. */
function startPassthrough(stream) {
  state.ctxPass = new AudioContext();
  resume(state.ctxPass);
  state.duckGain = state.ctxPass.createGain();
  state.duckGain.gain.value = 1;
  state.ctxPass.createMediaStreamSource(stream).connect(state.duckGain);
  state.duckGain.connect(state.ctxPass.destination);
}

/** Wire the tab stream to a Live session, and the replies to the speakers. */
function openSession(stream) {
  const player = makePlayer(state.ctxDown);
  // `usage` rides along with the transcript accumulator because the events it
  // is fed by arrive through the same handler. The tally has to
  // live out here rather than in the session: `SessionLoop` retires a session
  // roughly every ten minutes, and a counter inside one would restart from zero
  // with each of them.
  const models = modelsFor(state.settings);
  const acc = {
    input: "",
    output: "",
    idle: null,
    usage: emptyUsage(),
  };
  const session = new SessionLoop({
    apiKey: state.apiKey,
    setup: buildSetup(state.settings),
    closeHint: state.closeHint,
    models,
    onStatus: (status, detail) => {
      post({ type: "status", direction: "tab", status, detail });
      // The loop has stopped trying and will not restart itself.
      if (status === "failed") failRun(detail);
    },
    onEvent: (ev) => onEvent(ev, player, acc),
  });
  session.start();
  // Ungated: the tab feed is a digital tap and never hears the speakers.
  const node = makeRecorder(stream, (pcm) => {
    session.send(pcm);
    // Counts what went on the wire and nothing else, which is what the Live API
    // prices. Posting from a path that runs every 32 ms is free — the schedule
    // coalesces to one post a second and returns on a single comparison.
    noteAudioIn(acc.usage, pcm.byteLength / 2 / UPLINK_RATE);
    scheduleUsagePost();
  });
  return { session, player, node, acc };
}

/**
 * Transcripts arrive as increments and are accumulated here, not downstream.
 *
 * A `finished` frame carries the whole sentence rather than the next piece of
 * it, so it replaces the accumulator instead of extending it. Doing it here means the side panel and the
 * page captions both receive whole sentences and neither has to keep its own
 * copy of the state.
 */
function onEvent(ev, player, acc) {
  if (ev.type === "audio") {
    // Counted before the mute below, and before anything else can drop it: the
    // server sent this audio and is charging for it whether or not it reaches a
    // speaker. Muting silences the translation, not the usage.
    noteAudioOut(acc.usage, ev.buffer.byteLength / 2 / DOWNLINK_RATE);
    scheduleUsagePost();
    // Only the audio is dropped. The transcript of the same sentence goes on
    // arriving, so the sound can be switched off and the translation still read
    // — in the panel and, if they are on, in the subtitles on the page.
    if (state.settings?.soundMuted) return;
    player.port.postMessage(ev.buffer);
    noteVoiceAudio(ev.buffer.byteLength);
    return;
  }
  if (ev.type === "turnComplete") {
    endTurn(acc);
    return;
  }
  // What the server says it used. Swallowed rather than read: the price comes
  // from the audio clock instead, for the reasons in `lib/usage.js`. It has to
  // be caught here all the same, or it falls through to the transcript
  // accumulator below as if it were text.
  if (ev.type === "usage") return;
  acc[ev.type] = ev.finished ? ev.text : acc[ev.type] + ev.text;
  const text = acc[ev.type];
  if (ev.finished) acc[ev.type] = "";
  // Simultaneous translation never sends `turnComplete`, so a silence gap is
  // what closes a sentence.
  clearTimeout(acc.idle);
  acc.idle = setTimeout(() => endTurn(acc), SIMUL_IDLE_MS);
  post({
    type: "transcript",
    direction: "tab",
    side: ev.type, // "input" (what was heard) or "output" (the translation)
    text: ev.type === "input" ? cleanCJKSpaces(text) : text,
    finished: ev.finished,
  });
}

/**
 * End the run because the session loop gave up (#13).
 *
 * The stop is asked for rather than done here. The service worker owns the run
 * — it holds the `running` flag a reopened panel reads, the caption overlay,
 * the tab marker and this document's own lifetime — so a document that quietly
 * shut its own sessions down would leave every one of those saying the run is
 * still going. What is done here is the message: it goes out first, and
 * directly, because the stop that follows closes this document.
 *
 * Once per run.
 */
function failRun(detail) {
  if (!state.active || state.failed) return;
  state.failed = true;
  post({ type: "error", detail });
  chrome.runtime.sendMessage({ target: "sw", type: "failed", detail }).catch(() => {});
}

/** Close the open sentence: drop the accumulator and let both surfaces know. */
function endTurn(acc) {
  clearTimeout(acc.idle);
  acc.idle = null;
  acc.input = "";
  acc.output = "";
  post({ type: "turnComplete", direction: "tab" });
}

/**
 * How long the run has gone and how much audio it has moved.
 *
 * Nothing until audio has moved: a session still opening is quiet, not free.
 */
function usageSnapshot() {
  const acc = state.tab?.acc;
  if (!acc?.usage.inSeconds && !acc?.usage.outSeconds) return null;
  // The elapsed time is a wall clock, not a sum of audio.
  return {
    total: {
      inSeconds: acc.usage.inSeconds,
      outSeconds: acc.usage.outSeconds,
      elapsedSeconds: (performance.now() - state.startedAt) / 1000,
    },
  };
}

/** Trailing edge only: the first tally lands a second in, and none is skipped. */
function scheduleUsagePost() {
  if (state.usageTimer) return;
  state.usageTimer = setTimeout(() => {
    state.usageTimer = null;
    const usage = usageSnapshot();
    if (usage) post({ type: "usage", usage });
  }, USAGE_POST_MS);
}

/** 16 kHz uplink: mono-downmixed PCM16, the format the Live API takes. */
function makeRecorder(stream, onPcm) {
  const ctx = state.ctxUp;
  const node = new AudioWorkletNode(ctx, "pcm-recorder-processor", {
    // Tab audio is usually stereo. Explicit mono makes the graph downmix it
    // properly instead of the worklet silently reading the left channel only.
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  node.port.onmessage = (event) => onPcm(floatToPcm16(event.data));
  ctx.createMediaStreamSource(stream).connect(node);
  return node;
}

function makePlayer(ctx) {
  const node = new AudioWorkletNode(ctx, "pcm-player-processor");
  node.connect(ctx.destination);
  return node;
}

function floatToPcm16(input) {
  const pcm16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) pcm16[i] = input[i] * 0x7fff;
  return pcm16.buffer;
}

/** Extend the play-out deadline by the audio just enqueued. */
function noteVoiceAudio(byteLength) {
  const seconds = byteLength / 2 / DOWNLINK_RATE;
  const now = performance.now() / 1000;
  state.playoutEndsAt = Math.max(state.playoutEndsAt, now) + seconds;
}

/** Is the translation speaking? */
function speaking() {
  return performance.now() / 1000 < state.playoutEndsAt + VOICE_RELEASE_SEC;
}

/**
 * Duck the original while a translation is speaking, not for the whole session.
 *
 * A constant duck would hold a film's score at 15% through every silence
 * between lines. Following the play-out deadline instead means the original is
 * at full volume whenever the interpreter has nothing to say.
 */
function startDuckLoop() {
  clearInterval(state.duckTimer);
  state.duckTimer = setInterval(() => applyDuck(speaking()), 100);
}

function applyDuck(shouldDuck, force = false) {
  if (!state.duckGain) return;
  if (shouldDuck === state.ducked && !force) return;
  state.ducked = shouldDuck;
  const level = shouldDuck ? Number(state.settings?.duckLevel ?? 0.15) : 1;
  const gain = state.duckGain.gain;
  gain.cancelScheduledValues(state.ctxPass.currentTime);
  gain.setTargetAtTime(level, state.ctxPass.currentTime, DUCK_RAMP_SEC / 3);
}

async function stop() {
  clearInterval(state.duckTimer);
  state.duckTimer = null;
  // The tally goes with the session below, and the panel keeps the last
  // figure it was sent: what a run cost is worth reading after it has ended,
  // and it is cleared by the next Start rather than by this Stop.
  clearTimeout(state.usageTimer);
  state.usageTimer = null;
  const tab = state.tab;
  if (tab) {
    clearTimeout(tab.acc.idle);
    tab.session.close();
    tab.node.port.onmessage = null;
    tab.node.disconnect();
    tab.player.disconnect();
  }
  state.tab = null;
  state.tabStream?.getTracks().forEach((track) => track.stop());
  state.tabStream = null;
  if (state.ctxPass) {
    await state.ctxPass.close().catch(() => {});
    state.ctxPass = null;
    state.duckGain = null;
  }
  state.playoutEndsAt = 0;
  state.ducked = false;
  state.apiKey = null;
  // The verdict was about the key this run held, at the moment it was asked.
  state.closeHint = "";
  // `start` calls this first to clear any previous run. Announcing a stop that
  // never followed a start would flip the side panel's button to Start for the
  // instant between the two.
  if (state.active) post({ type: "state", running: false });
  state.active = false;
}

function resume(ctx) {
  // Extension pages are exempt from the autoplay gesture requirement, but a
  // context can still come up suspended; without this nothing is ever audible.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

/**
 * Fan out to the side panel and, via the service worker, to the page captions.
 *
 * Both are optional listeners — the panel may be closed and the page may have
 * refused injection — and `sendMessage` rejects when nobody is listening, so
 * every send here is fire-and-forget.
 *
 * The side panel always gets everything; the page overlay only gets the
 * translation, and only while subtitles are switched on.
 */
function post(payload) {
  noteLine(payload);
  chrome.runtime.sendMessage({ target: "ui", ...payload }).catch(() => {});
  const forCaptions =
    (payload.type === "transcript" && payload.side === "output") ||
    payload.type === "turnComplete";
  if (forCaptions && !state.settings?.tabCaptions) return;
  // `state` is the stop signal that tears the overlay down, and it has to
  // arrive whatever the switch says.
  if (forCaptions || payload.type === "state") {
    chrome.runtime.sendMessage({ target: "sw", type: "caption", payload }).catch(() => {});
  }
}

/**
 * Keep a copy of the transcript, for a side panel that is not there to hear it.
 *
 * The panel is scoped to one tab, so its document is torn down every time the
 * user looks at another one and the lines that arrive meanwhile have nobody to
 * arrive at. This mirrors what the panel would have drawn — the same open-line
 * bookkeeping, keyed by direction and side, so a streamed increment extends a
 * line instead of appending a new one — and hands the result over on `history`
 * when a panel comes back.
 *
 * Only the current run: this document is created at Start and closed at Stop,
 * which is exactly the span the transcript belongs to.
 */
function noteLine(payload) {
  if (payload.type === "turnComplete") {
    for (const key of [...state.openLines.keys()]) {
      if (key.startsWith(payload.direction)) state.openLines.delete(key);
    }
    return;
  }
  if (payload.type !== "transcript") return;
  const { direction, side, text, finished } = payload;
  const key = `${direction}:${side}`;
  let line = state.openLines.get(key);
  if (!line) {
    line = { direction, side, text };
    state.lines.push(line);
    if (state.lines.length > HISTORY_LIMIT) state.lines.shift();
    state.record.push(line);
    if (state.record.length > RECORD_LIMIT) state.record.shift();
    state.openLines.set(key, line);
  }
  line.text = text;
  if (finished) state.openLines.delete(key);
}

/**
 * The transcript so far, with the lines still being streamed into marked.
 *
 * A panel that redraws an unfinished line has to know it is unfinished:
 * otherwise the next increment of it — the same sentence, one word longer —
 * arrives as a line of its own and the text is on screen twice.
 */
function history() {
  const open = new Set(state.openLines.values());
  return state.lines.map((line) => ({ ...line, open: open.has(line) }));
}

/** Every line since Start, oldest first, as `{ side, text }`. */
function record() {
  return state.record
    .filter((line) => line.text && line.text.trim())
    .map(({ side, text }) => ({ side, text }));
}

/**
 * The two rate-fixed contexts, built once and reused across start/stop cycles.
 *
 * Registering an AudioWorklet module is asynchronous, and doing it per start
 * would race the first arriving audio frame — so this is done once and `start`
 * awaits it. Lazily, on the first start rather than at load, so that the order
 * of statements in this module cannot matter to a message that arrives mid-
 * evaluation. A failure is not cached: a worklet that failed to register once
 * leaves the extension unusable until reload if the next Start cannot retry.
 */
function ensureContexts() {
  if (!contextsReady) {
    contextsReady = initContexts().catch((err) => {
      contextsReady = null;
      throw err;
    });
  }
  return contextsReady;
}

async function initContexts() {
  state.ctxUp = new AudioContext({ sampleRate: UPLINK_RATE });
  state.ctxDown = new AudioContext({ sampleRate: DOWNLINK_RATE });
  resume(state.ctxUp);
  resume(state.ctxDown);
  await state.ctxUp.audioWorklet.addModule("worklets/pcm-recorder-processor.js");
  await state.ctxDown.audioWorklet.addModule("worklets/pcm-player-processor.js");
}
