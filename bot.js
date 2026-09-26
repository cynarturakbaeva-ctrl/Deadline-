'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs          = require('fs');
const { generatePresentation }                                                      = require('./index');
const { initDB, getUser, registerUser, addCredits, incrementRefCount, useCredit, refundCredit, getAllChatIds, checkRateLimits, markGenerationAttempt, markGenerationSuccess, REFERRALS_PER_BONUS } = require('./db');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Telegram-нің parse_mode:'Markdown' режимінде "_ * ` [" символдары
// арнайы синтаксис (italic/bold/code/link) деп қабылданады. Пайдаланушы
// жазған тақырыпта (мыс: "Python vs C++_негіздер") немесе Groq
// генерациялаған презентация атауында осы символдардың БІРІ ЖҰП БОЛМАЙ
// кездессе — Telegram "Can't parse entities" қатесімен БҮКІЛ ХАБАРЛАМАНЫ
// жібермей тастайды, бот "жауапсыз" болып көрінеді (нақты байқалған баг:
// реферал сілтемесіндегі "_" себебінен showReferral мүлде жауап бермеді;
// дәл сол қауіп ${topic} мен ${title} арқылы да бар). Бұл функция
// қауіпті символдардың алдына "\" қойып, Telegram-ге оларды әдеттегі
// таңба ретінде көрсетуді айтады — Markdown синтаксисі бұзылмайды.
function escapeMarkdown(text) {
  if (typeof text !== 'string') return String(text);
  return text.replace(/([_*`\[\]])/g, '\\$1');
}

const KASPI_PHONE = '+77713436592';
const KASPI_NAME  = 'Мурзабек Н';
const PRICE       = 250;
const ADMIN_ID    = process.env.ADMIN_CHAT_ID;
// МАҢЫЗДЫ: BOT_USERNAME env-де кейде "@ai_presentation_ybot" түрінде (@-мен)
// қойылып қалуы мүмкін. Telegram deep-link форматы (t.me/<username>?start=...)
// username-нің алдында @ КҮТПЕЙДІ — @-мен жіберілген сілтемені Telegram
// "пайдаланушы табылмады" деп қабылдамайды. Осыны env-ді өзгертпей-ақ,
// кодтың өзінде әрқашан дұрыс шығатындай, басындағы @-ты алып тастаймыз.
const BOT_USERNAME = (process.env.BOT_USERNAME || 'DeadLine_prezbot').replace(/^@/, '');

const processing      = new Set();
const waitingForCount = new Set();
const waitingForTopic = new Set();

// ─── Негізгі менюдің батырмалары ───────────────────────────────────────────
let WEBAPP_URL = process.env.WEBAPP_URL || '';

const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📱 Mini App ашу' }, { text: '📝 Тақырып жазу' }],
      [{ text: '💳 Менің есепшотым' }, { text: '🔗 Реферал сілтемем' }],
      [{ text: '💰 Кредит сатып алу' }, { text: '❓ Көмек' }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
  parse_mode: 'Markdown',
};

function webAppKeyboard() {
  if (!WEBAPP_URL) return undefined;
  return {
    inline_keyboard: [[
      { text: '📱 DeadLine Mini App', web_app: { url: WEBAPP_URL.replace(/\/$/, '') + '/webapp/' } },
    ]],
  };
}

// ─── /start ────────────────────────────────────────────────────────────────
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId   = msg.chat.id;
  const payload  = match?.[1]?.trim();
  let referredBy = null;

  if (payload && payload.startsWith('ref_')) {
    referredBy = payload.replace('ref_', '');
    if (referredBy === String(chatId)) referredBy = null; // өзін жіберген болса — есептемей
  }

  await registerUser(chatId, referredBy);

  // Реферал санауы презентация жасатқанда өседі — тіркелуде емес

  bot.sendMessage(
    chatId,
    '👋 *Сәлем!* DeadLine — кәсіби AI презентация студиясы.\n\n' +
    `💳 *Баға:* ${PRICE}₸ — 1 презентация\n\n` +
    '📱 *Mini App* арқылы стиль, тіл, слайд саны, прогресс пен тарихты басқарыңыз.\n' +
    'Немесе «📝 Тақырып жазу» арқылы жылдам бастаңыз.',
    { parse_mode: 'Markdown', reply_markup: MAIN_KEYBOARD.reply_markup }
  ).then(() => {
    const kb = webAppKeyboard();
    if (kb) {
      return bot.sendMessage(chatId, 'Төмендегі батырмамен Mini App ашыңыз:', {
        reply_markup: kb,
      });
    }
  });
});

// ─── /balance & "Менің есепшотым" ─────────────────────────────────────────
bot.onText(/\/balance/, (msg) => showBalance(msg.chat.id));

async function showBalance(chatId) {
  const user = await getUser(chatId);

  bot.sendMessage(
    chatId,
    `📊 *Менің есепшотым*\n\n` +
    `💳 Кредит: *${user.credits}* презентация\n` +
    `📦 Жалпы сатып алынды: *${user.total}*\n` +
    `🔗 Реферал табысы: *${user.refEarnings}* кредит`,
    { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
  );
}

// ─── /referral & "Реферал сілтемем" ───────────────────────────────────────
bot.onText(/\/referral/, (msg) => showReferral(msg.chat.id));

async function showReferral(chatId) {
  const user = await getUser(chatId);
  const link = `https://t.me/${BOT_USERNAME}?start=ref_${chatId}`;

  // МАҢЫЗДЫ: сілтемеде екі жеке "_" бар (BOT_USERNAME ішінде және
  // "ref_" префиксінде). Telegram-нің Markdown parser-і "_..._"-ты italic
  // деп қабылдайды — екі бөлек "_" дұрыс жабылмай, БҮКІЛ ХАБАРЛАМА
  // "Can't parse entities" қатесімен ЖІБЕРІЛМЕЙ ҚАЛАДЫ (бот жауапсыз
  // қалады). Дәл байқалған "🔗 Реферал сілтемем батырмасы жауап бермейді"
  // багы осы еді. Шешім: сілтемені backtick (`) ішіне алу — Markdown-да
  // бұл inline code блогы, оның ІШІНДЕГІ "_" арнайы символ ретінде
  // ЕМЕС, әдеттегі таңба ретінде қабылданады.
  bot.sendMessage(
    chatId,
    `🔗 *Реферал бағдарламасы*\n\n` +
    `Сенің жеке сілтемең:\n\`${link}\`\n\n` +
    `📌 *Қалай жұмыс жасайды:*\n` +
    `• Достарыңа осы сілтемені жіберіңіз\n` +
    `• Әр *${REFERRALS_PER_BONUS} адам* презентация жасатса — сізге *1 кредит* қосылады\n` +
    `• Шектеу жоқ — неше адам болса, сонша!\n\n` +
    `👥 Презентация жасатқан: *${user.refEarnings}* адам\nКелесі кредит үшін: *${REFERRALS_PER_BONUS - (user.refEarnings % REFERRALS_PER_BONUS)}* адам қажет`,
    { parse_mode: 'Markdown', disable_web_page_preview: true, ...MAIN_KEYBOARD }
  );
}

// ─── /help ─────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => showHelp(msg.chat.id));

function showHelp(chatId) {
  bot.sendMessage(
    chatId,
    '📖 *Қалай пайдалану:*\n\n' +
    '📱 *Mini App* — толық студия (стиль, тіл, слайд, тарих, прогресс)\n' +
    '📝 *Тақырып жазу* — жылдам режим\n\n' +
    '1️⃣ «💰 Кредит сатып алу»\n' +
    '2️⃣ Kaspi арқылы төлеңіз\n' +
    '3️⃣ Чекті (PDF) ботқа жіберіңіз\n' +
    '4️⃣ Кредит расталған соң презентация жасаңыз\n\n' +
    `📱 Kaspi: *${KASPI_PHONE}* (${KASPI_NAME})\n\n` +
    '⚡ Сапа қақпасы: нашар нәтиже клиентке жіберілмейді, кредит қайтарылады.',
    { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
  );
}

// ─── /confirm <chatId> <amount> — тек admin ───────────────────────────────
bot.onText(/\/confirm (\d+) (\d+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const targetId = match[1];
  const amount   = parseInt(match[2], 10);

  if (isNaN(amount) || amount < 1) {
    return bot.sendMessage(msg.chat.id, '❌ Дұрыс сан жазыңыз.');
  }

  const user = await addCredits(targetId, amount);

  // Реферал бонусы тіркелу кезінде беріледі — төлемде емес

  await bot.sendMessage(
    targetId,
    `✅ Төлем расталды!\n\n` +
    `💳 *${amount}* презентация кредиті қосылды.\n` +
    `📦 Жалпы кредитіңіз: *${user.credits}*\n\n` +
    `«📝 Тақырып жазу» батырмасын басып бастаңыз! 🚀`,
    { parse_mode: 'Markdown', ...MAIN_KEYBOARD }
  );

  bot.sendMessage(msg.chat.id, `✅ ${targetId} → +${amount} кредит. Қалған: ${user.credits}. Жиыны: ${user.total}.`);
});

// ─── /broadcast <хабар> — тек admin, барлық пайдаланушыға жіберу ─────────
bot.onText(/\/broadcast ([\s\S]+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;

  const text = match[1].trim();
  if (!text) {
    return bot.sendMessage(msg.chat.id, '❌ Хабар мәтінін жазыңыз: /broadcast Мәтін...');
  }

  const chatIds = await getAllChatIds();
  await bot.sendMessage(
    msg.chat.id,
    `📤 Broadcast басталды: *${chatIds.length}* пайдаланушыға жіберіледі...\n\n_Бұл біраз уақыт алуы мүмкін (~${Math.ceil(chatIds.length / 25)} секунд)._`,
    { parse_mode: 'Markdown' }
  );

  let sent = 0;
  let failed = 0;

  // Telegram-нің rate limit-і секундына ~30 хабарлама шамасында —
  // сол шектен аспау үшін әр хабардан кейін ~40мс кідіріс қоямыз
  // (шамамен секундына 25 хабар). Бір адамға жіберу сәтсіз болса
  // (мысалы, бот блокталған/чат жойылған), соны есептеп, циклді
  // ТОҚТАТПАЙ, қалған пайдаланушыларға жалғастырамыз — бір адамның
  // қатесі бүкіл broadcast-ты бұзбауы керек.
  for (const chatId of chatIds) {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`[Broadcast] failed for ${chatId}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 40));
  }

  bot.sendMessage(
    msg.chat.id,
    `✅ Broadcast аяқталды!\n\n📨 Жеткізілді: *${sent}*\n❌ Сәтсіз (блок/дилит): *${failed}*`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Негізгі хабар обработчигі ────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;

  if (text && text.startsWith('/')) return;

  if (text === '💳 Менің есепшотым') return showBalance(chatId);
  if (text === '❓ Көмек')           return showHelp(chatId);
  if (text === '🔗 Реферал сілтемем') return showReferral(chatId);

  if (text === '📱 Mini App ашу') {
    const kb = webAppKeyboard();
    if (kb) {
      return bot.sendMessage(chatId,
        '📱 *DeadLine Mini App*\n\nТолық мүмкіндіктер: стиль, тіл, слайд саны, прогресс, тарих және жүктеу — бір жерде.',
        { parse_mode: 'Markdown', reply_markup: kb }
      );
    }
    return bot.sendMessage(chatId, 'Mini App URL әлі бапталмаған (WEBAPP_URL).');
  }

  if (text === '📝 Тақырып жазу') {
    waitingForCount.delete(chatId); // eki rejim bir mezgilde bolmauy ushin
    waitingForTopic.add(chatId);
    return bot.sendMessage(
      chatId,
      '📝 Презентация тақырыбын жазыңыз:',
      { parse_mode: 'Markdown' }
    );
  }

  if (text === '💰 Кредит сатып алу') {
    waitingForTopic.delete(chatId); // eki rejim bir mezgilde bolmauy ushin
    waitingForCount.add(chatId);
    return bot.sendMessage(
      chatId,
      `💰 *Кредит сатып алу*\n\n💵 Баға: *${PRICE}₸* — 1 презентация\n\nНеше презентация керек? Санын жазыңыз:`,
      { parse_mode: 'Markdown' }
    );
  }

  // Чек (PDF)
  if (msg.document) {
    const fileName = (msg.document.file_name || '').toLowerCase();
    const isPdf    = fileName.endsWith('.pdf') || msg.document.mime_type === 'application/pdf';

    if (!isPdf) {
      return bot.sendMessage(chatId, '📎 Kaspi чегін *PDF* түрінде жіберіңіз.', { parse_mode: 'Markdown' });
    }

    const userName = escapeMarkdown([msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Белгісіз');

    await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
    await bot.sendMessage(
      ADMIN_ID,
      `📥 *Жаңа чек!*\n\n👤 ${userName}\n🆔 \`${chatId}\`\n\n` +
      `Растау үшін:\n\`/confirm ${chatId} <сан>\`\n\nМысалы 2 през үшін:\n\`/confirm ${chatId} 2\``,
      { parse_mode: 'Markdown' }
    );

    return bot.sendMessage(
      chatId,
      '📨 Чегіңіз қабылданды!\n\n⏳ Растау *5-10 минут* ішінде болады.\nРасталған соң хабарлама аласыз.',
      { parse_mode: 'Markdown' }
    );
  }

  if (!text) return;

  if (waitingForCount.has(chatId)) {
    const count = parseInt(text.trim(), 10);
    if (isNaN(count) || count < 1 || count > 50) {
      return bot.sendMessage(chatId, '❗ 1-ден 50-ге дейін сан жазыңыз.');
    }
    waitingForCount.delete(chatId);
    const total = count * PRICE;
    return bot.sendMessage(
      chatId,
      `🧾 *${count} презентация — ${total}₸*\n\n` +
      `💳 Kaspi арқылы төлеңіз:\n📱 *${KASPI_PHONE}*\n👤 ${KASPI_NAME}\n\n` +
      `Сомасы: *${total}₸*\n\nТөлегеннен кейін *чекті (PDF)* осы ботқа жіберіңіз ✅`,
      { parse_mode: 'Markdown' }
    );
  }

  if (waitingForTopic.has(chatId)) {
    waitingForTopic.delete(chatId);

    const user = await getUser(chatId);

    if (user.credits > 0) return makePresentaton(chatId, text);

    waitingForCount.add(chatId);
    return bot.sendMessage(
      chatId,
      `💳 Сізде презентация кредиті жоқ.\n\n💰 Баға: *${PRICE}₸* — 1 презентация\n\nНеше презентация керек? Санын жазыңыз:`,
      { parse_mode: 'Markdown' }
    );
  }

  // Ешбір режимде тұрмаса — бос мәтінді тікелей тақырып деп қабылдамай,
  // батырманы басуды сұраймыз. Осы арқылы "1" сияқты жаңылыс жазылған
  // мәтін де кездейсоқ сан/тақырып болып қате түсінілмейді.
  return bot.sendMessage(
    chatId,
    'Презентация жасау үшін «📝 Тақырып жазу» батырмасын басыңыз.',
    MAIN_KEYBOARD
  );
});

// ─── Concurrent generation hard cap (process-wide) ───────────────────────
// Per-chat `processing` prevents one user spamming; this caps total parallel
// decks so a burst of different users cannot exhaust RAM/CPU/API budget.
const MAX_CONCURRENT_GENERATIONS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_GENERATIONS || '3', 10) || 3);
const MAX_TOPIC_CHARS = Math.max(200, parseInt(process.env.MAX_TOPIC_CHARS || '8000', 10) || 8000);
let activeGenerations = 0;

// ─── Презентация жасау ────────────────────────────────────────────────────
async function makePresentaton(chatId, topic) {
  if (processing.has(chatId)) {
    return bot.sendMessage(chatId, '⏳ Презентацияңыз жасалып жатыр, күтіңіз...');
  }

  // Reject pathological briefs early — protects token budget and prompt size.
  const topicStr = String(topic || '').trim();
  if (!topicStr || topicStr.length < 2) {
    return bot.sendMessage(chatId, '❗ Тақырып тым қысқа. Нақтырақ жазыңыз.');
  }
  if (topicStr.length > MAX_TOPIC_CHARS) {
    return bot.sendMessage(
      chatId,
      `❗ Тақырып тым ұзын (макс. ${MAX_TOPIC_CHARS} таңба). Қысқартып жіберіңіз.`
    );
  }

  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    return bot.sendMessage(
      chatId,
      '⏳ Қазір сервер толы. 1–2 минуттан кейін қайта жіберіңіз.'
    );
  }

  // Persisted rate limits (cooldown + daily) — before charging credit.
  const rate = await checkRateLimits(chatId);
  if (!rate.allowed) {
    return bot.sendMessage(chatId, `⏳ ${rate.message}`, MAIN_KEYBOARD);
  }

  processing.add(chatId);
  activeGenerations += 1;

  // Atomic credit take — must succeed before any work or referral side-effects.
  const charged = await useCredit(chatId);
  if (!charged) {
    processing.delete(chatId);
    activeGenerations = Math.max(0, activeGenerations - 1);
    return bot.sendMessage(
      chatId,
      '💳 Кредит жеткіліксіз.\n\n«💰 Кредит сатып алу» батырмасын басыңыз.',
      MAIN_KEYBOARD
    );
  }

  // Start cooldown window even if generation later fails (anti-spam).
  // Daily quota is only incremented on success.
  await markGenerationAttempt(chatId);

  const userAfter = await getUser(chatId);
  const remaining = userAfter.credits;
  let statusMsg;

  try {
    const header =
      `📌 Тақырып: *${escapeMarkdown(topicStr.slice(0, 120))}*\n` +
      `💳 Қалған кредит: ${remaining}\n\n`;

    statusMsg = await bot.sendMessage(
      chatId,
      `⏳ Презентация жасалуда...\n\n${header}_1–3 минут күтіңіз..._`,
      { parse_mode: 'Markdown' }
    );

    const updateStatus = async (detail) => {
      if (!statusMsg) return;
      try {
        await bot.editMessageText(
          `⏳ *${detail}*\n\n${header}_Күте тұрыңыз..._`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
        );
      } catch {
        // Telegram ignores identical edits / rate-limits — non-fatal
      }
    };

    const { pptxPath, htmlPath, title, qualityScore, expensiveVisuals } = await generatePresentation(topicStr, {
      onProgress: async (_phase, detail) => { await updateStatus(detail || 'Жұмыс істелуде...'); },
    });

    await bot.editMessageText('✅ Дайын! Жіберілуде...', {
      chat_id: chatId, message_id: statusMsg.message_id,
    }).catch(() => {});

    const scoreNote = (qualityScore != null && qualityScore >= 0)
      ? `\n✨ Сапа: *${Math.round(qualityScore)}/100*`
      : '';

    await bot.sendDocument(
      chatId,
      pptxPath,
      {
        caption:
          `📊 *${escapeMarkdown(title)}*\n\n` +
          `💳 Қалған презентация: *${remaining}*` +
          scoreNote,
        parse_mode: 'Markdown',
      }
    );

    await bot.sendDocument(
      chatId,
      htmlPath,
      {
        caption: '🌐 *HTML нұсқасы*\n\nФайлды жүктеп алып, браузерде ашыңыз. Пернетақтадағы ← → пернелерімен ауыстырыңыз, F — толық экран.',
        parse_mode: 'Markdown',
      }
    );

    try { fs.unlinkSync(pptxPath); } catch {}
    try { fs.unlinkSync(htmlPath); } catch {}

    // Daily quota only on success (failed runs refund credit and do not burn quota).
    await markGenerationSuccess(chatId, { expensive: !!expensiveVisuals });

    // Referral counted ONLY after successful delivery — failed runs must not
    // inflate refEarnings or grant free bonus credits.
    const u = await getUser(chatId);
    if (u.referredBy) {
      const { newCount, bonusGiven } = await incrementRefCount(u.referredBy);
      const need = REFERRALS_PER_BONUS - (newCount % REFERRALS_PER_BONUS);
      if (bonusGiven) {
        bot.sendMessage(
          u.referredBy,
          `🎉 *+1 кредит!* Сенің реферал сілтемең арқылы ${newCount} адам презентация жасатты!\n\nКелесі кредит үшін тағы *${REFERRALS_PER_BONUS} адам* қажет.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      } else {
        bot.sendMessage(
          u.referredBy,
          `👥 Сенің реферал сілтемең арқылы жаңа адам презентация жасатты!\n\nКредит алу үшін тағы *${need} адам* керек.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }

  } catch (err) {
    console.error('[Bot] Error:', err.message);

    await refundCredit(chatId);

    const errText = err.isQualityGate
      ? '❌ Сапа шегінен өтпеді, кредитіңіз қайтарылды.\n\nТақырыпты сәл өзгертіп қайта жіберіп көріңіз.'
      : '❌ Қате орын алды, кредитіңіз қайтарылды.\n\nТақырыпты қайта жіберіп көріңіз.';

    if (statusMsg) {
      await bot.editMessageText(errText, {
        chat_id: chatId, message_id: statusMsg.message_id,
      }).catch(() => bot.sendMessage(chatId, errText));
    } else {
      await bot.sendMessage(chatId, errText);
    }

  } finally {
    processing.delete(chatId);
    activeGenerations = Math.max(0, activeGenerations - 1);
  }
}

// ─── Іске қосу ───────────────────────────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('[Bot] polling_error:', err && err.message ? err.message : err);
});
bot.on('error', (err) => {
  console.error('[Bot] error:', err && err.message ? err.message : err);
});

async function startBot(opts = {}) {
  if (opts.webappUrl) WEBAPP_URL = opts.webappUrl;
  global.__deadlineBot = bot;
  await initDB();
  bot.startPolling({ restart: true });
  console.log('[Bot] Іске қосылды. Хабарлар күтілуде...');
  return bot;
}

// Standalone mode (npm run bot-only)
if (require.main === module) {
  startBot().catch(err => {
    console.error('[Bot] Init error:', err);
    process.exit(1);
  });
}

module.exports = { startBot, bot, escapeMarkdown };

