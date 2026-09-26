'use strict';

// PostgreSQL негізіндегі база (Railway Postgres add-on).
// Сыртқа шығатын функциялар мен олардың мінез-құлқы бұрынғы (v2) db.js-пен
// ҮЙЛЕСІМДІ — bot.js өзгеріссіз жұмыс істейді. Оған қоса, v3 Mini App үшін
// jobs/history кестелері және rate-limit өрістері қосылды.

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] DATABASE_URL орнатылмаған. Railway-де Postgres add-on қосыңыз.');
  process.exit(1);
}

// Railway/Render/Neon сияқты бұлттық хостингтерге SSL керек; жергілікті
// (localhost) Postgres-те SSL болмайды. DATABASE_SSL=false деп өшіруге болады.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);
const useSsl = process.env.DATABASE_SSL !== 'false' && !isLocal;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

const REFERRALS_PER_BONUS = 2;

function envInt(name, def, min, max) {
  const n = parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
const RATE_COOLDOWN_SEC = envInt('RATE_COOLDOWN_SEC', 45, 0, 3600);
const RATE_DAILY_LIMIT = envInt('RATE_DAILY_LIMIT', 25, 1, 10000);
const RATE_DAILY_EXPENSIVE_LIMIT = envInt('RATE_DAILY_EXPENSIVE_LIMIT', 12, 1, 10000);

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ─── Init ───────────────────────────────────────────────────────────────
async function initDB() {
  // Ескі кесте (v2-ден келеді, деректер сақталады)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id      TEXT PRIMARY KEY,
      credits      INTEGER NOT NULL DEFAULT 0,
      total        INTEGER NOT NULL DEFAULT 0,
      free_used    BOOLEAN NOT NULL DEFAULT FALSE,
      referred_by  TEXT DEFAULT NULL,
      ref_earnings INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_earnings INTEGER NOT NULL DEFAULT 0`);

  // v3: rate-limit өрістері users кестесіне қосылады
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_attempt_at BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_success_at BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_date TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_gens INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_expensive INTEGER NOT NULL DEFAULT 0`);

  // v3: Mini App job queue
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      chat_id       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'queued',
      phase         TEXT NOT NULL DEFAULT 'queued',
      detail        TEXT DEFAULT '',
      progress      INTEGER NOT NULL DEFAULT 0,
      payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
      title         TEXT DEFAULT NULL,
      quality_score DOUBLE PRECISION DEFAULT NULL,
      pptx_path     TEXT DEFAULT NULL,
      html_path     TEXT DEFAULT NULL,
      error         TEXT DEFAULT NULL,
      created_at    BIGINT NOT NULL,
      updated_at    BIGINT NOT NULL,
      finished_at   BIGINT DEFAULT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_jobs_chat_id ON jobs (chat_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_jobs_finished_at ON jobs (finished_at)`);

  // v3: тарих
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id         TEXT PRIMARY KEY,
      chat_id    TEXT NOT NULL,
      entry      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_history_chat_id ON history (chat_id, created_at DESC)`);

  console.log('[DB] Postgres tables ready');
}

// ─── Users ──────────────────────────────────────────────────────────────
async function getUser(chatId) {
  try {
    const res = await pool.query(
      'SELECT credits, total, referred_by, ref_earnings FROM users WHERE chat_id = $1',
      [String(chatId)]
    );
    if (!res.rows.length) {
      return { credits: 0, total: 0, referredBy: null, refEarnings: 0 };
    }
    const r = res.rows[0];
    return {
      credits: r.credits,
      total: r.total,
      referredBy: r.referred_by,
      refEarnings: r.ref_earnings,
    };
  } catch (err) {
    console.error('[DB] getUser error:', err.message);
    return { credits: 0, total: 0, referredBy: null, refEarnings: 0 };
  }
}

