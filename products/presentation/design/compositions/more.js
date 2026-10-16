'use strict';
/**
 * КОМПОЗИЦИЯЛАР, 2-топ: түсті жолақты мұқаба, стикерлер, орбита, баспалдақ, көмескі бағандар,
 * полароид-тізім, фото-жолақ, уақыт рельсі, тұжырым. Тіркеу — index.js-тің def()-і арқылы.
 */
module.exports = function register(def, K) {
  const { P, H, I, esc, t, tb, fs, disp, wrap, wrapB, MX, MT, MB, W, HH } = K;
  const onDark = (ink) => 'cx-on-dark" style="--cx-ink:' + ink;

  // ── Мұқаба: сол жақта түсті жолақ (қиғаш шетті), оң жақта фото толық биіктікте ──
  def({
    id: 'cover-band', kind: 'cover',
    fits: (a) => a.hasPhoto,
    render(ctx) {
      const a = ctx.a; const p = ctx.palette; const ink = p.accentInk;
      const { metaHtml } = H.coverParts(ctx);
      const bg = '<div class="plate plate-cover"></div>' +
        P.div(P.pos(700, 0, 1220, HH) + ';overflow:hidden', I.imgTag(a.photo, a.img, p, { focus: a.focus })) +
        P.panel(0, 0, 1040, HH, p.accent, 'clip-path:polygon(0 0,100% 0,84% 100%,0 100%)') +
        P.div(P.pos(56, 56, 790, HH - 112) + ';border:1.5px solid ' + P.mix(p.accent, ink, 0.35)) +
        (ctx.sys && ctx.sys.decor ? P.horn(MX, 140, 96, P.mix(p.accent, ink, 0.7)) : P.diamond(MX + 14, 170, 22, P.mix(p.accent, ink, 0.7)));
      const fg = '<div class="' + onDark(ink) + '">' +
        wrap(MX, 250, 660, H.titleH1(ctx, a.title, { role: 'display', width: 660, maxLines: 5, scale: [92, 80, 70, 62, 54] }) + H.lead(ctx, a.subtitle, 30, { maxw: 640 })) +
        wrapB(MX, 120, 660, metaHtml) + '</div>';
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
    },
  });

  // ── Ұғымдар: таспамен жапсырылған стикерлер (фоны сәл қисық, мәтіні тік) ──
  def({
    id: 'concepts-stickers', kind: 'concepts', systems: ['campus', 'aurora', 'journal', 'atelier', 'heritage', 'ledger', 'academy'],
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 24 && (m.detail || '').length <= 80),
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const gap = 48; const span = W - 2 * MX; const w = (span - gap * (n - 1)) / n; const h = n === 3 ? 470 : 430;
      const fills = [P.mix(p.bg, p.accent, 0.22), P.mix(p.bg, p.accent2 || p.accent, 0.3), P.mix(p.bg, '#ffffff', 0.7), P.mix(p.bg, p.accent, 0.12)];
      const rots = [-2.2, 1.6, -1.2, 2];
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.07), 11);
      let fg = wrap(MX, MT, 1300, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1300, maxLines: 2, scale: [80, 70, 62, 54, 48], hl: true }));
      sh.items.forEach((m, i) => {
        const x = MX + i * (w + gap); const y = 390 + (i % 2 ? 30 : 0);
        bg += P.div(P.pos(x, y, w, h) + ';background:' + fills[i % 4] + ';transform:rotate(' + rots[i % 4] + 'deg);box-shadow:0 22px 34px -22px rgba(0,0,0,.35)');
        bg += P.tape(x + w / 2 - 70, y - 20, 140, rots[(i + 1) % 4] * 2, 'rgba(255,255,255,.55)');
        bg += P.ghost(x, y + h - 190, H.num(ctx, i + 1), 160, P.mix(fills[i % 4], p.text, 0.16), { italic: true, w: w - 30 });
        fg += t('concept', x + 40, y + 52, w - 80,
          '<div style="' + disp + ';' + fs(n === 3 ? 54 : 46) + ';line-height:1.05;color:var(--text)">' + esc(m.label) + '</div>' +
          (m.detail ? '<div style="margin-top:16px;' + fs(n === 3 ? 30 : 27) + ';line-height:1.42;color:var(--text2)">' + esc(m.detail) + '</div>' : ''));
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Ұғымдар: орбита — ортада негізгі ұғым (визуал), айналасында бөліктері ──
  def({
    id: 'concepts-orbit', kind: 'concepts',
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 24 && (m.detail || '').length <= 70) && String(a.title).length <= 70,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const cx = 1250; const cy = 590; const rx = 360; const ry = 250; const bw = 330;
      const ang = n === 3 ? [-150, -30, 90] : [-135, -45, 45, 135];
      const v = P.visualFor(a.title + ' ' + (a.subtitle || ''), ctx.sys, p, env.used, a.index + 21, { color: p.accentInk, stroke: 0.9 });
      let lines = '';
      const pts = ang.map((d) => { const r = (d * Math.PI) / 180; return { x: cx + Math.cos(r) * rx, y: cy + Math.sin(r) * ry, up: Math.sin(r) < 0 }; });
      pts.forEach((q) => { lines += '<line x1="' + cx + '" y1="' + cy + '" x2="' + q.x.toFixed(0) + '" y2="' + q.y.toFixed(0) + '"/>'; });
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06)) +
        P.div('inset:0', '<svg viewBox="0 0 1920 1080" width="100%" height="100%"><ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' + P.mix(p.bg, p.text, 0.2) + '" stroke-width="2" stroke-dasharray="3 10" stroke-linecap="round"/><g stroke="' + P.mix(p.bg, p.accent, 0.5) + '" stroke-width="2">' + lines + '</g></svg>') +
        P.div(P.pos(cx - 150, cy - 150, 300, 300) + ';border-radius:50%;background:' + p.accent + ';box-shadow:0 0 0 18px ' + P.mix(p.bg, p.accent, 0.18)) +
        (v ? P.visualImg(v, cx - 95, cy - 95, 190, 190, { dark: true }) : P.div(P.pos(cx - 150, cy - 150, 300, 300) + ';border-radius:50%;border:2px solid ' + P.mix(p.accent, p.accentInk, 0.4) + ';transform:scale(.78)'));
      pts.forEach((q) => { bg += P.diamond(q.x, q.y, 22, p.accent, p.bg); });
      let fg = '<div style="position:absolute;left:' + MX + 'px;top:' + MT + 'px;bottom:' + MB + 'px;width:520px;display:flex;flex-direction:column;justify-content:center">' +
        H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 520, maxLines: 5, scale: [72, 64, 56, 50, 44], hl: true }) + H.lead(ctx, a.subtitle, 28, { maxw: 500 }) + '</div>';
      sh.items.forEach((m, i) => {
        const q = pts[i]; const inner = '<div style="' + disp + ';' + fs(40) + ';line-height:1.08;color:var(--text)">' + esc(m.label) + '</div>' +
          (m.detail ? '<div style="margin-top:8px;' + fs(24) + ';line-height:1.38;color:var(--text2)">' + esc(m.detail) + '</div>' : '');
        fg += q.up ? tb('concept', q.x - bw / 2, HH - q.y + 30, bw, inner, 'text-align:center') : t('concept', q.x - bw / 2, q.y + 30, bw, inner, 'text-align:center');
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Ұғымдар: баспалдақ — кезеңдер биіктей береді (даму, деңгейлер) ──
  def({
    id: 'concepts-ladder', kind: 'concepts',
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 26 && (m.detail || '').length <= 80),
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const gap = 20; const span = W - 2 * MX; const w = (span - gap * (n - 1)) / n;
      const hs = n === 3 ? [340, 460, 580] : [310, 400, 490, 580];
      const base = HH - MB - 6; // бет нөмірінің (folio) үстінде аяқталады
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06));
      let fg = wrap(MX, MT, 1100, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1060, maxLines: 2, scale: [80, 70, 62, 54, 48], hl: true }));
      sh.items.forEach((m, i) => {
        const x = MX + i * (w + gap); const h = hs[i]; const y = base - h;
        const k = (i + 1) / n; const fill = i === n - 1 ? p.accent : P.mix(p.bg, p.accent, 0.1 + 0.22 * k);
        const ink = i === n - 1 ? p.accentInk : 'var(--text)';
        bg += P.panel(x, y, w, h, fill, 'border-radius:22px');
        bg += P.ghost(x, y + h - 170, H.num(ctx, i + 1), 150, i === n - 1 ? P.mix(p.accent, p.accentInk, 0.3) : P.mix(fill, p.text, 0.14), { italic: true, w: w - 26 });
        fg += t('concept', x + 34, y + 34, w - 68,
          '<div style="' + disp + ';' + fs(n === 3 ? 48 : 42) + ';line-height:1.06;color:' + ink + '">' + esc(m.label) + '</div>' +
          (m.detail ? '<div style="margin-top:12px;' + fs(n === 3 ? 28 : 25) + ';line-height:1.4;color:' + ink + ';opacity:.85">' + esc(m.detail) + '</div>' : ''));
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Ұғымдар: көмескі сандар үстіндегі бағандар (журнал беті) ──
  def({
    id: 'concepts-ghostcols', kind: 'concepts',
    fits: (a, sh) => sh.items.length >= 2 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 30 && (m.detail || '').length <= 110),
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const gap = 64; const span = W - 2 * MX; const w = (span - gap * (n - 1)) / n;
      let bg = '<div class="plate"></div>' + P.panel(0, 0, W, 300, P.mix(p.bg, p.text, 0.05));
      let fg = wrap(MX, MT, 1400, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1400, maxLines: 2, scale: [76, 68, 60, 52, 46], hl: true }));
      sh.items.forEach((m, i) => {
        const x = MX + i * (w + gap);
        bg += P.ghost(x - 10, 380, H.num(ctx, i + 1), 320, P.mix(p.bg, p.accent, 0.16), { weight: 700 });
        if (i) bg += P.panel(x - gap / 2, 420, 2, 520, P.mix(p.bg, p.text, 0.16));
        fg += t('concept', x, 640, w,
          '<div style="width:56px;height:5px;background:' + p.accent + ';margin-bottom:26px"></div>' +
          '<div style="' + disp + ';' + fs(n <= 3 ? 50 : 42) + ';line-height:1.06;color:var(--text)">' + esc(m.label) + '</div>' +
          (m.detail ? '<div style="margin-top:16px;' + fs(n <= 3 ? 29 : 26) + ';line-height:1.45;color:var(--text2)">' + esc(m.detail) + '</div>' : ''));
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Фото + тізім: полароид оң жақта, тізім сол жақта ──
  def({
    id: 'photo-polaroid', kind: 'photoList',
    fits: (a, sh) => a.hasPhoto && sh.items.length <= 4,
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette;
      const tw = 900; const n = sh.items.length;
      const bg = '<div class="plate"></div>' + P.panel(1120, 0, 800, HH, P.mix(p.bg, p.accent, 0.14)) + P.grain(P.mix(p.bg, p.text, 0.06), 11) +
        P.polaroid(1150, 190, 620, 660, I.imgTag(a.photo, a.img, p, { focus: a.focus }), { rot: 3, tapeColor: P.mix(p.bg, p.accent2 || p.accent, 0.6) });
      const rows = sh.items.map((m, i) => '<div data-role="row" style="display:flex;gap:26px;padding:20px 0;border-top:2px dashed ' + P.mix(p.bg, p.text, 0.18) + '">' +
        '<div style="flex:none;width:58px;height:58px;border-radius:50%;background:' + p.accent + ';color:' + p.accentInk + ';display:flex;align-items:center;justify-content:center;' + fs(24) + ';font-weight:700">' + (i + 1) + '</div>' +
        '<div><div style="' + disp + ';' + fs(n <= 3 ? 40 : 36) + ';line-height:1.1;color:var(--text)">' + esc(m.label) + '</div>' +
        (m.detail ? '<div style="margin-top:6px;' + fs(n <= 3 ? 26 : 24) + ';line-height:1.4;color:var(--text2)">' + esc(m.detail) + '</div>' : '') + '</div></div>').join('');
      const fg = '<div style="position:absolute;left:' + MX + 'px;top:' + MT + 'px;bottom:' + MB + 'px;width:' + tw + 'px;display:flex;flex-direction:column;justify-content:center">' +
        H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: tw, maxLines: 3, scale: [72, 64, 56, 50, 44], hl: true }) +
        H.lead(ctx, a.subtitle, 28, { maxw: tw }) + '<div style="margin-top:30px">' + rows + '</div></div>';
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Фото + тізім: жоғарыда фото-жолақ, оған тақырып карточкасы кіріп тұрады, астында бағандар ──
  def({
    id: 'photo-strip', kind: 'photoList',
    fits: (a, sh) => a.hasPhoto && sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 28 && (m.detail || '').length <= 80) && String(a.title).length <= 60,
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const gap = 48; const span = W - 2 * MX; const w = (span - gap * (n - 1)) / n;
      const bg = '<div class="plate"></div>' + P.div(P.pos(0, 0, W, 440) + ';overflow:hidden', I.imgTag(a.photo, a.img, p, { focus: a.focus })) +
        P.panel(MX - 40, 330, 1180, 200, p.bg, 'box-shadow:0 30px 50px -30px rgba(0,0,0,.4)') + P.panel(MX - 40, 330, 12, 200, p.accent);
      let fg = '<div style="position:absolute;left:' + MX + 'px;top:340px;width:1100px;height:180px;display:flex;flex-direction:column;justify-content:center">' +
        H.titleH1(ctx, a.title, { width: 1080, maxLines: 2, scale: [68, 60, 54, 48, 42], hl: true }) + '</div>';
      sh.items.forEach((m, i) => {
        const x = MX + i * (w + gap);
        fg += t('concept', x, 610, w,
          '<div style="' + disp + ';font-style:italic;' + fs(44) + ';line-height:1;color:' + p.accent + ';margin-bottom:14px">' + esc(H.num(ctx, i + 1)) + '</div>' +
          '<div style="' + disp + ';' + fs(n === 3 ? 44 : 38) + ';line-height:1.08;color:var(--text)">' + esc(m.label) + '</div>' +
          (m.detail ? '<div style="margin-top:12px;' + fs(n === 3 ? 27 : 25) + ';line-height:1.42;color:var(--text2)">' + esc(m.detail) + '</div>' : ''),
          'border-top:2px solid ' + P.mix(p.bg, p.text, 0.18) + ';padding-top:22px');
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Уақыт: рельс — ірі жылдар жоғарыда, оқиғалар астында, соңында гравюра/белгіше ──
  def({
    id: 'timeline-rail', kind: 'timeline',
    fits: (a, sh) => sh.items.every((m) => (m.label + (m.detail || '')).length <= 120),
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const span = W - 2 * MX - 120; const step = span / n; const ry = 640;
      const v = P.visualFor(a.title, ctx.sys, p, env.used, a.index + 31, { stroke: 0.8 });
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06)) + P.panel(0, ry - 2, W, 4, P.mix(p.bg, p.text, 0.2)) +
        P.panel(MX, ry - 2, (n - 0.5) * step, 4, p.accent) +
        (v ? P.visualImg(v, W - MX - 260, MT - 20, 260, 300, { opacity: 0.85 }) : '');
      let fg = wrap(MX, MT, 1200, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1150, maxLines: 2, scale: [80, 70, 62, 54, 48], hl: true }));
      sh.items.forEach((m, i) => {
        const x = MX + i * step;
        bg += P.div(P.pos(x - 2, ry - 18, 36, 36) + ';border-radius:50%;background:' + (i === n - 1 ? p.accent : p.bg) + ';border:4px solid ' + p.accent);
        fg += t('date', x, ry - 170, step - 30, esc(m.date), disp + ';' + fs(n <= 3 ? 120 : 100) + ';line-height:1;color:' + (i === n - 1 ? p.accent : 'var(--text)'));
        fg += t('concept', x, ry + 50, step - 40,
          (m.label ? '<div style="' + fs(22) + ';font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:' + p.accent + '">' + esc(m.label) + '</div>' : '') +
          (m.detail ? '<div style="margin-top:14px;' + fs(n <= 3 ? 34 : 30) + ';line-height:1.42;color:var(--text2)">' + esc(m.detail) + '</div>' : ''));
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ── Тұжырым: ірі мәтін + мағыналы ірі сурет арка ішінде ──
  def({
    id: 'statement-arch', kind: 'statement',
    fits: (a, sh) => sh.text.length <= 220,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette;
      const v = a.hasPhoto ? null : P.visualFor(a.title + ' ' + sh.text, ctx.sys, p, env.used, a.index + 41, { stroke: 0.8 });
      const inner = a.hasPhoto ? I.imgTag(a.photo, a.img, p, { focus: a.focus }) : (v ? P.visualImg(v, 70, 120, 380, 460) : '');
      const bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06)) +
        P.arch(1260, 150, 520, 790, inner, { fill: P.mix(p.bg, p.accent, 0.14), outline: p.accent, dx: -26, dy: 26 }) +
        (!a.hasPhoto && !v ? P.ghost(1260, 330, '“', 520, P.mix(p.bg, p.accent, 0.4), { w: 520 }) : '');
      const size = sh.text.length <= 90 ? 54 : sh.text.length <= 160 ? 44 : 38;
      const fg = '<div style="position:absolute;left:' + MX + 'px;top:' + MT + 'px;bottom:' + MB + 'px;width:980px;display:flex;flex-direction:column;justify-content:center">' +
        H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 980, maxLines: 3, scale: [88, 76, 68, 60, 52], hl: true }) +
        (sh.text ? '<div data-role="lead" style="margin-top:34px;padding-left:34px;border-left:4px solid ' + p.accent + ';' + fs(size) + ';line-height:1.32;color:var(--text2)">' + esc(sh.text) + '</div>' : '') + '</div>';
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });
};
