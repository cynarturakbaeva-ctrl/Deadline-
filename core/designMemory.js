'use strict';
/**
 * ДИЗАЙН ЖАДЫ — әр студенттің соңғы презентацияларының дизайн жүйелері, палитралары және суреттері.
 * Келесі презентация осыларды ҚАЙТАЛАМАЙДЫ («тағы сол бот» деп танылмасын, бір сурет екі рет шықпасын).
 * Базада users.design_memory (JSON мәтін) ретінде сақталады; бұл файл — екі базаға ортақ таза функциялар.
 */
const KEEP = { systems: 4, moods: 6, photos: 120, comps: 24 };

function parse(raw) {
  let m = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { m = null; } }
  m = m && typeof m === 'object' ? m : {};
  const arr = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, n) : []);
  return { systems: arr(m.systems, KEEP.systems), moods: arr(m.moods, KEEP.moods), photos: arr(m.photos, KEEP.photos), comps: arr(m.comps, KEEP.comps) };
}

/** Жаңа презентацияның дизайнын/суреттерін жадтың БАСЫНА қосады (ең жаңасы бірінші), қайталанбайды */
function merge(prev, add = {}) {
  const m = parse(prev);
  const front = (list, items, n) => {
    const xs = [].concat(items || []).filter((x) => typeof x === 'string' && x);
    return xs.concat(list.filter((x) => !xs.includes(x))).slice(0, n);
  };
  return {
    systems: add.system ? front(m.systems, [add.system], KEEP.systems) : m.systems,
    moods: add.mood ? front(m.moods, [add.mood], KEEP.moods) : m.moods,
    photos: add.photos ? front(m.photos, add.photos, KEEP.photos) : m.photos,
    // композициялар (compositions/): соңғы колодаларда болғандары келесіде алдымен таңдалмайды
    comps: add.comps ? front(m.comps, add.comps, KEEP.comps) : m.comps,
  };
}

/** generatePresentation опциялары: { designAvoid: {systems, moods}, photoAvoid: [...], recentComps: [...] } */
function avoidOptions(raw) {
  const m = parse(raw);
  return { designAvoid: { systems: m.systems, moods: m.moods }, photoAvoid: m.photos, recentComps: m.comps };
}

module.exports = { parse, merge, avoidOptions, KEEP };
