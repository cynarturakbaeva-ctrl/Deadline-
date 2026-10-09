'use strict';
/**
 * Референс талдауы → "skin": рендерер қолданатын нақты бет-безендіру ережелері (1920×1080 px).
 * Қайталанатын элементтер (жолақ, акцент пішін), слайд нөмірі орны, карточка толтыруы, жазық фон.
 * Логотип суреттері көшірілмейді (құқық/жеке дерек): тек оның орны бос қалдырылады.
 */
const W = 1920; const H = 1080;

function resolveFill(fill, theme, clrMap) {
  if (!fill) return null;
  if (fill[0] === '#') return fill;
  const m = String(fill).match(/^scheme:(\w+)/);
  if (!m) return null;
  const key = (clrMap && clrMap[m[1]]) || m[1];
  return (theme && (theme[key] || theme[m[1]])) || null;
}

function buildSkin(analysis, theme, clrMap, decor) {
  const rec = analysis.recurring || [];
  const accent = analysis.dna ? analysis.dna.palette.accent : null;
  const shapes = [];
  for (const r of rec) {
    if (!['bar', 'side-bar', 'accent-shape'].includes(r.type)) continue;
    // Тек жиектегі жіңішке жолақ/кішкентай акцент қана безендіру; ортадағы үлкен блок — мазмұн контейнері, көшірмейміз
    const area = r.w * r.h;
    const edge = r.zone !== 'center';
    if (r.type === 'bar' && r.h > 0.12) continue;
    if (r.type === 'side-bar' && r.w > 0.12) continue;
    if (r.type === 'accent-shape' && (area > 0.03 || !edge)) continue;
    const color = resolveFill(r.fill, theme, clrMap) || accent;
    shapes.push({ present: r.present || null, type: r.type, x: Math.round(r.x * W), y: Math.round(r.y * H), w: Math.round(r.w * W), h: Math.round(r.h * H), color });
  }
  const num = rec.find((r) => r.type === 'slide-number');
  const footerText = rec.find((r) => r.type === 'footer-text');
  let folio = 'default';
  if (num && !footerText) folio = /left/.test(num.zone) ? 'num-left' : /right/.test(num.zone) ? 'num-right' : 'num-center';
  else if (!num && !footerText && (analysis.outline.slideCount >= 4)) folio = 'none';
  const bottomBar = (decor && decor.slides && decor.slides.some((x) => x.items.length)) ? 0 : shapes.filter((s) => s.type === 'bar' && s.y > H * 0.8).reduce((m, s) => Math.max(m, H - s.y), 0);
  const topBar = shapes.filter((s) => s.type === 'bar' && s.y < H * 0.2).reduce((m, s) => Math.max(m, s.y + s.h), 0);
  const fills = analysis.outline.slides.map((s) => resolveFill(s.cardFill, theme, clrMap)).filter(Boolean);
  const cardFill = fills.length ? fills[0] : null;
  const hs = analysis.outline.slides.map((s) => s.cardH).filter(Boolean);
  const cardH = hs.length ? Math.round(hs[0] * H) : null;
  const numEl = rec.find((r) => r.type === 'slide-number');
  // Безендіру қабаты: нақты фон/декор/пішіндер референстен
  let dec = null; let photoShape = null; let coverPic = null;
  if (decor && decor.slides && decor.slides.length) {
    const items = decor.slides.reduce((a, s) => a + s.items.length, 0);
    const hasBgImage = decor.slides.some((s) => s.bg && s.bg.media);
    const hasBgColor = decor.slides.some((s) => s.bg && s.bg.color);
    const pics = decor.slides.flatMap((s) => s.pics);
    const circ = pics.filter((p) => p.shape === 'circle').length;
    photoShape = pics.length && circ > pics.length / 2 ? 'circle' : null;
    coverPic = decor.slides[0] && decor.slides[0].pics[0] ? decor.slides[0].pics[0] : null;
    if (items || hasBgImage || hasBgColor) dec = { slides: decor.slides, media: decor.media, items, hasBgImage };
  }
  const g = analysis.grid || {};
  if (dec) { shapes.length = 0; }
  return { decor: dec, photoShape, coverPic, titleAlign: g.titleAlign || 'left', bodyAlign: g.bodyAlign || 'left', flat: true, shapes, folio, bottomBar, topBar, cardFill, cardH, titleTop: !!(analysis.grid && analysis.grid.titleTop), numberPresent: numEl ? numEl.present || null : null, hasLogoSlot: rec.some((r) => r.type === 'logo'), slideCount: analysis.outline.slideCount };
}

/** Құрылған слайд j үшін референс слайд индексі */
function refIndexFor(skin, j, total, roles) {
  const n = skin.slideCount;
  if (!n) return j;
  if (j === 0) return 0;
  if (n === total) return j;
  const tail = roles && /^(conclusion|references|thanks)$/.test(roles[n - 1] || '');
  if (j === total - 1 && n >= 3 && tail) return n - 1;
  const mid = n >= 3 ? n - 1 - (tail ? 1 : 0) : n - 1; // 1..mid
  return 1 + ((j - 1) % Math.max(1, mid));
}

module.exports = { buildSkin, resolveFill, refIndexFor };
