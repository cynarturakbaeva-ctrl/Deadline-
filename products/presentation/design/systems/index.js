'use strict';
/**
 * DESIGN SYSTEMS — бір презентацияның ТОЛЫҚ көрінісі (тек түс емес):
 *   қаріп жұбы · тақырыптағы кілт сөзді бөлектеу · бөлгіш сызық · нөмірлеу · бет нөмірі (folio) · карточкалар ·
 *   фото рамкасы · фон эффектілері · мұқаба мен қорытынды композициясы · рұқсат етілген түс палитралары.
 *
 * Мақсат (CLAUDE.md, басымдық 2): бір студенттің презентациялары бір-біріне ұқсамасын, «тағы сол бот» деп танылмасын.
 * Жүйені КОД таңдайды (pickSystem): студенттің соңғы жүйелері мен палитралары қайталанбайды.
 *
 * Жүйе = { id, name, type|null, moods[], num, folio{}, cover, closing, fx{}, css(palette) }
 *   type   — null → палитраның тонына қарай (бұрынғы әрекет); әйтпесе { display, text: 'sans'|'serif'|'arial', ... }
 *   num    — 'pad' 01 · 'plain' 1 · 'dot' 1. · 'roman' I · 'bracket' [01]
 *   folio  — { title: bool, total: bool, pad: bool, cover: bool } — бет нөмірі қалай жазылады (орны CSS-те)
 *   cover  — 'classic' | 'center' | 'panel' | 'masthead'
 *   css    — #stage.ds-<id> ішіндегі қосымша стильдер (базалық стильдің үстінен)
 */
const T = require('../tokens');
const { formatNum } = require('./numbers');

const SYSTEMS = {};
for (const id of ['aurora', 'journal', 'swiss', 'academy', 'mono', 'atelier', 'heritage', 'campus']) {
  const sys = require('./' + id);
  SYSTEMS[sys.id] = sys;
}
const DEFAULT = 'aurora';

/** Стиль (business/minimal/…) → қай жүйелер лайықты (бірінші — ең лайықтысы). Белгісіз стиль → бәрі. */
const STYLE_SYSTEMS = Object.freeze({
  business: ['swiss', 'mono', 'academy', 'aurora', 'journal'],
  minimal: ['swiss', 'journal', 'atelier', 'academy'],
  creative: ['atelier', 'aurora', 'mono', 'journal', 'swiss'],
  academic: ['academy', 'journal', 'aurora', 'swiss', 'mono', 'atelier'],
  pitch: ['aurora', 'swiss', 'mono', 'atelier'],
});

function getSystem(id) {
  return SYSTEMS[id] || SYSTEMS[DEFAULT];
}

/** Жүйенің қаріп стилі (tokens.TYPE_STYLES пішімінде). null → палитраның тоны (aurora). */
function typeStyleFor(sys, palette) {
  if (!sys || !sys.type) return T.typeStyleFor(palette);
  const f = (k) => T.FONT_STACKS[k] || T.FONT_STACKS.sans;
  const t = sys.type;
  return {
    display: f(t.display), text: f(t.text),
    displayWeight: t.dw, titleWeight: t.tw, displayTracking: t.dt, titleTracking: t.tt,
    displayLine: t.dl, titleLine: t.tl, caps: false, italicQuote: !!t.italicQuote,
  };
}

/**
 * Презентацияға жүйе + палитра таңдайды.
 * @param {{seed?:string, style?:string, brief?:string, avoidSystems?:string[], avoidMoods?:string[]}} o
 *   avoidSystems/avoidMoods — студенттің соңғы презентацияларынікі (жаңасы бірінші)
 * @returns {{system:string, mood:string}}
 */
