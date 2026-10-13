'use strict';

/**
 * PostgreSQL дерекқоры (Railway). db.js-тің ашық API-ін толық сақтайды.
 *
 * Бұрыннан бар базамен үйлесімді:
 *  - кестелер тек жоқ болса жасалады (CREATE TABLE IF NOT EXISTS), жетіспейтін бағандар
 *    ADD COLUMN IF NOT EXISTS арқылы қосылады — ЕШТЕҢЕ ЖОЙЫЛМАЙДЫ;
 *  - уақыт бағандары BIGINT (мс) де, TIMESTAMP/TIMESTAMPTZ да болуы мүмкін — түрі іске қосылғанда анықталады;
 *  - id бағаны мәтін емес (мыс. SERIAL) болса, жұмыс id-і job_id бағанында сақталады.
 *
 * Кредит операциялары бір SQL сұранысымен атомарлы орындалады (бірнеше сұраныс бір мезгілде келсе де
 * баланс теріске кетпейді, бір чек екі рет қолданылмайды).
 */

const REFERRALS_PER_BONUS = 2;

function envInt(name, def, min, max) {
  const n = parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

const RATE_COOLDOWN_SEC = envInt('RATE_COOLDOWN_SEC', 45, 0, 3600);
const RATE_DAILY_LIMIT = envInt('RATE_DAILY_LIMIT', 25, 1, 10000);
const RATE_DAILY_EXPENSIVE_LIMIT = envInt('RATE_DAILY_EXPENSIVE_LIMIT', 12, 1, 10000);

let pool = null;

/** Тесттер үшін: pg.Pool-ға ұқсас объект (query(text, params) → { rows }) беруге болады. */
function _setPool(p) { pool = p; }

function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  // Railway: ішкі желі (postgres.railway.internal) — SSL керек емес; сыртқы прокси үшін DATABASE_SSL=1
  // немесе URL-да ?sslmode=require қойыңыз.
  const ssl = process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined;
  pool = new Pool({
    connectionString: url,
    ssl,
    max: envInt('PG_POOL_MAX', 10, 1, 50),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (err) => console.error('[DB] pool error:', err.message));
  return pool;
}

const q = (text, params) => getPool().query(text, params);

// ─── Схема ──────────────────────────────────────────────────────────────
const SCHEMA = {
  users: {
    create: `CREATE TABLE IF NOT EXISTS users (
      chat_id TEXT PRIMARY KEY,
      credits INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      free_used BOOLEAN DEFAULT FALSE,
      free_used_at BIGINT DEFAULT 0,
      source TEXT,
      blocked BOOLEAN DEFAULT FALSE,
      referred_by TEXT,
      ref_earnings INTEGER NOT NULL DEFAULT 0,
      last_attempt_at BIGINT DEFAULT 0,
      last_success_at BIGINT DEFAULT 0,
      daily_date TEXT,
      daily_gens INTEGER DEFAULT 0,
      daily_expensive INTEGER DEFAULT 0,
      created_at BIGINT,
      partner_status TEXT,
      partner_balance INTEGER NOT NULL DEFAULT 0,
      partner_earned INTEGER NOT NULL DEFAULT 0,
      partner_paid INTEGER NOT NULL DEFAULT 0
    )`,
    cols: {
      name: 'TEXT', username: 'TEXT',
      partner_status: 'TEXT', partner_balance: 'INTEGER DEFAULT 0', partner_earned: 'INTEGER DEFAULT 0', partner_paid: 'INTEGER DEFAULT 0',
      credits: 'INTEGER DEFAULT 0', total: 'INTEGER DEFAULT 0', free_used: 'BOOLEAN DEFAULT FALSE', free_used_at: 'BIGINT DEFAULT 0', source: 'TEXT', blocked: 'BOOLEAN DEFAULT FALSE',
      referred_by: 'TEXT', ref_earnings: 'INTEGER DEFAULT 0', last_attempt_at: 'BIGINT DEFAULT 0',
      last_success_at: 'BIGINT DEFAULT 0', daily_date: 'TEXT', daily_gens: 'INTEGER DEFAULT 0',
      daily_expensive: 'INTEGER DEFAULT 0', created_at: 'BIGINT',
    },
    unique: 'chat_id',
  },
  jobs: {
    create: `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      status TEXT,
      phase TEXT,
      detail TEXT,
      progress INTEGER DEFAULT 0,
      payload JSONB,
      title TEXT,
      quality_score REAL,
      pptx_path TEXT,
      html_path TEXT,
      error TEXT,
      created_at BIGINT,
      updated_at BIGINT,
      finished_at BIGINT
    )`,
    cols: {
      chat_id: 'TEXT', status: 'TEXT', phase: 'TEXT', detail: 'TEXT', progress: 'INTEGER DEFAULT 0',
      payload: 'JSONB', title: 'TEXT', quality_score: 'REAL', pptx_path: 'TEXT', html_path: 'TEXT',
      error: 'TEXT', created_at: 'BIGINT', updated_at: 'BIGINT', finished_at: 'BIGINT',
    },
    unique: 'id',
  },
  history: {
    create: `CREATE TABLE IF NOT EXISTS history (
      id TEXT,
      chat_id TEXT NOT NULL,
      title TEXT,
      topic TEXT,
      quality_score REAL,
      slide_count INTEGER,
      language TEXT,
      created_at BIGINT
    )`,
    cols: {
      chat_id: 'TEXT', title: 'TEXT', topic: 'TEXT', quality_score: 'REAL', slide_count: 'INTEGER',
      language: 'TEXT', created_at: 'BIGINT', job_id: 'TEXT',
    },
  },
  // Әр генерацияның тұрақты журналы (jobs 48 сағатта өшеді, бұл қалады) — админ панель үшін
  gen_log: {
    create: `CREATE TABLE IF NOT EXISTS gen_log (
      job_id TEXT PRIMARY KEY,
      chat_id TEXT,
      mode TEXT,
      topic TEXT,
      title TEXT,
      slides INTEGER,
      language TEXT,
      free BOOLEAN DEFAULT FALSE,
      status TEXT,
      error TEXT,
      cost_tg REAL,
      tokens INTEGER,
      duration_ms INTEGER,
      quality REAL,
      created_at BIGINT,
      finished_at BIGINT
    )`,
    cols: {
      chat_id: 'TEXT', mode: 'TEXT', topic: 'TEXT', title: 'TEXT', slides: 'INTEGER', language: 'TEXT', free: 'BOOLEAN DEFAULT FALSE',
      status: 'TEXT', error: 'TEXT', cost_tg: 'REAL', tokens: 'INTEGER', duration_ms: 'INTEGER', quality: 'REAL', created_at: 'BIGINT', finished_at: 'BIGINT',
    },
  },
  // Күнделікті воронка: бір адам · бір қадам · бір күн = бір жазба (start → app → gen → paid)
  events: {
    create: `CREATE TABLE IF NOT EXISTS events (
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT,
      created_at BIGINT,
      PRIMARY KEY (chat_id, kind, day)
    )`,
    cols: { source: 'TEXT', created_at: 'BIGINT' },
  },
  feedback: {
    create: `CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      chat_id TEXT,
      rating INTEGER,
      comment TEXT,
      created_at BIGINT
    )`,
    cols: { job_id: 'TEXT', chat_id: 'TEXT', rating: 'INTEGER', comment: 'TEXT', created_at: 'BIGINT' },
  },
  learn_templates: {
    create: `CREATE TABLE IF NOT EXISTS learn_templates (
      fingerprint TEXT PRIMARY KEY,
      created_at BIGINT,
      updated_at BIGINT,
      reader_version INTEGER DEFAULT 0,
      uses INTEGER DEFAULT 1,
      data JSONB
    )`,
    cols: { created_at: 'BIGINT', updated_at: 'BIGINT', reader_version: 'INTEGER DEFAULT 0', uses: 'INTEGER DEFAULT 1', data: 'JSONB' },
    unique: 'fingerprint',
  },
  rate_prompts: {
    create: `CREATE TABLE IF NOT EXISTS rate_prompts (
      job_id TEXT PRIMARY KEY,
      chat_id TEXT,
      kind TEXT,
      due_at BIGINT,
      sent BOOLEAN DEFAULT FALSE,
      created_at BIGINT
    )`,
    cols: { chat_id: 'TEXT', kind: 'TEXT', due_at: 'BIGINT', sent: 'BOOLEAN DEFAULT FALSE', created_at: 'BIGINT' },
    unique: 'job_id',
  },
  learn_uses: {
    create: `CREATE TABLE IF NOT EXISTS learn_uses (
      id TEXT PRIMARY KEY,
      created_at BIGINT,
      fingerprint TEXT,
      job_id TEXT,
      topic TEXT,
      language TEXT,
      outcome TEXT,
      data JSONB
    )`,
    cols: { created_at: 'BIGINT', fingerprint: 'TEXT', job_id: 'TEXT', topic: 'TEXT', language: 'TEXT', outcome: 'TEXT', data: 'JSONB' },
  },
  partner_log: {
    create: `CREATE TABLE IF NOT EXISTS partner_log (
      ref TEXT PRIMARY KEY,
      partner_id TEXT,
      buyer_id TEXT,
      amount INTEGER,
      commission INTEGER,
      created_at BIGINT
    )`,
    cols: { partner_id: 'TEXT', buyer_id: 'TEXT', amount: 'INTEGER', commission: 'INTEGER', created_at: 'BIGINT' },
    unique: 'ref',
  },
  receipts: {
    create: `CREATE TABLE IF NOT EXISTS receipts (
      receipt_no TEXT PRIMARY KEY,
      chat_id TEXT,
      amount INTEGER,
      credits INTEGER,
      status TEXT,
      created_at BIGINT
    )`,
    cols: { chat_id: 'TEXT', amount: 'INTEGER', credits: 'INTEGER', status: 'TEXT', created_at: 'BIGINT' },
    unique: 'receipt_no',
  },
};

/** Іске қосылғанда анықталған баған түрлері: types[table][col] = data_type */
let types = {};

const isTime = (t, c) => /timestamp|date/.test((types[t] && types[t][c]) || '') && !/^date$/.test(types[t][c]);
const isText = (t, c) => /text|character/.test((types[t] && types[t][c]) || '');

/** Жазу: уақыт бағанына мс → бағанның нақты түріне сай өрнек */
function tw(table, col, ph) {
  return isTime(table, col) ? `to_timestamp((${ph})::double precision / 1000)` : ph;
}
/** Оқу: уақыт бағаны → мс (BIGINT) */
function tr(table, col, alias) {
  const a = alias || col;
  return isTime(table, col) ? `(EXTRACT(EPOCH FROM ${col}) * 1000)::bigint AS ${a}` : `${col} AS ${a}`;
}
/** daily_date: TEXT немесе DATE — салыстыру әрқашан мәтін ретінде */
const dailyText = () => (types.users && types.users.daily_date === 'date' ? 'daily_date::text' : 'daily_date');
/** daily_date-ке жазу: баған DATE болса ::date, әйтпесе мәтін */
const dailySet = (ph) => (types.users && types.users.daily_date === 'date' ? `(${ph})::date` : ph);

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const numOrNull = (v) => (v == null ? null : num(v, null));

/** jsonb NUL таңбасын (\u0000) қабылдамайды — материал мәтінінде кездесуі мүмкін */
function jsonParam(obj) {
  return JSON.stringify(obj == null ? {} : obj).replace(/\\u0000/g, '');
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ─── Init ───────────────────────────────────────────────────────────────
async function initDB() {
  if (!process.env.DATABASE_URL && !pool) throw new Error('DATABASE_URL жоқ');
  for (const [table, def] of Object.entries(SCHEMA)) {
    await q(def.create);
    for (const [col, type] of Object.entries(def.cols)) {
      await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }
  }
  // Бұрыннан бар кестеде бірегейлік болмаса — қосамыз (ON CONFLICT үшін керек). Қайталанған жазба болса, тек ескертеміз.
  for (const [table, def] of Object.entries(SCHEMA)) {
    if (!def.unique) continue;
    try {
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_${def.unique}_uq ON ${table} (${def.unique})`);
    } catch (e) {
      console.warn(`[DB] ${table}.${def.unique} бірегей индекс жасалмады (қайталанған жазба бар ма?): ${e.message}`);
    }
  }
  await q('CREATE INDEX IF NOT EXISTS jobs_chat_created_idx ON jobs (chat_id, created_at DESC)');
  await q('CREATE INDEX IF NOT EXISTS history_chat_created_idx ON history (chat_id, created_at DESC)');
  await q('CREATE INDEX IF NOT EXISTS feedback_job_idx ON feedback (job_id)');

  const r = await q(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [Object.keys(SCHEMA)]
  );
  types = {};
  for (const row of r.rows) {
    (types[row.table_name] = types[row.table_name] || {})[row.column_name] = String(row.data_type).toLowerCase();
  }
  console.log('[DB] PostgreSQL ready');
}

// ─── Users ──────────────────────────────────────────────────────────────
async function ensureUser(chatId, referredBy = null, source = null) {
  const r = await q(
    `INSERT INTO users (chat_id, credits, total, referred_by, ref_earnings, created_at, source)
     VALUES ($1, 0, 0, $2, 0, ${tw('users', 'created_at', '$3')}, $4)
     ON CONFLICT (chat_id) DO NOTHING
     RETURNING chat_id`,
    [String(chatId), referredBy ? String(referredBy) : null, Date.now(), source ? String(source).slice(0, 40) : null]
  );
  return r.rowCount > 0;
}

async function getUser(chatId) {
  const r = await q('SELECT credits, total, referred_by, ref_earnings, free_used FROM users WHERE chat_id = $1', [String(chatId)]);
  const u = r.rows[0];
  if (!u) return { credits: 0, total: 0, referredBy: null, refEarnings: 0, freeUsed: false };
  return {
    credits: num(u.credits),
    total: num(u.total),
    referredBy: u.referred_by || null,
    refEarnings: num(u.ref_earnings),
    freeUsed: !!u.free_used,
  };
}

// ─── Бірінші презентация тегін (бір аккаунтқа бір рет) ─────────────────────
/** Атомарлы: тегін колоданы алу (бұрын алмаған, ешқашан сатып алмаған адам). true → берілді. */
async function claimFreeDeck(chatId) {
  await ensureUser(chatId);
  const r = await q(
    'UPDATE users SET free_used = TRUE, free_used_at = $2 WHERE chat_id = $1 AND COALESCE(free_used, FALSE) = FALSE AND COALESCE(total, 0) = 0 RETURNING chat_id',
    [String(chatId), Date.now()]
  );
  return r.rowCount > 0;
}
/** Генерация сәтсіз болса — тегін мүмкіндікті қайтару. */
async function releaseFreeDeck(chatId) {
  await q('UPDATE users SET free_used = FALSE, free_used_at = 0 WHERE chat_id = $1', [String(chatId)]);
}
/** ts-тен бері берілген тегін колодалар саны (тәуліктік шек үшін). */
async function countFreeDecksSince(ts) {
  const r = await q('SELECT COUNT(*)::int AS n FROM users WHERE free_used = TRUE AND COALESCE(free_used_at, 0) >= $1', [Number(ts) || 0]);
  return num(r.rows[0] && r.rows[0].n);
}
/** /stats: тегін алғандар және олардың ішінде кейін сатып алғандар. */
async function freeFunnel() {
  const r = await q('SELECT COUNT(*)::int AS free_users, COUNT(*) FILTER (WHERE COALESCE(total, 0) > 0)::int AS paid_after FROM users WHERE free_used = TRUE AND COALESCE(free_used_at, 0) > 0');
  const s = await q(`SELECT COALESCE(source, CASE WHEN referred_by IS NOT NULL THEN 'ref' ELSE 'direct' END) AS src,
      COUNT(*)::int AS users, COUNT(*) FILTER (WHERE free_used = TRUE AND COALESCE(free_used_at, 0) > 0)::int AS free,
      COUNT(*) FILTER (WHERE COALESCE(total, 0) > 0)::int AS paid
    FROM users GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
  return {
    freeUsers: num(r.rows[0].free_users), paidAfter: num(r.rows[0].paid_after),
    sources: s.rows.map((x) => ({ source: x.src, users: num(x.users), free: num(x.free), paid: num(x.paid) })),
  };
}

/** true → жаңа адам (бұрын болмаған) */
async function registerUser(chatId, referredBy = null, source = null) {
  return ensureUser(chatId, referredBy, source);
}

// ─── Воронка ────────────────────────────────────────────────────────────
/** Алматы күні (UTC+5) — "2026-10-13" */
const funnelDay = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);

/**
 * Қадамды белгілеу (бір адамға бір күнде бір рет). Арна: берілгені → сол күнгі /start арнасы → тіркелген арнасы.
 * kind: new | start | app | gen | free | paid
 */
async function logEvent(chatId, kind, source = null, t = Date.now()) {
  const day = funnelDay(t);
  await q(
    `INSERT INTO events (chat_id, kind, day, source, created_at)
     SELECT $1, $2, $3, COALESCE($4,
       (SELECT source FROM events WHERE chat_id = $1 AND kind = 'start' AND day = $3 LIMIT 1),
       (SELECT COALESCE(source, CASE WHEN referred_by IS NOT NULL THEN 'ref' END) FROM users WHERE chat_id = $1),
       'direct'), $5
     ON CONFLICT (chat_id, kind, day) DO NOTHING`,
    [String(chatId), String(kind), day, source ? String(source).slice(0, 40) : null, t]
  );
}

/** Бір күннің воронкасы: { day, total: {kind:n}, sources: [{source, new, start, app, gen, free, paid}] } */
async function funnelStats(day) {
  const r = await q('SELECT source, kind, COUNT(*)::int AS n FROM events WHERE day = $1 GROUP BY 1, 2', [day]);
  const { foldFunnel } = require('../core/funnel'); // lazy: тесттер бұл файлды бөлек көшіріп жүктейді
  return foldFunnel(day, r.rows.map((x) => ({ source: x.source || 'direct', kind: x.kind, n: num(x.n) })));
}


async function addCredits(chatId, amount) {
  const n = Number(amount) || 0;
  await ensureUser(chatId);
  await q(
    'UPDATE users SET credits = COALESCE(credits, 0) + $2, total = COALESCE(total, 0) + $2 WHERE chat_id = $1',
    [String(chatId), n]
  );
  console.log(`[DB] addCredits: ${chatId} +${n}`);
  return getUser(chatId);
}

async function applyReceipt(chatId, receiptNo, amount, credits) {
  const n = Number(credits) || 0;
  await ensureUser(chatId);
  // Бір сұраныс: чек жазылса ҒАНА кредит қосылады (қайталанған чек — ештеңе өзгермейді)
  const r = await q(
    `WITH ins AS (
       INSERT INTO receipts (receipt_no, chat_id, amount, credits, status, created_at)
       VALUES ($2, $1, $3, $4, 'confirmed', ${tw('receipts', 'created_at', '$5')})
       ON CONFLICT (receipt_no) DO NOTHING
       RETURNING receipt_no
     )
     UPDATE users SET credits = COALESCE(credits, 0) + $4, total = COALESCE(total, 0) + $4
     WHERE chat_id = $1 AND EXISTS (SELECT 1 FROM ins)
     RETURNING credits`,
    [String(chatId), String(receiptNo), Number(amount) || 0, n, Date.now()]
  );
  if (!r.rows.length) return { applied: false, duplicate: true };
  console.log(`[DB] applyReceipt: ${chatId} receipt=${receiptNo} +${n}`);
  return { applied: true, user: await getUser(chatId) };
}

async function receiptExists(receiptNo) {
  const r = await q('SELECT 1 FROM receipts WHERE receipt_no = $1', [String(receiptNo)]);
  return r.rows.length > 0;
}

async function incrementRefCount(referrerId) {
  const r = await q(
    `UPDATE users
     SET ref_earnings = COALESCE(ref_earnings, 0) + 1,
         credits = COALESCE(credits, 0) + CASE WHEN (COALESCE(ref_earnings, 0) + 1) % $2 = 0 THEN 1 ELSE 0 END
     WHERE chat_id = $1
     RETURNING ref_earnings`,
    [String(referrerId), REFERRALS_PER_BONUS]
  );
  if (!r.rows.length) {
    console.warn(`[DB] incrementRefCount: referrer ${referrerId} not found`);
    return { newCount: 0, bonusGiven: false };
  }
  const newCount = num(r.rows[0].ref_earnings);
  return { newCount, bonusGiven: newCount % REFERRALS_PER_BONUS === 0 };
}


// ─── Серіктестер (партнёрлер): әкелген клиенттің әр төлемінен пайыз ─────────────
const PARTNER_RATE = Math.min(0.9, Math.max(0, Number(process.env.PARTNER_RATE) || 0.3));
const noPartner = () => ({ status: 'none', balance: 0, earned: 0, paid: 0, buyers: 0, rate: PARTNER_RATE });

async function getPartner(chatId) {
  const r = await q(
    `SELECT partner_status, partner_balance, partner_earned, partner_paid,
            (SELECT COUNT(DISTINCT buyer_id) FROM partner_log WHERE partner_id = $1) AS buyers
     FROM users WHERE chat_id = $1`, [String(chatId)]);
  const u = r.rows[0];
  if (!u) return noPartner();
  return {
    status: u.partner_status || 'none', balance: num(u.partner_balance), earned: num(u.partner_earned),
    paid: num(u.partner_paid), buyers: num(u.buyers), rate: PARTNER_RATE,
  };
}

async function requestPartner(chatId) {
  await ensureUser(chatId);
  const r = await q(
    `UPDATE users SET partner_status = 'pending'
     WHERE chat_id = $1 AND COALESCE(partner_status, 'none') NOT IN ('active', 'pending')
     RETURNING partner_status`, [String(chatId)]);
  if (r.rows.length) return 'pending';
  return (await getPartner(chatId)).status;
}

async function setPartnerStatus(chatId, status) {
  if (!['active', 'rejected', 'none'].includes(status)) return false;
  const r = await q('UPDATE users SET partner_status = $2 WHERE chat_id = $1 RETURNING chat_id', [String(chatId), status]);
  return r.rows.length > 0;
}

async function creditPartnerCommission(buyerId, amount, ref) {
  const key = String(ref || '');
  const a = Math.floor(Number(amount) || 0);
  const commission = Math.floor(a * PARTNER_RATE);
  if (!key || a <= 0 || commission <= 0) return null;
  // Бір сұраныс: лог жазылса ҒАНА баланс өседі (қайталанған ref — ештеңе өзгермейді)
  const r = await q(
    `WITH p AS (
       SELECT b.referred_by AS pid FROM users b
       JOIN users pu ON pu.chat_id = b.referred_by AND pu.partner_status = 'active'
       WHERE b.chat_id = $1::text AND b.referred_by <> $1::text
     ), ins AS (
       INSERT INTO partner_log (ref, partner_id, buyer_id, amount, commission, created_at)
       SELECT $2::text, pid, $1::text, $3::int, $4::int, ${tw('partner_log', 'created_at', '$5::bigint')} FROM p
       ON CONFLICT (ref) DO NOTHING
       RETURNING partner_id
     )
     UPDATE users SET partner_balance = COALESCE(partner_balance, 0) + $4::int,
                       partner_earned = COALESCE(partner_earned, 0) + $4::int
     WHERE chat_id IN (SELECT partner_id FROM ins)
     RETURNING chat_id`,
    [String(buyerId), key, a, commission, Date.now()]
  );
  if (!r.rows.length) return null;
  console.log(`[DB] partner commission: ${r.rows[0].chat_id} +${commission}₸ (buyer ${buyerId}, ${key})`);
  return { partnerId: String(r.rows[0].chat_id), commission };
}

async function payoutPartner(chatId, amount) {
  const a = Math.floor(Number(amount) || 0);
  if (a <= 0) return null;
  const r = await q(
    `UPDATE users SET partner_balance = partner_balance - $2::int, partner_paid = COALESCE(partner_paid, 0) + $2::int
     WHERE chat_id = $1 AND COALESCE(partner_balance, 0) >= $2::int RETURNING partner_balance`,
    [String(chatId), a]);
  return r.rows.length ? num(r.rows[0].partner_balance) : null;
}

async function listPartners() {
  const r = await q("SELECT chat_id FROM users WHERE partner_status = 'active'");
  return Promise.all(r.rows.map(async (x) => ({ chatId: String(x.chat_id), ...(await getPartner(x.chat_id)) })));
}


// ─── Үйрену жүйесі: шаблонның оқылған дизайн-деректері (файлсыз, мәтінсіз) және әр қолдану ──────────
// cleanupOldJobs бұларды өшірмейді: клиентке байланбаған (chat_id жоқ), тек дизайн туралы дерек.
async function saveLearnedTemplate(read) {
  if (!read || !read.fingerprint) return null;
  const now = Date.now();
  const r = await q(
    `INSERT INTO learn_templates (fingerprint, created_at, updated_at, reader_version, uses, data)
     VALUES ($1, $2::bigint, $2::bigint, $3::int, 1, $4::jsonb)
     ON CONFLICT (fingerprint) DO UPDATE SET
       uses = COALESCE(learn_templates.uses, 1) + 1,
       updated_at = EXCLUDED.updated_at,
       data = CASE WHEN EXCLUDED.reader_version > COALESCE(learn_templates.reader_version, 0) THEN EXCLUDED.data ELSE learn_templates.data END,
       reader_version = GREATEST(EXCLUDED.reader_version, COALESCE(learn_templates.reader_version, 0))
     RETURNING (xmax = 0) AS inserted`,
    [String(read.fingerprint), now, Number(read.readerVersion) || 0, jsonParam(read)]
  );
  const row = r.rows[0] || {};
  return { fingerprint: read.fingerprint, isNew: row.inserted === true || row.inserted === 't' };
}

async function addLearnUse(use) {
  if (!use || !use.fingerprint) return null;
  const id = makeJobId();
  await q(
    `INSERT INTO learn_uses (id, created_at, fingerprint, job_id, topic, language, outcome, data)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8::jsonb)`,
    [id, Date.now(), String(use.fingerprint), use.jobId ? String(use.jobId) : null, String(use.topic || '').slice(0, 200),
      use.language || null, use.outcome || null, jsonParam(use)]
  );
  return id;
}

async function listLearnedTemplates(limit = 500) {
  const r = await q(
    `SELECT fingerprint, uses, created_at, updated_at, reader_version, data FROM learn_templates
     ORDER BY updated_at DESC LIMIT $1`, [Math.max(1, Math.min(5000, Number(limit) || 500))]);
  return r.rows.map((x) => ({
    fingerprint: x.fingerprint, uses: num(x.uses, 1), createdAt: num(x.created_at), updatedAt: num(x.updated_at),
    readerVersion: num(x.reader_version), data: typeof x.data === 'string' ? JSON.parse(x.data) : x.data,
  }));
}

/** Қолданулар + клиент бағасы (feedback, job_id бойынша соңғысы). */
async function listLearnUses(limit = 2000) {
  const r = await q(
    `SELECT u.id, u.created_at, u.data, f.rating, f.comment
     FROM learn_uses u
     LEFT JOIN LATERAL (
       SELECT rating, comment FROM feedback WHERE job_id = u.job_id ORDER BY created_at DESC LIMIT 1
     ) f ON TRUE
     ORDER BY u.created_at DESC LIMIT $1`, [Math.max(1, Math.min(20000, Number(limit) || 2000))]);
  return r.rows.map((x) => ({
    ...(typeof x.data === 'string' ? JSON.parse(x.data) : x.data), id: x.id, createdAt: num(x.created_at),
    rating: x.rating == null ? null : num(x.rating), comment: x.comment == null ? null : x.comment,
  }));
}

// ─── Кешіктірілген баға сұрауы (клиент нәтижені қарап үлгерсін) ─────────────
async function scheduleRatePrompt({ jobId, chatId, kind, dueAt }) {
  const r = await q(
    `INSERT INTO rate_prompts (job_id, chat_id, kind, due_at, sent, created_at)
     VALUES ($1, $2, $3, $4::bigint, FALSE, $5::bigint) ON CONFLICT (job_id) DO NOTHING RETURNING job_id`,
    [String(jobId), String(chatId), kind || 'presentation', Number(dueAt) || Date.now(), Date.now()]
  );
  return r.rows.length > 0;
}
/** Мерзімі жеткен сұрауларды атомарлы алады (бірнеше процесс болса да екі рет жіберілмейді). */
async function takeDueRatePrompts(now = Date.now(), limit = 20) {
  const r = await q(
    `UPDATE rate_prompts SET sent = TRUE
     WHERE job_id IN (
       SELECT job_id FROM rate_prompts WHERE sent = FALSE AND due_at <= $1::bigint
       ORDER BY due_at LIMIT $2::int FOR UPDATE SKIP LOCKED
     )
     RETURNING job_id, chat_id, kind, due_at`,
    [Number(now), Math.max(1, Number(limit) || 20)]
  );
  return r.rows.map((x) => ({ jobId: x.job_id, chatId: String(x.chat_id), kind: x.kind, dueAt: num(x.due_at) }));
}

async function useCredit(chatId) {
  // Атомарлы: бір мезгілде екі сұраныс келсе де баланс теріске кетпейді
  const r = await q(
    'UPDATE users SET credits = credits - 1 WHERE chat_id = $1 AND credits > 0 RETURNING credits',
    [String(chatId)]
  );
  if (!r.rows.length) return false;
  console.log(`[DB] useCredit: ${chatId}, remaining: ${num(r.rows[0].credits)}`);
  return true;
}

async function refundCredit(chatId) {
  await ensureUser(chatId);
  await q('UPDATE users SET credits = COALESCE(credits, 0) + 1 WHERE chat_id = $1', [String(chatId)]);
  console.log(`[DB] refundCredit: ${chatId}`);
}

async function getAllChatIds() {
  // ботты бұғаттаған / аккаунтын өшірген адамдар рассылкаға кірмейді
  const r = await q('SELECT chat_id FROM users WHERE COALESCE(blocked, FALSE) = FALSE');
  return r.rows.map((x) => String(x.chat_id));
}
/** Telegram 403 (бот бұғатталды / аккаунт өшірілді) → true; адам /start басса → false. */
async function setBlocked(chatId, blocked) {
  await q('UPDATE users SET blocked = $2 WHERE chat_id = $1', [String(chatId), !!blocked]);
}

// ─── Rate limits ────────────────────────────────────────────────────────
async function checkRateLimits(chatId, opts = {}) {
  const expensive = !!opts.expensive;
  const r = await q(
    `SELECT ${dailyText()} AS daily_date, daily_gens, daily_expensive, ${tr('users', 'last_attempt_at')}
     FROM users WHERE chat_id = $1`,
    [String(chatId)]
  );
  const u = r.rows[0];
  if (!u) return { allowed: true };

  const today = todayKey();
  const dailyGens = u.daily_date === today ? num(u.daily_gens) : 0;
  const dailyExpensive = u.daily_date === today ? num(u.daily_expensive) : 0;
  const now = Date.now();
  const lastAttemptAt = num(u.last_attempt_at);

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
}

async function markGenerationAttempt(chatId) {
  await ensureUser(chatId);
  const d = dailyText();
  await q(
    `UPDATE users SET
       last_attempt_at = ${tw('users', 'last_attempt_at', '$2')},
       daily_gens = CASE WHEN ${d} = $3::text THEN COALESCE(daily_gens, 0) ELSE 0 END,
       daily_expensive = CASE WHEN ${d} = $3::text THEN COALESCE(daily_expensive, 0) ELSE 0 END,
       daily_date = ${dailySet('$4')}
     WHERE chat_id = $1`,
    [String(chatId), Date.now(), todayKey(), todayKey()]
  );
}

async function markGenerationSuccess(chatId, opts = {}) {
  // server.js кейде boolean береді — екеуін де қабылдаймыз
  const expensive = typeof opts === 'boolean' ? opts : !!(opts && opts.expensive);
  await ensureUser(chatId);
  const d = dailyText();
  const r = await q(
    `UPDATE users SET
       last_success_at = ${tw('users', 'last_success_at', '$2')},
       daily_gens = (CASE WHEN ${d} = $3::text THEN COALESCE(daily_gens, 0) ELSE 0 END) + 1,
       daily_expensive = (CASE WHEN ${d} = $3::text THEN COALESCE(daily_expensive, 0) ELSE 0 END) + $4,
       daily_date = ${dailySet('$5')}
     WHERE chat_id = $1
     RETURNING daily_gens`,
    [String(chatId), Date.now(), todayKey(), expensive ? 1 : 0, todayKey()]
  );
  const daily = r.rows[0] ? num(r.rows[0].daily_gens) : 0;
  console.log(`[DB] markGenerationSuccess: ${chatId} daily=${daily}/${RATE_DAILY_LIMIT}`);
}

// ─── Jobs ───────────────────────────────────────────────────────────────
function makeJobId() {
  return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const JOB_SELECT = () => [
  'id', 'chat_id', 'status', 'phase', 'detail', 'progress', 'payload', 'title', 'quality_score',
  'pptx_path', 'html_path', 'error',
  tr('jobs', 'created_at'), tr('jobs', 'updated_at'), tr('jobs', 'finished_at'),
].join(', ');

function rowToJob(r) {
  if (!r) return null;
  let payload = r.payload || {};
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  return {
    id: r.id,
    chatId: String(r.chat_id),
    status: r.status,
    phase: r.phase,
    detail: r.detail,
    progress: num(r.progress),
    payload,
    title: r.title,
    qualityScore: numOrNull(r.quality_score),
    pptxPath: r.pptx_path,
    htmlPath: r.html_path,
    error: r.error,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    finishedAt: numOrNull(r.finished_at),
  };
}

async function createJob(chatId, payload) {
  const id = makeJobId();
  const now = Date.now();
  const r = await q(
    `INSERT INTO jobs (id, chat_id, status, phase, detail, progress, payload, created_at, updated_at)
     VALUES ($1, $2, 'queued', 'queued', '', 0, $3, ${tw('jobs', 'created_at', '$4')}, ${tw('jobs', 'updated_at', '$5')})
     RETURNING ${JOB_SELECT()}`,
    [id, String(chatId), jsonParam(payload), now, now]
  );
  return rowToJob(r.rows[0]);
}

const JOB_COLS = {
  status: 'status', phase: 'phase', detail: 'detail', progress: 'progress', title: 'title',
  qualityScore: 'quality_score', pptxPath: 'pptx_path', htmlPath: 'html_path', error: 'error',
};

async function updateJob(jobId, patch) {
  const sets = [];
  const params = [String(jobId)];
  for (const [key, col] of Object.entries(JOB_COLS)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      params.push(patch[key] === undefined ? null : patch[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  const now = Date.now();
  params.push(now);
  sets.push(`updated_at = ${tw('jobs', 'updated_at', '$' + params.length)}`);
  if (patch.status === 'done' || patch.status === 'failed') {
    params.push(now);
    sets.push(`finished_at = ${tw('jobs', 'finished_at', '$' + params.length)}`);
  }
  const r = await q(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $1 RETURNING ${JOB_SELECT()}`, params);
  return rowToJob(r.rows[0]);
}

async function getJob(jobId) {
  const r = await q(`SELECT ${JOB_SELECT()} FROM jobs WHERE id = $1`, [String(jobId)]);
  return rowToJob(r.rows[0]);
}

async function getUserJobs(chatId, limit = 20) {
  const r = await q(
    `SELECT ${JOB_SELECT()} FROM jobs WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [String(chatId), Number(limit) || 20]
  );
  return r.rows.map(rowToJob);
}

// ─── History ─────────────────────────────────────────────────────────────
/** history.id мәтін болса — жұмыс id-і сонда; әйтпесе (мыс. SERIAL) — job_id бағанында */
const historyIdIsText = () => isText('history', 'id');

async function addHistory(chatId, entry) {
  const id = entry.id || makeJobId();
  const createdAt = entry.createdAt || Date.now();
  const full = { ...entry, id, createdAt };
  const cols = ['chat_id', 'job_id', 'title', 'topic', 'quality_score', 'slide_count', 'language', 'created_at'];
  const vals = [String(chatId), id, entry.title || null, entry.topic || null,
    entry.qualityScore == null ? null : Number(entry.qualityScore),
    entry.slideCount == null ? null : (parseInt(entry.slideCount, 10) || null),
    entry.language || null, createdAt];
  if (historyIdIsText()) { cols.unshift('id'); vals.unshift(id); }
  const ph = vals.map((_, i) => (cols[i] === 'created_at' ? tw('history', 'created_at', `$${i + 1}`) : `$${i + 1}`));
  await q(`INSERT INTO history (${cols.join(', ')}) VALUES (${ph.join(', ')})`, vals);
  // JSON нұсқасындағыдай — әр пайдаланушыға соңғы 50 жазба
  await q(
    `DELETE FROM history WHERE chat_id = $1 AND ctid NOT IN (
       SELECT ctid FROM history WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 50)`,
    [String(chatId)]
  );
  return full;
}

async function getHistory(chatId, limit = 20) {
  const idExpr = historyIdIsText() ? 'COALESCE(job_id, id)' : 'COALESCE(job_id, id::text)';
  const r = await q(
    `SELECT ${idExpr} AS id, title, topic, quality_score, slide_count, language, ${tr('history', 'created_at')}
     FROM history WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [String(chatId), Number(limit) || 20]
  );
  return r.rows.map((h) => ({
    id: h.id,
    title: h.title,
    topic: h.topic,
    qualityScore: numOrNull(h.quality_score),
    slideCount: numOrNull(h.slide_count),
    language: h.language,
    createdAt: num(h.created_at),
  }));
}

// ─── Feedback ────────────────────────────────────────────────────────────
async function addFeedback(jobId, chatId, rating, comment) {
  const id = makeJobId();
  const createdAt = Date.now();
  const clampedRating = Math.min(Math.max(parseInt(rating, 10) || 0, 1), 5);
  const cols = ['job_id', 'chat_id', 'rating', 'comment', 'created_at'];
  const vals = [String(jobId), String(chatId), clampedRating, String(comment || '').slice(0, 1000), createdAt];
  if (isText('feedback', 'id')) { cols.unshift('id'); vals.unshift(id); }
  const ph = vals.map((_, i) => (cols[i] === 'created_at' ? tw('feedback', 'created_at', `$${i + 1}`) : `$${i + 1}`));
  await q(`INSERT INTO feedback (${cols.join(', ')}) VALUES (${ph.join(', ')})`, vals);
  return { id, jobId: String(jobId), chatId: String(chatId), rating: clampedRating, comment: comment || '', createdAt };
}

/** Баға/пікірді жаңарту немесе қосу (бір клиент — бір жұмысқа бір жазба). rating/comment — қайсысы берілсе, сол өзгереді. */
async function setFeedback(jobId, chatId, { rating, comment } = {}) {
  const r = rating == null ? null : Math.min(Math.max(parseInt(rating, 10) || 0, 1), 5);
  const sets = []; const vals = [String(jobId), String(chatId)];
  if (r != null) { vals.push(r); sets.push(`rating = $${vals.length}::int`); }
  if (comment != null) { vals.push(String(comment).slice(0, 1000)); sets.push(`comment = $${vals.length}`); }
  vals.push(Date.now()); sets.push(`created_at = ${tw('feedback', 'created_at', `$${vals.length}::bigint`)}`);
  const up = await q(
    `UPDATE feedback SET ${sets.join(', ')} WHERE job_id = $1 AND chat_id = $2 RETURNING job_id, rating, comment`, vals);
  if (up.rows.length) return { jobId: String(jobId), rating: num(up.rows[0].rating), comment: up.rows[0].comment };
  if (r == null) return null; // пікір бағадан кейін ғана
  const f = await addFeedback(jobId, chatId, r, comment || '');
  return { jobId: f.jobId, rating: f.rating, comment: f.comment };
}

async function getFeedbackForJob(jobId) {
  const r = await q(
    `SELECT id::text AS id, job_id, chat_id, rating, comment, ${tr('feedback', 'created_at')}
     FROM feedback WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [String(jobId)]
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: x.id, job_id: x.job_id, chat_id: x.chat_id, rating: num(x.rating),
    comment: x.comment, created_at: num(x.created_at),
  };
}

/**
 * Ескі жұмыстар мен тарихты өшіру. Аяқталған жұмыс — finished_at бойынша; тұрып қалған
 * (аяқталмаған) жұмыс — created_at бойынша. Қайтарады: өшірілген жұмыс саны.
 */
async function cleanupOldJobs(maxAgeMs = 2 * 24 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const r = await q(
    `DELETE FROM jobs
     WHERE (finished_at IS NOT NULL AND finished_at < ${tw('jobs', 'finished_at', '$1')})
        OR (finished_at IS NULL AND created_at < ${tw('jobs', 'created_at', '$2')})`,
    [cutoff, cutoff]
  );
  await q(`DELETE FROM history WHERE created_at < ${tw('history', 'created_at', '$1')}`, [cutoff]);
  await q('DELETE FROM rate_prompts WHERE created_at < $1::bigint', [cutoff]);
  return r.rowCount || 0;
}

// ─── Админ панель ───────────────────────────────────────────────────────
/** Telegram аты мен username (/start және Mini App ашылғанда жаңарады) */
async function setUserProfile(chatId, { name = null, username = null } = {}) {
  if (!name && !username) return;
  await q('UPDATE users SET name = COALESCE($2, name), username = COALESCE($3, username) WHERE chat_id = $1',
    [String(chatId), name ? String(name).slice(0, 80) : null, username ? String(username).slice(0, 40) : null]);
}

const GEN_COLS = ['chat_id', 'mode', 'topic', 'title', 'slides', 'language', 'free', 'status', 'error', 'cost_tg', 'tokens', 'duration_ms', 'quality', 'created_at', 'finished_at'];
/** Генерация журналын жазу/жаңарту (тек берілген өрістер өзгереді) */
async function logGen(jobId, fields = {}) {
  const cols = GEN_COLS.filter((c) => fields[c] !== undefined);
  const vals = cols.map((c) => (c === 'topic' || c === 'title' || c === 'error') && fields[c] != null ? String(fields[c]).slice(0, c === 'error' ? 300 : 500) : fields[c]);
  const ph = cols.map((_, i) => `$${i + 2}`);
  const upd = cols.length ? 'DO UPDATE SET ' + cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ') : 'DO NOTHING';
  await q(`INSERT INTO gen_log (job_id${cols.map((c) => ', ' + c).join('')}) VALUES ($1${ph.map((x) => ', ' + x).join('')})
     ON CONFLICT (job_id) ${upd}`, [String(jobId), ...vals]);
}

/** Қолмен расталған төлемді де receipts-ке жазамыз (кредит қоспайды — тек есеп) */
async function logPayment(chatId, amount, credits, ref) {
  await q(`INSERT INTO receipts (receipt_no, chat_id, amount, credits, status, created_at)
     VALUES ($1, $2, $3, $4, 'manual', ${tw('receipts', 'created_at', '$5')}) ON CONFLICT (receipt_no) DO NOTHING`,
  [String(ref), String(chatId), Number(amount) || 0, Number(credits) || 0, Date.now()]);
}

/**
 * Админ панельге шикі деректер (есептеу core/admin.js-те): барлық адам + since-тен бергі генерация, төлем, баға, воронка.
 * chatId берілсе — тек сол адамның бүкіл тарихы.
 */
async function adminData({ since = 0, chatId = null } = {}) {
  const who = chatId ? String(chatId) : null;
  const [users, gens, receipts, feedback, events] = await Promise.all([
    q(`SELECT chat_id, name, username, source, referred_by, credits, total, free_used, blocked, ${tr('users', 'created_at')}, last_success_at
       FROM users ${who ? 'WHERE chat_id = $1' : ''}`, who ? [who] : []),
    q(`SELECT * FROM gen_log WHERE ${who ? 'chat_id = $1' : 'COALESCE(created_at, 0) >= $1'} ORDER BY created_at DESC LIMIT 5000`, [who || since]),
    q(`SELECT receipt_no, chat_id, amount, credits, status, ${tr('receipts', 'created_at')} FROM receipts
       WHERE ${who ? 'chat_id = $1' : `created_at >= ${tw('receipts', 'created_at', '$1')}`} ORDER BY created_at DESC LIMIT 5000`, [who || since]),
    q(`SELECT job_id, chat_id, rating, comment, ${tr('feedback', 'created_at')} FROM feedback
       WHERE ${who ? 'chat_id = $1' : `created_at >= ${tw('feedback', 'created_at', '$1')}`} ORDER BY created_at DESC LIMIT 5000`, [who || since]),
    q(`SELECT chat_id, kind, day, source FROM events WHERE ${who ? 'chat_id = $1' : 'COALESCE(created_at, 0) >= $1'} LIMIT 20000`, [who || since]),
  ]);
  const n = (v) => (v == null ? null : Number(v));
  return {
    users: users.rows.map((u) => ({ ...u, credits: num(u.credits), total: num(u.total), created_at: n(u.created_at), last_success_at: n(u.last_success_at) })),
    gens: gens.rows.map((g) => ({ ...g, created_at: n(g.created_at), finished_at: n(g.finished_at), cost_tg: n(g.cost_tg), quality: n(g.quality) })),
    receipts: receipts.rows.map((r) => ({ ...r, amount: num(r.amount), credits: num(r.credits), created_at: n(r.created_at) })),
    feedback: feedback.rows.map((f) => ({ ...f, rating: n(f.rating), created_at: n(f.created_at) })),
    events: events.rows,
  };
}

async function closeDB() {
  if (pool && typeof pool.end === 'function') await pool.end().catch(() => {});
}

module.exports = {
  backend: 'postgres',
  initDB,
  closeDB,
  _setPool,
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
  saveLearnedTemplate,
  addLearnUse,
  listLearnedTemplates,
  listLearnUses,
  setFeedback,
  scheduleRatePrompt,
  takeDueRatePrompts,
  useCredit,
  refundCredit,
  claimFreeDeck,
  releaseFreeDeck,
  countFreeDecksSince,
  freeFunnel,
  setUserProfile,
  logGen,
  logPayment,
  adminData,
  logEvent,
  funnelStats,
  funnelDay,
  getAllChatIds,
  setBlocked,
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
  cleanupOldJobs,
};
