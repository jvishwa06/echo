# Echo Privacy Policy

Last updated: 2 November 2026

Echo has no server. The developer collects nothing and receives nothing from your use of it.
The extension connects only to Google's Gemini API, at `generativelanguage.googleapis.com`.

## Data Echo handles

| Data | Sent to | Stored |
| --- | --- | --- |
| **Tab audio** | Gemini Live API, only while a session is running | Never. Streamed, then discarded. |
| **Transcripts** | Received from Gemini; sent back to the Gemini API only when you press **Minutes** | In memory until the browser closes |
| **Minutes of meeting** | Nowhere | A Markdown file in your Downloads folder, only when you press **Minutes** |
| **API key** | Gemini API, to authenticate | `chrome.storage.local` on your device |
| **Settings** | Nowhere | `chrome.storage.local` on your device |

When you press **Minutes**, Echo sends the transcript of the current or last session to the
Gemini API (`generateContent`) and saves the minutes it returns to your Downloads folder.
Nothing is sent unless you press it.

Echo also uses your key to fetch the list of models it can access. It does this on the Options
page and once before each session, to check that the key works.

Audio is captured only between **Start** and **Stop**. A few seconds of recent audio are kept
in memory so that a sentence cut off when a Gemini session expires can be resent to the next
one. That buffer is discarded when capture stops. Audio is never written to disk.

## Google

Your audio and key are sent to Google under the
[Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) and the
[Google Privacy Policy](https://policies.google.com/privacy). **Google may use data sent with
free-tier keys to improve its products, but not data sent with paid-tier keys.** Use a paid key
if that matters to you.

## What Echo does not do

- It does not include analytics, telemetry, crash reporting or ads.
- It does not sell or transfer your data.
- It does not use your data for anything except the translation and minutes you asked for.
- It does not use your data for credit or lending decisions.
- It does not read page content. It only adds subtitles and a 💬 to the tab's title.

## Your control

- **Stop** ends capture and closes the connection immediately.
- Removing your API key stops Echo from connecting at all.
- Uninstalling Echo deletes everything it stored, including your key.
