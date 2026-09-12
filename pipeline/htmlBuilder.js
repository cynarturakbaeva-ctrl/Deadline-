'use strict';

const fs_   = require('fs');
const path_ = require('path');

function getLogoBase64() {
  try {
    const logoPath = path_.join(__dirname, '..', 'assets', 'logo_white.png');
    const data = fs_.readFileSync(logoPath);
    return 'data:image/png;base64,' + data.toString('base64');
  } catch (e) {
    return '';
  }
}
const LOGO_WHITE = getLogoBase64();


const MOOD = {
  dark:  { bg: '#0d1117', text: '#ffffff', muted: 'rgba(255,255,255,0.6)',  surface: 'rgba(255,255,255,0.06)' },
  light: { bg: '#f5f2ed', text: '#1a1a1a', muted: 'rgba(0,0,0,0.70)',      surface: 'rgba(0,0,0,0.06)' },
  warm:  { bg: '#1e1209', text: '#f5e8d0', muted: 'rgba(245,232,208,0.6)', surface: 'rgba(255,255,255,0.06)' },
  cold:  { bg: '#0c1622', text: '#e8f0f8', muted: 'rgba(232,240,248,0.6)', surface: 'rgba(255,255,255,0.07)' },
  vivid: { bg: '#0a0a0a', text: '#ffffff', muted: 'rgba(255,255,255,0.65)', surface: 'rgba(255,255,255,0.08)' },
};

function overlayCSS(type, accent) {
  switch (type) {
    case 'dark_gradient_left':
      return 'background:linear-gradient(90deg,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.80) 45%,rgba(0,0,0,0.40) 70%,rgba(0,0,0,0.08) 100%)';
    case 'dark_gradient_right':
      return 'background:linear-gradient(270deg,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.80) 45%,rgba(0,0,0,0.35) 70%,rgba(0,0,0,0.06) 100%)';
    case 'dark_gradient_bottom':
      return 'background:linear-gradient(180deg,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.75) 100%)';
    case 'dark_gradient_top':
      // dark_gradient_bottom-мен айна-теңдес — мәтін ЖОҒАРЫДА тұрғанда
      // (top_left/top_center) қолданылады, жоғарғы жиекті қараңғылайды.
      return 'background:linear-gradient(0deg,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.75) 100%)';
    case 'dark_full':
      return 'background:rgba(0,0,0,0.62)';
    case 'light_full':
      return 'background:rgba(255,255,255,0.55)';
    case 'color_wash':
      return 'background:' + accent + '22';
    default:
      return 'display:none';
  }
}

function imagePlacement(imageType, img) {
  if (!img || imageType === 'none') return { wrapperCSS: '' };
  const base = "background-image:url('" + img + "');background-size:cover;background-position:center;";
  switch (imageType) {
    case 'full_background':
      return { wrapperCSS: 'position:absolute;inset:0;z-index:0;' + base };
    case 'right_half':
      return { wrapperCSS: 'position:absolute;top:0;right:0;width:52%;height:100%;z-index:0;' + base + 'border-left:1px solid rgba(255,255,255,0.08)' };
    case 'left_half':
      return { wrapperCSS: 'position:absolute;top:0;left:0;width:48%;height:100%;z-index:0;' + base };
    case 'top_strip':
      return { wrapperCSS: 'position:absolute;top:0;left:0;right:0;height:38%;z-index:0;' + base + 'background-position:center 30%;-webkit-mask-image:linear-gradient(180deg,black 55%,transparent 100%);mask-image:linear-gradient(180deg,black 55%,transparent 100%)' };
    case 'bottom_strip':
      return { wrapperCSS: 'position:absolute;bottom:0;left:0;right:0;height:35%;z-index:0;' + base + 'background-position:center 70%;-webkit-mask-image:linear-gradient(0deg,black 55%,transparent 100%);mask-image:linear-gradient(0deg,black 55%,transparent 100%)' };
    case 'corner_accent':
      return { wrapperCSS: 'position:absolute;bottom:0;right:0;width:38%;height:55%;z-index:0;' + base + 'border-radius:24px 0 0 0;opacity:0.75' };
    default:
      return { wrapperCSS: '' };
  }
}
function buildFallbackVisual(accent, mood, index) {
  const a  = accent || '#d4a843';
  const a1 = a + 'cc';
  const a2 = a + '55';
  const a3 = a + '22';
  const a4 = a + '11';
  const v  = index % 3;

  if (v === 0) {
    // Neural network
    return '<svg width="500" height="500" viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;right:-30px;top:10px;z-index:1;opacity:0.8;">'
      + '<circle cx="250" cy="250" r="240" fill="' + a3 + '"/>'
      + '<circle cx="250" cy="250" r="160" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="250" cy="250" r="100" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<line x1="250" y1="250" x2="120" y2="130" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="250" y1="250" x2="390" y2="120" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="250" y1="250" x2="420" y2="300" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="250" y1="250" x2="340" y2="420" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="250" y1="250" x2="110" y2="390" stroke="' + a2 + '" stroke-width="1"/>'
      + '<circle cx="120" cy="130" r="10" fill="' + a + '" opacity="0.7"/>'
      + '<circle cx="390" cy="120" r="8"  fill="' + a + '" opacity="0.6"/>'
      + '<circle cx="420" cy="300" r="12" fill="' + a + '" opacity="0.75"/>'
      + '<circle cx="340" cy="420" r="9"  fill="' + a + '" opacity="0.65"/>'
      + '<circle cx="110" cy="390" r="11" fill="' + a + '" opacity="0.7"/>'
      + '<circle cx="120" cy="130" r="22" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="420" cy="300" r="26" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="250" cy="250" r="20" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="250" cy="250" r="34" stroke="' + a1 + '" stroke-width="1.5" fill="none"/>'
      + '<circle cx="250" cy="250" r="52" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '</svg>';
  }

  if (v === 1) {
    // Hexagon
    return '<svg width="480" height="480" viewBox="0 0 480 480" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;right:-10px;top:20px;z-index:1;opacity:0.8;">'
      + '<circle cx="240" cy="240" r="230" stroke="' + a3 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="240" cy="240" r="185" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<polygon points="240,60 396,150 396,330 240,420 84,330 84,150" stroke="' + a1 + '" stroke-width="1.5" fill="' + a4 + '"/>'
      + '<polygon points="240,130 340,185 340,295 240,350 140,295 140,185" stroke="' + a2 + '" stroke-width="1" fill="' + a3 + '"/>'
      + '<polygon points="240,200 290,230 290,290 240,320 190,290 190,230" fill="' + a + '" opacity="0.5"/>'
      + '<circle cx="240" cy="60"  r="5" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="396" cy="150" r="5" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="396" cy="330" r="5" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="240" cy="420" r="5" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="84"  cy="330" r="5" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="84"  cy="150" r="5" fill="' + a + '" opacity="0.9"/>'
      + '</svg>';
  }

  // Orbits
  return '<svg width="520" height="520" viewBox="0 0 520 520" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;right:-40px;top:0;z-index:1;opacity:0.75;">'
    + '<circle cx="260" cy="260" r="250" fill="' + a3 + '"/>'
    + '<ellipse cx="260" cy="260" rx="210" ry="75" stroke="' + a2 + '" stroke-width="1" fill="none" transform="rotate(-30 260 260)"/>'
    + '<ellipse cx="260" cy="260" rx="210" ry="75" stroke="' + a2 + '" stroke-width="1" fill="none" transform="rotate(30 260 260)"/>'
    + '<ellipse cx="260" cy="260" rx="210" ry="75" stroke="' + a2 + '" stroke-width="1" fill="none" transform="rotate(90 260 260)"/>'
    + '<circle cx="470" cy="260" r="8"  fill="' + a + '" opacity="0.8"/>'
    + '<circle cx="50"  cy="260" r="6"  fill="' + a + '" opacity="0.6"/>'
    + '<circle cx="370" cy="80"  r="7"  fill="' + a + '" opacity="0.7"/>'
    + '<circle cx="150" cy="440" r="5"  fill="' + a + '" opacity="0.55"/>'
    + '<circle cx="370" cy="440" r="9"  fill="' + a + '" opacity="0.75"/>'
    + '<circle cx="260" cy="260" r="38" fill="' + a + '" opacity="0.15"/>'
    + '<circle cx="260" cy="260" r="22" fill="' + a + '" opacity="0.8"/>'
    + '<circle cx="260" cy="260" r="55" stroke="' + a1 + '" stroke-width="1.5" fill="none"/>'
    + '</svg>';
}

