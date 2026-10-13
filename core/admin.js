'use strict';
/**
 * АДМИН ПАНЕЛЬ — есептеу (екі база үшін ортақ, тек таза функциялар).
 * Кіріс: db.adminData() қайтаратын шикі жолдар { users, gens, receipts, feedback, events }.
 */

/** Алматы күні (UTC+5) */
const dayOf = (ms) => new Date((Number(ms) || 0) + 5 * 3600e3).toISOString().slice(0, 10);
const DAY = 86400e3;

const userName = (u) => (u ? (u.name || (u.username ? '@' + u.username : '') || u.chat_id) : '');
const userSource = (u) => (u ? u.source || (u.referred_by ? 'ref' : 'direct') : 'direct');

/** Жұмыс → соңғы баға */
function ratingsByJob(feedback) {
  const m = new Map();
  (feedback || []).forEach((f) => {
    const cur = m.get(f.job_id);
    if (!cur || (f.created_at || 0) > (cur.created_at || 0)) m.set(f.job_id, f);
  });
  return m;
}

/** Күндік қатар + жиынтықтар */
function overview(data, { days = 14, now = Date.now() } = {}) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayOf(now - i * DAY));
  const row = () => ({ new: 0, start: 0, app: 0, gens: 0, free: 0, failed: 0, revenue: 0, payments: 0, cost: 0, rSum: 0, rN: 0 });
  const by = Object.fromEntries(keys.map((k) => [k, row()]));
  (data.events || []).forEach((e) => { const d = by[e.day]; if (d && (e.kind === 'new' || e.kind === 'start' || e.kind === 'app')) d[e.kind] += 1; });
  (data.gens || []).forEach((g) => {
    const d = by[dayOf(g.created_at)]; if (!d) return;
    d.gens += 1; if (g.free) d.free += 1; if (g.status === 'failed') d.failed += 1;
    d.cost += Number(g.cost_tg) || 0;
  });
  (data.receipts || []).forEach((r) => { const d = by[dayOf(r.created_at)]; if (d) { d.revenue += Number(r.amount) || 0; d.payments += 1; } });
  (data.feedback || []).forEach((f) => { const d = by[dayOf(f.created_at)]; if (d && f.rating) { d.rSum += f.rating; d.rN += 1; } });
  const series = keys.map((k) => ({ day: k, ...by[k], cost: Math.round(by[k].cost), rating: by[k].rN ? Math.round((by[k].rSum / by[k].rN) * 10) / 10 : null }));

  const sum = (arr, f) => arr.reduce((a, x) => a + (x[f] || 0), 0);
  const period = (arr) => {
    const rN = sum(arr, 'rN');
    return {
      new: sum(arr, 'new'), start: sum(arr, 'start'), app: sum(arr, 'app'), gens: sum(arr, 'gens'), free: sum(arr, 'free'), failed: sum(arr, 'failed'),
      revenue: sum(arr, 'revenue'), payments: sum(arr, 'payments'), cost: sum(arr, 'cost'), ratings: rN,
      rating: rN ? Math.round((sum(arr, 'rSum') / rN) * 10) / 10 : null,
    };
  };
  const today = period(series.slice(-1));
  const yesterday = period(series.slice(-2, -1));
  const week = period(series.slice(-7));

  // арналар (кезең бойы): /start → Mini App → жасатты (воронка оқиғаларынан)
  const src = {};
  (data.events || []).forEach((e) => {
    if (!by[e.day]) return;
    const s = src[e.source || 'direct'] || (src[e.source || 'direct'] = { source: e.source || 'direct', new: 0, start: 0, app: 0, gen: 0, paid: 0 });
    if (s[e.kind] != null) s[e.kind] += 1;
  });
  const users = data.users || [];
  return {
    days, series, today, yesterday, week,
    sources: Object.values(src).sort((a, b) => (b.start + b.app) - (a.start + a.app)).slice(0, 12),
    totals: {
      users: users.length,
      paying: users.filter((u) => (u.total || 0) > 0).length,
      freeUsed: users.filter((u) => u.free_used).length,
      blocked: users.filter((u) => u.blocked).length,
      creditsLeft: users.reduce((a, u) => a + Math.max(0, u.credits || 0), 0),
    },
    lowRatings: (data.feedback || []).filter((f) => f.rating && f.rating <= 3 && (f.created_at || 0) >= now - 7 * DAY).length,
  };
}

