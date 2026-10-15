'use strict';
/**
 * АВРОРА — кинематографиялық стиль (бұрынғы әдепкі көрініс): атмосфералық жарық дақтары, мұқабадағы орбита,
 * тақырыптағы градиентті кілт сөз, шыны карточкалар, нөмір «01» таблеткада, үлдір түйіршігі.
 * Қаріп палитраның тонына қарай (editorial → Times, modern/technical → Calibri). Базалық стиль = осы жүйе.
 */
module.exports = {
  id: 'aurora',
  name: 'Аврора',
  type: null,
  moods: ['midnight', 'cold', 'vivid', 'archive', 'forest', 'wine', 'graphite', 'warm', 'ivory', 'cloud', 'mint', 'blush', 'sand', 'light'],
  num: 'pad',
  folio: { title: true, total: true, pad: true, cover: true },
  cover: 'classic',
  closing: 'rows',
  css: () => '',
};
