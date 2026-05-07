// popup.js — WPML AI Translation + Vision v2

const DEFAULT_SYSTEM_PROMPT = `You are a translation tool. Follow these rules strictly:
1. ONLY translate text from the source language to the target language
2. NEVER add explanations, definitions, etymology, or commentary
3. Return ONLY the translated text - nothing more
4. Keep these AS-IS without translation:
   - Brand names (Nike, McDonald's, StreamConnect, Allied Telesis, VMS, etc.)
   - Product names and model numbers
   - URLs, email addresses, and technical identifiers
   - HTML tags and attributes
   - Text already in the target language
5. If the text is already in the target language, return it EXACTLY as provided
6. Preserve all formatting, spacing, and HTML structure exactly
Output format: Return ONLY the translation. No quotes, no language labels, no explanations.`;

// ─── STATE ────────────────────────────────────────────────────────────────────

let screenshotBase64 = null;
let aiTranslations   = null;  // { "english string": "translated string" }
let pageFields       = null;  // [{ index, sourceText, fieldType }]
let targetLanguage   = 'unknown';

// ─── TABS ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'vision') refreshPageInfo();
  });
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await refreshPageInfo();
});

document.getElementById('closeBtn').addEventListener('click', () => window.close());

// ─── SETTINGS: LOAD ───────────────────────────────────────────────────────────

async function loadSettings() {
  const s = await chromeGet([
    'openrouterApiKey', 'openrouterSelectedModel', 'systemPrompt',
    'visionProvider', 'visionKey', 'visionModel',
    'azureEndpoint', 'azureDeployment', 'azureApiVersion'
  ]);

  const orKey = s.openrouterApiKey || '';
  document.getElementById('orKey').value       = orKey;
  document.getElementById('systemPrompt').value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  document.getElementById('visionProvider').value = s.visionProvider || 'openrouter';
  document.getElementById('visionKey').value   = s.visionKey || '';
  document.getElementById('visionModel').value = s.visionModel || 'google/gemini-2.5-flash';
  document.getElementById('azureEndpoint').value   = s.azureEndpoint || '';
  document.getElementById('azureDeployment').value = s.azureDeployment || '';
  document.getElementById('azureApiVersion').value = s.azureApiVersion || '2024-12-01-preview';

  updateOrKeyStatus(!!orKey);
  updateVisionKeyVisibility(s.visionProvider || 'openrouter');

  if (orKey) {
    document.getElementById('modelSelect').disabled = false;
    await loadOpenRouterModels(orKey, s.openrouterSelectedModel);
  } else {
    document.getElementById('modelSelect').disabled = true;
  }

  updateStripProvider();
}

// ─── SETTINGS: SAVE ───────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', async () => {
  const orKey          = document.getElementById('orKey').value.trim();
  const model          = document.getElementById('modelSelect').value.trim();
  const prompt         = document.getElementById('systemPrompt').value.trim();
  const vProvider      = document.getElementById('visionProvider').value;
  const vKey           = document.getElementById('visionKey').value.trim();
  const vModel         = document.getElementById('visionModel').value;
  const azureEndpoint  = document.getElementById('azureEndpoint').value.trim();
  const azureDeployment = document.getElementById('azureDeployment').value.trim();
  const azureApiVersion = document.getElementById('azureApiVersion').value.trim();

  if (orKey && !model) { showStatus('settingsStatus', 'error', '❌ Please select an OpenRouter model for Auto Translate'); return; }
  if (!prompt) { showStatus('settingsStatus', 'error', '❌ System prompt cannot be empty'); return; }
  if (vProvider === 'azure' && (!azureEndpoint || !azureDeployment)) {
    showStatus('settingsStatus', 'error', '❌ Azure requires Endpoint and Deployment Name'); return;
  }

  await chrome.storage.sync.set({
    openrouterApiKey: orKey,
    openrouterSelectedModel: model,
    systemPrompt: prompt,
    visionProvider: vProvider,
    visionKey: vKey,
    visionModel: vModel,
    azureEndpoint,
    azureDeployment,
    azureApiVersion: azureApiVersion || '2024-12-01-preview'
  });

  updateOrKeyStatus(!!orKey);
  updateStripProvider();
  showStatus('settingsStatus', 'success', '✅ Settings saved');
});

// ─── OPENROUTER: load live model list ─────────────────────────────────────────

document.getElementById('orKey').addEventListener('input', async (e) => {
  const key = e.target.value.trim();
  updateOrKeyStatus(false);
  if (key.startsWith('sk-')) {
    document.getElementById('modelSelect').disabled = false;
    await loadOpenRouterModels(key, null);
  } else {
    document.getElementById('modelSelect').disabled = true;
  }
});