function textPositionCSS(pos, imageType) {
  // Split layouts (right_half / left_half) — flex-негізді екі колонка,
  // мәтін әрдайым сурет жоқ жарты бөлікте орналасады.
  if (pos === 'left_column' || imageType === 'right_half') {
    return 'position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;gap:18px;width:48%;padding:64px 48px 64px 80px';
  }
  if (pos === 'right_column' || imageType === 'left_half') {
    return 'position:relative;z-index:2;display:flex;flex-direction:column;justify-content:center;gap:18px;margin-left:48%;width:52%;padding:64px 80px 64px 56px';
  }

  // bullets/stats — flex-негізді ішкі элементтер, олар text-align:center
  // мұрасын елемейді (flex-context center-ды сыртқы блокқа ғана береді,
  // <li> өзі flex болғандықтан сол жақтан бастай береді). Сондықтан
  // center/top_center/bottom_center кезінде де контейнерге align-items:center
  // қосамыз — bullet иконкасы + мәтін бірге, блок ретінде центрде тұрады.
  const shared = 'position:absolute;z-index:2;display:flex;flex-direction:column;gap:18px;';
  const sharedCentered = shared + 'align-items:center;';

  // corner_accent: сурет оң төменгі бұрышта (bottom:0;right:0;width:38%;height:55%) —
  // яғни слайд биіктігінің 720px-тің 396px-і (55%) СУРЕТ, демек сурет
  // top:324px-тен (720×0.45) басталады. Мазмұн көп болса (title+subtitle+
  // 5 bullet) тік мәтін блогы сол шектен асып, суреттің үстіне кіріп кетеді.
  // Сондықтан ені ЖӘНЕ биіктігі де шектеледі: max-height мазмұнды 324px-тен
  // аспайтындай ұстайды, артық bullet болса overflow:hidden арқылы жасырылады
  // (толық мазмұн prompt деңгейінде шектелгендіктен бұл сирек іске қосылады,
  // бірақ кепілдік ретінде қалады).
  if (imageType === 'corner_accent') {
    switch (pos) {
      case 'top_center': return sharedCentered + 'top:56px;left:50%;transform:translateX(-50%);text-align:center;max-width:600px;max-height:260px;overflow:hidden';
      case 'top_left':
      default:           return shared + 'top:56px;left:80px;max-width:560px;max-height:260px;overflow:hidden';
    }
  }

  // top_strip: сурет жоғарғы 38%-ды алады → мәтін тек 40%-дан төмен орналасуы керек
  if (imageType === 'top_strip') {
    switch (pos) {
      case 'bottom_center': return sharedCentered + 'bottom:88px;left:50%;transform:translateX(-50%);text-align:center;width:75%;max-width:900px';
      case 'bottom_left':
      default:              return shared + 'bottom:64px;left:80px;max-width:760px';
    }
  }

  // bottom_strip: сурет төменгі 35%-ды алады → мәтін тек 40%-ға дейін жоғарыда орналасуы керек
  if (imageType === 'bottom_strip') {
    switch (pos) {
      case 'top_center': return sharedCentered + 'top:56px;left:50%;transform:translateX(-50%);text-align:center;width:75%;max-width:900px';
      case 'top_left':
      default:           return shared + 'top:56px;left:80px;max-width:760px';
    }
  }

  switch (pos) {
    case 'center':        return sharedCentered + 'top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;width:75%;max-width:900px';
    case 'center_left':   return shared + 'top:50%;left:80px;transform:translateY(-50%);max-width:600px';
    case 'center_right':  return shared + 'top:50%;right:80px;transform:translateY(-50%);text-align:right;max-width:600px';
    case 'top_left':      return shared + 'top:64px;left:80px;max-width:700px';
    case 'top_center':    return sharedCentered + 'top:64px;left:50%;transform:translateX(-50%);text-align:center;width:75%;max-width:900px';
    case 'bottom_left':   return shared + 'bottom:72px;left:80px;max-width:700px';
    case 'bottom_center': return sharedCentered + 'bottom:96px;left:50%;transform:translateX(-50%);text-align:center;width:75%;max-width:900px';
    default:              return shared + 'top:50%;left:80px;transform:translateY(-50%);max-width:600px';
  }
}

