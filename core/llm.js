'use strict';
/** DeepSeek JSON шақыру (ортақ). Кілт жоқ немесе сәтсіз болса — лақтырады; шақырушы өзі ұстайды. */
const { recordApiUsage } = require('./cost');

/**
 * DeepSeek V4 Flash шығысының ресми максимумы. Жасанды төмен лимит қойылмайды: модель қанша керек
 * болса сонша жазып, табиғи түрде (finish_reason=stop) тоқтайды — төленетін тек нақты жазылған токен.
 * Қажет болса env DEEPSEEK_MAX_OUTPUT арқылы өзгертуге болады.
 */
const DEEPSEEK_MAX_OUTPUT = Number(process.env.DEEPSEEK_MAX_OUTPUT) || 393216;

async function deepseekJson(system, user, label, maxTokensHint, opts = {}) {
  const maxTokens = DEEPSEEK_MAX_OUTPUT;   // шақырушының «hint»-і елеусіз: лимитке тірелмесін
  void maxTokensHint;
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
      // max_tokens-қа жетіп КЕСІЛГЕН жауап: JSON толық емес — қайталаудың мәні жоқ, шақырушы сұранысты бөлуі керек
      if (data.choices?.[0]?.finish_reason === 'length') { const err = new Error(`truncated: response hit max_tokens=${maxTokens}`); err.truncated = true; throw err; }
      if (!text) throw new Error('empty response');
      try { return JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('invalid JSON');
        return JSON.parse(m[0]);
      }
    } catch (e) {
      lastErr = e;
      if (e && e.truncated) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

module.exports = { deepseekJson, DEEPSEEK_MAX_OUTPUT };