/** Әр адамға: неше генерация, соңғы әрекет, төлем сомасы, соңғы баға */
function enrichUsers(data) {
  const gens = new Map(); const paid = new Map(); const rated = new Map();
  (data.gens || []).forEach((g) => {
    const x = gens.get(g.chat_id) || { n: 0, last: 0 };
    x.n += 1; x.last = Math.max(x.last, g.created_at || 0); gens.set(g.chat_id, x);
  });
  (data.receipts || []).forEach((r) => paid.set(r.chat_id, (paid.get(r.chat_id) || 0) + (Number(r.amount) || 0)));
  (data.feedback || []).forEach((f) => {
    const cur = rated.get(f.chat_id);
    if (f.rating && (!cur || (f.created_at || 0) > cur.at)) rated.set(f.chat_id, { rating: f.rating, at: f.created_at || 0 });
  });
  return (data.users || []).map((u) => {
    const g = gens.get(u.chat_id) || { n: 0, last: 0 };
    return {
      id: u.chat_id, name: userName(u), username: u.username || null, source: userSource(u),
      credits: u.credits || 0, bought: u.total || 0, freeUsed: !!u.free_used, blocked: !!u.blocked,
      createdAt: u.created_at || null, gens: g.n, lastAt: Math.max(g.last, Number(u.last_success_at) || 0) || null,
      paidSum: paid.get(u.chat_id) || 0, lastRating: rated.has(u.chat_id) ? rated.get(u.chat_id).rating : null,
    };
  });
}

/** Клиенттер тізімі: іздеу (id / аты / @username) және сүзгі */
function usersList(data, { q = '', filter = 'all', limit = 50, offset = 0, now = Date.now() } = {}) {
  const needle = String(q || '').trim().toLowerCase().replace(/^@/, '');
  let list = enrichUsers(data);
  if (needle) list = list.filter((u) => [u.id, u.name, u.username].some((v) => String(v || '').toLowerCase().includes(needle)));
  if (filter === 'paying') list = list.filter((u) => u.bought > 0);
  else if (filter === 'free') list = list.filter((u) => u.freeUsed && u.bought === 0);
  else if (filter === 'active') list = list.filter((u) => (u.lastAt || 0) >= now - 7 * DAY);
  else if (filter === 'blocked') list = list.filter((u) => u.blocked);
  else if (filter === 'credits') list = list.filter((u) => u.credits > 0);
  list.sort((a, b) => (b.lastAt || b.createdAt || 0) - (a.lastAt || a.createdAt || 0));
  return { total: list.length, items: list.slice(offset, offset + limit) };
}

/** Генерациялар тізімі (баға, пікір, клиент атымен) */
function gensList(data, { filter = 'all', limit = 50, offset = 0 } = {}) {
  const fb = ratingsByJob(data.feedback);
  const users = new Map((data.users || []).map((u) => [u.chat_id, u]));
  let list = (data.gens || []).map((g) => {
    const f = fb.get(g.job_id); const u = users.get(g.chat_id);
    return {
      jobId: g.job_id, chatId: g.chat_id, name: userName(u) || g.chat_id, mode: g.mode || 'presentation', topic: g.title || g.topic || '',
      slides: g.slides || null, language: g.language || null, free: !!g.free, status: g.status || null, error: g.error || null,
      cost: g.cost_tg != null ? Math.round(g.cost_tg * 10) / 10 : null, durationS: g.duration_ms ? Math.round(g.duration_ms / 1000) : null,
      quality: g.quality != null ? Math.round(g.quality) : null, createdAt: g.created_at || null,
      rating: f ? f.rating : null, comment: f && f.comment ? f.comment : null,
    };
  });
  if (filter === 'low') list = list.filter((g) => g.rating && g.rating <= 3);
  else if (filter === 'rated') list = list.filter((g) => g.rating || g.comment);
  else if (filter === 'failed') list = list.filter((g) => g.status === 'failed');
  else if (filter === 'free') list = list.filter((g) => g.free);
  else if (filter === 'paid') list = list.filter((g) => !g.free);
  else if (filter === 'template' || filter === 'referat') list = list.filter((g) => g.mode === filter);
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { total: list.length, items: list.slice(offset, offset + limit) };
}

/** Төлемдер (авто чек + қолмен расталған) */
function paymentsList(data, { limit = 100 } = {}) {
  const users = new Map((data.users || []).map((u) => [u.chat_id, u]));
  const list = (data.receipts || []).map((r) => ({
    ref: r.receipt_no, chatId: r.chat_id, name: userName(users.get(r.chat_id)) || r.chat_id,
    amount: Number(r.amount) || 0, credits: Number(r.credits) || 0, kind: r.status === 'manual' ? 'қолмен' : 'чек', createdAt: r.created_at || null,
  })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { total: list.length, sum: list.reduce((a, x) => a + x.amount, 0), items: list.slice(0, limit) };
}

/** Бір клиенттің толық картасы */
function userDetail(data, id) {
  const u = (data.users || []).find((x) => x.chat_id === String(id));
  if (!u) return null;
  const [card] = enrichUsers({ ...data, users: [u] });
  const days = new Set((data.events || []).map((e) => e.day));
  return {
    ...card,
    referredBy: u.referred_by || null,
    activeDays: days.size,
    gens: gensList(data, { limit: 100 }).items,
    payments: paymentsList(data, { limit: 100 }).items,
  };
}

module.exports = { dayOf, overview, usersList, gensList, paymentsList, userDetail, enrichUsers };
