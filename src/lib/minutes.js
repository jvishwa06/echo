/**
 * Minutes of meeting, from the transcript of the current (or last) run.
 *
 * The transcript is sent to Gemini's ordinary `generateContent` endpoint, on
 * the user's own key, with a prompt asking for Markdown minutes. The Live
 * translation models cannot do this — they only translate audio — so this uses
 * a general text model instead.
 */

const API = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Tried in order. `gemini-flash-latest` is Google's moving alias for the
 * current Flash model, so it keeps working as models are retired; the pinned
 * one behind it is for keys or regions where the alias is not served.
 */
const MODELS = ["gemini-flash-latest", "gemini-2.5-flash"];

/**
 * The transcript as the model reads it: one line per utterance, each tagged
 * with which side it came from, in the order they were spoken.
 */
export function formatTranscript(lines) {
  return lines
    .map(({ side, text }) => `${side === "input" ? "[Original]" : "[Translation]"} ${text.trim()}`)
    .join("\n");
}

function buildPrompt(transcript, { language, date, source }) {
  return `You are writing the Minutes of Meeting (MoM) for a meeting, from its live transcript.

The transcript below was captured from a browser tab${source ? ` titled "${source}"` : ""} on ${date}. Lines tagged [Original] are what was said, in the speakers' own language; lines tagged [Translation] are a live machine translation of them into ${language}. Speakers are not identified. The transcript may contain recognition errors, repetitions and fragments — use judgement, and do not invent anything that is not supported by it.

Write the minutes in ${language}, as GitHub-flavoured Markdown, with exactly these sections:

# Minutes of Meeting
A short line with the date${source ? " and the source" : ""}.

## Summary
Three to six sentences on what the meeting was about and its outcome.

## Key discussion points
Bulleted, grouped by topic.

## Decisions
Bulleted. Write "None recorded." if there were none.

## Action items
A Markdown table with columns: Action, Owner, Due. Use "—" where the owner or due date was not stated. Write "None recorded." instead of the table if there were none.

## Open questions
Bulleted. Omit the section if there are none.

Output only the Markdown, with no preamble and no code fences around it.

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---`;
}

/**
 * Ask Gemini for the minutes. Resolves to Markdown; rejects with the API's own
 * message, or with `noText` if the model returned nothing usable.
 */
export async function generateMinutes(apiKey, lines, options, { fetchImpl = fetch } = {}) {
  const prompt = buildPrompt(formatTranscript(lines), options);
  let lastError = null;
  for (const model of MODELS) {
    const res = await fetchImpl(`${API}/${model}:generateContent`, {
      method: "POST",
      // A header and not the `key` query parameter, so the key stays out of
      // any URL that ends up in a log.
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      lastError = new Error(body?.error?.message || `HTTP ${res.status}`);
      // A model this key cannot reach: try the next one. Anything else — a bad
      // key, a quota — would fail the same way on every model.
      if (res.status === 404) continue;
      throw lastError;
    }
    const text = (body?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();
    if (!text) throw new Error(options.noText);
    return stripFence(text);
  }
  throw lastError;
}

/** Models sometimes wrap the whole answer in ```markdown … ``` regardless. */
function stripFence(text) {
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return fenced ? fenced[1].trim() : text;
}

/** `Echo-MoM-2026-11-04-1530.md`, in local time. */
export function minutesFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `Echo-MoM-${date}-${time}.md`;
}