function renderTitle(slide, palette, big) {
  if (!slide.title) return '';
  return '<h1 style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:' + (big || '42px') + ';font-weight:700;line-height:1.15;color:' + palette.text + ';letter-spacing:-0.5px;margin:0;">' + slide.title + '</h1>';
}
function renderSubtitle(slide, palette) {
  if (!slide.subtitle) return '';
  return '<p style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:17px;font-weight:400;line-height:1.55;color:' + palette.muted + ';margin:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">' + slide.subtitle + '</p>';
}
function renderBody(slide, palette) {
  if (!slide.body) return '';
  return '<p style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:16px;font-weight:400;line-height:1.65;color:' + palette.muted + ';margin:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">' + slide.body + '</p>';
}
function renderEyebrow(slide, accent) {
  const raw = slide.title || 'Overview';
  const label = raw.split(' ').slice(0, 4).join(' ');
  return '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:' + accent + ';margin-bottom:18px;opacity:0.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + label + '</div>';
}
function renderDivider(accent) {
  return '<div style="width:52px;height:3px;background:' + accent + ';border-radius:2px;margin-bottom:24px;"></div>';
}
function renderQuoteMark(accent) {
  return '<div style="font-family:Georgia,serif;font-size:110px;line-height:0.7;color:' + accent + ';opacity:0.45;margin-bottom:24px;">"</div>';
}
// align: 'left' (default), 'right', немесе 'center'. Title/subtitle секілді
// text-align арқылы емес — bullets/stats flex-элементтер болғандықтан,
// text-align мұрагерлігі icon мен мәтіннің РЕТІН ауыстырып жібереді
// (мысалы text-align:right кезінде bullet ⚬ мәтіннен КЕЙІН қалып қояды).
// Сондықтан мұнда flex-direction мен text-align-ды бірге, сәйкес басқарамыз.
function renderBullets(slide, palette, accent, grid, align) {
  if (!slide.bullets || !slide.bullets.length) return '';
  const isRight  = align === 'right';
  const isCenter = align === 'center';
  // row-reverse: icon пен мәтін орны ауысады (icon оң жақта тұрады),
  // бірақ мәтіннің ӨЗІ дұрыс солдан-оңға оқылады — тек орналасуы айналады.
  const flexDir   = isRight ? 'row-reverse' : 'row';
  const itemAlign = isCenter ? 'center' : 'flex-start';
  const textAlign = isCenter ? 'center' : (isRight ? 'right' : 'left');
  const justify    = isCenter ? 'justify-content:center;' : '';

  const items = slide.bullets.map(function(b) {
    return '<li style="display:flex;flex-direction:' + flexDir + ';align-items:' + itemAlign + ';' + justify + 'gap:12px;margin-bottom:14px;"><span style="color:' + accent + ';margin-top:3px;flex-shrink:0;font-size:13px;">▸</span><span style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:18px;line-height:1.55;color:' + palette.text + ';font-weight:400;text-align:' + textAlign + ';">' + b + '</span></li>';
  }).join('');
  if (grid) {
    const gridItems = slide.bullets.map(function(b) {
      return '<div style="display:flex;flex-direction:' + flexDir + ';align-items:' + itemAlign + ';' + justify + 'gap:10px;"><div style="width:7px;height:7px;border-radius:50%;background:' + accent + ';flex-shrink:0;margin-top:5px;"></div><span style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:17px;line-height:1.55;color:' + palette.text + ';font-weight:400;text-align:' + textAlign + ';">' + b + '</span></div>';
    }).join('');
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 40px;">' + gridItems + '</div>';
  }
  return '<ul style="list-style:none;margin:0;padding:0;">' + items + '</ul>';
}
function renderStats(slide, palette, accent) {
  if (!slide.stats || !slide.stats.length) return '';
  const count = slide.stats.length;
  const useGrid = count >= 4;
  const cardCount = slide.stats.length;
  const cards = slide.stats.map(function(s) {
    const padding = useGrid ? '16px 18px' : '22px 28px';
    const valueStr = String(s.value || '');

    // Санның ұзындығына ЖӘНЕ карточка санына қарай font-size динамикалық есептеледі.
    // Мысалы "12 мм сынап бағ." секілді ұзын мән 5-карточкалы қатарда кесіліп қалмас үшін
    // ұзындығы 6 таңбадан асса — кішірейтеміз, 10 таңбадан асса — тағы да кішірейтеміз.
    let fontSize = useGrid ? 32 : 38;
    if (cardCount >= 4) fontSize -= 4;           // тар карточка — алдын ала кішірек
    if (valueStr.length > 6)  fontSize -= 4;
    if (valueStr.length > 10) fontSize -= 4;
    fontSize = Math.max(fontSize, 18);            // ешқашан 18px-тен кіші болмайды

    // backdrop-filter — фонда сурет тұрса да карточка оқылатындай ажыратады.
    return '<div style="background:' + palette.surface + ';backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid ' + accent + '33;border-radius:14px;padding:' + padding + ';text-align:center;flex:1;min-width:0;overflow:hidden;"><div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:' + fontSize + 'px;font-weight:700;color:' + accent + ';line-height:1.1;margin-bottom:8px;overflow-wrap:break-word;word-break:break-word;">' + valueStr + '</div><div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:' + palette.muted + ';word-break:break-word;line-height:1.4;">' + s.label + '</div></div>';
  }).join('');
  if (useGrid) {
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;width:100%;">' + cards + '</div>';
  }
  return '<div style="display:flex;gap:24px;width:100%;">' + cards + '</div>';
}

