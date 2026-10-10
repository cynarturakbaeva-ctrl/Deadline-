'use strict';

/**
 * Local JSON database for Termux.
 * Replaces PostgreSQL/Railway while preserving the db.js public API.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const REFERRALS_PER_BONUS = 2;

function envInt(name, def, min, max) {
  const n = parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

const RATE_COOLDOWN_SEC = envInt('RATE_COOLDOWN_SEC', 45, 0, 3600);
const RATE_DAILY_LIMIT = envInt('RATE_DAILY_LIMIT', 25, 1, 10000);
const RATE_DAILY_EXPENSIVE_LIMIT = envInt('RATE_DAILY_EXPENSIVE_LIMIT', 12, 1, 10000);

function emptyDB() {
  return {
    users: {},
    jobs: {},
    history: {},
    feedback: {},
    receipts: {},
    partner_log: {}
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const db = emptyDB();
      saveDB(db);
      return db;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    return {
      users: db.users || {},
      jobs: db.jobs || {},
      history: db.history || {},
      feedback: db.feedback || {},
      receipts: db.receipts || {},
      partner_log: db.partner_log || {}
    };
  } catch (err) {
    console.error('[DB] Local read error:', err.message);
    return emptyDB();
  }
}

function saveDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

let db = loadDB();

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function ensureUser(chatId, referredBy = null) {
  const id = String(chatId);
  if (!db.users[id]) {
    db.users[id] = {
      chat_id: id,
      credits: 0,
      total: 0,
      free_used: false,
      referred_by: referredBy ? String(referredBy) : null,
      ref_earnings: 0,
      last_attempt_at: 0,
      last_success_at: 0,
      daily_date: null,
      daily_gens: 0,
      daily_expensive: 0
    };
  }
  return db.users[id];
}

// ─── Init ───────────────────────────────────────────────────────────────
async function initDB() {
  db = loadDB();
  saveDB(db);
  console.log(`[DB] Local JSON database ready: ${DB_FILE}`);
}

// ─── Users ──────────────────────────────────────────────────────────────
async function getUser(chatId) {
  const u = db.users[String(chatId)];
  if (!u) return { credits: 0, total: 0, referredBy: null, refEarnings: 0 };
  return {
    credits: Number(u.credits) || 0,
    total: Number(u.total) || 0,
    referredBy: u.referred_by || null,
    refEarnings: Number(u.ref_earnings) || 0
  };
}

async function registerUser(chatId, referredBy = null) {
  ensureUser(chatId, referredBy);
  saveDB(db);
}

async function addCredits(chatId, amount) {
  const u = ensureUser(chatId);
  const n = Number(amount) || 0;
  u.credits += n;
  u.total += n;
  saveDB(db);
  console.log(`[DB] addCredits: ${chatId} +${n}`);
  return getUser(chatId);
}

async function applyReceipt(chatId, receiptNo, amount, credits) {
  const key = String(receiptNo);
  if (db.receipts[key]) return { applied: false, duplicate: true };

  const u = ensureUser(chatId);
  const n = Number(credits) || 0;

  db.receipts[key] = {
    receipt_no: key,
    chat_id: String(chatId),
    amount: Number(amount) || 0,
    credits: n,
    status: 'confirmed',
    created_at: Date.now()
  };

  u.credits += n;
  u.total += n;
  saveDB(db);

  console.log(`[DB] applyReceipt: ${chatId} receipt=${key} +${n}`);
  return { applied: true, user: await getUser(chatId) };
}

async function receiptExists(receiptNo) {
  return !!db.receipts[String(receiptNo)];
}

async function incrementRefCount(referrerId) {
  const u = db.users[String(referrerId)];
  if (!u) {
    console.warn(`[DB] incrementRefCount: referrer ${referrerId} not found`);
    return { newCount: 0, bonusGiven: false };
  }

  u.ref_earnings = (Number(u.ref_earnings) || 0) + 1;
  let bonusGiven = false;

  if (u.ref_earnings % REFERRALS_PER_BONUS === 0) {
    u.credits += 1;
    bonusGiven = true;
  }

  saveDB(db);
  return { newCount: u.ref_earnings, bonusGiven };
}


// ─── Серіктестер (партнёрлер): әкелген клиенттің әр төлемінен пайыз ─────────────
const PARTNER_RATE = Math.min(0.9, Math.max(0, Number(process.env.PARTNER_RATE) || 0.3));

function partnerView(u) {
  const buyers = new Set(Object.values(db.partner_log).filter((l) => l.partner_id === u.chat_id).map((l) => l.buyer_id));
  return {
    status: u.partner_status || 'none',
    balance: Number(u.partner_balance) || 0,
    earned: Number(u.partner_earned) || 0,
    paid: Number(u.partner_paid) || 0,
    buyers: buyers.size,
    rate: PARTNER_RATE,
  };
}

async function getPartner(chatId) {
  const u = db.users[String(chatId)];
  if (!u) return { status: 'none', balance: 0, earned: 0, paid: 0, buyers: 0, rate: PARTNER_RATE };
  return partnerView(u);
}

/** Серіктес болуға сұраныс. 'none'/'rejected' → 'pending'. Қайтарады: жаңа статус */
async function requestPartner(chatId) {
  const u = ensureUser(chatId);
  if (u.partner_status === 'active' || u.partner_status === 'pending') return u.partner_status;
  u.partner_status = 'pending';
  saveDB(db);
  return 'pending';
}

