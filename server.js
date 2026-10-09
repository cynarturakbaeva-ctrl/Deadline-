'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const { generatePresentation } = require('./products/presentation/index');
const { generateReferat } = require('./products/referat/index');
const { analyzeMaterialFile, materialsToText } = require('./core/materials');
const {
  initDB, getUser, registerUser, useCredit, refundCredit,
  checkRateLimits, markGenerationAttempt, markGenerationSuccess,
  createJob, updateJob, getJob, getUserJobs, addHistory, getHistory,
  cleanupOldJobs, REFERRALS_PER_BONUS, closeDB, backend: DB_BACKEND,
} = require('./db');

// ─── Config ───────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.BOT_USERNAME || 'DeadLine_prezbot').replace(/^@/, '');
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.MAX_CONCURRENT_GENERATIONS || '3', 10) || 3);
const MAX_TOPIC_CHARS = Math.max(200, parseInt(process.env.MAX_TOPIC_CHARS || '8000', 10) || 8000);
const { PRICE, PLUS } = require('./core/pricing');
const { formatReport } = require('./requirements');
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
// Railway-де файлдар жүйесі уақытша: сақтау керек болса Volume қосып, JOBS_DIR=/data/jobs сияқты беріңіз
const JOBS_DIR = process.env.JOBS_DIR || path.join(__dirname, 'jobs');
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
      plus: { amount: PLUS.amount, credits: PLUS.credits },
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
    // Тарихта реферат па, презентация ма — job payload-тан аламыз
    let modes = {};
    try {
      const jobs = await getUserJobs(req.tgUser.id, 50);
      for (const j of jobs) modes[j.id] = j.payload?.mode || 'presentation';
    } catch {}
    res.json({ items: list.map(h => ({ ...h, mode: modes[h.id] || 'presentation' })) });
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
        mode: j.payload?.mode || 'presentation',
        hasPptx: j.payload?.mode !== 'referat' && !!j.pptxPath,
        hasDocx: j.payload?.mode === 'referat' && !!j.pptxPath,
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
    let requirementsReport = null;
    try {
      const rp = path.join(JOBS_DIR, job.id, 'requirements.json');
      if (fs.existsSync(rp)) requirementsReport = JSON.parse(fs.readFileSync(rp, 'utf8'));
    } catch {}
    let templateReport = null;
    try {
      const tp = path.join(JOBS_DIR, job.id, 'template.json');
      if (fs.existsSync(tp)) templateReport = JSON.parse(fs.readFileSync(tp, 'utf8'));
    } catch {}
    res.json({
      requirementsReport,
      templateReport,
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
      mode: job.payload?.mode || 'presentation',
      hasPptx: job.payload?.mode !== 'referat' && !!job.pptxPath,
      hasDocx: job.payload?.mode === 'referat' && !!job.pptxPath,
      hasHtml: !!job.htmlPath,
      payload: {
        topic: job.payload?.topic,
        slideCount: job.payload?.slideCount,
        pages: job.payload?.pages,
        language: job.payload?.language,
        style: job.payload?.style,
      },
    });
  } catch (err) {
    console.error('[API] /job', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Референс PPTX жүктеу (тек .pptx): сырой бинарлы дене, DNA талданады, файл уақытша сақталады
const REF_DIR = path.join(JOBS_DIR, '_ref');
fs.mkdirSync(REF_DIR, { recursive: true });
app.post('/api/reference', authMiddleware, express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 1000 || buf.readUInt32LE(0) !== 0x04034b50) {
      return res.status(400).json({ error: 'not_pptx', message: 'Тек .pptx файлы қабылданады' });
    }
    let an;
    try { an = require('./design-dna').analyzeReference(buf); }
    catch { return res.status(400).json({ error: 'not_pptx', message: 'Бұл .pptx емес немесе оқылмады' }); }
    const maxN = require('./design-dna').MAX_REFERENCE_SLIDES;
    if (an.outline.slideCount > maxN) {
      return res.status(400).json({ error: 'too_large', message: `Референс ${maxN} слайдтан аспауы керек (қазір ${an.outline.slideCount})` });
    }
    const refId = `${String(req.tgUser.id)}-${Date.now().toString(36)}`;
    fs.writeFileSync(path.join(REF_DIR, refId + '.pptx'), buf);
    res.json({ refId, lines: an.summaryLines, slides: an.outline.slideCount, warnings: an.warnings });
  } catch (e) { console.error('[API] /reference', e); res.status(500).json({ error: 'server_error' }); }
});

