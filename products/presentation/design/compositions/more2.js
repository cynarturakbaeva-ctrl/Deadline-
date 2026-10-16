'use strict';
/**
 * КОМПОЗИЦИЯЛАР, 3-топ (дизайн-канвадан көшірілген макеттер кітапханасы):
 *   мұқаба: ірі мағыналы сурет / картуш / журнал;  салыстыру: орталық ось / екі блок;
 *   процесс: доға / шеврондар;  сан: ірі цифр;  сандар: плиткалар;  анықтама: сөздік беті;
 *   бөлім: түсті жолақ + ірі нөмір;  қорытынды: мөр;  ұзын тізім: жиегінде ескерту / көмескі нөмірлі қатарлар.
 * Барлық элемент left+width-пен орналасқан → айна нұсқасы дұрыс шағылысады (MIRROR_SAFE).
 */
module.exports = function register(def, K) {
  const { P, H, I, esc, t, tb, fs, disp, wrap, wrapB, MX, MT, MB, W, HH } = K;
  const col = (x, y, w, inner) => '<div style="position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(w) + 'px">' + inner + '</div>';
  const vBox = (x, y, w, h, inner) => '<div style="position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(w) + 'px;height:' + Math.round(h) + 'px;display:flex;flex-direction:column;justify-content:center">' + inner + '</div>';
  const item = (m, ls, ds, ink, ink2) => '<div style="' + disp + ';' + fs(ls) + ';line-height:1.08;color:' + (ink || 'var(--text)') + '">' + esc(m.label) + '</div>' +
    (m.detail ? '<div style="margin-top:10px;' + fs(ds) + ';line-height:1.42;color:' + (ink2 || 'var(--text2)') + '">' + esc(m.detail) + '</div>' : '');

  // ───────────── МҰҚАБАЛАР (фотосыз) ─────────────

  /** Тақырыпқа сай ІРІ сурет (шаңырақ, карта, тәж, белгіше…) оң жиектен шығып тұрады + түсті жиек сызығы */
  def({
    id: 'cover-bigvisual', kind: 'cover',
    fits: (a) => !a.hasPhoto,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette;
      const v = P.visualFor(ctx.deckTitle + ' ' + a.title + ' ' + (a.subtitle || ''), ctx.sys, p, env.used, a.index + 3, { stroke: 0.7 });
      if (!v) throw new Error('no visual');
      const { metaHtml } = H.coverParts(ctx);
      const bg = '<div class="plate plate-cover"></div>' + P.grain(P.mix(p.bg, p.text, 0.07)) +
        P.visualImg(v, 1040, -120, 1100, 1100, { opacity: v.kind === 'icon' ? 0.85 : 0.9 }) +
        P.panel(W - 22, 0, 22, HH, p.accent) + P.panel(MX, 150, 70, 3, p.accent);
      const fg = wrap(MX, 200, 960, H.kicker(ctx, H.sectionLabel(ctx)) +
        H.titleH1(ctx, a.title, { role: 'display', width: 960, maxLines: 4, scale: [112, 98, 86, 74, 64], hl: true }) +
        H.lead(ctx, a.subtitle, 32, { maxw: 820 })) + wrapB(MX, 110, 900, metaHtml);
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
    },
  });

  /** Картуш: ортада қос жиектемелі карточка, артында тақырыпқа сай сурет бозғылт фон болып тұрады */
  def({
    id: 'cover-cartouche', kind: 'cover',
    fits: (a) => String(a.title).length <= 90,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette;
      const v = a.hasPhoto ? null : P.visualFor(ctx.deckTitle + ' ' + a.title, ctx.sys, p, env.used, a.index + 9, { stroke: 0.6 });
      const back = a.hasPhoto
        ? P.div('inset:0;overflow:hidden;opacity:.9', I.imgTag(a.photo, a.img, p, { focus: a.focus })) + P.div('inset:0;background:' + P.mix(p.bg, p.text, 0.1) + 'b3')
        : (v ? P.visualImg(v, 0, 0, W, HH, { opacity: 0.18 }) : '') + P.grain(P.mix(p.bg, p.text, 0.1), 8);
      const { metaHtml } = H.coverParts(ctx);
      const cw = 1240; const cx0 = (W - cw) / 2;
      const bg = '<div class="plate plate-cover"></div>' + back +
        P.div(P.pos(cx0, 190, cw, 560) + ';background:' + p.bg + ';border:2px solid ' + P.mix(p.bg, p.text, 0.55) + ';outline:2px solid ' + P.mix(p.bg, p.text, 0.55) + ';outline-offset:10px;box-shadow:0 40px 80px -40px rgba(0,0,0,.45)') +
        P.panel(W / 2 - 110, 260, 220, 2, p.accent) + P.diamond(W / 2, 261, 16, p.accent, p.bg) +
        (a.hasPhoto ? P.panel(MX - 36, HH - 236, 1000, 160, p.bg + 'e8') : ''); // фото үстінде автор жолы оқылсын
      const fg = vBox(cx0 + 90, 300, cw - 180, 400, '<div style="text-align:center">' + H.kicker(ctx, H.sectionLabel(ctx)) +
        H.titleH1(ctx, a.title, { role: 'display', width: cw - 180, maxLines: 3, scale: [92, 80, 70, 62, 54], hl: true, style: 'text-align:center' }) +
        H.lead(ctx, a.subtitle, 30, { maxw: cw - 260, cls: 'cx-center' }) + '</div>') + wrapB(MX, 100, 900, metaHtml);
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
    },
  });

  /** Журнал: жоғарғы сызық, айдар мен жыл, ірі тақырып, оң жақта байланыс торы (IT) не шұғыла (басқа) */
  def({
    id: 'cover-magazine', kind: 'cover',
    fits: (a) => !a.hasPhoto,
    render(ctx) {
      const a = ctx.a; const p = ctx.palette; const it = /blueprint|ledger|mono|swiss/.test((ctx.sys && ctx.sys.id) || '');
      const { metaHtml } = H.coverParts(ctx);
      const r = P.rng(a.title.length + 5);
      let art = '';
      if (it) {
        const n = []; for (let i = 0; i < 7; i++) n.push([60 + r() * 600, 60 + r() * 600]);
        let lines = ''; n.forEach((q, i) => { const o = n[(i + 2) % n.length]; const o2 = n[(i + 3) % n.length]; lines += '<line x1="' + q[0].toFixed(0) + '" y1="' + q[1].toFixed(0) + '" x2="' + o[0].toFixed(0) + '" y2="' + o[1].toFixed(0) + '"/><line x1="' + q[0].toFixed(0) + '" y1="' + q[1].toFixed(0) + '" x2="' + o2[0].toFixed(0) + '" y2="' + o2[1].toFixed(0) + '"/>'; });
        const dots = n.map((q, i) => '<circle cx="' + q[0].toFixed(0) + '" cy="' + q[1].toFixed(0) + '" r="' + (i === 0 ? 34 : 13) + '" fill="' + (i === 0 ? p.accent : p.bg) + '" stroke="' + p.accent + '" stroke-width="4"/>').join('');
        art = P.div(P.pos(1140, 200, 680, 680), '<svg viewBox="0 0 720 720" width="100%" height="100%"><g stroke="' + P.mix(p.bg, p.accent, 0.55) + '" stroke-width="2">' + lines + '</g>' + dots + '</svg>');
      } else art = P.sunburst(1500, 560, 420, p.accent, { opacity: 0.4, rays: 36, from: 0, to: 360, inner: 0.3 }) + P.div(P.pos(1380, 440, 240, 240) + ';border-radius:50%;background:' + p.accent);
      const year = new Date().getFullYear();
      const bg = '<div class="plate plate-cover"></div>' + P.grain(P.mix(p.bg, p.text, 0.08)) + art +
        P.panel(MX, 150, W - 2 * MX, 3, p.text);
      const fg = t('kicker', MX, 104, 900, esc(String(H.sectionLabel(ctx) || '').slice(0, 60)), fs(20) + ';font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:' + p.accent) +
        t('meta', W - MX - 300, 104, 300, '№ 01 · ' + year, fs(20) + ';font-weight:700;letter-spacing:.2em;text-align:right;color:var(--text2)') +
        wrap(MX, 250, 1000, H.titleH1(ctx, a.title, { role: 'display', width: 1000, maxLines: 4, scale: [120, 104, 92, 80, 68], hl: true }) + H.lead(ctx, a.subtitle, 32, { maxw: 820 })) +
        wrapB(MX, 110, 900, metaHtml);
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
    },
  });

  // ───────────── САЛЫСТЫРУ ─────────────

  function side(ctx, x, w, head, sub, rows, align, v, ink, ink2, line) {
    return vBox(x, 230, w, HH - 230 - MB,
      (v ? '<div style="height:150px;margin-bottom:8px;display:flex;justify-content:' + (align === 'right' ? 'flex-end' : 'flex-start') + '"><img alt="" aria-hidden="true" src="' + v.uri + '" style="height:150px;width:180px;object-fit:contain;' + (v.kind === 'engraving' ? 'mix-blend-mode:multiply;filter:sepia(.55)' : '') + '"></div>' : '') +
      (sub ? t('label', 0, 0, w, esc(sub), 'position:static;' + fs(20) + ';font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:' + ink2 + ';text-align:' + align) : '') +
      t('title', 0, 0, w, esc(head), 'position:static;margin-top:10px;' + disp + ';' + fs(68) + ';line-height:1.04;color:' + ink + ';text-align:' + align) +
      '<div style="margin-top:30px">' + rows.map((r, k) => t('row', 0, 0, w, esc(r), 'position:static;padding:20px 0;' + (k ? 'border-top:1.5px solid ' + line + ';' : '') + fs(rows.length <= 3 ? 34 : 30) + ';line-height:1.36;color:' + ink + ';text-align:' + align)).join('') + '</div>');
  }
  def({
    id: 'compare-spine', kind: 'compare',
    fits: (a, sh) => sh.left.rows.length <= 4 && sh.right.rows.length <= 4,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const line = P.mix(p.bg, p.text, 0.18);
      const vs = P.visualsForAll([sh.left.head, sh.right.head], ctx.sys, p, env.used, a.index * 3, { stroke: 1.1 });
      const bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06)) + P.panel(W / 2 - 1, 230, 2, 760, line) +
        P.div(P.pos(W / 2 - 80, 520, 160, 160) + ';border-radius:50%;background:' + p.text + ';box-shadow:0 0 0 14px ' + p.bg) +
        P.div(P.pos(W / 2 - 80, 520, 160, 160) + ';display:flex;align-items:center;justify-content:center;font-family:var(--f-display);font-style:italic;font-size:56px;color:' + p.bg, 'vs');
      const fg = col(MX, MT, W - 2 * MX, '<div style="text-align:center">' + H.titleH1(ctx, a.title, { width: W - 2 * MX, maxLines: 1, scale: [64, 56, 50, 44], hl: true, style: 'text-align:center' }) + '</div>') +
        side(ctx, MX, 700, sh.left.head, sh.left.sub, sh.left.rows, 'right', vs[0], 'var(--text)', p.accent, line) +
        side(ctx, W - MX - 700, 700, sh.right.head, sh.right.sub, sh.right.rows, 'left', vs[1], 'var(--text)', P.mix(p.text, p.accent, 0.4), line);
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });
  def({
    id: 'compare-blocks', kind: 'compare',
    fits: (a, sh) => sh.left.rows.length <= 4 && sh.right.rows.length <= 4,
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const ink = p.accentInk;
      const bg = '<div class="plate"></div>' + P.panel(0, 0, W * 0.5 + 60, HH, p.accent, 'clip-path:polygon(0 0,100% 0,88% 100%,0 100%)') +
        P.div(P.pos(W / 2 - 62, 470, 124, 124) + ';border-radius:50%;background:' + p.bg + ';box-shadow:0 0 0 8px ' + p.accent2) +
        P.div(P.pos(W / 2 - 62, 470, 124, 124) + ';display:flex;align-items:center;justify-content:center;font-family:var(--f-display);font-style:italic;font-size:46px;color:' + p.text, 'vs');
      const fg = '<div class="cx-on-dark" style="--cx-ink:' + ink + '">' + col(MX, MT, 760, H.titleH1(ctx, a.title, { width: 740, maxLines: 2, scale: [56, 50, 44, 40] })) + '</div>' +
        side(ctx, MX, 720, sh.left.head, sh.left.sub, sh.left.rows, 'left', null, ink, ink, P.mix(p.accent, ink, 0.3)) +
        side(ctx, W / 2 + 140, W / 2 - 140 - MX, sh.right.head, sh.right.sub, sh.right.rows, 'left', null, 'var(--text)', p.accent, P.mix(p.bg, p.text, 0.16));
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ───────────── ПРОЦЕСС ─────────────

  def({
    id: 'process-arc', kind: 'process',
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 26 && (m.detail || '').length <= 70),
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const cx = W / 2; const cy = 960; const R = 610;
      const angs = n === 3 ? [160, 90, 20] : [162, 117, 63, 18];
      const pts = angs.map((d) => ({ x: cx + Math.cos((d * Math.PI) / 180) * R, y: cy - Math.sin((d * Math.PI) / 180) * R }));
      const track = P.mix(p.bg, p.text, 0.14);
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.05)) +
        P.div('inset:0', '<svg viewBox="0 0 1920 1080" width="100%" height="100%" fill="none"><path d="M' + (cx - R) + ' ' + cy + ' A' + R + ' ' + R + ' 0 0 1 ' + (cx + R) + ' ' + cy + '" stroke="' + track + '" stroke-width="56" stroke-linecap="round"/>' +
          '<path d="M' + (cx - R) + ' ' + cy + ' A' + R + ' ' + R + ' 0 0 1 ' + pts[n - 2].x.toFixed(0) + ' ' + pts[n - 2].y.toFixed(0) + '" stroke="' + p.accent + '" stroke-width="56" stroke-linecap="round"/></svg>');
      let fg = vBox(cx - 420, 470, 840, 240, '<div style="text-align:center">' + H.kicker(ctx, H.sectionLabel(ctx)) +
        H.titleH1(ctx, a.title, { width: 840, maxLines: 3, scale: [64, 56, 50, 44], hl: true, style: 'text-align:center' }) + '</div>');
      sh.items.forEach((m, i) => {
        const q = pts[i]; const done = i < n - 1;
        bg += P.div(P.pos(q.x - 44, q.y - 44, 88, 88) + ';border-radius:50%;background:' + (done ? p.bg : p.accent) + ';border:7px solid ' + (done ? p.accent : p.accent) + ';box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:34px;color:' + (done ? p.accent : p.accentInk), esc(H.num(ctx, i + 1)));
        const w = 400; const above = q.y < 600;
        // жоғарғы түйін — жазу үстінде; төменгі түйін — жазу доғаның ІШІНДЕ (сызықты кесіп өтпейді)
        if (above) fg += tb('concept', Math.max(MX, Math.min(W - MX - w, q.x - w / 2)), HH - q.y + 70, w, item(m, 40, 25), 'text-align:center');
        else fg += t('concept', q.x < cx ? q.x + 80 : q.x - 80 - w, q.y - 30, w, item(m, 40, 25), 'text-align:' + (q.x < cx ? 'left' : 'right'));
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });
  def({
    id: 'process-chevrons', kind: 'process',
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 5 && sh.items.every((m) => m.label.length <= 22 && (m.detail || '').length <= 70),
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const span = W - 2 * MX; const w = span / n; const y = 430; const h = 170;
      const vis = P.visualsForAll(sh.items.map((m) => m.label + ' ' + (m.detail || '')), ctx.sys, p, env.used, a.index * 5, (i) => ({ color: i === n - 1 ? p.accentInk : p.accent, stroke: 1.4 }));
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.05));
      let fg = wrap(MX, MT, 1300, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1300, maxLines: 2, scale: [76, 66, 58, 50, 44], hl: true }));
      sh.items.forEach((m, i) => {
        const x = MX + i * w; const last = i === n - 1;
        const fill = last ? p.accent : P.mix(p.bg, p.accent, 0.12 + 0.12 * (i / Math.max(1, n - 1)));
        const clip = i === 0 ? 'polygon(0 0,88% 0,100% 50%,88% 100%,0 100%)' : 'polygon(0 0,88% 0,100% 50%,88% 100%,0 100%,12% 50%)';
        bg += P.panel(x, y, w + 18, h, fill, 'clip-path:' + clip);
        if (vis[i]) bg += P.visualImg(vis[i], x + w * 0.2, y + 45, 80, 80, { dark: last });
        bg += P.ghost(x + (vis[i] ? w * 0.2 + 100 : w * 0.22), y + 40, H.num(ctx, i + 1), 72, last ? p.accentInk : p.accent, { weight: 800 });
        fg += t('concept', x + 10, y + h + 44, w - 30, item(m, n <= 4 ? 38 : 34, n <= 4 ? 25 : 23, last ? p.accent : 'var(--text)'));
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ───────────── САН / САНДАР ─────────────

  def({
    id: 'number-hero', kind: 'number',
    fits: (a, sh) => String(sh.stat.value).length <= 7,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const s = sh.stat;
      const v = P.visualFor(a.title + ' ' + (s.label || ''), ctx.sys, p, env.used, a.index + 13, { stroke: 0.8 });
      const val = String(s.value); const size = val.length <= 2 ? 460 : val.length <= 4 ? 340 : 250;
      const bg = '<div class="plate"></div>' + P.panel(0, 0, 900, HH, P.mix(p.bg, p.accent, 0.12)) + P.grain(P.mix(p.bg, p.text, 0.06)) +
        (v ? P.visualImg(v, 120, 160, 660, 660, { opacity: 0.35 }) : P.div(P.pos(150, 190, 600, 600) + ';border-radius:50%;border:2px solid ' + P.mix(p.bg, p.accent, 0.5)));
      const fg = vBox(MX, MT, 780, HH - MT - MB, t('number', 0, 0, 780, esc(val), 'position:static;text-align:center;' + disp + ';' + fs(size) + ';line-height:1;letter-spacing:-.04em;color:' + p.accent)) +
        vBox(1010, MT, W - 1010 - MX, HH - MT - MB, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: W - 1010 - MX, maxLines: 3, scale: [64, 56, 50, 44], hl: true }) +
          '<div style="width:80px;height:4px;background:' + p.accent + ';margin:28px 0"></div>' +
          t('lead', 0, 0, W - 1010 - MX, esc(s.label || a.subtitle || ''), 'position:static;' + fs(32) + ';line-height:1.45;color:var(--text2)') +
          (s.source ? t('source', 0, 0, 700, esc(s.source), 'position:static;margin-top:18px;' + fs(20) + ';letter-spacing:.08em;color:var(--text3)') : ''));
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });
  def({
    id: 'stats-tiles', kind: 'stats',
    fits: (a, sh) => sh.stats.length >= 2 && sh.stats.length <= 4 && sh.stats.every((s) => String(s.value).length <= 8 && String(s.label || '').length <= 70),
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.stats.length;
      const gap = 28; const span = W - 2 * MX; const w = (span - gap * (n - 1)) / n; const y = 500; const h = 420;
      let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.05));
      let fg = wrap(MX, MT, 1400, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1300, maxLines: 2, scale: [76, 66, 58, 50], hl: true }) + H.lead(ctx, a.subtitle, 28, { maxw: 1200 }));
      sh.stats.forEach((s, i) => {
        const x = MX + i * (w + gap); const hot = i === 0; const yy = y + (i % 2 ? 40 : 0);
        bg += P.panel(x, yy, w, h - (i % 2 ? 40 : 0), hot ? p.accent : P.mix(p.bg, '#ffffff', p.isLight ? 0.65 : 0.06), 'border-radius:28px');
        fg += t('stat', x + 40, yy + 40, w - 80, '<div style="' + disp + ';' + fs(String(s.value).length <= 4 ? 128 : 96) + ';line-height:1;letter-spacing:-.03em;color:' + (hot ? p.accentInk : p.accent) + '">' + esc(s.value) + '</div>' +
          '<div style="' + fs(30) + ';line-height:1.38;color:' + (hot ? p.accentInk : 'var(--text2)') + '">' + esc(s.label || '') + '</div>',
          'height:' + Math.round(h - (i % 2 ? 40 : 0) - 80) + 'px;display:flex;flex-direction:column;justify-content:space-between');
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ───────────── АНЫҚТАМА ─────────────

  def({
    id: 'definition-page', kind: 'statement',
    fits: (a, sh) => sh.text.length >= 30 && sh.text.length <= 240 && String(a.title).length <= 48 && /дегеніміз|ұғым|анықтама|түсінік|деген не|что такое|понятие|определение|definition|what is|термин/i.test(a.title + ' ' + sh.text.slice(0, 60)),
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette;
      const head = String(a.title).replace(/\s*(дегеніміз не|дегеніміз|деген не|ұғымы|анықтамасы|түсінігі)\s*\??$/i, '').replace(/^(что такое|what is)\s+/i, '').trim() || a.title;
      const v = P.visualFor(a.title + ' ' + sh.text, ctx.sys, p, env.used, a.index + 17, { stroke: 0.8 });
      const bg = '<div class="plate"></div>' + P.panel(0, 0, 560, HH, P.mix(p.bg, p.text, 0.07)) +
        (v ? P.visualImg(v, 90, 260, 380, 460) : P.ghost(60, 230, (head[0] || '').toUpperCase(), 520, P.mix(p.bg, p.accent, 0.35), { italic: true, w: 440 }));
      const fg = col(660, 190, W - 660 - MX,
        t('title', 0, 0, W - 660 - MX, esc(head), 'position:static;' + disp + ';' + fs(head.length <= 18 ? 120 : 88) + ';line-height:1;letter-spacing:-.02em;color:var(--text)') +
        '<div style="margin:30px 0 34px;height:2px;background:' + P.mix(p.bg, p.text, 0.2) + '"></div>' +
        '<div style="display:flex;gap:30px"><div style="flex:none;' + disp + ';' + fs(56) + ';line-height:1;color:' + p.accent + '">1.</div>' +
        t('lead', 0, 0, W - 660 - MX - 90, esc(sh.text), 'position:static;' + fs(sh.text.length <= 120 ? 42 : 36) + ';line-height:1.45;color:var(--text)') + '</div>');
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ───────────── БӨЛІМ ─────────────

  def({
    id: 'section-band', kind: 'section',
    fits: () => true,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const num = (ctx.plan && ctx.plan.section) || sh.n || a.index;
      const v = P.visualFor(a.title + ' ' + (a.subtitle || ''), ctx.sys, p, env.used, a.index + 19, { color: p.accentInk, stroke: 0.8 });
      const bg = '<div class="plate"></div>' + P.panel(0, 0, 780, HH, p.accent) +
        P.div(P.pos(0, 70, 780, 900) + ';display:flex;align-items:center;justify-content:center;font-family:var(--f-display);font-style:italic;font-size:760px;line-height:.9;color:' + P.mix(p.accent, p.accentInk, 0.18), esc(String(num))) +
        (v ? P.visualImg(v, 470, 640, 360, 360, { dark: true, opacity: 0.85 }) : '');
      const fg = vBox(900, MT, W - 900 - MX, HH - MT - MB, H.kicker(ctx, H.sectionLabel(ctx) || '') +
        H.titleH1(ctx, a.title, { role: 'display', width: W - 900 - MX, maxLines: 4, scale: [110, 96, 84, 72, 62], hl: true }) + H.lead(ctx, a.subtitle, 32, { maxw: W - 900 - MX }));
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ───────────── ҚОРЫТЫНДЫ ─────────────

  def({
    id: 'closing-seal', kind: 'closing',
    fits: (a, sh) => sh.items.length >= 2 && sh.items.length <= 4 && sh.items.every((m) => (m.label + ' ' + (m.detail || '')).length <= 120),
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette;
      const v = P.visualFor(ctx.deckTitle + ' ' + a.title, ctx.sys, p, env.used, a.index + 23, { color: p.accentInk, stroke: 0.9 });
      const bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.07)) + P.seal(1480, 520, 250, p.accent, p.accentInk) +
        (v ? P.visualImg(v, 1480 - 120, 520 - 120, 240, 240, { dark: true }) : P.ghost(1230, 370, '✓', 300, p.accentInk, { w: 500 }));
      const rows = sh.items.map((m) => '<div data-role="row" style="display:flex;gap:26px;align-items:baseline;padding:14px 0"><span style="flex:none;width:18px;height:18px;background:' + p.accent + ';transform:rotate(45deg)"></span><div style="' + fs(32) + ';line-height:1.42;color:var(--text)">' +
        (m.detail ? '<b style="font-weight:700">' + esc(m.label) + '</b> — ' + esc(m.detail) : esc(m.label)) + '</div></div>').join('');
      const fg = vBox(MX, MT, 1000, HH - MT - MB, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1000, maxLines: 3, scale: [80, 70, 62, 54], hl: true }) +
        H.lead(ctx, a.subtitle, 28, { maxw: 960 }) + '<div style="margin-top:30px">' + rows + '</div>');
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });

  // ───────────── ҰЗЫН ТІЗІМ ─────────────

  /** Негізгі тізім + жиегінде түсті панель: тақырыпқа сай сурет және слайдтың түйіні (subtitle) */
  def({
    id: 'list-margin', kind: 'list',
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 5 && !!a.subtitle && String(a.subtitle).length <= 150,
    render(ctx, sh, env) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length; const pw = 520;
      const v = P.visualFor(a.title + ' ' + a.subtitle, ctx.sys, p, env.used, a.index + 29, { color: p.accentInk, stroke: 0.9 });
      const bg = '<div class="plate"></div>' + P.panel(W - MX - pw + 40, MT - 20, pw, HH - MT - MB + 40, p.accent, 'border-radius:4px') +
        (v ? P.visualImg(v, W - MX - pw + 100, MT + 30, 220, 240, { dark: true }) : '');
      const tw = W - 2 * MX - pw - 40;
      const rows = sh.items.map((m, i) => '<div data-role="row" style="display:flex;gap:28px;padding:' + (n <= 3 ? 24 : 16) + 'px 0;border-top:2px solid ' + P.mix(p.bg, p.text, 0.15) + '">' +
        '<div style="flex:none;width:56px;' + disp + ';font-style:italic;' + fs(46) + ';line-height:1;color:' + p.accent + '">' + esc(H.num(ctx, i + 1)) + '</div><div>' + item(m, n <= 3 ? 38 : 33, n <= 3 ? 26 : 23) + '</div></div>').join('');
      const fg = vBox(MX, MT, tw, HH - MT - MB, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: tw, maxLines: 2, scale: [68, 60, 54, 48], hl: true }) + '<div style="margin-top:26px">' + rows + '</div>') +
        '<div class="cx-on-dark" style="--cx-ink:' + p.accentInk + '">' + tb('lead', W - MX - pw + 100, MB + 50, pw - 120, esc(a.subtitle), disp + ';' + fs(38) + ';line-height:1.25;color:' + p.accentInk) + '</div>';
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });
  /** Қатарлар: әр пункттің алдында ірі көмескі нөмір, жоғарыда тақырып жолағы */
  def({
    id: 'list-ghostrows', kind: 'list',
    fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 5,
    render(ctx, sh) {
      const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
      const y0 = 330; const rh = (HH - MB - y0) / n;
      let bg = '<div class="plate"></div>' + P.panel(0, 0, W, 280, P.mix(p.bg, p.text, 0.06)) + P.panel(MX, 278, 160, 5, p.accent);
      let fg = wrap(MX, MT, 1500, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1500, maxLines: 2, scale: [68, 60, 54, 48], hl: true }));
      sh.items.forEach((m, i) => {
        const y = y0 + i * rh;
        bg += P.ghost(MX - 6, y + rh / 2 - 70, H.num(ctx, i + 1), 140, P.mix(p.bg, p.accent, 0.22), { weight: 700, w: 230 });
        if (i) bg += P.panel(MX + 260, y, W - 2 * MX - 260, 2, P.mix(p.bg, p.text, 0.12));
        fg += t('row', MX + 290, y + 16, W - 2 * MX - 290, '<div style="display:flex;gap:40px;align-items:baseline"><div style="flex:none;width:520px;' + disp + ';' + fs(n <= 3 ? 40 : 34) + ';line-height:1.1;color:var(--text)">' + esc(m.label) + '</div>' +
          (m.detail ? '<div style="' + fs(n <= 3 ? 27 : 24) + ';line-height:1.42;color:var(--text2)">' + esc(m.detail) + '</div>' : '') + '</div>');
      });
      return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
    },
  });
};
