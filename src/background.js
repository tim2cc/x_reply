importScripts('domain.js');
const DEFAULTS = { mode: 'draft', myHandle: '', dailyCap: 20, batchSize: 5, minDelaySec: 45, maxDelaySec: 120, preSendMinSec: 3, preSendMaxSec: 8, authorCooldownHours: 24, minTextLength: 31, endpoint: 'https://openrouter.ai/api/v1', apiPath: '/chat/completions', apiKey: '', model: 'openrouter/free', prompt: 'Write a very short, natural reply that invites discussion. Add one light criticism, nuance, or a single genuine question when appropriate. Stay relevant, do not invent personal experience, do not flatter blindly, and do not use more than 12 words. Return JSON only: {"reply":"...","shouldReply":true}. Set shouldReply to false only when the post is clearly unsuitable for a reply.', prompts: '' };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.id || sender.id !== chrome.runtime.id) return;
  if (message.type === 'GET_CONFIG') {
    chrome.storage.local.get({ config: DEFAULTS, emergencyStop: false }, (s) => { if (chrome.runtime.lastError) { sendResponse({ ok: false, reason: `storage.get: ${chrome.runtime.lastError.message}` }); return; } const config = { ...DEFAULTS, ...(s.config || {}) }; const { apiKey, ...safeConfig } = config; sendResponse({ ok: true, config: safeConfig, emergencyStop: !!s.emergencyStop }); });
    return true;
  }
  if (message.type === 'EMERGENCY_STOP') {
    chrome.storage.local.set({ emergencyStop: true }, () => sendResponse(chrome.runtime.lastError ? { ok: false, reason: `storage.set: ${chrome.runtime.lastError.message}` } : { ok: true }));
    return true;
  }
  if (message.type === 'GENERATE_REPLY') {
    chrome.storage.local.get({ config: DEFAULTS, emergencyStop: false }, async (s) => {
      if (chrome.runtime.lastError) return sendResponse({ ok: false, reason: `storage.get: ${chrome.runtime.lastError.message}` });
      if (s.emergencyStop) return sendResponse({ ok: false, reason: 'emergency-stop' });
      const config = { ...DEFAULTS, ...(s.config || {}) };
      const promptVariants = XAR.parsePrompts(config.prompts, config.prompt);
      const selectedPrompt = promptVariants.length ? promptVariants[Math.floor(Math.random() * promptVariants.length)] : config.prompt;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(String(config.endpoint).replace(/\/$/, '') + (config.apiPath || DEFAULTS.apiPath), {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'HTTP-Referer': 'https://x.com/', 'X-Title': 'X Accessible Auto Replier', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
          body: JSON.stringify({ model: config.model, stream: false, messages: [{ role: 'system', content: selectedPrompt }, { role: 'user', content: `Post by @${message.post.handle}:\n${message.post.text}` }] }),
        });
        if (!response.ok) return sendResponse({ ok: false, reason: `AI HTTP ${response.status}` });
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') return sendResponse({ ok: false, reason: 'empty-ai-response' });
        sendResponse({ ok: true, content });
      } catch (error) {
        const message = String(error?.message || error);
        const reason = error?.name === 'AbortError'
          ? 'AI timeout after 45s'
          : /failed to fetch|networkerror|load failed|econnrefused/i.test(message)
          ? 'AI endpoint недоступен: проверьте адрес, API key и доступность OpenRouter'
          : message;
        sendResponse({ ok: false, reason });
      } finally { clearTimeout(timeout); }
    });
    return true;
  }
});