function renderElement(el, slide, palette, accent, layout, align) {
  switch (el) {
    case 'eyebrow':    return renderEyebrow(slide, accent);
    case 'title':      return renderTitle(slide, palette, layout === 'cover' ? '58px' : '38px');
    case 'subtitle':   return renderSubtitle(slide, palette);
    case 'divider':    return renderDivider(accent);
    case 'body':       return renderBody(slide, palette);
    case 'bullets':    return renderBullets(slide, palette, accent, layout === 'two_column_bullets', align);
    case 'stats':      return renderStats(slide, palette, accent);
    case 'quote_mark': return renderQuoteMark(accent);
    default:           return '';
  }
}

// ─── ЖАҢА "HERO" LAYOUT-ТАР ────────────────────────────────────────────────
// Мақсаты: қазіргі "eyebrow+title+divider+body/bullets" формуласынан толық
// бөлек, драмалық, доминантты композиция. Екеуі де buildSlideHTML-дің ЕҢ
// БАСЫНДА, бар imagePlacement/backdrop/sanitize логикасына жетпей, ерте
// return арқылы шақырылады — сондықтан бар layout түрлерінің коды бұларға
// тәуелді емес және керісінше.
//
// ҚАУІПСІЗДІК ШАРТЫ (buildSlideHTML-де тексеріледі, мұнда емес): бұл екі
// функция да тек мазмұны нақты сол форматқа сай болған кезде ғана
// шақырылады — сай болмаса buildSlideHTML оларды шақырмай, қалыпты жолмен
// (fallback ретінде) жалғастырады. Бұл функциялардың өзі мазмұн туралы
// болжам жасамайды, тек берілгенді рендерлейді.

function renderBigStatHero(slide, mood) {
  const palette = MOOD[mood] || MOOD.dark;
  const accent  = (slide.composition && slide.composition.accentColor) || '#d4a843';
  const stat    = slide.stats[0];
  const valueStr = String(stat.value || '');

  // Сан ұзындығына қарай өлшемді бейімдеу — "80%" мен "1,000,000" бірдей
  // vizual салмақ бермеуі керек, бірақ екеуі де экраннан шықпауы керек.
  let fontSize = 200;
  if (valueStr.length > 4) fontSize = 160;
  if (valueStr.length > 7) fontSize = 120;
  if (valueStr.length > 11) fontSize = 90;

  const eyebrowHTML = slide.title
    ? '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:13px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:' + accent + ';margin-bottom:28px;opacity:0.85;">' + slide.title + '</div>'
    : '';
  const subtitleHTML = slide.subtitle
    ? '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:20px;font-weight:400;line-height:1.5;color:' + palette.muted + ';margin-top:28px;max-width:720px;">' + slide.subtitle + '</div>'
    : '';

  const bgLayer = '<div style="position:absolute;inset:0;z-index:0;background:radial-gradient(circle at 50% 40%,' + accent + '2a 0,transparent 45%),linear-gradient(135deg,' + palette.bg + ',#101820);"></div>';

  const content =
    '<div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:64px;">'
    + eyebrowHTML
    + '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:' + fontSize + 'px;font-weight:800;line-height:1;color:' + accent + ';letter-spacing:-2px;">' + valueStr + '</div>'
    + '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:22px;font-weight:600;letter-spacing:1px;color:' + palette.text + ';margin-top:20px;">' + (stat.label || '') + '</div>'
    + subtitleHTML
    + '</div>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:1280px;height:720px;overflow:hidden;}.slide{position:relative;width:1280px;height:720px;background:' + palette.bg + ';font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;}</style></head><body><div class="slide">'
    + bgLayer + content
    + '<img src="' + LOGO_WHITE + '" style="position:absolute;bottom:24px;right:32px;height:36px;opacity:0.85;z-index:10;object-fit:contain;" />'
    + '</div></body></html>';
}

function renderQuoteHero(slide, mood) {
  const palette = MOOD[mood] || MOOD.dark;
  const accent  = (slide.composition && slide.composition.accentColor) || '#d4a843';
  // subtitle-ды "цитата" мәтіні ретінде қолданамыз — SLIDE_JSON_SHAPE-ті
  // өзгертпей, бар өрістен пайдалану үшін. title — авторы/белгісі (eyebrow орнында).
  const quoteText = slide.subtitle || slide.body || slide.title || '';
  const attribution = slide.title && slide.subtitle ? slide.title : '';

  const bgLayer = '<div style="position:absolute;inset:0;z-index:0;background:radial-gradient(circle at 20% 80%,' + accent + '22 0,transparent 40%),linear-gradient(135deg,' + palette.bg + ',#101820);"></div>';

  const attrHTML = attribution
    ? '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:16px;font-weight:600;letter-spacing:1px;color:' + accent + ';margin-top:32px;">— ' + attribution + '</div>'
    : '';

  const content =
    '<div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:96px 140px;">'
    + '<div style="font-family:Georgia,serif;font-size:130px;line-height:0.6;color:' + accent + ';opacity:0.5;margin-bottom:12px;">"</div>'
    + '<div style="font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;font-size:40px;font-weight:600;line-height:1.35;color:' + palette.text + ';letter-spacing:-0.5px;">' + quoteText + '</div>'
    + attrHTML
    + '</div>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:1280px;height:720px;overflow:hidden;}.slide{position:relative;width:1280px;height:720px;background:' + palette.bg + ';font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;}</style></head><body><div class="slide">'
    + bgLayer + content
    + '<img src="' + LOGO_WHITE + '" style="position:absolute;bottom:24px;right:32px;height:36px;opacity:0.85;z-index:10;object-fit:contain;" />'
    + '</div></body></html>';
}

