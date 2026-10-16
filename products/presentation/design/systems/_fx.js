'use strict';
/** Жүйелерге ортақ CSS үзінділері (#stage.ds-<id> аясында). */

/** Атмосфералық эффектілерді өшіру: түйіршік, виньетка, аврора, орбита, елес цифрлар, фон әшекейі */
const calm = (S, keep = {}) => [
  keep.grain ? '' : `${S} .layer-bg::after{display:none}`,
  keep.vignette ? '' : `${S} .layer-bg::before{display:none}`,
  keep.aurora ? '' : `${S} .aurora{display:none}`,
  keep.halo ? '' : `${S} .halo{display:none}`,
  keep.ghost ? '' : `${S} .ghost{display:none}`,
  keep.deco ? '' : `${S} .deco{display:none}`,
].filter(Boolean).join('\n');

/** Градиентті мәтіндерді тұтас түске қайтару (сан, тақырып кілт сөзі) */
const solid = (sel, color) => `${sel}{background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;color:${color}!important;-webkit-text-fill-color:${color}!important}`;

/** Шыны карточкаларды басқа пішінге: карточка селекторлары */
const CARDS = '.concept,.st,.hn,.stat,.ig-card';
const CARD_DECOR = '.concept::before,.concept::after,.stat::before,.stat::after,.hn::after,.ig-card::before';

module.exports = { calm, solid, CARDS, CARD_DECOR };