async function loadOpenRouterModels(apiKey, savedModel) {
  const datalist = document.getElementById('model-list');
  datalist.innerHTML = '<option value="Loading models..."></option>';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();
    const models = (data.data || []).sort((a, b) => a.id.localeCompare(b.id));
    datalist.innerHTML = '';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.dataset.name = m.name || m.id;
      opt.dataset.ctx  = m.context_length || '';
      datalist.appendChild(opt);
    });
    if (savedModel) {
      document.getElementById('modelSelect').value = savedModel;
      updateModelInfo(savedModel);
    }
  } catch (e) {
    datalist.innerHTML = '<option value="Error loading models"></option>';
    console.error('[WPML popup] Model load error:', e);
  }
}

document.getElementById('modelSelect').addEventListener('input', e => updateModelInfo(e.target.value));

function updateModelInfo(id) {
  const opt = document.querySelector(`#model-list option[value="${id}"]`);
  const el  = document.getElementById('model-info');
  if (opt) {
    const ctx = opt.dataset.ctx ? parseInt(opt.dataset.ctx).toLocaleString() : '?';
    el.textContent = `${opt.dataset.name || id} · context: ${ctx}`;
  } else {
    el.textContent = '';
  }
}

// ─── VISION PROVIDER ──────────────────────────────────────────────────────────

document.getElementById('visionProvider').addEventListener('change', e => {
  updateVisionKeyVisibility(e.target.value);
  updateStripProvider();
});

function updateVisionKeyVisibility(provider) {
  const needsKey = provider === 'openai' || provider === 'anthropic' || provider === 'azure';
  document.getElementById('visionKeyGroup').style.display = needsKey ? 'block' : 'none';
  document.getElementById('azureGroup').style.display = provider === 'azure' ? 'block' : 'none';
  document.getElementById('visionModelGroup').style.display = provider === 'azure' ? 'none' : 'block';

  const label = document.getElementById('visionKeyLabel');
  if (provider === 'azure') {
    label.textContent = 'Azure API Key';
    document.getElementById('visionKey').placeholder = 'Azure API key from portal';
  } else {
    label.innerHTML = 'Vision API Key <span class="help" style="display:inline">(if different from OpenRouter)</span>';
    document.getElementById('visionKey').placeholder = 'sk-...';
  }
}

function updateStripProvider() {
  const v = document.getElementById('visionProvider')?.value || '—';
  const el = document.getElementById('stripProvider');
  if (el) el.textContent = v;
}

function updateOrKeyStatus(saved) {
  const el = document.getElementById('orKeyStatus');
  el.textContent = saved ? '✓ saved' : '✗ not saved';
  el.className = 'api-status ' + (saved ? 'saved' : 'unsaved');
}

// ─── REFRESH PAGE INFO (from active WPML tab) ─────────────────────────────────

async function refreshPageInfo() {
  const tab = await getActiveTab();
  if (!tab) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) { /* already injected */ }

  chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_FIELDS' }, res => {
    if (chrome.runtime.lastError || !res) return;
    pageFields     = res.fields;
    targetLanguage = res.language;

    const strip = document.getElementById('pageStrip');
    strip.classList.add('show');

    const langLabels = { es: '🇪🇸 Spanish', it: '🇮🇹 Italian', fr: '🇫🇷 French', de: '🇩🇪 German', id: '🇮🇩 Indonesian', en: '🇬🇧 English' };
    document.getElementById('stripLang').innerHTML =
      `<span class="pill pill-teal">${langLabels[res.language] || res.language.toUpperCase()}</span>`;
    // count empties
    const emptyCount = res.fields.filter(f => f.isEmpty).length;
    document.getElementById('stripFields').innerHTML =
      `<span class="pill pill-amber">${res.fields.length} fields</span> <span class="pill pill-purple">${emptyCount} empty</span>`;

    updateStripProvider();

    // Enable analyze if screenshot is ready too
    if (screenshotBase64) document.getElementById('analyzeBtn').disabled = false;
  });
}

// ─── UPLOAD ZONE ──────────────────────────────────────────────────────────────

const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) handleFile(f);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

document.getElementById('removeImg').addEventListener('click', e => {
  e.stopPropagation();
  screenshotBase64 = null;
  document.getElementById('previewWrap').style.display = 'none';
  uploadZone.style.display = '';
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('previewResults').style.display = 'none';
  clearStatus('visionStatus');
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    screenshotBase64 = dataUrl.split(',')[1];
    document.getElementById('previewImg').src = dataUrl;
    document.getElementById('previewWrap').style.display = 'block';
    uploadZone.style.display = 'none';
    document.getElementById('analyzeBtn').disabled = false;
    if (!pageFields) refreshPageInfo();
  };
  reader.readAsDataURL(file);
}

// ─── ANALYZE ──────────────────────────────────────────────────────────────────

