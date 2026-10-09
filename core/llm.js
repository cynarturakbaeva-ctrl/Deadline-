'use strict';
/** DeepSeek JSON шақыру (ортақ). Кілт жоқ немесе сәтсіз болса — лақтырады; шақырушы өзі ұстайды. */
const { recordApiUsage } = require('./cost');

async function deepseekJson(system, user, label, maxTokens = 3000, opts = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY жоқ');
  const tries = opts.tries || 2;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 60_000);
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
          temperature: opts.temperature == null ? 0 : opts.temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`[${res.status}] ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      recordApiUsage(data.usage || null, { label, model: 'deepseek' });
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('empty response');
      try { return JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('invalid JSON');
        return JSON.parse(m[0]);
      }
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

module.exports = { deepseekJson };