function renderDecor(d, accent, palette) {
  if (d === 'accent_line_left')  return '<div style="position:absolute;left:0;top:50%;transform:translateY(-50%);width:4px;height:200px;border-radius:2px;z-index:3;background:linear-gradient(180deg,transparent,' + accent + ',transparent);"></div>';
  if (d === 'accent_line_right') return '<div style="position:absolute;right:0;top:50%;transform:translateY(-50%);width:4px;height:200px;border-radius:2px;z-index:3;background:linear-gradient(180deg,transparent,' + accent + ',transparent);"></div>';
  if (d === 'corner_circle')     return '<div style="position:absolute;bottom:40px;right:72px;width:110px;height:110px;border:1px solid ' + accent + '44;border-radius:50%;z-index:3;"></div>';
  if (d === 'bottom_rule')       return '<div style="position:absolute;bottom:40px;left:50%;transform:translateX(-50%);width:72px;height:2px;background:' + palette.muted + ';z-index:3;opacity:0.4;"></div>';
  if (d === 'grid_dots') {
    const svg = '<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><circle cx=\'2\' cy=\'2\' r=\'1.2\' fill=\'' + accent + '\' opacity=\'0.15\'/></svg>';
    const enc = Buffer.from(svg).toString('base64');
    return '<div style="position:absolute;inset:0;z-index:1;background-image:url(\'data:image/svg+xml;base64,' + enc + '\');background-size:24px 24px;pointer-events:none;"></div>';
  }
  return '';
}

// Әр imageType үшін QIYYLYSPAUY тиіс textPosition-дар тізімі.
// Position осы тізімде болса — суретпен қиылысады, қауіпсіз позицияға ауыстырамыз.
const UNSAFE_POSITIONS = {
  right_half:    ['center', 'center_right', 'top_center', 'bottom_center', 'right_column'],
  left_half:     ['center', 'center_left',  'top_center', 'bottom_center', 'left_column'],
  top_strip:     ['top_left', 'top_center', 'center', 'center_left', 'center_right'],
  bottom_strip:  ['bottom_left', 'bottom_center', 'center', 'center_left', 'center_right'],
  // corner_accent: сурет оң ТӨМЕНГІ бұрышта (bottom:0;right:0;width:38%;height:55%).
  // "center" секілді кең позициялар (max-width:900px) сол аймаққа кіріп кетеді —
  // сондықтан center/center_right/bottom_center/bottom_right де осында қауіпсіз емес.
  corner_accent: ['center', 'center_right', 'bottom_center', 'bottom_right', 'top_center'],
};

// Position ауыстырылғанда неге ауысатынын анықтайтын fallback картасы
const POSITION_FALLBACK = {
  right_half:    'center_left',
  left_half:     'center_right',
  top_strip:     'bottom_left',
  bottom_strip:  'top_left',
  // corner_accent — сурет оң төменде, сондықтан мәтінді жоғарғы сол жаққа шоғырландыру қауіпсіз
  corner_accent: 'top_left',
};

// Мәтін позициясы бойынша қай градиент бағыты қауіпсіз екенін анықтайды.
// Мысалы textPos "top_center" болса, мәтін ЖОҒАРЫДА тұр — оны қараңғылау
// үшін dark_gradient_bottom (төменнен жоғары қараңғылайтын) ЕМЕС,
// dark_gradient_top (керісінше) керек. Бағыты сәйкес келмесе, мәтін
// ашық суретпен тікелей қиылысады — дәл байқалған баг осы еді.
function overlayForTextPosition(textPos) {
  if (textPos === 'top_left' || textPos === 'top_center' || textPos === 'top_right') return 'dark_gradient_top';
  if (textPos === 'bottom_left' || textPos === 'bottom_center' || textPos === 'bottom_right') return 'dark_gradient_bottom';
  return 'dark_full'; // center/center_left/center_right — мәтін ортада, толық overlay ең сенімдісі
}

// Overlay мәндерінің біразы (мысалы color_wash — небары ~13% қараңғылық,
// немесе light_full қараңғы mood-та) мәтінге ЖЕТКІЛІКСІЗ контраст береді.
// Модель "overlay бар" деп жауап бергенімен, ол іс жүзінде дерлік
// мөлдір болуы мүмкін — сол себепті нақты байқалған "тек cover дұрыс,
// қалғаны жалаң" багы шықты: тек overlayType==='none' тексерілгендіктен,
// "color_wash" секілді бар-бірақ-әлсіз мәндер өзгертілместен өтіп кеткен.
const WEAK_OVERLAYS = ['none', 'color_wash'];

function sanitizeComposition(imageType, overlayType, img, textPos) {
  let safeOverlay = overlayType;

  // full_background-та overlay жоқ НЕМЕСЕ жеткіліксіз әлсіз болса —
  // textPos-қа сай қауіпсіз бағыт таңдаймыз.
  if (imageType === 'full_background' && WEAK_OVERLAYS.indexOf(overlayType) !== -1 && img) {
    safeOverlay = overlayForTextPosition(textPos);
  }

  if ((imageType === 'right_half' || imageType === 'left_half') && (overlayType === 'dark_full' || overlayType === 'light_full')) safeOverlay = 'none';

  // top_strip/bottom_strip кезінде де толық overlay керек емес — тек жиек fade жеткілікті
  if ((imageType === 'top_strip' || imageType === 'bottom_strip') && overlayType === 'dark_full') safeOverlay = 'none';

  return safeOverlay;
}

// top_strip/bottom_strip слайдтарда мәтін орналасатын аймақ (фон түсі) мен
// сурет-маска жиегінің түйісуінде жұқа градиент қажет — олай болмаса
// сурет пен фонның шекарасы қатаң сызық болып көрінеді.
function stripSeamCSS(imageType, palette) {
  if (imageType === 'top_strip') {
    return '<div style="position:absolute;top:0;left:0;right:0;height:38%;z-index:1;background:linear-gradient(180deg,transparent 60%,' + palette.bg + ' 100%);"></div>';
  }
  if (imageType === 'bottom_strip') {
    return '<div style="position:absolute;bottom:0;left:0;right:0;height:35%;z-index:1;background:linear-gradient(0deg,transparent 60%,' + palette.bg + ' 100%);"></div>';
  }
  return '';
}

// textPosition суретпен қиылысатын болса — қауіпсіз позицияға ауыстыру
function sanitizeTextPosition(imageType, textPos, img) {
  if (!img) return textPos; // сурет жоқ болса — қиылысу қаупі жоқ
  const unsafe = UNSAFE_POSITIONS[imageType];
  if (unsafe && unsafe.indexOf(textPos) !== -1) {
    return POSITION_FALLBACK[imageType] || textPos;
  }
  return textPos;
}

