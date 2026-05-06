# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome Extension (Manifest v3) that enhances the WPML translation editor at `*.ate.wpml.org`. Two distinct translation workflows exist in the same codebase:

- **Auto Translate** — injects buttons into the WPML toolbar; calls OpenRouter to translate one field at a time and can auto-advance through all fields
- **Vision Fill** — user uploads a screenshot of an already-translated page; AI vision extracts and maps translated text to WPML fields; fills all matched fields in one pass

## Development & Installation

No build step. Load the unpacked extension directly in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the project folder
4. After any file change, click the reload icon on the extension card

## Architecture

```
manifest.json   — permissions, host access (*.ate.wpml.org, *.wpml.org), MV3 config
background.js   — service worker; handles vision API calls (can't be called from popup directly due to CORS)
content.js      — injected into WPML editor pages; DOM manipulation, segment detection, translation filling
popup.html/.js  — 3-tab UI: Auto Translate | Vision Fill | Settings
style.css       — styles for buttons injected into the WPML editor DOM
```

### Message Passing Contract

Popup ↔ Content Script ↔ Background communicate via `chrome.runtime.sendMessage`:

| Message | Sender | Receiver | Purpose |
|---------|--------|----------|---------|
| `GET_PAGE_FIELDS` | popup.js | content.js | Fetch all WPML source strings |
| `VISION_FILL` | popup.js | content.js | Push matched translations into fields |
| `VISION_API_CALL` | popup.js | background.js | Send image to vision AI (bypasses CORS) |

### WPML Editor DOM Structure

Content script targets this structure on translation pages:

```html
<div class="sentences-row" id="mrk_XXXXXXX">
  <div class="sentences">
    <div class="original-sentence-container">
      <div class="original-sentence">SOURCE TEXT</div>
    </div>
    <div class="target-sentence-container">
      <!-- either: -->
      <div class="target-sentence">EXISTING TRANSLATION</div>
      <!-- or: -->
      <div class="add-translation"><button>...</button></div>
    </div>
  </div>
</div>
```

TinyMCE iframes require special handling — the editor may be inside an iframe, so `content.js` must detect and interact with `iframe.mce-edit-area` for rich text fields.

### Chrome Storage Keys

All settings stored in `chrome.storage.sync`:

- `openrouterApiKey`, `openrouterSelectedModel`, `systemPrompt` — Auto Translate config
- `visionProvider` (`openrouter` | `openai` | `anthropic`), `visionKey`, `visionModel` — Vision Fill config

### API Endpoints

| Provider | Base URL | Notes |
|----------|----------|-------|
| OpenRouter | `https://openrouter.ai/api/v1/` | Used for both auto-translate and vision |
| OpenAI | `https://api.openai.com/v1/` | Vision only (`/chat/completions` with `image_url`) |
| Anthropic | `https://api.anthropic.com/v1/` | Vision only (`/messages` with base64 image) |

Anthropic uses a different request/response shape than OpenAI-compatible providers — see `background.js` for the branching logic.
