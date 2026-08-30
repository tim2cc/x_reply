(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    mode: 'draft',
    myHandle: '',
    dailyCap: 20,
    batchSize: 5,
    minDelaySec: 45,
    maxDelaySec: 120,
    preSendMinSec: 3,
    preSendMaxSec: 8,
    authorCooldownHours: 24,
    minTextLength: 31,
    endpoint: 'https://openrouter.ai/api/v1',
    apiPath: '/chat/completions',
    apiKey: '',
    model: 'openrouter/free',
    prompt: 'Write a very short, natural reply that invites discussion. Add one light criticism, nuance, or a single genuine question when appropriate. Stay relevant, do not invent personal experience, do not flatter blindly, and do not use more than 12 words. Return JSON only: {"reply":"...","shouldReply":true}. Set shouldReply to false only when the post is clearly unsuitable for a reply.',
    prompts: '',
  });

  function normHandle(value) {
    return String(value || '').trim().replace(/^@/, '').toLowerCase();
  }

  function parseStatusHref(href) {
    const raw = String(href || '').trim();
    let path = raw;
    try { if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname; } catch (_) { return null; }
    const m = path.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (m) return { handle: normHandle(m[1]), postId: m[2], postUrl: `https://x.com/${m[1]}/status/${m[2]}` };
    const web = path.match(/^\/i\/web\/status\/(\d+)/);
    return web ? { handle: '', postId: web[1], postUrl: `https://x.com/i/web/status/${web[1]}` } : null;
  }

  function targetReason(post, options = {}) {
    if (!post || !post.postId || !post.handle) return 'meta';
    if (post.promoted) return 'promoted';
    if (post.repost) return 'repost';
    if (post.reply) return 'reply';
    if (options.myHandle && normHandle(post.handle) === normHandle(options.myHandle)) return 'self';
    if (String(post.text || '').trim().length < (options.minTextLength ?? DEFAULTS.minTextLength)) return 'short';
    if (options.replied?.[post.postId]) return 'replied';
    const lastSent = Number(options.authorLastSent?.[normHandle(post.handle)] || 0);
    const cooldownMs = Math.max(0, Number(options.authorCooldownHours) || 0) * 60 * 60 * 1000;
    const now = Number(options.now) || Date.now();
    if (lastSent > 0 && cooldownMs > 0 && now - lastSent < cooldownMs) return 'author-cooldown';
    if (options.seen?.has(post.postId)) return 'duplicate';
    if (options.blockedAuthors?.has(normHandle(post.handle))) return 'blocked-author';
    return null;
  }

  function collectTargets(posts, options = {}) {
    const seen = options.seen || new Set();
    const blockedAuthors = new Set(options.blockedAuthors || []);
    const cooldownEnabled = Math.max(0, Number(options.authorCooldownHours) || 0) > 0;
    const out = [];
    for (const post of posts || []) {
      if (options.max && out.length >= options.max) break;
      if (targetReason(post, { ...options, seen, blockedAuthors })) continue;
      seen.add(post.postId);
      out.push({ ...post, handle: normHandle(post.handle), text: String(post.text || '').slice(0, 1200), status: 'queued' });
      if (cooldownEnabled) blockedAuthors.add(normHandle(post.handle));
    }
    return out;
  }

  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function delayMs(minSec, maxSec, random = Math.random()) {
    const lo = Math.max(1, Number(minSec) || 1);
    const hi = Math.max(lo, Number(maxSec) || lo);
    return Math.round((lo + Math.min(1, Math.max(0, random)) * (hi - lo)) * 1000);
  }

  function parsePrompts(value, fallback = '') {
    const items = String(value || '').split(/\n\s*---\s*\n|\n{2,}/).map((item) => item.trim()).filter(Boolean);
    return items.length ? items : [String(fallback || '').trim()].filter(Boolean);
  }

  function validateReply(value, maxWords = 20) {
    const reply = String(value || '').trim();
    if (!reply) return { ok: false, reason: 'empty' };
    if (/\r|\n/.test(reply)) return { ok: false, reason: 'multiline' };
    if (reply.split(/\s+/).length > Math.max(1, Number(maxWords) || 20)) return { ok: false, reason: 'too-many-words' };
    return { ok: true };
  }

  function parseReply(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const value = JSON.parse(match[0]);
        if (value && value.shouldReply === false) return { reply: '', shouldReply: false };
        if (value && typeof value.reply === 'string') return { reply: value.reply.trim(), shouldReply: true };
      } catch (_) {}
    }
    return { reply: text.replace(/^['"«]|['"»]$/g, '').trim(), shouldReply: !!text };
  }

  function canAutoPublish(config, state) {
    if (config.mode !== 'auto') return { ok: false, reason: 'not-auto' };
    if (!state || state.day !== dayKey()) return { ok: true };
    if ((state.sentToday || 0) >= Math.max(1, Number(config.dailyCap) || DEFAULTS.dailyCap)) return { ok: false, reason: 'daily-cap' };
    return { ok: true };
  }

  const api = { DEFAULTS, normHandle, parseStatusHref, targetReason, collectTargets, dayKey, delayMs, parsePrompts, parseReply, validateReply, canAutoPublish };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.XAR = api;
  else if (typeof globalThis !== 'undefined') globalThis.XAR = api;
})();
