'use strict';
/**
 * BOTANIC — ескі ботаникалық гравюралар (Cleveland Museum of Art Open Access, CC0): фоны алынған, мөлдір WebP.
 * «Мұра» жүйесінде слайдтың бос бұрышына әшекей ретінде қойылады — ескі кітап/гербарий сезімі.
 * Бір презентацияда әр слайдқа басқа өсімдік (seed бойынша), мәтінге тимейтін бұрышта.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'botanic');
let LIST = null;
const cache = new Map();

function list() {
  if (!LIST) {
    try { LIST = Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'))).sort(); } catch { LIST = []; }
  }
  return LIST;
}

/** seed (презентация) + k (слайд) → файл атауы; бір презентацияда қайталанбайды */
function pickBotanic(seed, k) {
  const L = list();
  if (!L.length) return null;
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return L[(h + k * 7) % L.length];
}

function botanicUri(name) {
  if (!name) return '';
  if (cache.has(name)) return cache.get(name);
  let uri = '';
  try { uri = 'data:image/webp;base64,' + fs.readFileSync(path.join(DIR, name)).toString('base64'); } catch { /* жоқ */ }
  cache.set(name, uri);
  return uri;
}

module.exports = { pickBotanic, botanicUri, botanicList: list };