document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
document.getElementById('reanalyzeBtn').addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!screenshotBase64) { showStatus('visionStatus', 'error', '❌ Upload a screenshot first.'); return; }

  const s = await chromeGet([
    'openrouterApiKey', 'visionProvider', 'visionKey', 'visionModel',
    'azureEndpoint', 'azureDeployment', 'azureApiVersion'
  ]);
  const provider = s.visionProvider || 'openrouter';
  const apiKey   = (provider === 'openrouter') ? s.openrouterApiKey : s.visionKey;
  const model    = s.visionModel || 'google/gemini-2.5-flash';

  if (!apiKey) { showStatus('visionStatus', 'error', '❌ No API key. Configure in Settings.'); return; }

  if (!pageFields || pageFields.length === 0) {
    showStatus('visionStatus', 'error', '❌ No WPML fields detected on active tab. Open a WPML translation page first.');
    return;
  }

  const onlyEmpty = document.getElementById('onlyEmpty').checked;
  const fieldsToSend = pageFields.map(f => f.sourceText);

  showStatus('visionStatus', 'loading',
    `<span class="spinner"></span> Sending ${fieldsToSend.length} fields to ${provider} vision AI…`);
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('previewResults').style.display = 'none';

  try {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'VISION_API_CALL',
        payload: {
          provider, apiKey, model,
          imageBase64: screenshotBase64,
          sourceFields: fieldsToSend,
          targetLanguage,
          azureEndpoint: s.azureEndpoint || '',
          azureDeployment: s.azureDeployment || '',
          azureApiVersion: s.azureApiVersion || '2024-12-01-preview'
        }
      }, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res.success) resolve(res.data);
        else reject(new Error(res.error));
      });
    });

    aiTranslations = result;
    const matched = Object.values(result).filter(v => v && v !== 'null').length;
    const missed  = fieldsToSend.length - matched;

    showStatus('visionStatus', 'success', `✅ AI matched ${matched} of ${fieldsToSend.length} fields`);
    buildPreview(fieldsToSend, result, missed);

  } catch (err) {
    showStatus('visionStatus', 'error', `❌ ${err.message}`);
  } finally {
    document.getElementById('analyzeBtn').disabled = false;
  }
}

// ─── PREVIEW TABLE ────────────────────────────────────────────────────────────

function buildPreview(sourceFields, translations, missed) {
  const table = document.getElementById('previewTable');
  const matched = sourceFields.length - missed;

  document.getElementById('statMatched').textContent = matched;
  document.getElementById('statMissed').textContent  = missed;
  document.getElementById('statTotal').textContent   = sourceFields.length;

  const CODE_RE = /^(class|span\s?\d*|div|section|container|wrapper|\d+)$/i;

  table.innerHTML = sourceFields.map(src => {
    const tr  = translations[src];
    const isCode = CODE_RE.test(src.trim());
    const trClass = !tr || tr === 'null' ? 'null' : isCode ? 'code' : '';
    const trText  = !tr || tr === 'null' ? '— not found' : tr;
    return `<div class="prow">
      <div class="src" title="${esc(src)}">${esc(trunc(src, 46))}</div>
      <div class="trn ${trClass}" title="${esc(trText)}">${esc(trunc(trText, 46))}</div>
    </div>`;
  }).join('');

  document.getElementById('previewResults').style.display = 'block';
}

// ─── APPLY ────────────────────────────────────────────────────────────────────

document.getElementById('applyBtn').addEventListener('click', async () => {
  if (!aiTranslations) return;
  const tab = await getActiveTab();
  if (!tab) return;

  const onlyEmpty = document.getElementById('onlyEmpty').checked;
  const applyBtn  = document.getElementById('applyBtn');

  applyBtn.disabled = true;
  showStatus('visionStatus', 'loading', '<span class="spinner"></span> Filling fields into page…');

  chrome.tabs.sendMessage(tab.id, {
    type: 'VISION_FILL',
    payload: { translations: aiTranslations, onlyEmpty }
  }, res => {
    applyBtn.disabled = false;
    if (chrome.runtime.lastError) {
      showStatus('visionStatus', 'error', '❌ ' + chrome.runtime.lastError.message);
      return;
    }
    if (res) {
      showStatus('visionStatus', 'success',
        `✅ Done — filled ${res.filled} · skipped ${res.skipped} · unmatched ${res.missed}`);
    }
  });
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function chromeGet(keys) {
  return new Promise(resolve => chrome.storage.sync.get(keys, resolve));
}

function getActiveTab() {
  return new Promise(resolve => {
    chrome.windows.getAll({ windowTypes: ['normal'], populate: true }, windows => {
      if (chrome.runtime.lastError || !windows.length) { resolve(null); return; }
      const target = windows.find(w => w.focused) || windows[windows.length - 1];
      resolve(target.tabs?.find(t => t.active) || null);
    });
  });
}

function showStatus(id, type, html) {
  const el = document.getElementById(id);
  el.className = `status show ${type}`;
  el.innerHTML = html;
}

function clearStatus(id) {
  const el = document.getElementById(id);
  el.className = 'status';
  el.innerHTML = '';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function trunc(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
