'use strict';
/**
 * SVG FIT — модель салған сызбадағы (visual.js, <img src="data:image/svg+xml">) жазу өз пішініне
 * (таблетка, шеңбер, қорап) сыймай шығып кетсе, қаріпті сол жазуға ғана кішірейтеді.
 *
 * Мысал: «Ортақ құндылықтар» деген екі жол жасыл таблеткадан асып кеткен (Абай/әл-Фараби слайды).
 * visual.js-тің inspectSvg-і тек холст шетін тексереді, пішіннің ішін емес — және ол өлшемей, болжайды.
 * Мұнда браузердің өзі өлшейді: SVG бөлек iframe-ге (беттің веб-қаріптерінсіз — <img> ішіндегідей) салынып,
 * әр <text>-тің нақты ені өзін қамтитын ең кіші пішіннің енімен салыстырылады.
 *
 * fitSvgLabels() — page.evaluate()-ке тұтас беріледі (өзіндік, тәуелсіз). Сурет src-і орнында ауыстырылады.
 */

/* eslint-disable no-var */
function fitSvgLabels() {
  var MIN_SCALE = 0.62; // одан кіші — оқылмайды: онда жазу сол күйі қалады (ұсақ әрі сыймаған жазудан жақсы)
  var PAD = 0.9;        // пішін енінің 90%-ы — шетке жабыспасын
  var imgs = [].filter.call(document.querySelectorAll('.figure img'), function (im) {
    return /^data:image\/svg\+xml/.test(im.getAttribute('src') || '');
  });
  if (!imgs.length) return Promise.resolve([]);
  var frame = document.createElement('iframe');
  frame.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:2000px;height:1400px;border:0;visibility:hidden');
  document.body.appendChild(frame);
  var doc = frame.contentDocument;
  doc.open(); doc.write('<!doctype html><html><body style="margin:0"></body></html>'); doc.close();

  function decode(src) {
    var i = src.indexOf(',');
    var head = src.slice(0, i); var data = src.slice(i + 1);
    if (/;base64/.test(head)) {
      var bin = atob(data); var bytes = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(data);
  }
  function encode(svg) {
    var bytes = new TextEncoder().encode(svg); var bin = '';
    for (var k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
    return 'data:image/svg+xml;base64,' + btoa(bin);
  }
  function fontPx(el) { return parseFloat(frame.contentWindow.getComputedStyle(el).fontSize) || 16; }

  var report = [];
  imgs.forEach(function (im, n) {
    try {
      doc.body.innerHTML = decode(im.getAttribute('src'));
      var svg = doc.body.querySelector('svg');
      if (!svg) return;
      var sr = svg.getBoundingClientRect();
      if (!sr.width || !sr.height) return;
      var shapes = [].filter.call(svg.querySelectorAll('rect,circle,ellipse,polygon,path'), function (s) {
        var r = s.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.width * r.height < sr.width * sr.height * 0.5; // фон/карточка емес
      }).map(function (s) {
        var r = s.getBoundingClientRect();
        var round = /circle|ellipse/i.test(s.tagName);
        return { r: r, w: r.width * (round ? 0.82 : 1), area: r.width * r.height };
      });
      var changed = 0;
      [].forEach.call(svg.querySelectorAll('text'), function (t) {
        var tr = t.getBoundingClientRect();
        if (!tr.width) return;
        var cx = tr.left + tr.width / 2; var cy = tr.top + tr.height / 2;
        var box = null;
        shapes.forEach(function (s) {
          if (cx < s.r.left || cx > s.r.right || cy < s.r.top || cy > s.r.bottom) return;
          if (!box || s.area < box.area) box = s;
        });
        var room = box ? box.w * PAD : sr.width * 0.98;
        if (tr.width <= room + 1) return;
        var k = room / tr.width;
        if (k < MIN_SCALE) return;
        // text-тің өзі және өз өлшемі бар tspan-дары бірдей кішірейеді (жол аралығы dy em-мен болса бірге қысылады)
        [t].concat([].slice.call(t.querySelectorAll('tspan'))).forEach(function (el) {
          if (el !== t && !el.getAttribute('font-size') && !/font-size/.test(el.getAttribute('style') || '')) return;
          el.style.fontSize = (fontPx(el) * k).toFixed(2) + 'px';
        });
        changed += 1;
      });
      if (changed) {
        im.setAttribute('src', encode(new XMLSerializer().serializeToString(svg)));
        report.push({ figure: n, labels: changed });
      }
    } catch (e) { report.push({ figure: n, error: String(e && e.message || e) }); }
  });
  frame.remove();
  return Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; })).then(function () { return report; });
}
/* eslint-enable no-var */

module.exports = { fitSvgLabels };
