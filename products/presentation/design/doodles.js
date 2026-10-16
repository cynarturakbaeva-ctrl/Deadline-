'use strict';
/**
 * DOODLES — Open Doodles (Pablo Stanley, CC0) қолмен салынған адам иллюстрациялары: педагогика, психология, спорт
 * тақырыптарына. Қызғылт акцент палитраның акцентіне боялады, қара сызық — мәтін түсіне.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'doodles');
const PINKS = /#(CF536D|FF788F|FF5678)/gi;
const cache = new Map();

// тақырып сөздері → иллюстрация (бірінші сәйкесі)
const PICK = [
  [/психолог|эмоци|стресс|сана|медитац|психик|мейірім|сезім|psycholog|emotion|stress|mind|медитац|эмоц/i, ['meditating', 'loving', 'sitting']],
  [/спорт|дене|жаттығу|денсаулық|фитнес|олимп|sport|fitness|exercise|health|трениров|физкульт/i, ['running', 'roller-skating', 'jumping']],
  [/экология|табиғат|өсімдік|жасыл|ecolog|nature|plant|природ|растен/i, ['plant', 'strolling']],
  [/оқу|сабақ|педагог|білім|мектеп|оқушы|студент|кітап|education|teach|school|learn|reading|урок|учени|школ|педагог|образован/i, ['reading', 'sitting-reading', 'reading-side', 'laying']],
];
const ALL = ['reading', 'sitting-reading', 'reading-side', 'meditating', 'loving', 'plant', 'running', 'roller-skating', 'laying', 'sitting', 'strolling', 'jumping'];

/** Тақырыпқа сай иллюстрация атауы; k — бір презентация ішінде әр түрлі алу үшін ығысу */
function pickDoodle(text, k = 0) {
  const t = String(text || '');
  const hit = PICK.find(([re]) => re.test(t));
  const list = hit ? hit[1] : ALL;
  return list[k % list.length];
}

/** data:image/svg+xml URI — акцент пен сызық түсі палитрадан */
function doodleUri(name, accent, ink) {
  const key = name + '|' + accent + '|' + ink;
  if (cache.has(key)) return cache.get(key);
  let svg = '';
  try { svg = fs.readFileSync(path.join(DIR, name + '.svg'), 'utf8'); } catch { return ''; }
  svg = svg.replace(PINKS, accent || '#CF536D');
  if (ink) svg = svg.replace(/#000000/gi, ink);
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  cache.set(key, uri);
  return uri;
}

module.exports = { pickDoodle, doodleUri, DOODLES: ALL };