// Сала → жүйе (тақырыпқа қарай, студенттің мамандығына емес). Тек салаға арналған жүйелер жалпы пулға кірмейді.
const FIELD_SYSTEMS = { humanities: 'heritage', education: 'campus' };
const FIELD_ONLY = new Set(Object.values(FIELD_SYSTEMS));
const FIELD_RE = {
  humanities: /тарих|хандық|хандығ|соғыс|мұрағат|қолжазба|шежіре|ғасыр|история|хански|войн|архив|рукопис|war\b|khanate|archive|manuscript|әдебиет|философ|ойшыл|ақын|жазушы|абай|фараби|мәдениет|өнертану|этнограф|фольклор|истори|литератур|философ|культур|поэт|писател|history|historical|literature|philosoph|culture|poet|heritage/i,
};
FIELD_RE.education = /педагог|психолог|оқыту|сабақ|оқушы|тәрбие|мектеп|спорт|дене шынықтыру|жаттығу|эмоци|стресс|педагогик|психологи|обучени|урок|школ|воспитан|спорт|education|teaching|pedagog|psycholog|school|lesson|sport|fitness/i;
function fieldOf(text) {
  const t = String(text || '');
  return Object.keys(FIELD_RE).find((k) => FIELD_RE[k].test(t)) || null;
}

function pickDesign(o = {}) {
  const seed = String(o.seed || '');
  const avoidS = (o.avoidSystems || []).filter(Boolean);
  const avoidM = (o.avoidMoods || []).filter(Boolean);
  let pool = (STYLE_SYSTEMS[String(o.style || '').toLowerCase()] || Object.keys(SYSTEMS)).filter((id) => SYSTEMS[id] && !FIELD_ONLY.has(id));
  // салаға тән жүйе: тақырып гуманитарлық болса — «Мұра» (студенттің соңғы жүйесі болмаса)
  const field = (o.field && FIELD_SYSTEMS[o.field] ? o.field : null) || fieldOf(o.brief);
  if (field && FIELD_SYSTEMS[field] && !avoidS.slice(0, 1).includes(FIELD_SYSTEMS[field])) pool = [FIELD_SYSTEMS[field]];
  // соңғы 2 жүйе қайталанбайды (пул жетсе); пулдың басы — стильге ең лайықтысы, бірақ хэш араластырады
  const fresh = pool.filter((id) => !avoidS.slice(0, 2).includes(id));
  if (fresh.length) pool = fresh;
  const fresher = pool.filter((id) => !avoidS.includes(id));
  if (fresher.length >= 2) pool = fresher;
  const system = pool[T.strHash(seed + '|sys') % pool.length];
  const sys = SYSTEMS[system];

  // палитра: жүйенің палитралары ∩ клиенттің тілегі (қара/ақ фон); соңғы палитралар қайталанбайды
  const brief = String(o.brief || '');
  const wantsDark = /(қара|тұнық|тёмн\p{L}*|темн\p{L}*|dark|black)\s*(фон|тема|түс|стиль|дизайн|background|theme|mode)/iu.test(brief);
  const wantsLight = /(ақ|жарық|светл\p{L}*|бел\p{L}*|light|white)\s*(фон|тема|түс|стиль|дизайн|background|theme|mode)/iu.test(brief);
  let moods = sys.moods.filter((m) => T.MOODS[m]);
  if (wantsDark && !wantsLight) moods = (moods.filter((m) => !T.isLightMood(m)).length ? moods.filter((m) => !T.isLightMood(m)) : Object.keys(T.MOODS).filter((m) => !T.isLightMood(m) && !/^ref_/.test(m)));
  else if (wantsLight && !wantsDark) moods = (moods.filter(T.isLightMood).length ? moods.filter(T.isLightMood) : Object.keys(T.MOODS).filter((m) => T.isLightMood(m) && !/^ref_/.test(m)));
  const freshM = moods.filter((m) => !avoidM.includes(m));
  if (freshM.length) moods = freshM;
  const mood = moods[T.strHash(seed + '|mood') % moods.length] || 'ivory';
  return { system, mood };
}

/** Жүйенің CSS-і (#stage.ds-<id> аясында) */
function systemCss(sys, palette) {
  if (!sys || typeof sys.css !== 'function') return '';
  return sys.css(palette) || '';
}

module.exports = {
  fieldOf, SYSTEMS, DEFAULT, STYLE_SYSTEMS, getSystem, typeStyleFor, pickDesign, systemCss, formatNum };