async function setPartnerStatus(chatId, status) {
  if (!['active', 'rejected', 'none'].includes(status)) return false;
  const u = db.users[String(chatId)];
  if (!u) return false;
  u.partner_status = status;
  saveDB(db);
  return true;
}

/**
 * Төлем расталғанда шақырған серіктеске пайыз есептейді. ref — бірегей (чек №), қайталанбайды.
 * @returns {{partnerId, commission}|null}
 */
async function creditPartnerCommission(buyerId, amount, ref) {
  const buyer = db.users[String(buyerId)];
  const pid = buyer && buyer.referred_by;
  const key = String(ref || '');
  const a = Math.floor(Number(amount) || 0);
  if (!pid || !key || a <= 0 || String(pid) === String(buyerId)) return null;
  const partner = db.users[String(pid)];
  if (!partner || partner.partner_status !== 'active') return null;
  if (db.partner_log[key]) return null;
  const commission = Math.floor(a * PARTNER_RATE);
  if (commission <= 0) return null;
  db.partner_log[key] = { ref: key, partner_id: String(pid), buyer_id: String(buyerId), amount: a, commission, created_at: Date.now() };
  partner.partner_balance = (Number(partner.partner_balance) || 0) + commission;
  partner.partner_earned = (Number(partner.partner_earned) || 0) + commission;
  saveDB(db);
  console.log(`[DB] partner commission: ${pid} +${commission}₸ (buyer ${buyerId}, ${key})`);
  return { partnerId: String(pid), commission };
}

/** Админ серіктеске ақша аударды: баланстан алып тастайды. Қайтарады: жаңа баланс немесе null */
async function payoutPartner(chatId, amount) {
  const u = db.users[String(chatId)];
  const a = Math.floor(Number(amount) || 0);
  if (!u || a <= 0 || (Number(u.partner_balance) || 0) < a) return null;
  u.partner_balance -= a;
  u.partner_paid = (Number(u.partner_paid) || 0) + a;
  saveDB(db);
  return u.partner_balance;
}

async function listPartners() {
  return Object.values(db.users).filter((u) => u.partner_status === 'active').map((u) => ({ chatId: u.chat_id, ...partnerView(u) }));
}

async function useCredit(chatId) {
  const u = db.users[String(chatId)];
  if (!u || (Number(u.credits) || 0) <= 0) return false;
  u.credits -= 1;
  saveDB(db);
  console.log(`[DB] useCredit: ${chatId}, remaining: ${u.credits}`);
  return true;
}

async function refundCredit(chatId) {
  const u = ensureUser(chatId);
  u.credits += 1;
  saveDB(db);
  console.log(`[DB] refundCredit: ${chatId}`);
}

async function getAllChatIds() {
  return Object.keys(db.users);
}

// ─── Rate limits ────────────────────────────────────────────────────────
async function checkRateLimits(chatId, opts = {}) {
  const expensive = !!opts.expensive;
  const u = db.users[String(chatId)];
  if (!u) return { allowed: true };

  const today = todayKey();
  const dailyGens = u.daily_date === today ? Number(u.daily_gens) || 0 : 0;
  const dailyExpensive = u.daily_date === today ? Number(u.daily_expensive) || 0 : 0;

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
        retryAfterSec
      };
    }
  }

  if (dailyGens >= RATE_DAILY_LIMIT) {
    return {
      allowed: false,
      code: 'daily_limit',
      message: `Бүгінгі лимит (${RATE_DAILY_LIMIT} презентация) толды. Ертең қайта көріңіз.`
    };
  }

  if (expensive && dailyExpensive >= RATE_DAILY_EXPENSIVE_LIMIT) {
    return {
      allowed: false,
      code: 'daily_expensive',
      message: `Бүгінгі кеңейтілген визуал лимиті (${RATE_DAILY_EXPENSIVE_LIMIT}) толды.`
    };
  }

  return { allowed: true };
}

async function markGenerationAttempt(chatId) {
  const u = ensureUser(chatId);
  const today = todayKey();
  u.last_attempt_at = Date.now();

  if (u.daily_date !== today) {
    u.daily_date = today;
    u.daily_gens = 0;
    u.daily_expensive = 0;
  }

  saveDB(db);
}