async function registerUser(chatId, referredBy = null) {
  try {
    await pool.query(`
      INSERT INTO users (chat_id, credits, total, referred_by, ref_earnings)
      VALUES ($1, 0, 0, $2, 0)
      ON CONFLICT (chat_id) DO NOTHING
    `, [String(chatId), referredBy ? String(referredBy) : null]);
  } catch (err) {
    console.error('[DB] registerUser error:', err.message);
  }
}

async function addCredits(chatId, amount) {
  try {
    await pool.query(`
      INSERT INTO users (chat_id, credits, total, ref_earnings)
      VALUES ($1, $2, $2, 0)
      ON CONFLICT (chat_id) DO UPDATE
      SET credits = users.credits + $2,
          total   = users.total   + $2
    `, [String(chatId), amount]);
    console.log(`[DB] addCredits: ${chatId} +${amount}`);
    return getUser(chatId);
  } catch (err) {
    console.error('[DB] addCredits error:', err.message);
    throw err;
  }
}

async function incrementRefCount(referrerId) {
  try {
    const res = await pool.query(`
      UPDATE users
      SET ref_earnings = ref_earnings + 1
      WHERE chat_id = $1
      RETURNING ref_earnings
    `, [String(referrerId)]);

    if (!res.rowCount) {
      console.warn(`[DB] incrementRefCount: referrer ${referrerId} табылмады`);
      return { newCount: 0, bonusGiven: false };
    }

    const newCount = res.rows[0].ref_earnings;

    if (newCount % REFERRALS_PER_BONUS === 0) {
      await pool.query(
        'UPDATE users SET credits = credits + 1 WHERE chat_id = $1',
        [String(referrerId)]
      );
      console.log(`[DB] refBonus: ${referrerId} earned +1 credit (${newCount} referrals)`);
      return { newCount, bonusGiven: true };
    }

    console.log(`[DB] refCount: ${referrerId} now has ${newCount} referrals`);
    return { newCount, bonusGiven: false };
  } catch (err) {
    console.error('[DB] incrementRefCount error:', err.message);
    return { newCount: 0, bonusGiven: false };
  }
}

async function useCredit(chatId) {
  try {
    const res = await pool.query(
      'UPDATE users SET credits = credits - 1 WHERE chat_id = $1 AND credits > 0 RETURNING credits',
      [String(chatId)]
    );
    if (!res.rowCount) return false;
    console.log(`[DB] useCredit: ${chatId}, remaining: ${res.rows[0].credits}`);
    return true;
  } catch (err) {
    console.error('[DB] useCredit error:', err.message);
    return false;
  }
}

async function refundCredit(chatId) {
  try {
    await pool.query('UPDATE users SET credits = credits + 1 WHERE chat_id = $1', [String(chatId)]);
    console.log(`[DB] refundCredit: ${chatId}`);
  } catch (err) {
    console.error('[DB] refundCredit error:', err.message);
  }
}

async function getAllChatIds() {
  try {
    const res = await pool.query('SELECT chat_id FROM users');
    return res.rows.map(r => r.chat_id);
  } catch (err) {
    console.error('[DB] getAllChatIds error:', err.message);
    return [];
  }
}

// ─── Rate limits (v3) ──────────────────────────────────────────────────
async function checkRateLimits(chatId, opts = {}) {
  const expensive = !!opts.expensive;
  try {
    const res = await pool.query(
      'SELECT last_attempt_at, daily_date, daily_gens, daily_expensive FROM users WHERE chat_id = $1',
      [String(chatId)]
    );
    if (!res.rows.length) return { allowed: true };

    const u = res.rows[0];
    const today = todayKey();
    const dailyGens = u.daily_date === today ? u.daily_gens : 0;
    const dailyExpensive = u.daily_date === today ? u.daily_expensive : 0;

    const now = Date.now();
    const lastAttemptAt = Number(u.last_attempt_at) || 0;
    if (RATE_COOLDOWN_SEC > 0 && lastAttemptAt > 0) {
      const elapsed = (now - lastAttemptAt) / 1000;
      if (elapsed < RATE_COOLDOWN_SEC) {
        const retryAfterSec = Math.ceil(RATE_COOLDOWN_SEC - elapsed);
        return {
          allowed: false,
          code: 'cooldown',
          message: `Күте тұрыңыз: ${retryAfterSec} сек кейін қайта жіберіңіз.`,
          retryAfterSec,
        };
      }
    }

    if (dailyGens >= RATE_DAILY_LIMIT) {
      return {
        allowed: false,
        code: 'daily_limit',
        message: `Бүгінгі лимит (${RATE_DAILY_LIMIT} презентация) толды. Ертең қайта көріңіз.`,
      };
    }

    if (expensive && dailyExpensive >= RATE_DAILY_EXPENSIVE_LIMIT) {
      return {
        allowed: false,
        code: 'daily_expensive',
        message: `Бүгінгі кеңейтілген визуал лимиті (${RATE_DAILY_EXPENSIVE_LIMIT}) толды.`,
      };
    }

    return { allowed: true };
  } catch (err) {
    console.error('[DB] checkRateLimits error:', err.message);
    return { allowed: true };
  }
}

