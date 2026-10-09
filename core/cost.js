'use strict';

/**
 * Structured cost / usage accounting per generation ID.
 * Records ONLY provider-reported token usage — never guesses.
 * Distinguishes actual (from API) vs estimated (price applied to actual tokens).
 * Never logs secrets or full user content.
 */

const USD_KZT = Number(process.env.USD_KZT) || 470;
const PRICE_IN = Number(process.env.COST_PRICE_IN) || 0.30;
const PRICE_OUT = Number(process.env.COST_PRICE_OUT) || 1.20;

/** @type {ReturnType<typeof createCostTracker>|null} */
let activeTracker = null;

function setActiveCostTracker(tracker) {
  activeTracker = tracker || null;
}

function getActiveCostTracker() {
  return activeTracker;
}

/**
 * Record provider usage if a tracker is active.
 * usage must come from the API response (prompt_tokens / completion_tokens / etc).
 * If usage is missing, records the call with tokens=0 and actual=false for that call's tokens.
 */
function recordApiUsage(usage, meta = {}) {
  if (!activeTracker) return;
  activeTracker.addUsage(usage, meta.label || meta.phase || 'api', meta);
}

function createCostTracker(genId) {
  const state = {
    genId: genId || 'unknown',
    model: process.env.DEEPSEEK_MODEL || process.env.QUALITY_MODEL || 'deepseek-v4-flash',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    apiCalls: 0,
    callsWithUsage: 0,
    callsWithoutUsage: 0,
    slides: 0,
    qualityIterations: 0,
    repairIterations: 0,
    renderAttempts: 0,
    startedAt: Date.now(),
    phases: [],
    models: new Set(),
  };

  return {
    addUsage(usage, label, meta = {}) {
      state.apiCalls += 1;
      const hasUsage = !!(usage && typeof usage === 'object');
      let inn = 0;
      let out = 0;
      let total = 0;
      let actual = false;

      if (hasUsage) {
        inn = Number(usage.prompt_tokens) || Number(usage.input_tokens) || 0;
        out = Number(usage.completion_tokens) || Number(usage.output_tokens) || 0;
        total = Number(usage.total_tokens) || (inn + out);
        // Only treat as actual if provider reported at least one token field
        if (
          usage.prompt_tokens != null || usage.completion_tokens != null
          || usage.input_tokens != null || usage.output_tokens != null
          || usage.total_tokens != null
        ) {
          actual = true;
          state.callsWithUsage += 1;
        } else {
          state.callsWithoutUsage += 1;
        }
      } else {
        state.callsWithoutUsage += 1;
      }

      if (actual) {
        state.inputTokens += inn;
        state.outputTokens += out;
        state.totalTokens += total;
      }

      const model = meta.model || state.model;
      if (model) state.models.add(model);

      state.phases.push({
        label: String(label || 'api').slice(0, 48),
        in: actual ? inn : null,
        out: actual ? out : null,
        total: actual ? total : null,
        actual,
        model,
      });
    },
    setSlides(n) { state.slides = n; },
    setQuality(iterations, repairs) {
      state.qualityIterations = iterations || 0;
      state.repairIterations = repairs || 0;
    },
    addRenderAttempt() { state.renderAttempts += 1; },
    setModel(m) {
      if (m) {
        state.model = m;
        state.models.add(m);
      }
    },
    snapshot() {
      const durationMs = Date.now() - state.startedAt;
      // Cost is estimated from actual tokens only — never invented token counts
      const costUsd = (state.inputTokens * PRICE_IN + state.outputTokens * PRICE_OUT) / 1e6;
      const costTg = costUsd * USD_KZT;
      return {
        genId: state.genId,
        model: state.model,
        models: [...state.models],
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        totalTokens: state.totalTokens,
        apiCalls: state.apiCalls,
        callsWithUsage: state.callsWithUsage,
        callsWithoutUsage: state.callsWithoutUsage,
        tokenSource: state.callsWithUsage > 0 ? 'provider' : (state.apiCalls ? 'none' : 'none'),
        estimatedCostUsd: Math.round(costUsd * 1e6) / 1e6,
        estimatedCostTg: Math.round(costTg * 100) / 100,
        costIsEstimate: true, // price math is always an estimate; tokens are actual when tokenSource=provider
        durationMs,
        slides: state.slides,
        qualityIterations: state.qualityIterations,
        repairIterations: state.repairIterations,
        renderAttempts: state.renderAttempts,
      };
    },
    logSummary() {
      const s = this.snapshot();
      console.log(
        `[Cost] id=${s.genId} model=${s.model} calls=${s.apiCalls} ` +
        `tok_in=${s.inputTokens} tok_out=${s.outputTokens} tok_total=${s.totalTokens} ` +
        `source=${s.tokenSource} ~$${s.estimatedCostUsd} (~${s.estimatedCostTg}₸) ` +
        `ms=${s.durationMs} slides=${s.slides} qIter=${s.qualityIterations} ` +
        `repair=${s.repairIterations} render=${s.renderAttempts}`
      );
      return s;
    },
  };
}

module.exports = {
  createCostTracker,
  setActiveCostTracker,
  getActiveCostTracker,
  recordApiUsage,
  USD_KZT,
  PRICE_IN,
  PRICE_OUT,
};
