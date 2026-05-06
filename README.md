# WPML AI Translation + Vision

A Chrome extension that brings AI-powered translation to the [WPML Advanced Translation Editor](https://wpml.org/documentation/translating-your-contents/using-the-translation-editor/). It operates in two independent modes: **auto-translate** individual fields using the inline editor, or **vision fill** — upload a screenshot of an already-translated page and let the AI map the content automatically into WPML's fields.

Built for teams migrating content between CMS platforms (e.g. Drupal → WordPress) where translated content already exists but needs to be re-entered into WPML field by field.

![Extension popup showing Vision Fill tab with 18 of 35 fields matched](https://img.shields.io/badge/status-active-27ad95?style=flat-square) ![Manifest V3](https://img.shields.io/badge/manifest-v3-blue?style=flat-square) ![License MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## The Problem This Solves

When rebuilding a Drupal site in WordPress with Bricks Builder, translated content already exists on the Drupal site — but there is no clean API bridge. Drupal stores content in blocks with no consistent field mapping, and WPML's translation editor requires field-by-field input. Manually copying translations across dozens of pages and five languages is impractical.

This extension solves that by:
- Taking a screenshot of the translated Drupal page
- Sending it to a vision AI model along with the list of English source strings from the WPML editor
- Receiving a semantically-matched translation map
- Filling each WPML field automatically

---

## Features

### Mode A — Auto Translate
- Injects **AI Translate**, **AI Translate All**, and **Stop** buttons directly into the WPML TinyMCE editor toolbar
- **AI Translate** — translates the currently active segment and saves it
- **AI Translate All** — automatically advances through every segment on the page, translating and saving each one sequentially
- **Stop** — immediately aborts any in-progress API call with proper fetch cancellation
- Powered by [OpenRouter](https://openrouter.ai) with a live, searchable model list
- Fully customisable system prompt for translation quality control

### Mode B — Vision Fill
- Upload a screenshot of any translated page (drag-and-drop or file picker)
- Detects all translation segments on the active WPML editor page
- Sends segments + screenshot to a vision-capable AI model in a single API call
- Semantically maps translated text from the screenshot to the correct WPML field — regardless of page layout or DOM structure
- Preview table shows matched vs unmatched fields before anything is written
- Shows a loading state while translations are being applied; reports filled / skipped / unmatched when done
- "Only fill empty fields" toggle — safely skips segments that already have translations
- Supports **OpenRouter**, **OpenAI**, **Anthropic**, and **Azure OpenAI**

### General
- Opens as a **persistent floating window** — does not close when you click outside; stays open while you work in the WPML editor. Close it with the **✕** button in the header
- Re-clicking the extension icon focuses the existing window instead of opening a duplicate
- Works on `e.ate.wpml.org` (WPML Advanced Translation Editor)
- Correctly handles the React/div-based ATE layout (not table-based)
- Reads both plain-text segments and TinyMCE rich-text iframe segments
- React-aware field writing — dispatches native input/change events so WPML's state updates correctly
- Settings persisted in `chrome.storage.sync`
- No external servers — API calls go directly from your browser to the AI provider

---

## Requirements

- Google Chrome (or any Chromium-based browser supporting Manifest V3)
- A WPML account with access to the Advanced Translation Editor (`e.ate.wpml.org`)
- At least one of the following:
  - An [OpenRouter](https://openrouter.ai) API key — required for Mode A; also usable for Mode B
  - An [OpenAI](https://platform.openai.com) API key (Vision Fill only)
  - An [Anthropic](https://console.anthropic.com) API key (Vision Fill only)
  - An Azure OpenAI deployment with a vision-capable model (Vision Fill only)

---

## Installation

This extension is not published to the Chrome Web Store. Install it manually as an unpacked extension:

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked**
5. Select the root folder of this repository (the folder containing `manifest.json`)
6. The **WPML AI Translation + Vision** icon will appear in your Chrome toolbar

To update after pulling new changes: go back to `chrome://extensions` and click the **↺ refresh** icon on the extension card.

---

## Setup

Click the extension icon → go to the **Settings** tab.

### OpenRouter (required for Mode A, and for Mode B if using OpenRouter models)

| Field | Description |
|---|---|
| API Key | Your OpenRouter key — starts with `sk-or-v1-`. Get one at [openrouter.ai/keys](https://openrouter.ai/keys) |
| Model | Auto-loaded from OpenRouter's live model list. Type to search. Used for Mode A (auto-translate) only |
| System Prompt | Controls translation rules for Mode A. Edit to match your brand voice or add protected terms |

### Vision AI (Mode B only)

Select your preferred provider. Each provider requires its own credentials.

#### OpenRouter
Reuses the API key from the Mode A section. No additional key needed.

#### OpenAI
| Field | Description |
|---|---|
| Vision API Key | Your OpenAI key — starts with `sk-` |
| Vision Model | Select from the dropdown, e.g. `gpt-4o` |

#### Anthropic
| Field | Description |
|---|---|
| Vision API Key | Your Anthropic key |
| Vision Model | Select from the dropdown, e.g. `claude-opus-4-5` |

#### Azure OpenAI
| Field | Description |
|---|---|
| Azure API Key | API key from Azure portal → your resource → **Keys and Endpoint** |
| Endpoint | The resource endpoint, e.g. `https://your-resource.openai.azure.com/` |
| Deployment Name | The name of your GPT-4o (or other vision) deployment |
| API Version | Azure API version, e.g. `2024-12-01-preview` |

> The Vision Model dropdown is hidden when Azure is selected — the model is determined by your deployment, not a separate selector.

### Recommended Vision Models

| Model | Provider | Cost | Notes |
|---|---|---|---|
| `google/gemini-2.5-flash` | OpenRouter | Low | Best balance of speed and accuracy ⭐ |
| `google/gemini-2.5-flash-lite` | OpenRouter | Very low | Faster, good for simple pages |
| `openai/gpt-4o` | OpenRouter / OpenAI | Medium | Excellent accuracy on complex layouts |
| `anthropic/claude-opus-4-5` | OpenRouter / Anthropic | Higher | Best for dense or ambiguous content |
| Any vision deployment | Azure OpenAI | Varies | Use your own Azure-hosted model |

> **Note:** OpenRouter free-tier credits may be limited. Top up at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) if you hit 402 errors.

Click **Save All Settings** after making any changes.

---

## Usage

### Mode A — Auto Translate

1. Open a translation job on `e.ate.wpml.org`
2. Click any segment row to open it in the TinyMCE editor
3. Use the buttons injected into the editor toolbar:
   - **AI Translate** — translates the active segment only, then saves
   - **AI Translate All** — translates every segment in sequence automatically
   - **Stop** — cancels the current operation immediately
4. Translations are saved automatically after each segment

### Mode B — Vision Fill

1. On the translated source page (e.g. your Drupal site), take a full-page screenshot showing all the translated text
2. Open the corresponding WPML translation job on `e.ate.wpml.org`
3. Click the extension icon to open the persistent window → go to the **Vision Fill** tab
4. The strip will show the detected language, field count, and empty field count
5. Drop or upload your screenshot into the upload zone
6. Toggle **Only fill empty fields** as needed
7. Click **Analyse Screenshot** — the AI reads the screenshot and maps translations
8. Review the stats (matched / not found / total) and the preview table
9. Click **Apply Translations to Page** — a loading indicator appears while fields are being filled
10. When complete, the status bar reports how many fields were filled, skipped, and unmatched

> The window stays open throughout this process. Use **Re-analyse** to run the AI again on the same screenshot, or upload a new screenshot without losing your current results.

#### Tips for better match rates
- Take a **full-page screenshot** rather than a partial one — more visible text means more matches
- Make sure the page is **fully loaded** before screenshotting (no lazy-loaded placeholders)
- If a field shows "not found", it likely means that text isn't visible in the screenshot — scroll further or take multiple screenshots and run the process again
- Code tokens (`class`, `span 1`, `container`) are intentionally left untranslated — this is correct behaviour

---

## Supported Languages

Spanish · Italian · French · German · Indonesian — and any other language supported by your chosen AI model.

---

## Project Structure

```
wpml-vision-v2/
├── manifest.json       # Chrome Extension Manifest V3 config
├── content.js          # Injected into WPML ATE pages
│   ├─ Mode A           # TinyMCE detection, inline buttons, auto-advance loop
│   └─ Mode B           # Segment scraping, vision fill, message bridge
├── background.js       # Service worker — vision AI calls + popup window management
│                       # Supports OpenRouter, OpenAI, Anthropic, Azure OpenAI
├── popup.html          # Extension UI (persistent floating window)
├── popup.js            # Popup controller — tabs, upload, analyse, apply, settings
├── style.css           # Injected styles for AI Translate buttons in WPML editor
├── icon16.png          # Extension icons
├── icon48.png
└── icon128.png
```

---

## Troubleshooting

**"No WPML fields detected on active tab"**
Make sure the active Chrome tab is an open WPML translation job at `e.ate.wpml.org/dashboard?id=...`. Switch to that tab, then click the **Vision Fill** tab in the extension window to re-detect fields.

**AI Translate buttons not appearing in the editor**
The buttons inject into `.otgs-editor-container .nav` when that element appears. If they don't appear, reload the WPML page and wait a few seconds for the editor to fully initialise.

**402 error from OpenRouter**
Your account has insufficient credits. Top up at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits), or switch to a lower-cost model like `google/gemini-2.5-flash-lite`.

**400 error — invalid model ID**
Model IDs on OpenRouter follow the format `provider/model-name` (e.g. `google/gemini-2.5-flash`). Do not append `:free` or `openrouter/` prefix. The Settings tab loads the live model list from OpenRouter to avoid this.

**Azure API errors**
Verify that the Endpoint includes the trailing slash and matches your Azure resource URL exactly. Confirm the Deployment Name matches what is shown in Azure OpenAI Studio. The API Version must match a version supported by your deployment (e.g. `2024-12-01-preview`).

**Low match rate from Vision Fill**
Try a more capable model (`openai/gpt-4o` or `anthropic/claude-opus-4-5`). Also ensure the screenshot clearly shows all the translated text and is not cut off.

**Translations applied but not saving**
The extension clicks the save button after each segment. If WPML's UI is slow to respond, this can occasionally be missed. Re-run Vision Fill on the remaining empty segments.

---

## Acknowledgements

This project was built on top of the foundational work by **[@sinanisler](https://github.com/sinanisler)** — whose [WPML AI Translation Chrome Extension](https://github.com/sinanisler/WPML-AI-Translation-Chrome-Extension) provided the original approach for injecting AI translate buttons into the WPML editor, the TinyMCE field detection logic, the auto-advance automation loop, and the OpenRouter integration pattern. The Vision Fill mode and multi-provider support were built on top of that foundation.

---

## License

MIT — see `license.txt` for details.