// Материал жүктеу (Mode 2/3): PDF, DOC/DOCX, PPT/PPTX, TXT, сурет/screenshot.
// Файл сақталады және мазмұны толық талданады — жауапта preview мен түрі қайтарылады.
const MATERIAL_DIR = path.join(JOBS_DIR, '_mat');
fs.mkdirSync(MATERIAL_DIR, { recursive: true });
const MATERIAL_EXT = /\.(pdf|docx?|pptx?|txt|md|rtf|csv|json|log|png|jpe?g|webp|gif|bmp)$/i;
app.post('/api/material', authMiddleware, express.raw({ type: '*/*', limit: '30mb' }), async (req, res) => {
  try {
    const buf = req.body;
    const name = String(req.query.name || req.headers['x-file-name'] || 'file');
    if (!Buffer.isBuffer(buf) || buf.length < 4) {
      return res.status(400).json({ error: 'bad_file', message: 'Бос немесе зақымдалған файл' });
    }
    if (!MATERIAL_EXT.test(name)) {
      return res.status(400).json({ error: 'bad_type', message: 'Қолдау көрсетілмейтін формат. PDF, DOC(X), PPT(X), TXT немесе сурет жүктеңіз' });
    }
    const analysis = await analyzeMaterialFile({ buffer: buf, name });
    if (!analysis.text && analysis.kind !== 'image') {
      return res.status(422).json({ error: 'unreadable', message: analysis.note || 'Файлдан мәтін алынбады', preview: '' });
    }
    const materialId = `${String(req.tgUser.id)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const ext = (name.split('.').pop() || 'bin').slice(0, 8);
    fs.writeFileSync(path.join(MATERIAL_DIR, materialId + '.' + ext), buf);
    res.json({
      materialId,
      name: String(name).slice(0, 120),
      kind: analysis.kind,
      preview: analysis.preview,
      meta: analysis.meta || {},
      note: analysis.note || '',
    });
  } catch (e) { console.error('[API] /material', e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const chatId = String(req.tgUser.id);
    const { topic, slideCount, language, style, audience, performedBy, checkedBy, mode, pages, university, faculty, department, group, city, refId, requirements, materialIds, sampleId } = req.body || {};
    const PRESENTATION_MODES = new Set(['presentation', 'template']);
    const genMode = PRESENTATION_MODES.has(String(mode)) ? String(mode) : (mode === 'referat' ? 'referat' : 'presentation');
    const isReferat = genMode === 'referat';

    const topicStr = String(topic || '').trim();
    if (!topicStr || topicStr.length < 3) {
      return res.status(400).json({ error: 'invalid_topic', message: 'Тақырып тым қысқа' });
    }
    if (topicStr.length > MAX_TOPIC_CHARS) {
      return res.status(400).json({ error: 'topic_too_long', message: `Максимум ${MAX_TOPIC_CHARS} таңба` });
    }

    const rate = await checkRateLimits(chatId);
    if (!rate.allowed) {
      return res.status(429).json({
        error: 'rate_limited',
        message: rate.message || 'Тым жиі сұраныс',
        retryAfter: rate.retryAfterSec,
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
    let userInput = parts.join('. ');
    // Титул: Орындаған / Тексерген — жеке жолдарға (parseCoverMeta жол соңына дейін оқиды)
    const clean = (v) => String(v || '').replace(/\s*[,;\n\r]+\s*/g, ' / ').replace(/[:：]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (clean(university)) userInput += '\nУниверситет: ' + clean(university);
    if (clean(faculty)) userInput += '\nФакультет: ' + clean(faculty);
    if (clean(department)) userInput += '\nКафедра: ' + clean(department);
    if (clean(group)) userInput += '\nТоп: ' + clean(group);
    if (clean(performedBy)) userInput += '\nОрындаған: ' + clean(performedBy);
    if (clean(checkedBy)) userInput += '\nТексерген: ' + clean(checkedBy);
    const referatMeta = {
      university: clean(university), faculty: clean(faculty), department: clean(department),
      group: clean(group), city: clean(city), performedBy: clean(performedBy), checkedBy: clean(checkedBy),
    };

    const charged = await useCredit(chatId);
    if (!charged) {
      return res.status(402).json({ error: 'no_credits', message: 'Кредит жеткіліксіз' });
    }
    await markGenerationAttempt(chatId);

    // Берілген материал файлдарын толық талдау (Mode 2/3). Бірнеше файл — бір контекст.
    let materialText = '';
    let materialMeta = [];
    if (!isReferat && Array.isArray(materialIds) && materialIds.length) {
      for (const mid of materialIds.slice(0, 8)) {
        if (!/^[\w-]+$/.test(String(mid || ''))) continue;
        try {
          const files = fs.readdirSync(MATERIAL_DIR).filter((f) => f.startsWith(String(mid) + '.'));
          const filePath = files.length ? path.join(MATERIAL_DIR, files[0]) : null;
          if (filePath && fs.existsSync(filePath)) {
            const buf = fs.readFileSync(filePath);
            const an = await analyzeMaterialFile({ buffer: buf, name: files[0] });
            materialMeta.push({ id: mid, name: files[0], kind: an.kind, preview: an.preview, note: an.note });
            if (an.text) materialText += `\n\n===== ${files[0]} (${an.kind}) =====\n${an.text}`;
          }
        } catch (e) {
          console.warn('[API] material load failed:', e.message);
        }
      }
      if (materialText) console.log(`[API] materials: ${materialMeta.length} file(s), ${materialText.length} chars`);
    }

    // Реферат: мұғалім қабылдаған үлгі реферат (опционал) — мәтіні толық оқылып, генераторда терең талданады
    let sampleText = '';
    let sampleName = '';
    if (isReferat && /^[\w-]+$/.test(String(sampleId || ''))) {
      try {
        const files = fs.readdirSync(MATERIAL_DIR).filter((f) => f.startsWith(String(sampleId) + '.'));
        if (files.length) {
          const an = await analyzeMaterialFile({ buffer: fs.readFileSync(path.join(MATERIAL_DIR, files[0])), name: files[0] });
          sampleText = String(an.text || '').slice(0, 60000);
          sampleName = files[0];
        }
      } catch (e) {
        console.warn('[API] sample load failed:', e.message);
      }
    }

    // Қосымша талап мәтіні (опционал, тек AI Presentation режимінде)
    const typedRequirements = !isReferat && genMode === 'presentation' ? String(requirements || '').trim() : '';
    const requirementsSource = typedRequirements.slice(0, 2000);

    console.log(`[API] generate: mode=${genMode} language=${language || '(жоқ → kk)'} slides=${slideCount || '-'} pages=${pages || '-'} materials=${materialMeta.length}${sampleName ? ' sample=' + sampleName : ''} chat=${chatId}`);
    const job = await createJob(chatId, {
      topic: topicStr,
      slideCount: slideCount || null,
      language: language || 'kk',
      style: style || null,
      audience: audience || null,
      userInput,
      mode: genMode,
      requirements: requirementsSource || null,
      materialText: materialText.slice(0, 60000) || null,
      materialMeta,
      refId: !isReferat && /^[\w-]+$/.test(String(refId || '')) ? String(refId) : null,
      pages: isReferat ? Math.max(5, Math.min(30, parseInt(pages, 10) || 10)) : null,
      meta: isReferat ? referatMeta : null,
      sampleText: sampleText || null,
      sampleName: sampleName || null,
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

// Resend file to the user's Telegram chat (blob-download doesn't work in Telegram WebView)
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
    if (type === 'pptx' && job.pptxPath && job.payload?.mode !== 'referat') {
      filePath = job.pptxPath;
      mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      name = `${(job.title || 'presentation').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60)}.pptx`;
    } else if (type === 'docx' && job.payload?.mode === 'referat' && job.pptxPath) {
      filePath = job.pptxPath;
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      name = `${(job.title || 'referat').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60) || 'referat'}.docx`;
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
    if (!global.__deadlineBot) {
      return res.status(503).json({ error: 'bot_unavailable' });
    }
    await global.__deadlineBot.sendDocument(job.chatId, filePath, {}, {
      filename: name,
      contentType: mime,
    });
    res.json({ sent: true });
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

// ─── Реферат (.docx) ──────────────────────────────────────────────────────
async function executeReferatJob(job) {
  const jobId = job.id;
  const chatId = job.chatId;
  console.log(`[Job] ${jobId} referat language=${job.payload?.language} pages=${job.payload?.pages}`);
  try {
    const progressMap = { outline: 8, write: 35, fit: 80, docx: 92 };
    const result = await generateReferat({
      topic: job.payload.topic,
      pages: job.payload.pages,
      language: job.payload.language,
      meta: job.payload.meta || {},
      brief: job.payload.audience || '',
      sample: job.payload.sampleText || '',
      onProgress: async (phase, detail) => {
        await updateJob(jobId, {
          phase: String(phase || ''),
          detail: String(detail || phase || ''),
          progress: progressMap[phase] || 20,
        });
      },
    });
    const destDir = path.join(JOBS_DIR, jobId);
    fs.mkdirSync(destDir, { recursive: true });
    const docxPath = path.join(destDir, 'referat.docx');
    fs.copyFileSync(result.docxPath, docxPath);
    try { fs.unlinkSync(result.docxPath); } catch {}

    await updateJob(jobId, {
      status: 'done', phase: 'done', detail: 'Дайын!', progress: 100,
      title: result.title || job.payload.topic, qualityScore: null,
      pptxPath: docxPath, htmlPath: null,
    });
    await markGenerationSuccess(chatId, false);
    await addHistory(chatId, {
      id: jobId, title: result.title || job.payload.topic, topic: job.payload.topic,
      qualityScore: null, slideCount: job.payload.pages, language: job.payload.language, createdAt: Date.now(),
    });
    try {
      if (global.__deadlineBot) {
        await global.__deadlineBot.sendMessage(
          chatId,
          `✅ *Реферат дайын!*\n\n📌 ${escapeMd(result.title || job.payload.topic)}\n📄 ${result.pages} бет\n\n⚠️ Әдебиеттер тізімін өзіңіз тексеріп алыңыз.`,
          { parse_mode: 'Markdown' }
        );
        const name = `${(result.title || 'referat').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60) || 'referat'}.docx`;
        await global.__deadlineBot.sendDocument(chatId, docxPath, {}, {
          filename: name,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }
    } catch (e) {
      console.warn('[Job] referat send failed', e.message);
    }
    console.log(`[Job] ${jobId} referat done — ${result.title} (${result.pages} pages, fillOk=${result.fillOk})`);
  } catch (err) {
    console.error(`[Job] ${jobId} referat failed:`, err.message);
    await refundCredit(chatId);
    await updateJob(jobId, {
      status: 'failed', phase: 'failed', detail: 'Қате орын алды', progress: 0, error: err.message || 'unknown',
    });
    try {
      if (global.__deadlineBot) {
        await global.__deadlineBot.sendMessage(chatId, '❌ Реферат жасалмады, кредитіңіз қайтарылды.\nҚайта көріңіз.');
      }
    } catch {}
  }
}

async function executeJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return;
  const chatId = job.chatId;
  const userInput = job.payload.userInput || job.payload.topic;

  await updateJob(jobId, { status: 'running', phase: 'start', detail: 'Басталуда...', progress: 2 });
  if (job.payload?.mode === 'referat') return executeReferatJob(job);

  try {
    console.log(`[Job] ${jobId} language=${job.payload?.language}`);
    let referencePptx = null;
    if (job.payload?.refId) {
      try { referencePptx = fs.readFileSync(path.join(REF_DIR, job.payload.refId + '.pptx')); } catch {}
    }
    const result = await generatePresentation(userInput, {
      language: job.payload?.language,
      mode: job.payload?.mode || 'presentation',
      materialText: job.payload?.materialText || null,
      referencePptx,
      requirements: job.payload?.requirements || null,
      onProgress: async (phase, detail) => {
        const progressMap = {
          content: 15,
          qc: 25,
          quality: 35,
          narrative: 42,
          composition: 48,
          sources: 52,
          qa: 58,
          template: 80,
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
      try { fs.unlinkSync(result.pptxPath); } catch {}
    }
    if (result.htmlPath && fs.existsSync(result.htmlPath)) {
      htmlPath = path.join(destDir, 'presentation.html');
      fs.copyFileSync(result.htmlPath, htmlPath);
      try { fs.unlinkSync(result.htmlPath); } catch {}
    }

    if (result.requirementsReport) {
      try { fs.writeFileSync(path.join(destDir, 'requirements.json'), JSON.stringify(result.requirementsReport)); } catch (e) { console.warn('[Job] requirements.json', e.message); }
    }
    if (result.templateReport) {
      try { fs.writeFileSync(path.join(destDir, 'template.json'), JSON.stringify(result.templateReport)); } catch (e) { console.warn('[Job] template.json', e.message); }
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

    // Notify via bot and send files directly to chat
    try {
      if (global.__deadlineBot) {
        const scoreNote = result.qualityScore != null
          ? `\n⭐ Сапа: ${Math.round(result.qualityScore)}/100`
          : '';
        await global.__deadlineBot.sendMessage(
          chatId,
          `✅ *Презентация дайын!*\n\n📌 ${escapeMd(result.title || job.payload.topic)}${scoreNote}\n\nФайлдар төменде жіберілді 👇`,
          { parse_mode: 'Markdown' }
        );
        if (result.requirementsReport) {
          const rt = formatReport(result.requirementsReport, job.payload?.language);
          if (rt) await global.__deadlineBot.sendMessage(chatId, rt).catch(() => {});
        }
        if (result.templateReport && result.templateReport.checks && result.templateReport.checks.length) {
          const tr = result.templateReport;
          const lines = [`🎨 ${tr.summary}`];
          for (const c of tr.checks) lines.push(`${c.status === 'pass' ? '✅' : '❌'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
          await global.__deadlineBot.sendMessage(chatId, lines.join('\n')).catch(() => {});
        }
        if (pptxPath && fs.existsSync(pptxPath)) {
          const pptxName = `${(result.title || job.payload.topic || 'presentation').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60)}.pptx`;
          await global.__deadlineBot.sendDocument(chatId, pptxPath, {}, {
            filename: pptxName,
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
        }
        if (htmlPath && fs.existsSync(htmlPath)) {
          const htmlName = `${(result.title || job.payload.topic || 'presentation').replace(/[^\w\u0400-\u04FF\- ]+/g, '').slice(0, 60)}.html`;
          await global.__deadlineBot.sendDocument(chatId, htmlPath, {}, {
            filename: htmlName,
            contentType: 'text/html',
          });
        }
      }
    } catch (e) {
      console.warn('[Job] file send failed', e.message);
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

// ─── Ескі нәтижелерді тазалау ─────────────────────────────────────────────
// Клиенттердің презентация/рефераттары, жүктелген шаблон мен материалдар JOB_RETENTION_HOURS
// (әдепкі 48 сағат) өткен соң базадан да, дисктен де өшіріледі.
const RETENTION_MS = Math.max(1, parseInt(process.env.JOB_RETENTION_HOURS || '48', 10) || 48) * 3600 * 1000;

function removeOldFiles(dir, cutoff, keep = new Set()) {
  let n = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return 0; }
  for (const name of entries) {
    if (keep.has(name)) continue;
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { recursive: true, force: true }); n++; }
    } catch {}
  }
  return n;
}