async function markGenerationAttempt(chatId) {
  try {
    const today = todayKey();
    await pool.query(`
      INSERT INTO users (chat_id, credits, total, ref_earnings, last_attempt_at, daily_date, daily_gens, daily_expensive)
      VALUES ($1, 0, 0, 0, $2, $3, 0, 0)
      ON CONFLICT (chat_id) DO UPDATE
      SET last_attempt_at = $2,
          daily_date = CASE WHEN users.daily_date = $3 THEN users.daily_date ELSE $3 END,
          daily_gens = CASE WHEN users.daily_date = $3 THEN users.daily_gens ELSE 0 END,
          daily_expensive = CASE WHEN users.daily_date = $3 THEN users.daily_expensive ELSE 0 END
    `, [String(chatId), Date.now(), today]);
  } catch (err) {
    console.error('[DB] markGenerationAttempt error:', err.message);
  }
}

async function markGenerationSuccess(chatId, opts = {}) {
  try {
    const today = todayKey();
    const expensiveInc = opts.expensive ? 1 : 0;
    const res = await pool.query(`
      UPDATE users
      SET last_success_at = $2,
          daily_date = $3,
          daily_gens = CASE WHEN daily_date = $3 THEN daily_gens + 1 ELSE 1 END,
          daily_expensive = CASE WHEN daily_date = $3 THEN daily_expensive + $4 ELSE $4 END
      WHERE chat_id = $1
      RETURNING daily_gens
    `, [String(chatId), Date.now(), today, expensiveInc]);
    if (res.rowCount) {
      console.log(`[DB] markGenerationSuccess: ${chatId} daily=${res.rows[0].daily_gens}/${RATE_DAILY_LIMIT}`);
    }
  } catch (err) {
    console.error('[DB] markGenerationSuccess error:', err.message);
  }
}

