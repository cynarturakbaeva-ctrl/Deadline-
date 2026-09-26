'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const { generatePresentation } = require('./index');
const {
  initDB, getUser, registerUser, useCredit, refundCredit,
  checkRateLimits, markGenerationAttempt, markGenerationSuccess,
  createJob, updateJob, getJob, getUserJobs, addHistory, getHistory,
  cleanupOldJobs, REFERRALS_PER_BONUS,
} = require('./db');

// ─── Config ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.BOT_USERNAME || 'DeadLine_prezbot').replace(/^@/, '');
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_GENERATIONS || '3', 10) || 3);
const MAX_TOPIC_CHARS = Math.max(200, parseInt(process.env.MAX_TOPIC_CHARS || '8000', 10) || 8000);
const PRICE = 250;
const KASPI_PHONE = process.env.KASPI_PHONE || '+77713436592';
const KASPI_NAME = process.env.KASPI_NAME || 'Мурзабек Н';

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[Server] TELEGRAM_BOT_TOKEN required');
  process.exit(1);
}
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('[Server] DEEPSEEK_API_KEY required');
  process.exit(1);
}

// ─── Express ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

// Static Mini App
app.use('/webapp', express.static(path.join(__dirname, 'webapp'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res) {
    res.setHeader('X-Frame-Options', 'ALLOWALL'); // Telegram WebView
  },
}));

// Jobs output dir (PPTX/HTML served securely)
const JOBS_DIR = path.join(__dirname, 'jobs');
fs.mkdirSync(JOBS_DIR, { recursive: true });

// ─── Telegram WebApp initData validation ──────────────────────────────────
function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(TELEGRAM_BOT_TOKEN)
      .digest();
    const calculated = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    if (calculated !== hash) return null;

    // Auth date freshness (24h)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (Date.now() / 1000 - authDate > 86400) return null;

    const userRaw = params.get('user');
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    if (!user || !user.id) return null;
    return user;
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.query.initData || '';
  const user = validateInitData(initData);
  if (!user) {
    // Dev fallback: allow ?devUser=123 when WEBAPP_DEV=1
    if (process.env.WEBAPP_DEV === '1' && req.query.devUser) {
      req.tgUser = { id: parseInt(req.query.devUser, 10), first_name: 'Dev' };
      return next();
    }
    return res.status(401).json({ error: 'unauthorized', message: 'Telegram WebApp auth required' });
  }
  req.tgUser = user;
  next();
}