let cleanupRunning = false;
async function runCleanup() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const cutoff = Date.now() - RETENTION_MS;
    const jobs = await cleanupOldJobs(RETENTION_MS).catch((e) => { console.warn('[Cleanup] db:', e.message); return 0; });
    const files = removeOldFiles(JOBS_DIR, cutoff, new Set(['_ref', '_mat']))
      + removeOldFiles(REF_DIR, cutoff)
      + removeOldFiles(MATERIAL_DIR, cutoff);
    if (jobs || files) console.log(`[Cleanup] өшірілді: ${jobs} жұмыс (базадан), ${files} файл/папка (${RETENTION_MS / 3600000} сағаттан ескі)`);
  } finally {
    cleanupRunning = false;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────
async function main() {
  await initDB();
  await runCleanup();
  setInterval(runCleanup, 60 * 60 * 1000).unref(); // сағат сайын

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
  // Railway қайта іске қосқанда SIGTERM жібереді — базаға қосылымдарды дұрыс жабамыз
  const shutdown = (sig) => {
    console.log(`[Server] ${sig} — тоқтатылуда...`);
    server.close();
    Promise.resolve(closeDB && closeDB()).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  server.listen(PORT, () => {
    console.log(`[Server] DeadLine v3 listening on :${PORT} (db=${DB_BACKEND || 'json'})`);
    console.log(`[Server] Mini App: ${WEBAPP_URL}/webapp/`);
  });
}

main().catch(err => {
  console.error('[Server] fatal', err);
  process.exit(1);
});

module.exports = { app };
