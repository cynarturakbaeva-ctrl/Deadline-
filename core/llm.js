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
          model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
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

/**
 * DeepSeek VISION (deepseek-flash = V4.1-Flash, суретті көреді): мәтін + суреттер → JSON.
 * parts: [{text}] | [{image:{mime,data,url}}] — сурет base64 data URL ретінде (detail:'low' → 512px, арзан);
 * data URL қабылданбаса (400) — суреттің http(s) сілтемесімен бір рет қайталанады.
 * Кілт жоқ / қате → null (шақырушы резерв жолға өтеді), ешқашан лақтырмайды.
 */
async function deepseekVisionJson(parts, opts = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !Array.isArray(parts) || !parts.length) return null;
  const model = opts.model || process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash';
  const build = (useUrl) => parts.map((p) => (p.image
    ? { type: 'image_url', image_url: { url: useUrl && p.image.url ? p.image.url : `data:${p.image.mime};base64,${p.image.data}`, detail: opts.detail || 'low' } }
    : { type: 'text', text: String(p.text || '') }));
  for (const useUrl of [false, true]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 40_000);
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: controller.signal,
        body: JSON.stringify({
          model, temperature: 0, max_tokens: opts.maxTokens || 1500,
          // ойлау режимі әдепкіде ҚОСУЛЫ: баға қою үшін керек емес, бірақ токенді жеп, жауапты бос/кешіктіріп қайтарады
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: build(useUrl) }],
        }),
      });
      if (!res.ok) {
        const t = (await res.text()).slice(0, 200);
        console.warn(`[DeepSeekVision] ${model} HTTP ${res.status} ${t}`);
        if (res.status === 400 && !useUrl && parts.some((p) => p.image && p.image.url)) continue; // data URL қабылданбады → сілтемемен
        return null;
      }
      let data = {};
      try { data = JSON.parse(await res.text()); } catch { return null; }
      recordApiUsage(data.usage || null, { label: opts.label || 'vision', model });
      const text = data.choices?.[0]?.message?.content || '';
      try { return JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        try { if (m) return JSON.parse(m[0]); } catch { /* төменде жазылады */ }
        // үнсіз null болмасын: себебі логта көрінсін (бос жауап, токен шегі, т.б.)
        console.warn(`[DeepSeekVision] ${model} unreadable reply finish=${data.choices?.[0]?.finish_reason || '-'} len=${text.length} "${text.slice(0, 80).replace(/\s+/g, ' ')}"`);
        return null;
      }
    } catch (e) {
      console.warn(`[DeepSeekVision] ${model} ${e.name === 'AbortError' ? 'timeout' : 'error'} after ${Date.now() - t0}ms: ${e.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

module.exports = { deepseekJson, deepseekVisionJson, DEEPSEEK_MAX_OUTPUT };