async function markGenerationSuccess(chatId, opts = {}) {
  const u = ensureUser(chatId);
  const today = todayKey();

  if (u.daily_date !== today) {
    u.daily_date = today;
    u.daily_gens = 0;
    u.daily_expensive = 0;
  }

  u.last_success_at = Date.now();
  u.daily_gens += 1;
  if (opts.expensive) u.daily_expensive += 1;

  saveDB(db);
  console.log(`[DB] markGenerationSuccess: ${chatId} daily=${u.daily_gens}/${RATE_DAILY_LIMIT}`);
}

// ─── Jobs ───────────────────────────────────────────────────────────────
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
    finishedAt: r.finished_at != null ? Number(r.finished_at) : null
  };
}

async function createJob(chatId, payload) {
  const id = makeJobId();
  const now = Date.now();

  const job = {
    id,
    chat_id: String(chatId),
    status: 'queued',
    phase: 'queued',
    detail: '',
    progress: 0,
    payload: payload || {},
    title: null,
    quality_score: null,
    pptx_path: null,
    html_path: null,
    error: null,
    created_at: now,
    updated_at: now,
    finished_at: null
  };

  db.jobs[id] = job;
  saveDB(db);
  return rowToJob(job);
}

async function updateJob(jobId, patch) {
  const job = db.jobs[String(jobId)];
  if (!job) return null;

  const map = {
    status: 'status',
    phase: 'phase',
    detail: 'detail',
    progress: 'progress',
    title: 'title',
    qualityScore: 'quality_score',
    pptxPath: 'pptx_path',
    htmlPath: 'html_path',
    error: 'error'
  };

  for (const [key, col] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      job[col] = patch[key];
    }
  }

  job.updated_at = Date.now();
  if (patch.status === 'done' || patch.status === 'failed') {
    job.finished_at = job.updated_at;
  }

  saveDB(db);
  return rowToJob(job);
}

async function getJob(jobId) {
  return rowToJob(db.jobs[String(jobId)]);
}

async function getUserJobs(chatId, limit = 20) {
  return Object.values(db.jobs)
    .filter(j => j.chat_id === String(chatId))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, Number(limit) || 20)
    .map(rowToJob);
}

// ─── History ─────────────────────────────────────────────────────────────
async function addHistory(chatId, entry) {
  const id = entry.id || makeJobId();
  const createdAt = entry.createdAt || Date.now();
  const full = { ...entry, id, createdAt };

  const key = String(chatId);
  if (!db.history[key]) db.history[key] = [];
  db.history[key].unshift(full);
  db.history[key] = db.history[key].slice(0, 50);

  saveDB(db);
  return full;
}

async function getHistory(chatId, limit = 20) {
  return (db.history[String(chatId)] || []).slice(0, Number(limit) || 20);
}

// ─── Feedback ────────────────────────────────────────────────────────────
async function addFeedback(jobId, chatId, rating, comment) {
  const id = makeJobId();
  const createdAt = Date.now();
  const clampedRating = Math.min(Math.max(parseInt(rating, 10) || 0, 1), 5);

  db.feedback[id] = {
    id,
    job_id: String(jobId),
    chat_id: String(chatId),
    rating: clampedRating,
    comment: String(comment || '').slice(0, 1000),
    created_at: createdAt
  };

  saveDB(db);
  return {
    id,
    jobId: String(jobId),
    chatId: String(chatId),
    rating: clampedRating,
    comment: comment || '',
    createdAt
  };
}

async function getFeedbackForJob(jobId) {
  const rows = Object.values(db.feedback)
    .filter(x => x.job_id === String(jobId))
    .sort((a, b) => b.created_at - a.created_at);
  return rows[0] || null;
}

/**
 * Ескі жұмыстар мен тарихты өшіру. Аяқталған жұмыс — finished_at бойынша; ұзақ уақыт
 * аяқталмай қалған (тұрып қалған) жұмыс — created_at бойынша. Қайтарады: өшірілген жұмыс саны.
 */
async function cleanupOldJobs(maxAgeMs = 2 * 24 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let changed = false;

  for (const [id, job] of Object.entries(db.jobs)) {
    const ts = job.finished_at != null ? Number(job.finished_at) : Number(job.created_at);
    if (ts < cutoff) {
      delete db.jobs[id];
      removed++;
    }
  }
  for (const [chatId, list] of Object.entries(db.history)) {
    const kept = (list || []).filter((h) => Number(h.createdAt) >= cutoff);
    if (kept.length !== (list || []).length) {
      changed = true;
      if (kept.length) db.history[chatId] = kept; else delete db.history[chatId];
    }
  }

  if (removed || changed) saveDB(db);
  return removed;
}

module.exports = {
  backend: 'json',
  closeDB: async () => {},
  initDB,
  getUser,
  registerUser,
  addCredits,
  applyReceipt,
  receiptExists,
  incrementRefCount,
  PARTNER_RATE,
  getPartner,
  requestPartner,
  setPartnerStatus,
  creditPartnerCommission,
  payoutPartner,
  listPartners,
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
  addFeedback,
  getFeedbackForJob,
  cleanupOldJobs
};