// right_half/left_half слайдтарда бос жақта SVG визуал шығару
function buildSplitFallbackSVG(accent, side, index) {
  const a  = accent || '#d4a843';
  const a2 = a + '55';
  const a3 = a + '22';
  const a4 = a + '11';
  const pos = side === 'right' ? 'right:0;' : 'left:0;';
  const v = index % 3;

  let svg = '';
  if (v === 0) {
    svg = '<svg width="580" height="720" viewBox="0 0 580 720" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<circle cx="290" cy="360" r="280" fill="' + a4 + '"/>'
      + '<circle cx="290" cy="360" r="200" stroke="' + a3 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="290" cy="360" r="130" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="290" cy="360" r="70"  stroke="' + a2 + '" stroke-width="1.5" fill="' + a3 + '"/>'
      + '<circle cx="290" cy="360" r="28"  fill="' + a + '" opacity="0.7"/>'
      + '<line x1="290" y1="360" x2="120" y2="180" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="290" y1="360" x2="460" y2="170" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="290" y1="360" x2="490" y2="420" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="290" y1="360" x2="380" y2="570" stroke="' + a2 + '" stroke-width="1"/>'
      + '<line x1="290" y1="360" x2="100" y2="520" stroke="' + a2 + '" stroke-width="1"/>'
      + '<circle cx="120" cy="180" r="10" fill="' + a + '" opacity="0.7"/>'
      + '<circle cx="460" cy="170" r="8"  fill="' + a + '" opacity="0.6"/>'
      + '<circle cx="490" cy="420" r="12" fill="' + a + '" opacity="0.8"/>'
      + '<circle cx="380" cy="570" r="9"  fill="' + a + '" opacity="0.65"/>'
      + '<circle cx="100" cy="520" r="11" fill="' + a + '" opacity="0.7"/>'
      + '<circle cx="120" cy="180" r="22" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '<circle cx="490" cy="420" r="26" stroke="' + a2 + '" stroke-width="1" fill="none"/>'
      + '</svg>';
  } else if (v === 1) {
    svg = '<svg width="580" height="720" viewBox="0 0 580 720" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<circle cx="290" cy="360" r="270" fill="' + a4 + '"/>'
      + '<polygon points="290,100 490,220 490,500 290,620 90,500 90,220" stroke="' + a2 + '" stroke-width="1.5" fill="' + a4 + '"/>'
      + '<polygon points="290,180 420,255 420,465 290,540 160,465 160,255" stroke="' + a3 + '" stroke-width="1" fill="' + a3 + '"/>'
      + '<polygon points="290,270 360,312 360,408 290,450 220,408 220,312" fill="' + a + '" opacity="0.4"/>'
      + '<circle cx="290" cy="100" r="6" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="490" cy="220" r="6" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="490" cy="500" r="6" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="290" cy="620" r="6" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="90"  cy="500" r="6" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="90"  cy="220" r="6" fill="' + a + '" opacity="0.9"/>'
      + '<circle cx="290" cy="360" r="30" fill="' + a + '" opacity="0.6"/>'
      + '<circle cx="290" cy="360" r="48" stroke="' + a2 + '" stroke-width="1.5" fill="none"/>'
      + '</svg>';
  } else {
    svg = '<svg width="580" height="720" viewBox="0 0 580 720" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<ellipse cx="290" cy="360" rx="250" ry="100" stroke="' + a2 + '" stroke-width="1" fill="none" transform="rotate(-20 290 360)"/>'
      + '<ellipse cx="290" cy="360" rx="250" ry="100" stroke="' + a2 + '" stroke-width="1" fill="none" transform="rotate(20 290 360)"/>'
      + '<ellipse cx="290" cy="360" rx="250" ry="100" stroke="' + a2 + '" stroke-width="1" fill="none" transform="rotate(80 290 360)"/>'
      + '<circle cx="290" cy="360" r="240" fill="' + a4 + '"/>'
      + '<circle cx="540" cy="360" r="9"  fill="' + a + '" opacity="0.8"/>'
      + '<circle cx="40"  cy="360" r="7"  fill="' + a + '" opacity="0.6"/>'
      + '<circle cx="420" cy="120" r="8"  fill="' + a + '" opacity="0.7"/>'
      + '<circle cx="160" cy="600" r="6"  fill="' + a + '" opacity="0.55"/>'
      + '<circle cx="420" cy="600" r="10" fill="' + a + '" opacity="0.75"/>'
      + '<circle cx="160" cy="120" r="7"  fill="' + a + '" opacity="0.6"/>'
      + '<circle cx="290" cy="360" r="45" fill="' + a + '" opacity="0.15"/>'
      + '<circle cx="290" cy="360" r="26" fill="' + a + '" opacity="0.8"/>'
      + '<circle cx="290" cy="360" r="62" stroke="' + a2 + '" stroke-width="1.5" fill="none"/>'
      + '<circle cx="290" cy="360" r="85" stroke="' + a3 + '" stroke-width="1" fill="none"/>'
      + '</svg>';
  }

  return '<div style="position:absolute;top:0;' + pos + 'width:52%;height:100%;z-index:1;display:flex;align-items:center;justify-content:center;overflow:hidden;">' + svg + '</div>';
}

