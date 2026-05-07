(function () {
  // ─── STATE ───────────────────────────────────────────────────────────────
  let apiKey        = '';
  let selectedModel = 'openai/gpt-4o-mini';
  let systemPrompt  = '';
  let stopTranslation = false;
  let currentAbortController = null;

  const DEFAULT_SYSTEM_PROMPT = `You are a translation tool. Follow these rules strictly:
1. ONLY translate text from the source language to the target language
2. NEVER add explanations, definitions, etymology, or commentary
3. Return ONLY the translated text - nothing more
4. Keep these AS-IS without translation:
   - Brand names (StreamConnect, Allied Telesis, VMS, etc.)
   - Product names and model numbers
   - URLs, email addresses, technical identifiers
   - HTML tags and attributes
   - Text already in the target language
5. If the text is already in the target language, return it EXACTLY as provided
6. Preserve all formatting, spacing, and HTML structure exactly
Output format: Return ONLY the translation. No quotes, no language labels, no explanations.`;

  // ─── SETTINGS ────────────────────────────────────────────────────────────
  const loadSettings = async () => {
    try {
      const r = await chrome.storage.sync.get(['openrouterApiKey', 'openrouterSelectedModel', 'systemPrompt']);
      apiKey        = r.openrouterApiKey || '';
      selectedModel = r.openrouterSelectedModel || 'openai/gpt-4o-mini';
      systemPrompt  = r.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    } catch (e) { console.error('[WPML AI] settings error', e); }
  };
  loadSettings();

  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'sync') return;
    if (changes.openrouterApiKey)        apiKey        = changes.openrouterApiKey.newValue || '';
    if (changes.openrouterSelectedModel) selectedModel = changes.openrouterSelectedModel.newValue || selectedModel;
    if (changes.systemPrompt)            systemPrompt  = changes.systemPrompt.newValue || systemPrompt;
  });

  // ─── DOM HELPERS (actual WPML ATE structure) ──────────────────────────────
  //
  // Layout per segment:
  //   <div class="sentences-row" id="mrk_XXXXXXX">
  //     <div class="sentences">
  //       <div class="original-sentence-container">
  //         <div class="original-sentence">SOURCE TEXT</div>
  //       </div>
  //       <div class="target-sentence-container">
  //         <div class="target-segment-wrapper">
  //           <div class="target-sentence">EXISTING TRANSLATION</div>  ← filled
  //           OR
  //           <div class="add-translation ..."><button>...</button></div>  ← empty
  //         </div>
  //       </div>
  //     </div>
  //   </div>
  //
  // The TinyMCE iframe (id ends in _ifr) is the ONE active editor,
  // shown when a segment is clicked/active (.sentence-in-progress).

  // WPML ATE stores inline formatting as XLIFF <g ctype="x-html-TAG"> elements in the
  // .original-sentence div of the segment list. This converts them to semantic HTML tags
  // so the AI can see and preserve bold/italic in its translation output.
  const getSourceHTML = (el) => {
    if (!el) return '';
    const raw = el.innerHTML || '';

    const FORMATTING_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 's']);

    // <g ctype="x-html-strong">text</g>  →  <strong>text</strong>
    // <g ctype="x-html-span">text</g>    →  text  (structural, not semantic formatting)
    const formatted = raw.replace(
      /<g\b[^>]*\bctype="x-html-([a-z0-9]+)"[^>]*>([\s\S]*?)<\/g>/gi,
      (_, tag, content) => FORMATTING_TAGS.has(tag) ? `<${tag}>${content}</${tag}>` : content
    );

    // Strip any remaining XLIFF inline elements (<g>, <x/>, <ph>, etc.)
    return formatted.replace(/<\/?[gxph]\b[^>]*\/?>/gi, '').trim();
  };

  const getSegmentRows = () => {
    return [...document.querySelectorAll('.sentences-row')].map(row => {
      const sourceEl = row.querySelector('.original-sentence');
      return {
        rowEl:      row,
        mrkId:      row.id,
        sourceText: sourceEl?.innerText?.trim() || '',
        sourceHTML: getSourceHTML(sourceEl),
        targetText: row.querySelector('.target-sentence')?.innerText?.trim() || '',
        isEmpty:    !!row.querySelector('.add-translation'),
        isActive:   row.classList.contains('sentence-in-progress'),
      };
    }).filter(s => s.sourceText.length > 0);
  };

  const findEditorIframe = () => {
    for (const sel of ['.mce-panel iframe', '.mce-edit-area iframe', 'iframe[id*="otgs-editor"]', 'iframe[id*="_ifr"]']) {
      const el = document.querySelector(sel);
      if (el?.contentDocument?.querySelector('#tinymce')) return el;
    }
    for (const iframe of document.querySelectorAll('iframe')) {
      try { if (iframe.contentDocument?.querySelector('#tinymce')) return iframe; } catch {}
    }
    return null;
  };

  const getEditorHTML = () => {
    const el = findEditorIframe()?.contentDocument?.querySelector('#tinymce');
    return el ? el.innerHTML : null;
  };

  const setEditorHTML = (html) => {
    const el = findEditorIframe()?.contentDocument?.querySelector('#tinymce');
    if (!el) return false;
    el.innerHTML = html;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  const getTargetLanguage = () => {
    const spans = document.querySelectorAll('.translation div span');
    if (spans.length > 1) return spans[1].textContent.trim();
    return new URLSearchParams(window.location.search).get('language') || 'the target language';
  };

  const waitFor = (selector, timeout = 5000) => new Promise(resolve => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const obs = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
  });

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── INLINE BUTTON INJECTION (Mode A) ────────────────────────────────────
  const tryAddButtons = () => {
    // The nav is a <ul class="nav"> inside .otgs-editor-container
    const nav = document.querySelector('.otgs-editor-container .nav');
    if (!nav) return false;
    if (nav.querySelector('.wpml-ai-translate-btn')) return true;

    const mk = (text, cls, handler) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.className = 'wpml-ai-btn ' + cls;
      b.addEventListener('click', handler);
      const li = document.createElement('li');
      li.className = 'inline-block m-r-1';
      li.appendChild(b);
      nav.appendChild(li);
    };

    mk('AI Translate',     'wpml-ai-translate-btn', () => runAutoTranslate(false));
    mk('AI Translate All', 'wpml-ai-all-btn',       () => runAutoTranslate(true));
    mk('Stop',             'wpml-ai-stop-btn',      () => {
      stopTranslation = true;
      currentAbortController?.abort();
      currentAbortController = null;
      setWorking(false);
    });

    console.log('[WPML AI] Buttons injected into nav.');
    return true;
  };

  const setWorking = (on, all) => {
    const t   = document.querySelector('.wpml-ai-translate-btn');
    const all_ = document.querySelector('.wpml-ai-all-btn');
    if (!t || !all_) return;
    t.disabled    = on;
    all_.disabled = on;
    t.classList.toggle('working',   on && !all);
    all_.classList.toggle('working', on && !!all);
  };

  const domObs = new MutationObserver((_, obs) => { if (tryAddButtons()) obs.disconnect(); });
  if (!tryAddButtons()) domObs.observe(document.body, { childList: true, subtree: true });

  // ─── AUTO-TRANSLATE FLOW (Mode A) ────────────────────────────────────────
  const runAutoTranslate = async (autoAll) => {
    stopTranslation = false;
    if (!apiKey) { alert('Configure your OpenRouter API key in the extension popup → Settings tab.'); return; }

    // Read from the SOURCE panel of the currently-open segment (.sentence-current),
    // not from TinyMCE which holds the existing (possibly wrong) translation.
    // getSourceHTML converts XLIFF <g ctype="x-html-strong"> → <strong> so the AI
    // sees and preserves bold/italic in the output.
    const activeRow = document.querySelector('.sentence-current');
    const sourceEl  = activeRow?.querySelector('.original-sentence');
    const text      = sourceEl ? getSourceHTML(sourceEl) : getEditorHTML();

    const lang = getTargetLanguage();
    if (!text) { alert('No active editor field found. Click a segment row first to open it.'); return; }
    setWorking(true, autoAll);
    await callTranslateAPI(text, lang, autoAll);
  };

  const callTranslateAPI = async (text, lang, autoAll) => {
    currentAbortController = new AbortController();
    const tid = setTimeout(() => currentAbortController.abort(), 60000);
    try {
      if (stopTranslation) return;
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://wpml.org',
          'X-Title': 'WPML AI Translation'
        },
        body: JSON.stringify({
          model: selectedModel, max_tokens: 4000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Translate the following to ${lang}. If the input contains HTML tags such as <strong> or <em>, place them in the semantically equivalent positions in the translation — do not drop or move them:\n\n${text}` }
          ]
        }),
        signal: currentAbortController.signal
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        let msg = err; try { msg = JSON.parse(err)?.error?.message || err; } catch {}
        throw new Error(`API ${res.status}: ${msg}`);
      }
      const data = await res.json();
      const translation = data?.choices?.[0]?.message?.content?.trim() ?? '';
      if (!translation) throw new Error('Empty translation from API');
      if (stopTranslation) return;

      setEditorHTML(translation);

      if (!stopTranslation) {
        if (autoAll) { await advanceAndContinue(); }
        else         { document.querySelector('.save-sentence-btn')?.click(); }
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('[WPML AI]', e);
      alert(`Translation failed: ${e.message}`);
    } finally {
      clearTimeout(tid);
      currentAbortController = null;
      setWorking(false);
    }
  };

  const advanceAndContinue = async () => {
    const saveBtn = await waitFor('.save-sentence-btn');
    if (!saveBtn || stopTranslation) return;
    saveBtn.click();
    await sleep(1200);
    if (stopTranslation) return;
    // .sentence-current = editor still open on the next segment after WPML auto-advances
    // .add-translation  = untranslated segments still waiting
    if (document.querySelector('.sentence-current, .add-translation')) {
      document.querySelector('.wpml-ai-all-btn')?.click();
    } else {
      console.log('[WPML AI] Auto-translate complete.');
    }
  };

  // ─── VISION FILL FLOW (Mode B) ────────────────────────────────────────────
  //
  // For vision mode we DON'T try to click through segments one by one.
  // Instead we:
  //   1. Collect all segment source texts + their current target texts
  //   2. Send them to the popup for AI mapping
  //   3. Receive the translations back
  //   4. For each segment: if it has a .target-sentence div, set its text directly
  //      AND trigger React state update; for empty ones, click to open → write → save
  //
  // Writing directly to .target-sentence is possible because WPML reads from the
  // TinyMCE iframe only when a segment is active. When a segment is NOT active,
  // its .target-sentence div is the source of truth for display, not for saving.
  // So the correct flow for empty fields is:
  //   click .add-translation → wait for TinyMCE → write → click save → wait → next

  const visionFillSegments = async (translations, onlyEmpty) => {
    const segments = getSegmentRows();
    let filled = 0, skipped = 0, missed = 0;

    for (const seg of segments) {
      if (stopTranslation) break;

      const val = translations[seg.sourceText];

      // Skip non-empty if onlyEmpty
      if (onlyEmpty && !seg.isEmpty) { skipped++; continue; }

      if (!val || val === 'null') {
        // Highlight missed
        seg.rowEl.style.background = 'rgba(251,191,36,0.1)';
        missed++;
        continue;
      }

      if (seg.isEmpty) {
        // Need to open the segment in TinyMCE first
        const addBtn = seg.rowEl.querySelector('.add-translation button, .add-translation');
        if (!addBtn) { missed++; continue; }

        addBtn.click();
        // Wait for this row to become active (sentence-in-progress) and TinyMCE to load
        await sleep(600);
        await waitFor('.save-sentence-btn', 4000);
        await sleep(200);

        if (!setEditorHTML(val)) { missed++; continue; }
        await sleep(300);
        document.querySelector('.save-sentence-btn')?.click();
        await sleep(800);

      } else {
        // Segment already has a translation — open it, overwrite, save
        if (!onlyEmpty) {
          seg.rowEl.querySelector('.target-sentence-container')?.click();
          await sleep(600);
          await waitFor('.save-sentence-btn', 4000);
          await sleep(200);
          if (!setEditorHTML(val)) { missed++; continue; }
          await sleep(300);
          document.querySelector('.save-sentence-btn')?.click();
          await sleep(800);
        } else {
          skipped++;
          continue;
        }
      }

      seg.rowEl.style.background = 'rgba(34,197,94,0.12)';
      filled++;
    }

    return { filled, skipped, missed };
  };

  // ─── MESSAGE BRIDGE ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

    if (msg.type === 'GET_PAGE_FIELDS') {
      const segs = getSegmentRows();
      sendResponse({
        fields:   segs.map(s => ({ sourceText: s.sourceText, sourceHTML: s.sourceHTML, targetText: s.targetText, isEmpty: s.isEmpty })),
        language: getTargetLanguage(),
        url:      window.location.href
      });
      return true;
    }

    if (msg.type === 'VISION_FILL') {
      const { translations, onlyEmpty } = msg.payload;
      visionFillSegments(translations, onlyEmpty)
        .then(result => sendResponse(result))
        .catch(e    => sendResponse({ error: e.message }));
      return true; // async
    }
  });

  console.log('[WPML AI] v2.1 content script loaded — DOM: div-based ATE layout');
})();