// ─── Jobs (v3 Mini App) ──────────────────────────────────────────────────
function makeJobId() {
  return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function rowToJob(r) {
  if (!r) return null;
  return {
    id: r.id,
    chatId: r.chat_id,
    status: r.status,
    phase: r.phase,
    detail: r.detail,
    progress: r.progress,
    payload: r.payload || {},
    title: r.title,
    qualityScore: r.quality_score,
    pptxPath: r.pptx_path,
    htmlPath: r.html_path,
    error: r.error,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    finishedAt: r.finished_at != null ? Number(r.finished_at) : null,
  };
}

async function createJob(chatId, payload) {
  const id = makeJobId();
  const now = Date.now();
  const job = {
    id,
    chatId: String(chatId),
    status: 'queued',
    phase: 'queued',
    detail: '',
    progress: 0,
    payload: payload || {},
    title: null,
    qualityScore: null,
    pptxPath: null,
    htmlPath: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  await pool.query(`
    INSERT INTO jobs (id, chat_id, status, phase, detail, progress, payload, title, quality_score, pptx_path, html_path, error, created_at, updated_at, finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [job.id, job.chatId, job.status, job.phase, job.detail, job.progress, JSON.stringify(job.payload),
      job.title, job.qualityScore, job.pptxPath, job.htmlPath, job.error, job.createdAt, job.updatedAt, job.finishedAt]);
  return job;
}

const JOB_FIELD_MAP = {
  status: 'status',
  phase: 'phase',
  detail: 'detail',
  progress: 'progress',
  title: 'title',
  qualityScore: 'quality_score',
  pptxPath: 'pptx_path',
  htmlPath: 'html_path',
  error: 'error',
};

async function updateJob(jobId, patch) {
  try {
    const sets = [];
    const values = [String(jobId)];
    let idx = 2;
    for (const [key, col] of Object.entries(JOB_FIELD_MAP)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${col} = $${idx}`);
        values.push(patch[key]);
        idx++;
      }
    }
    const now = Date.now();
    sets.push(`updated_at = $${idx}`);
    values.push(now);
    idx++;
    if (patch.status === 'done' || patch.status === 'failed') {
      sets.push(`finished_at = $${idx}`);
      values.push(now);
      idx++;
    }
    if (!sets.length) return getJob(jobId);
    const res = await pool.query(
      `UPDATE jobs SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return rowToJob(res.rows[0]);
  } catch (err) {
    console.error('[DB] updateJob error:', err.message);
    return null;
  }
}

async function getJob(jobId) {
  try {
    const res = await pool.query('SELECT * FROM jobs WHERE id = $1', [String(jobId)]);
    return rowToJob(res.rows[0]);
  } catch (err) {
    console.error('[DB] getJob error:', err.message);
    return null;
  }
}

async function getUserJobs(chatId, limit = 20) {
  try {
    const res = await pool.query(
      'SELECT * FROM jobs WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2',
      [String(chatId), limit]
    );
    return res.rows.map(rowToJob);
  } catch (err) {
    console.error('[DB] getUserJobs error:', err.message);
    return [];
  }
}

// ─── History (v3) ────────────────────────────────────────────────────────
async function addHistory(chatId, entry) {
  try {
    const id = entry.id || makeJobId();
    const createdAt = entry.createdAt || Date.now();
    const full = { ...entry, id, createdAt };
    await pool.query(
      'INSERT INTO history (id, chat_id, entry, created_at) VALUES ($1,$2,$3,$4)',
      [id, String(chatId), JSON.stringify(full), createdAt]
    );
    await pool.query(`
      DELETE FROM history WHERE id IN (
        SELECT id FROM history WHERE chat_id = $1 ORDER BY created_at DESC OFFSET 50
      )
    `, [String(chatId)]);
    return full;
  } catch (err) {
    console.error('[DB] addHistory error:', err.message);
    return null;
  }
}

async function getHistory(chatId, limit = 20) {
  try {
    const res = await pool.query(
      'SELECT entry FROM history WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2',
      [String(chatId), limit]
    );
    return res.rows.map(r => r.entry);
  } catch (err) {
    console.error('[DB] getHistory error:', err.message);
    return [];
  }
}

async function cleanupOldJobs(maxAgeMs = 7 * 24 * 3600 * 1000) {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const res = await pool.query('DELETE FROM jobs WHERE finished_at IS NOT NULL AND finished_at < $1', [cutoff]);
    return res.rowCount || 0;
  } catch (err) {
    console.error('[DB] cleanupOldJobs error:', err.message);
    return 0;
  }
}

module.exports = {
  initDB,
  getUser,
  registerUser,
  addCredits,
  incrementRefCount,
  useCredit,
  refundCredit,
  getAllChatIds,
  checkRateLimits,
  markGenerationAttempt,
  markGenerationSuccess,
  REFERRALS_PER_BONUS,
  RATE_COOLDOWN_SEC,
  RATE_DAILY_LIMIT,
  RATE_DAILY_EXPENSIVE_LIMIT,
  createJob,
  updateJob,
  getJob,
  getUserJobs,
  addHistory,
  getHistory,
  cleanupOldJobs,
};
