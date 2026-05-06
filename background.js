// background.js — handles vision API calls from popup

chrome.runtime.onInstalled.addListener(() => {
  console.log('[WPML AI] Extension v2 installed.');
});

// ─── POPUP WINDOW MANAGEMENT ─────────────────────────────────────────────────

let popupWindowId = null;

chrome.action.onClicked.addListener(() => {
  if (popupWindowId !== null) {
    chrome.windows.get(popupWindowId, win => {
      if (chrome.runtime.lastError || !win) {
        openPopupWindow();
      } else {
        chrome.windows.update(popupWindowId, { focused: true });
      }
    });
  } else {
    openPopupWindow();
  }
});

async function openPopupWindow() {
  const popupUrl = chrome.runtime.getURL('popup.html');
  const all = await chrome.windows.getAll({ populate: true });
  const existing = all.find(w => w.tabs?.some(t => t.url === popupUrl));
  if (existing) {
    chrome.windows.update(existing.id, { focused: true });
    popupWindowId = existing.id;
    return;
  }
  chrome.windows.create(
    { url: popupUrl, type: 'popup', width: 500, height: 740, focused: true },
    win => { popupWindowId = win.id; }
  );
}

chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === popupWindowId) popupWindowId = null;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'VISION_API_CALL') {
    handleVisionCall(msg.payload)
      .then(data  => sendResponse({ success: true, data }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open
  }
});

async function handleVisionCall({ provider, apiKey, model, imageBase64, sourceFields, targetLanguage, azureEndpoint, azureDeployment, azureApiVersion }) {
  const system = `You are a professional translation assistant helping migrate content from a Drupal website to WordPress/WPML.

You will receive:
1. A screenshot of a translated Drupal page (in ${targetLanguage})
2. A JSON array of English source strings from the WPML translation editor

Your task:
- Extract ALL visible translated text from the screenshot
- Match each English source string to its ${targetLanguage} translation visible in the screenshot
- Return a flat JSON object: { "english source string": "translated string", ... }

Rules:
- Match by semantic meaning, not by position on screen
- For CSS/code tokens like "class", "span 1", "container" — return them unchanged (copy English value as-is)
- If you cannot find a clear translation match, set the value to null
- Do NOT add any markdown, backticks, commentary, or wrapping — return raw JSON only
- Brand names (StreamConnect, Allied Telesis, VMS, etc.) stay in English in all translations`;

  const userPrompt = `Target language: ${targetLanguage}

English source strings to translate:
${JSON.stringify(sourceFields, null, 2)}

Extract the ${targetLanguage} translations from the screenshot and return a JSON object mapping each English string to its translation.`;

  if (provider === 'openrouter' || provider === 'openai') {
    return await callOpenCompatAPI(provider, apiKey, model, system, userPrompt, imageBase64);
  }
  if (provider === 'anthropic') {
    return await callAnthropicAPI(apiKey, model, system, userPrompt, imageBase64);
  }
  if (provider === 'azure') {
    return await callAzureOpenAIAPI(apiKey, azureEndpoint, azureDeployment, azureApiVersion, system, userPrompt, imageBase64);
  }
  throw new Error('Unknown provider: ' + provider);
}

async function callOpenCompatAPI(provider, apiKey, model, system, userPrompt, imageBase64) {
  const baseURL = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  const body = {
    model,
    max_tokens: 3800,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } },
          { type: 'text', text: userPrompt }
        ]
      }
    ]
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://wpml.org';
    headers['X-Title'] = 'WPML Vision Translator';
  }

  const res = await fetch(baseURL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t;
    try { msg = JSON.parse(t)?.error?.message || t; } catch {}
    throw new Error(`${provider} API ${res.status}: ${msg}`);
  }

  const data = await res.json();
  return parseJSON(data.choices[0].message.content);
}

async function callAnthropicAPI(apiKey, model, system, userPrompt, imageBase64) {
  const body = {
    model: model || 'claude-opus-4-5-20251101',
    max_tokens: 3800,
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
        { type: 'text', text: userPrompt }
      ]
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${t}`);
  }

  const data = await res.json();
  return parseJSON(data.content[0].text);
}

async function callAzureOpenAIAPI(apiKey, endpoint, deployment, apiVersion, system, userPrompt, imageBase64) {
  const base = endpoint.replace(/\/$/, '');
  const url  = `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const body = {
    max_tokens: 3800,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } },
          { type: 'text', text: userPrompt }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t;
    try { msg = JSON.parse(t)?.error?.message || t; } catch {}
    throw new Error(`Azure OpenAI ${res.status}: ${msg}`);
  }

  const data = await res.json();
  return parseJSON(data.choices[0].message.content);
}

function parseJSON(text) {
  const clean = text.replace(/```json\n?|```\n?/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  throw new Error('Could not parse AI response as JSON. Response was: ' + text.substring(0, 300));
}