function buildSlideHTML(slide, imageUrl) {
  const comp0 = slide.composition || {};

  // ─── ЖАҢА "HERO" LAYOUT-ТАР — ерте return ──────────────────────────────
  // Тек мазмұны нақты сай болғанда ғана осы жолмен кетеді (қауіпсіздік
  // шарттары төменде). Сай болмаса — ЕШБІР флаг қоймай, қалыпты
  // buildSlideHTML логикасына түседі (соңында fallback layout ретінде
  // жұмыс істейді, сурет/bullets/stats бармен бірге дұрыс рендерленеді).
  // Бұл екі жол бар композиция логикасының (imagePlacement, backdrop,
  // sanitize*, т.б.) ЕШҚАЙСЫСЫН қолданбайды және оларға әсер етпейді.
  if (comp0.layout === 'big_stat_hero') {
    const statCount0 = (slide.stats && slide.stats.length) || 0;
    const bulletCount0 = (slide.bullets && slide.bullets.length) || 0;
    // Дәл 1 stat, bullets жоқ, body жоқ болғанда ғана — "бір ғана драмалық
    // сан" идеясы бұзылмауы үшін. Басқа жағдайда бұл композиция бір статты
    // ерекшелеп, қалған мазмұнды (bullets/body) жасырып тастар еді.
    if (statCount0 === 1 && bulletCount0 === 0 && !slide.body) {
      console.log('[HTML] slide', slide.index, '| layout: big_stat_hero');
      return renderBigStatHero(slide, comp0.mood || 'dark');
    }
    console.warn('[HTML] slide', slide.index, '| big_stat_hero requested but content mismatch (stats:' + statCount0 + ', bullets:' + bulletCount0 + ', body:' + !!slide.body + ') — falling back to standard layout');
  }

  if (comp0.layout === 'quote_hero') {
    const statCount0 = (slide.stats && slide.stats.length) || 0;
    const bulletCount0 = (slide.bullets && slide.bullets.length) || 0;
    // Цитата стилі тек bullets/stats жоқ, дәл 1 сөйлемдік мазмұн
    // (subtitle НЕМЕСЕ body, екеуі бірге емес) болғанда ғана мағыналы.
    const quoteSource = slide.subtitle || slide.body || '';
    if (statCount0 === 0 && bulletCount0 === 0 && quoteSource && quoteSource.length <= 220) {
      console.log('[HTML] slide', slide.index, '| layout: quote_hero');
      return renderQuoteHero(slide, comp0.mood || 'dark');
    }
    console.warn('[HTML] slide', slide.index, '| quote_hero requested but content mismatch (stats:' + statCount0 + ', bullets:' + bulletCount0 + ', textLen:' + quoteSource.length + ') — falling back to standard layout');
  }

  const comp        = slide.composition || {};
  const rawImageType = comp.image       || 'none';
  const overlayType = comp.overlay      || 'none';
  const rawTextPos  = comp.textPosition || 'center_left';
  const layout      = comp.layout       || 'single_column';
  const mood        = comp.mood         || 'dark';
  const accent      = comp.accentColor  || '#d4a843';
  const elements    = comp.elements     || ['title'];
  const decorative  = comp.decorative   || [];
  const idx         = (slide.index || 1) - 1;

  // ДИАГНОСТИКА: mood DeepSeek-тен MOOD кестесінде жоқ мән ретінде келсе
  // (мыс. жазылу қатесі, бос жол, немесе үлкен әріппен "Dark"), MOOD.dark-қа
  // үнсіз ауысады — бірақ бұл жерде композицияның басқа өрістері (мыс.
  // sanitizeComposition) сол сәйкес келмейтін mood-пен есептелген болуы
  // мүмкін, нәтижесінде мәтін мен фон контрасты жеткіліксіз болатын
  // сирек баг байқалды (7-слайд, mood мәні консольге шықпағандықтан
  // нақты қандай екенін растай алмадық). Келесі жолы қайталанса — осы лог
  // дәл композицияны көрсетеді.
  if (!MOOD[mood]) {
    console.warn(`[HTML] WARNING: unrecognized mood "${mood}" for slide ${slide.index} — falling back to 'dark'. Full composition:`, JSON.stringify(comp));
  }
  const palette  = MOOD[mood] || MOOD.dark;
  const hasStats = slide.stats   && slide.stats.length   > 0;
  const img      = imageUrl || '';

  // Kepildik: "corner_accent" тек 38%x55% кіші декоративті сурет —
  // көп мазмұн (title+subtitle+3+ bullets секілді) болса, тік мәтін блогы
  // сол шағын аймақтан асып, суреттің үстіне кіріп кетеді (нақты байқалған
  // баг). Prompt деңгейінде модельге ескерту берілді, бірақ ол әрдайым
  // орындала бермейді, сондықтан мұнда да сақтандырамыз: мазмұн ауыр болса,
  // corner_accent автоматты full_background-қа ауысады — сурет үлкейеді,
  // мәтінге орын жеткілікті болады.
  const bulletCount   = (slide.bullets && slide.bullets.length) || 0;
  const hasSubtitle   = !!slide.subtitle;
  const hasBody       = !!slide.body;
  const isContentHeavy = bulletCount >= 3 || (hasSubtitle && hasBody) || (hasSubtitle && bulletCount >= 2);
  let imageType = (rawImageType === 'corner_accent' && isContentHeavy) ? 'full_background' : rawImageType;

  // Kepildik #2: right_half/left_half сурет контейнердің ені небары 48%
  // (~486px пайдалы кеңістік, padding алынған соң). 2+ stat карточка
  // (әрқайсысы кемінде ~150-180px, gap 24px) сол енге СЫЙМАЙДЫ — карточка
  // не сығылып мәтіні кесіледі, не контейнерден шығып суреттің үстіне
  // мінеді (нақты байқалған баг: "Экспериментті дәлелдер" слайды).
  // Сондықтан 2+ stat бар слайдта split-layout (right_half/left_half)
  // автоматты full_background-қа ауысады — толық ен статтарға жеткілікті
  // орын береді.
  const statCount = (slide.stats && slide.stats.length) || 0;
  const isSplitLayout = imageType === 'right_half' || imageType === 'left_half';
  if (isSplitLayout && statCount >= 2) {
    imageType = 'full_background';
  }

  // Stat cards бар слайдта сурет болса — толық қараңғы overlay,
  // әйтпесе карточка мен сурет бір-бірімен араласып, оқылмай қалады.
  const safeOverlay = hasStats && img ? 'dark_full' : sanitizeComposition(imageType, overlayType, img, rawTextPos);

  // Мәтін позициясы суретпен қиылысатын болса — автоматты қауіпсіз позицияға ауыстыру.
  // Мысалы: full_background емес, top_strip кезінде "top_left" сұралса,
  // текст сурет үстіне мінбей, суреттен төмен орналасады.
  const textPos = sanitizeTextPosition(imageType, rawTextPos, img);

  const { wrapperCSS } = imagePlacement(imageType, img);
  const hasOverlay = img && safeOverlay !== 'none';
  const textCSS    = textPositionCSS(textPos, imageType);

  // Кепілдендірілген контраст, ЕКІ ҚАБАТ:
  // 1) text-shadow — жеңіл, әрдайым қосылады, әдеттегі суретте жеткілікті.
  // 2) backdrop панелі — ТОЛЫҚ жартылай мөлдір фон, мәтін блогының өзіне
  //    (сыртқы overlay-ге емес) тікелей қосылады. Бұл КЕПІЛДІ жұмыс істейді,
  //    себебі сурет қаншалықты "шулы" болса да (мыс: Unsplash-тан "periodic
  //    table" суреті — өз мәтіні, сандары бар күрделі фото — нақты байқалған
  //    "екі текст қабаты араласып кеткен" багы), backdrop оның үстін ЖАУЫП
  //    тастайды, ал text-shadow мұндай жағдайда жеткіліксіз (тек 1-3px контур).
  //    Padding қосамыз, сонда backdrop мәтіннен сәл үлкенірек болып, "карточка"
  //    секілді көрінеді — дизайнды бұзбайды, керісінше құрылымдық көрінеді.
  const needsTextShadow = !!img;
  const textShadowCSS = needsTextShadow
    ? (palette.text === '#1a1a1a'
        // light-mood мәтін қара болғанда — ашық сурет үстінде ақ "гало" контур
        ? 'text-shadow:0 1px 3px rgba(255,255,255,0.9),0 0 12px rgba(255,255,255,0.5);'
        // қалған барлық mood-та мәтін ашық түсті — қараңғы гало контур
        : 'text-shadow:0 1px 3px rgba(0,0,0,0.85),0 0 16px rgba(0,0,0,0.5);')
    : '';

  // Backdrop СУРЕТ бар және мәтін оның үстінде тұратын layout түрлерінде
  // ӘРДАЙЫМ қосылады — overlay түріне ТӘУЕЛСІЗ. Бастапқыда "safeOverlay !==
  // dark_full" шарты болған, бірақ бұл ҚАТЕ еді: dark_full өзі небары 62%
  // қараңғылық береді, ал "шулы" сурет (мыс: Unsplash-тан "periodic table" —
  // өз мәтіні, сандары бар фото) үстінде bullets/subtitle секілді ұсақ
  // мәтін әлі де контраст жетіспей қалады (дәл байқалған баг). Backdrop —
  // ЕҢ СОҢҒЫ, ең сенімді қорғаныс қабаты, сондықтан overlay бар-жоғына
  // қарамастан қосылады.
  const BACKDROP_LAYOUTS = ['full_background', 'top_strip', 'bottom_strip', 'corner_accent'];
  const needsBackdrop = img && BACKDROP_LAYOUTS.indexOf(imageType) !== -1;
  const backdropCSS = needsBackdrop
    ? (palette.text === '#1a1a1a'
        ? 'background:rgba(255,255,255,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:16px;padding:28px 36px;margin:-28px -36px;'
        : 'background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:16px;padding:28px 36px;margin:-28px -36px;')
    : '';

  const hasRichContent = (slide.stats && slide.stats.length > 0) || (slide.bullets && slide.bullets.length > 0);
  const showFallback   = !img && !hasRichContent;

  // right_half / left_half + сурет жоқ → бос жаққа SVG визуал
  const isSplit = imageType === 'right_half' || imageType === 'left_half';
  const splitSide = imageType === 'right_half' ? 'right' : 'left';
  const splitFallbackSVG = !img && isSplit ? buildSplitFallbackSVG(accent, splitSide, idx) : '';

  const fallbackSVG = showFallback && !isSplit ? buildFallbackVisual(accent, mood, idx) : '';

  const bgLayer = wrapperCSS
    ? '<div style="' + wrapperCSS + '"></div>'
    : '<div style="position:absolute;inset:0;z-index:0;background:radial-gradient(circle at 80% 20%,' + accent + '22 0,transparent 32%),radial-gradient(circle at 15% 85%,' + accent + '18 0,transparent 35%),linear-gradient(135deg,' + palette.bg + ',#101820);"></div>'
      + '<div style="position:absolute;inset:0;z-index:0;opacity:.12;background-image:linear-gradient(' + accent + '33 1px,transparent 1px),linear-gradient(90deg,' + accent + '33 1px,transparent 1px);background-size:48px 48px;"></div>';

  // textPos-тан bullets/stats icon-мәтін бағытын анықтайтын align есептейміз.
  // *_right позициялары → 'right' (icon оң жақта), 'center' → 'center',
  // қалғандары (солдан басталатындар) → 'left' (әдепкі, өзгеріссіз).
  const contentAlign = (textPos === 'center_right' || textPos === 'right_column') ? 'right'
                      : (textPos === 'center') ? 'center'
                      : 'left';
  const contentHTML = elements.map(function(el) { return renderElement(el, slide, palette, accent, layout, contentAlign); }).join('\n');
  const decorHTML   = decorative.map(function(d) { return renderDecor(d, accent, palette); }).join('\n');
  const seamHTML    = img ? stripSeamCSS(imageType, palette) : '';

  console.log('[HTML] slide', slide.index, '| image:', img ? 'YES' : ('NO (fallback:' + showFallback + ')'), '| composition:', imageType + '/' + textPos + (rawTextPos !== textPos ? ' (auto-corrected from ' + rawTextPos + ')' : ''), '| mood:', mood, '| accent:', accent, '| elements:', elements.join(','));

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:1280px;height:720px;overflow:hidden;}.slide{position:relative;width:1280px;height:720px;background:' + palette.bg + ';font-family:Noto Sans CJK KR,DejaVu Sans,sans-serif;}</style></head><body><div class="slide">'
    + bgLayer
    + fallbackSVG
    + splitFallbackSVG
    + (hasOverlay ? '<div style="position:absolute;inset:0;z-index:1;' + overlayCSS(safeOverlay, accent) + '"></div>' : '')
    + seamHTML
    + decorHTML
    + '<div style="' + textCSS + textShadowCSS + backdropCSS + '">' + contentHTML + '</div>'
    + '<img src="' + LOGO_WHITE + '" style="position:absolute;bottom:24px;right:32px;height:36px;opacity:0.85;z-index:10;object-fit:contain;" />'
    + '</div></body></html>';
}

module.exports = { buildSlideHTML };
