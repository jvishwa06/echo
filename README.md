# Echo

A Chrome extension that translates any tab's audio in real time. Videos, webinars and calls play
with a spoken translation and optional on-page subtitles.

Audio goes straight from your browser to Google's Gemini Live API using your own key. Echo has
no server.

## Getting started

1. Open `chrome://extensions`, turn on **Developer mode** and click **Load unpacked** on this folder.
2. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey) and paste it into
   Echo's **Options** page.
3. On the tab you want translated, click the Echo icon, pick a language and press **Start**.

## Features

- Spoken translation; the source language is detected automatically.
- The original audio is turned down while the translation plays, by an amount you set.
- On-page subtitles that keep working in fullscreen.
- A live transcript and audio usage in the side panel.
- **Minutes**: one click turns the transcript so far into minutes of meeting (summary, decisions,
  action items), saved as a Markdown file in your Downloads folder.
- Light and dark themes; English and Hindi interface.

Closing the tab or pressing **Stop** ends the session.

## Project structure

```
src/
  background/   Service worker: tab capture and session control
  offscreen/    Audio engine and audio worklets
  sidepanel/    Controls and transcript
  options/      Settings page
  content/      Scripts injected into the page (subtitles, tab marker)
  lib/          Shared modules: Gemini Live session, settings, i18n
  styles/       Shared stylesheet
assets/icons/   Extension icons
_locales/       Translated interface text
```

Run `npm run package` to build `echo.zip` for the Chrome Web Store.

## Privacy and license

See [PRIVACY.md](PRIVACY.md) and [LICENSE](LICENSE) (Apache 2.0).