// ─── API ──────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '3.0.0', service: 'DeadLine' });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const chatId = String(req.tgUser.id);
    let user = await getUser(chatId);
    if (!user) {
      await registerUser(chatId, null);
      user = await getUser(chatId);
    }
    res.json({
      id: chatId,
      firstName: req.tgUser.first_name || '',
      lastName: req.tgUser.last_name || '',
      username: req.tgUser.username || '',
      credits: user.credits || 0,
      total: user.total || 0,
      refEarnings: user.refEarnings || 0,
      referralLink: `https://t.me/${BOT_USERNAME}?start=ref_${chatId}`,
      price: PRICE,
      kaspi: { phone: KASPI_PHONE, name: KASPI_NAME },
      referralsPerBonus: REFERRALS_PER_BONUS,
    });
  } catch (err) {
    console.error('[API] /me', err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/history', authMiddleware, async (req, res) => {
  try {
    const list = await getHistory(req.tgUser.id, 30);
    res.json({ items: list });
  } catch (err) {
    console.error('[API] /history', err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/jobs', authMiddleware, async (req, res) => {
  try {
    const list = await getUserJobs(req.tgUser.id, 20);
    res.json({
      items: list.map(j => ({
        id: j.id,
        status: j.status,
        phase: j.phase,
        detail: j.detail,
        progress: j.progress,
        title: j.title,
        qualityScore: j.qualityScore,
        error: j.error,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
        hasPptx: !!j.pptxPath,
        hasHtml: !!j.htmlPath,
      })),
    });
  } catch (err) {
    console.error('[API] /jobs', err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/job/:id', authMiddleware, async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job || job.chatId !== String(req.tgUser.id)) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({
      id: job.id,
      status: job.status,
      phase: job.phase,
      detail: job.detail,
      progress: job.progress,
      title: job.title,
      qualityScore: job.qualityScore,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      hasPptx: !!job.pptxPath,
      hasHtml: !!job.htmlPath,
      payload: {
        topic: job.payload?.topic,
        slideCount: job.payload?.slideCount,
        language: job.payload?.language,
        style: job.payload?.style,
      },
    });
  } catch (err) {
    console.error('[API] /job', err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const chatId = String(req.tgUser.id);
    const { topic, slideCount, language, style, audience } = req.body || {};

    const topicStr = String(topic || '').trim();
    if (!topicStr || topicStr.length < 3) {
      return res.status(400).json({ error: 'invalid_topic', message: 'Тақырып тым қысқа' });
    }
    if (topicStr.length > MAX_TOPIC_CHARS) {
      return res.status(400).json({ error: 'topic_too_long', message: `Максимум ${MAX_TOPIC_CHARS} таңба` });
    }

    const rate = await checkRateLimits(chatId);
    if (!rate.ok) {
      return res.status(429).json({
        error: 'rate_limited',
        message: rate.message || 'Тым жиі сұраныс',
        retryAfter: rate.retryAfter,
      });
    }

    // Ensure user exists
    let user = await getUser(chatId);
    if (!user) {
      await registerUser(chatId, null);
      user = await getUser(chatId);
    }
    if (!user || user.credits <= 0) {
      return res.status(402).json({
        error: 'no_credits',
        message: 'Кредит жеткіліксіз. Сатып алыңыз немесе реферал шақырыңыз.',
        credits: user?.credits || 0,
      });
    }

    // Build free-text input compatible with existing parseUserInput
    const parts = [topicStr];
    if (slideCount) parts.push(`${slideCount} слайд`);
    if (language) parts.push(language === 'en' ? 'ағылшынша' : language === 'ru' ? 'орысша' : 'қазақша');
    if (style) parts.push(style);
    if (audience) parts.push(`аудитория: ${audience}`);
    const userInput = parts.join('. ');

    const charged = await useCredit(chatId);
    if (!charged) {
      return res.status(402).json({ error: 'no_credits', message: 'Кредит жеткіліксіз' });
    }
    await markGenerationAttempt(chatId);

    const job = await createJob(chatId, {
      topic: topicStr,
      slideCount: slideCount || null,
      language: language || 'kk',
      style: style || null,
      audience: audience || null,
      userInput,
    });

    // Fire-and-forget generation
    runGeneration(job.id).catch(err => {
      console.error('[Job] unhandled', job.id, err);
    });

    res.status(202).json({
      jobId: job.id,
      status: 'queued',
      creditsLeft: (user.credits || 1) - 1,
    });
  } catch (err) {
    console.error('[API] /generate', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Secure file download
app.get('/api/job/:id/download/:type', authMiddleware, async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job || job.chatId !== String(req.tgUser.id)) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (job.status !== 'done') {
      return res.status(400).json({ error: 'not_ready' });
    }
    const type = req.params.type;
    let filePath, mime, name;
    if (type === 'pptx' && job.pptxPath) {
      filePath = job.pptxPath;
      mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      name = `${(job.title || 'presentation').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60)}.pptx`;
    } else if (type === 'html' && job.htmlPath) {
      filePath = job.htmlPath;
      mime = 'text/html; charset=utf-8';
      name = `${(job.title || 'presentation').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60)}.html`;
    } else {
      return res.status(404).json({ error: 'file_not_found' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file_missing' });
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[API] download', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Root → Mini App
app.get('/', (_req, res) => {
  res.redirect('/webapp/');
});

// ─── Generation runner ────────────────────────────────────────────────────
let activeGenerations = 0;
const waitQueue = [];

async function runGeneration(jobId) {
  // Simple concurrency gate
  if (activeGenerations >= MAX_CONCURRENT) {
    await new Promise(resolve => waitQueue.push(resolve));
  }
  activeGenerations++;
  try {
    await executeJob(jobId);
  } finally {
    activeGenerations = Math.max(0, activeGenerations - 1);
    const next = waitQueue.shift();
    if (next) next();
  }
}

async function executeJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return;
  const chatId = job.chatId;
  const userInput = job.payload.userInput || job.payload.topic;

  await updateJob(jobId, { status: 'running', phase: 'start', detail: 'Басталуда...', progress: 2 });

  try {
    const result = await generatePresentation(userInput, {
      onProgress: async (phase, detail) => {
        const progressMap = {
          content: 15,
          qc: 25,
          quality: 35,
          narrative: 42,
          composition: 48,
          sources: 52,
          images: 60,
          visual: 68,
          html: 75,
          render: 85,
          critic: 90,
          redesign: 93,
          pptx: 97,
        };
        const progress = progressMap[phase] || Math.min(95, (await getJob(jobId))?.progress || 10);
        await updateJob(jobId, {
          phase: String(phase || ''),
          detail: String(detail || phase || ''),
          progress,
        });
      },
    });

    // Move outputs into jobs dir for stable serving
    const destDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(destDir, { recursive: true });
    let pptxPath = null;
    let htmlPath = null;

    if (result.pptxPath && fs.existsSync(result.pptxPath)) {
      pptxPath = path.join(destDir, 'presentation.pptx');
      fs.copyFileSync(result.pptxPath, pptxPath);
    }
    if (result.htmlPath && fs.existsSync(result.htmlPath)) {
      htmlPath = path.join(destDir, 'presentation.html');
      fs.copyFileSync(result.htmlPath, htmlPath);
    }

    await updateJob(jobId, {
      status: 'done',
      phase: 'done',
      detail: 'Дайын!',
      progress: 100,
      title: result.title || job.payload.topic,
      qualityScore: result.qualityScore ?? null,
      pptxPath,
      htmlPath,
    });

    await markGenerationSuccess(chatId, !!result.expensiveVisuals);
    await addHistory(chatId, {
      id: jobId,
      title: result.title || job.payload.topic,
      topic: job.payload.topic,
      qualityScore: result.qualityScore ?? null,
      slideCount: job.payload.slideCount,
      language: job.payload.language,
      createdAt: Date.now(),
    });

    // Optional: notify via bot if available
    try {
      if (global.__deadlineBot) {
        const scoreNote = result.qualityScore != null
          ? `\n⭐ Сапа: ${Math.round(result.qualityScore)}/100`
          : '';
        await global.__deadlineBot.sendMessage(
          chatId,
          `✅ *Презентация дайын!*\n\n📌 ${escapeMd(result.title || job.payload.topic)}${scoreNote}\n\n📱 Mini App ішінен жүктеп алыңыз.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '📱 Mini App ашу', web_app: { url: `${WEBAPP_URL}/webapp/` } },
              ]],
            },
          }
        );
      }
    } catch (e) {
      console.warn('[Job] notify failed', e.message);
    }

    console.log(`[Job] ${jobId} done — ${result.title}`);
  } catch (err) {
    console.error(`[Job] ${jobId} failed:`, err.message);
    await refundCredit(chatId);
    await updateJob(jobId, {
      status: 'failed',
      phase: 'failed',
      detail: err.isQualityGate ? 'Сапа шегінен өтпеді' : 'Қате орын алды',
      progress: 0,
      error: err.isQualityGate ? 'quality_gate' : (err.message || 'unknown'),
    });
    try {
      if (global.__deadlineBot) {
        await global.__deadlineBot.sendMessage(
          chatId,
          err.isQualityGate
            ? '❌ Сапа шегінен өтпеді, кредитіңіз қайтарылды.\nТақырыпты сәл өзгертіп қайта көріңіз.'
            : '❌ Қате орын алды, кредитіңіз қайтарылды.\nҚайта көріңіз немесе қолдауға жазыңыз.'
        );
      }
    } catch {}
  }
}

function escapeMd(text) {
  if (typeof text !== 'string') return String(text);
  return text.replace(/([_*`\[\]])/g, '\\$1');
}

// ─── Start ────────────────────────────────────────────────────────────────
async function main() {
  await initDB();
  await cleanupOldJobs().catch(() => {});

  // Start bot in same process (shared DB + notify)
  try {
    const botModule = require('./bot');
    if (botModule && botModule.startBot) {
      await botModule.startBot({ webappUrl: WEBAPP_URL });
    }
  } catch (err) {
    console.warn('[Server] Bot start skipped/failed:', err.message);
  }

  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`[Server] DeadLine v3 listening on :${PORT}`);
    console.log(`[Server] Mini App: ${WEBAPP_URL}/webapp/`);
  });
}

main().catch(err => {
  console.error('[Server] fatal', err);
  process.exit(1);
});

module.exports = { app };
