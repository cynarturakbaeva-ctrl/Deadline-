'use strict';
/**
 * ТЕСТЕР РЕЖИМІ — таза функциялар (екі база үшін ортақ).
 *
 * Админ адамды N күнге тестер етеді. Тестер күніне TESTER_DAILY (3) презентацияны тегін жасайды:
 *  - тестер-кредит Алматы түн ортасында 3-ке дейін ТОЛАДЫ, жиналмайды (жұмсамаса ертең де 3, 6 емес);
 *  - админ қосқан артық кредит сақталады (3-тен көп болса, толтыру оны кемітпейді);
 *  - әр презентациядан кейін бот 3 сұрақ қояды; пікір жазылмайынша келесі презентация жасалмайды.
 * Базада: users.tester_until (мс), tester_credits, tester_day (кредит соңғы толған Алматы күні), tester_pending (пікір күтетін job id).
 */
const DAILY = Math.max(1, Number(process.env.TESTER_DAILY) || 3);
const DEFAULT_DAYS = Math.max(1, Number(process.env.TESTER_DAYS) || 7);
const DAY_MS = 86400e3;

/** Алматы күні (UTC+5) */
const dayOf = (ms = Date.now()) => new Date((Number(ms) || 0) + 5 * 3600e3).toISOString().slice(0, 10);

const isActive = (u, now = Date.now()) => !!u && Number(u.tester_until) > now;

/** Бүгінгі нақты тестер-кредит: күн ауысса — 3-ке дейін толады (артығы сақталады) */
function creditsToday(u, now = Date.now()) {
  if (!isActive(u, now)) return 0;
  const c = Math.max(0, Number(u.tester_credits) || 0);
  return u.tester_day === dayOf(now) ? c : Math.max(c, DAILY);
}

/** Mini App / админ үшін қысқа күй */
function testerView(u, now = Date.now()) {
  if (!u || u.tester_until == null) return null;
  return {
    active: isActive(u, now),
    until: Number(u.tester_until) || null,
    creditsToday: creditsToday(u, now),
    daily: DAILY,
    pending: u.tester_pending || null,
  };
}

/** Тестер мерзімінің соңы: бүгіннен бастап `days` күн, соңғы күннің Алматы түн ортасына дейін */
function untilFor(days = DEFAULT_DAYS, now = Date.now()) {
  const d = Math.max(1, Math.min(60, parseInt(days, 10) || DEFAULT_DAYS));
  const almatyMidnight = Date.parse(dayOf(now) + 'T00:00:00Z') - 5 * 3600e3; // бүгінгі Алматы 00:00 (UTC мс)
  return almatyMidnight + d * DAY_MS;
}

/** «@aidana» / «aidana» / «t.me/aidana» / «123456» → { id } немесе { username } */
function parseWho(input) {
  const s = String(input || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').trim();
  if (/^\d{4,15}$/.test(s)) return { id: s };
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s)) return { username: s.toLowerCase() };
  return null;
}

/** Әр презентациядан кейін тестерге қойылатын сұрақтар */
function questionsText(title) {
  return '🧪 *Тест пікірі* — «' + String(title || 'презентация').replace(/[*_`[\]]/g, '').slice(0, 80) + '»\n\n'
    + 'Осы чатқа *бір хабарламамен* жауап беріңіз:\n'
    + '1️⃣ Тақырыпқа сай емес сурет немесе мәтін болды ма? Қай слайдта?\n'
    + '2️⃣ Фактілік қате болды ма?\n'
    + '3️⃣ Мұғалімге осы күйінде тапсырар ма едіңіз? Тапсырмасаңыз — неге?\n\n'
    + 'Пікір жазылғаннан кейін келесі тегін презентация ашылады. Төменнен жұлдызша да қоя аласыз 👇';
}

/** Тестерлер бөлімі: әр тестер — жасағаны, пікірі, күйі; соңғы пікірлер тізімі */
function testersList({ users = [], gens = [], feedback = [] } = {}, now = Date.now()) {
  const fbBy = new Map(); feedback.forEach((f) => { const a = fbBy.get(f.chat_id) || []; a.push(f); fbBy.set(f.chat_id, a); });
  const items = users.filter((u) => u.tester_until != null).map((u) => {
    const mine = gens.filter((g) => g.chat_id === u.chat_id);
    const fb = fbBy.get(u.chat_id) || [];
    return {
      id: u.chat_id,
      name: u.name || (u.username ? '@' + u.username : u.chat_id),
      username: u.username || null,
      ...testerView(u, now),
      gens: mine.length,
      failed: mine.filter((g) => g.status === 'failed').length,
      feedbacks: fb.length,
      lastAt: Math.max(0, ...mine.map((g) => Number(g.created_at) || 0), ...fb.map((f) => Number(f.created_at) || 0)) || null,
    };
  }).sort((a, b) => (b.active - a.active) || ((b.lastAt || 0) - (a.lastAt || 0)));
  const names = new Map(users.map((u) => [u.chat_id, u.name || (u.username ? '@' + u.username : u.chat_id)]));
  const topics = new Map(gens.map((g) => [g.job_id, g.title || g.topic || '']));
  const recent = feedback.slice().sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0)).slice(0, 100)
    .map((f) => ({ jobId: f.job_id, chatId: f.chat_id, name: names.get(f.chat_id) || f.chat_id, topic: topics.get(f.job_id) || '', text: f.text, createdAt: Number(f.created_at) || null }));
  return {
    daily: DAILY,
    active: items.filter((x) => x.active).length,
    gens: items.reduce((a, x) => a + x.gens, 0),
    feedbacks: feedback.length,
    items,
    recent,
  };
}

module.exports = { DAILY, DEFAULT_DAYS, dayOf, isActive, creditsToday, testerView, untilFor, parseWho, questionsText, testersList };
