'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs          = require('fs');
const { generatePresentation }                                                      = require('./index');
const { initDB, getUser, registerUser, addCredits, incrementRefCount, useCredit, refundCredit, getAllChatIds, REFERRALS_PER_BONUS } = require('./db');

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
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📝 Тақырып жазу' }],
      [{ text: '💳 Менің есепшотым' }, { text: '🔗 Реферал сілтемем' }],
      [{ text: '💰 Кредит сатып алу' }, { text: '❓ Көмек' }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
  parse_mode: 'Markdown',
};

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
    '👋 Сәлем! Мен кәсіби презентация жасайтын ботпын.\n\n' +
    `💳 *Баға:* ${PRICE}₸ — 1 презентация\n\n«📝 Тақырып жазу» батырмасын басып бастаңыз.`,
    MAIN_KEYBOARD
  );
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
    '1️⃣ «💰 Кредит сатып алу» басыңыз\n' +
    '2️⃣ Kaspi арқылы төлеңіз\n' +
    '3️⃣ Чекті (PDF) осы ботқа жіберіңіз\n' +
    '4️⃣ Кредит расталған соң «📝 Тақырып жазу» басыңыз\n\n' +
    `📱 Kaspi: *${KASPI_PHONE}* (${KASPI_NAME})`,
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

// ─── Презентация жасау ────────────────────────────────────────────────────
async function makePresentaton(chatId, topic) {
  if (processing.has(chatId)) {
    return bot.sendMessage(chatId, '⏳ Презентацияңыз жасалып жатыр, күтіңіз...');
  }

  processing.add(chatId);

  await useCredit(chatId);

  // Реферал иесіне есептей — кез келген (ақылы) презентация жасатқанда.
  // Референт әр 2 реферал (REFERRALS_PER_BONUS, db.js-те) презентация
  // жасатқанда 1 кредит алады.
  const u = await getUser(chatId);
  if (u.referredBy) {
    const { newCount, bonusGiven } = await incrementRefCount(u.referredBy);
    const remaining = REFERRALS_PER_BONUS - (newCount % REFERRALS_PER_BONUS);
    if (bonusGiven) {
      bot.sendMessage(
        u.referredBy,
        `🎉 *+1 кредит!* Сенің реферал сілтемең арқылы ${newCount} адам презентация жасатты!\n\nКелесі кредит үшін тағы *${REFERRALS_PER_BONUS} адам* қажет.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      bot.sendMessage(
        u.referredBy,
        `👥 Сенің реферал сілтемең арқылы жаңа адам презентация жасатты!\n\nКредит алу үшін тағы *${remaining} адам* керек.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  }

  const userAfter   = await getUser(chatId);
  const remaining   = userAfter.credits;
  let statusMsg;

  try {
    statusMsg = await bot.sendMessage(
      chatId,
      `⏳ Презентация жасалуда...\n\n📌 Тақырып: *${escapeMarkdown(topic)}*\n` +
      `💳 Қалған кредит: ${remaining}\n` +
      `\n_1-2 минут күтіңіз..._`,
      { parse_mode: 'Markdown' }
    );

    const { pptxPath, htmlPath, title } = await generatePresentation(topic);

    await bot.editMessageText('✅ Дайын! Жіберілуде...', {
      chat_id: chatId, message_id: statusMsg.message_id,
    });

    await bot.sendDocument(
      chatId,
      pptxPath,
      {
        caption:
          `📊 *${escapeMarkdown(title)}*\n\n` +
          `💳 Қалған презентация: *${remaining}*`,
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

  } catch (err) {
    console.error('[Bot] Error:', err.message);

    await refundCredit(chatId);

    const errText = '❌ Қате орын алды, кредитіңіз қайтарылды.\n\nТақырыпты қайта жіберіп көріңіз.';

    if (statusMsg) {
      await bot.editMessageText(errText, {
        chat_id: chatId, message_id: statusMsg.message_id,
      }).catch(() => bot.sendMessage(chatId, errText));
    } else {
      await bot.sendMessage(chatId, errText);
    }

  } finally {
    processing.delete(chatId);
  }
}

// ─── Іске қосу ───────────────────────────────────────────────────────────
initDB()
  .then(() => {
    bot.startPolling();
    console.log('[Bot] Іске қосылды. Хабарлар күтілуде...');
  })
  .catch(err => {
    console.error('[DB] Init error:', err);
    process.exit(1);
  });

