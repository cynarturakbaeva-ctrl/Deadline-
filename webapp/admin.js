/* DeadLine — админ панель (тек ADMIN_CHAT_ID; сервер /api/admin/* әр сұранысты тексереді) */
(function () {
  'use strict';
  let ctx = null;            // { api, esc, showToast, haptic } — app.js береді
  const st = { view: 'overview', days: 14, userQ: '', userFilter: 'all', genFilter: 'all' };
  const $ = (s) => document.querySelector(s);

  const tz = { timeZone: 'Asia/Almaty' };
  const fmtDT = (ms) => (ms ? new Date(ms).toLocaleString('ru-RU', { ...tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtD = (day) => day.slice(8, 10) + '.' + day.slice(5, 7);
  const money = (n) => Math.round(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
  const stars = (r) => (r ? '★'.repeat(r) + '☆'.repeat(5 - r) : '');
  const e = (v) => ctx.esc(v == null ? '' : String(v));

  function init(c) {
    ctx = c;
    const btn = $('#adminTabBtn');
    if (!btn || btn.dataset.ready) return;
    btn.dataset.ready = '1';
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => render());
    document.querySelectorAll('#admNav .chip').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#admNav .chip').forEach((x) => x.classList.toggle('active', x === b));
      st.view = b.dataset.view; render();
    }));
    $('#admUserClose').addEventListener('click', () => $('#admUser').classList.add('hidden'));
    $('#admUser').addEventListener('click', (ev) => { if (ev.target.id === 'admUser') $('#admUser').classList.add('hidden'); });
    // Ботты ашқанда админге бірден панель (шаблон сілтемесінен келсе — жоқ)
    if (!/template/.test(location.hash)) btn.click();
  }

  async function render() {
    const box = $('#admView');
    box.innerHTML = '<p class="hint">Жүктелуде…</p>';
    try {
      if (st.view === 'overview') box.innerHTML = await viewOverview();
      else if (st.view === 'users') box.innerHTML = await viewUsers();
      else if (st.view === 'gens') box.innerHTML = await viewGens();
      else box.innerHTML = await viewPayments();
      bind(box);
    } catch (err) {
      box.innerHTML = `<p class="hint">Қате: ${e(err.message)}</p>`;
    }
  }

  // ── Шолу ────────────────────────────────────────────────────────────────
  function tile(label, value, sub) {
    return `<div class="adm-tile"><div class="adm-tile-v">${value}</div><div class="adm-tile-l">${label}</div>${sub ? `<div class="adm-tile-s">${sub}</div>` : ''}</div>`;
  }
  function periodTiles(p) {
    return tile('Жаңа адам', p.new) +
      tile('Жасатты', p.gens, p.free ? `тегін ${p.free}` : '') +
      tile('Табыс', money(p.revenue), p.payments ? `${p.payments} төлем` : '') +
      tile('Баға', p.rating != null ? p.rating + ' ★' : '—', p.ratings ? `${p.ratings} баға` : '') +
      tile('Mini App', p.app, p.start ? `/start ${p.start}` : '') +
      tile('Шығын (AI)', money(p.cost), p.failed ? `қате ${p.failed}` : '');
  }
  /** Бір қатар, бір түс: күндік бағаналар; әр баған үстінен түртсе — мәні (title) */
  function columns(series, field, title, fmt) {
    const W = 340; const H = 120; const n = series.length; const gap = 2; const bw = Math.max(4, (W - gap * (n - 1)) / n);
    const max = Math.max(1, ...series.map((d) => d[field] || 0));
    const hiIdx = series.reduce((k, d, i) => ((d[field] || 0) > (series[k][field] || 0) ? i : k), 0);
    const bars = series.map((d, i) => {
      const v = d[field] || 0; const h = v ? Math.max(3, (H - 18) * (v / max)) : 0; const x = i * (bw + gap);
      return `<g><title>${fmtD(d.day)}: ${fmt(v)}</title><rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="adm-bar${i === n - 1 ? ' last' : ''}"/>` +
        `<rect x="${x.toFixed(1)}" y="0" width="${(bw + gap).toFixed(1)}" height="${H}" fill="transparent"/></g>`;
    }).join('');
    const label = (i) => `<text x="${(i * (bw + gap) + bw / 2).toFixed(1)}" y="${(H - Math.max(3, (H - 18) * ((series[i][field] || 0) / max)) - 4).toFixed(1)}" text-anchor="middle" class="adm-val">${fmt(series[i][field] || 0)}</text>`;
    return `<div class="card compact adm-chart"><div class="adm-chart-t">${title}</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${e(title)}">${bars}<line x1="0" x2="${W}" y1="${H}" y2="${H}" class="adm-base"/>${max > 0 ? label(hiIdx) : ''}${hiIdx !== n - 1 ? label(n - 1) : ''}</svg>
      <div class="adm-axis"><span>${fmtD(series[0].day)}</span><span>${fmtD(series[n - 1].day)}</span></div></div>`;
  }
  async function viewOverview() {
    const o = await ctx.api(`/api/admin/overview?days=${st.days}`);
    const t = o.totals;
    const srcRows = o.sources.map((s) => `<tr><td>${e(s.source)}</td><td>${s.new}</td><td>${s.start}</td><td>${s.app}</td><td>${s.gen}</td><td>${s.paid}</td></tr>`).join('');
    const img = o.images && o.images.providers ? Object.entries(o.images.providers).map(([k, p]) =>
      `${e(k)}: ${p.calls} сұраныс${p.monthLeft != null ? ` · айына ${p.monthLeft}` : ''}${p.hourLeft != null ? ` · сағатына ≈${p.hourLeft}` : ''}${p.paused ? ' · ⏸' : ''}`).join('<br>') : '—';
    return `
      <div class="chips adm-days">${[7, 14, 30].map((d) => `<button type="button" class="chip${st.days === d ? ' active' : ''}" data-days="${d}">${d} күн</button>`).join('')}</div>
      ${o.lowRatings ? `<button type="button" class="adm-alert" data-goto-gens="low">⚠️ Соңғы 7 күнде ${o.lowRatings} төмен баға (★1–3) — қарау</button>` : ''}
      <div class="adm-h">Бүгін</div><div class="adm-grid">${periodTiles(o.today)}</div>
      <div class="adm-h">Кеше</div><div class="adm-grid">${periodTiles(o.yesterday)}</div>
      <div class="adm-h">Соңғы 7 күн</div><div class="adm-grid">${periodTiles(o.week)}</div>
      ${columns(o.series, 'gens', 'Күніне жасалған презентация', (v) => v)}
      ${columns(o.series, 'revenue', 'Күніне табыс', (v) => money(v))}
      ${columns(o.series, 'new', 'Күніне жаңа адам', (v) => v)}
      <div class="adm-h">Арналар (${o.days} күн): жаңа · /start · Mini App · жасатты · төледі</div>
      <div class="card compact adm-table-wrap"><table class="adm-table"><thead><tr><th>Арна</th><th>Жаңа</th><th>/start</th><th>App</th><th>Жас.</th><th>Төл.</th></tr></thead>
        <tbody>${srcRows || '<tr><td colspan="6">Әзірге дерек жоқ</td></tr>'}</tbody></table></div>
      <div class="adm-h">Барлығы</div>
      <div class="adm-grid">${tile('Клиент', t.users) + tile('Төлеген', t.paying) + tile('Тегін алған', t.freeUsed) + tile('Бұғаттаған', t.blocked) + tile('Қалған кредит', t.creditsLeft)}</div>
      <div class="adm-h">Суреттер (сервер қосылғаннан бері)</div><div class="card compact adm-small">${img}</div>
      <p class="hint">Табыс — авто расталған чектер + осы жаңартудан кейін қолмен расталғандар. Жасалым журналы осы жаңартудан бастап жиналады.</p>`;
  }

  // ── Клиенттер ───────────────────────────────────────────────────────────
  const USER_FILTERS = [['all', 'Барлығы'], ['active', 'Белсенді (7 күн)'], ['paying', 'Төлегендер'], ['free', 'Тегін ғана'], ['credits', 'Кредиті бар'], ['blocked', 'Бұғаттаған']];
  function userRow(u) {
    return `<button type="button" class="adm-row" data-user="${e(u.id)}">
      <div class="adm-row-top"><b>${e(u.name)}</b>${u.username ? ` <span class="adm-muted">@${e(u.username)}</span>` : ''}<span class="adm-right">${u.lastRating ? stars(u.lastRating) : ''}</span></div>
      <div class="adm-muted">${e(u.source)} · кредит ${u.credits} · сатып алған ${u.bought} · жасатқан ${u.gens}${u.paidSum ? ' · ' + money(u.paidSum) : ''}${u.freeUsed ? ' · тегін алған' : ''}${u.blocked ? ' · ⛔ бұғаттаған' : ''}</div>
      <div class="adm-muted">соңғы: ${fmtDT(u.lastAt || u.createdAt)} · 🆔 ${e(u.id)}</div></button>`;
  }
  async function viewUsers() {
    const r = await ctx.api(`/api/admin/users?q=${encodeURIComponent(st.userQ)}&filter=${st.userFilter}&limit=100`);
    return `<input type="search" id="admUserQ" class="adm-search" placeholder="Іздеу: аты, @username немесе ID" value="${e(st.userQ)}" />
      <div class="chips wrap">${USER_FILTERS.map(([k, l]) => `<button type="button" class="chip${st.userFilter === k ? ' active' : ''}" data-ufilter="${k}">${l}</button>`).join('')}</div>
      <div class="adm-h">${r.total} клиент${r.total > r.items.length ? ` (алғашқы ${r.items.length})` : ''}</div>
      <div class="list">${r.items.map(userRow).join('') || '<p class="hint">Табылмады</p>'}</div>`;
  }

  // ── Жасалымдар ──────────────────────────────────────────────────────────
  const GEN_FILTERS = [['all', 'Барлығы'], ['low', '★1–3'], ['rated', 'Бағаланған'], ['failed', 'Қате'], ['free', 'Тегін'], ['paid', 'Ақылы'], ['template', 'Шаблон'], ['referat', 'Реферат']];
  function genRow(g, withUser = true) {
    const meta = [g.mode === 'template' ? 'шаблон' : g.mode === 'referat' ? 'реферат' : null, g.slides ? g.slides + (g.mode === 'referat' ? ' бет' : ' слайд') : null,
      g.free ? 'тегін' : 'ақылы', g.quality != null ? 'сапа ' + g.quality : null, g.durationS ? g.durationS + ' с' : null, g.cost != null ? g.cost + ' ₸' : null].filter(Boolean).join(' · ');
    const status = g.status === 'failed' ? `<span class="adm-bad">❌ қате${g.error ? ': ' + e(g.error.slice(0, 80)) : ''}</span>` : g.status === 'done' ? '' : `<span class="adm-muted">${e(g.status || '')}</span>`;
    return `<div class="adm-row static">
      <div class="adm-row-top">${withUser ? `<button type="button" class="adm-link" data-user="${e(g.chatId)}">${e(g.name)}</button>` : ''}<span class="adm-muted">${fmtDT(g.createdAt)}</span><span class="adm-right adm-stars">${stars(g.rating)}</span></div>
      <div>${e(g.topic)}</div>
      <div class="adm-muted">${meta} ${status}</div>
      ${g.comment ? `<div class="adm-comment">«${e(g.comment)}»</div>` : ''}
      ${g.status === 'done' ? `<button type="button" class="btn secondary small adm-send" data-send="${e(g.jobId)}">📤 Файлды маған жіберу</button>` : ''}</div>`;
  }
  async function viewGens() {
    const r = await ctx.api(`/api/admin/gens?filter=${st.genFilter}&days=60&limit=100`);
    return `<div class="chips wrap">${GEN_FILTERS.map(([k, l]) => `<button type="button" class="chip${st.genFilter === k ? ' active' : ''}" data-gfilter="${k}">${l}</button>`).join('')}</div>
      <div class="adm-h">${r.total} жасалым (60 күн)</div>
      <div class="list">${r.items.map((g) => genRow(g)).join('') || '<p class="hint">Әзірге жоқ</p>'}</div>
      <p class="hint">Файлды жұмыс аяқталғаннан кейін 48 сағат ішінде ғана жіберуге болады.</p>`;
  }

  // ── Төлемдер ────────────────────────────────────────────────────────────
  async function viewPayments() {
    const r = await ctx.api('/api/admin/payments?days=90');
    return `<div class="adm-grid">${tile('Төлем (90 күн)', r.total) + tile('Сомасы', money(r.sum))}</div>
      <div class="list">${r.items.map((p) => `<div class="adm-row static"><div class="adm-row-top"><button type="button" class="adm-link" data-user="${e(p.chatId)}">${e(p.name)}</button><span class="adm-right"><b>${money(p.amount)}</b></span></div>
        <div class="adm-muted">${fmtDT(p.createdAt)} · ${p.credits} кредит · ${p.kind}</div></div>`).join('') || '<p class="hint">Әзірге жоқ</p>'}</div>`;
  }

  // ── Клиент картасы ──────────────────────────────────────────────────────
  async function openUser(id) {
    $('#admUser').classList.remove('hidden');
    $('#admUserTitle').textContent = 'Клиент ' + id;
    const body = $('#admUserBody');
    body.innerHTML = '<p class="hint">Жүктелуде…</p>';
    try {
      const u = await ctx.api(`/api/admin/user/${encodeURIComponent(id)}`);
      if (u.error) { body.innerHTML = '<p class="hint">Табылмады</p>'; return; }
      $('#admUserTitle').textContent = u.name;
      body.innerHTML = `
        <div class="adm-muted">${u.username ? '@' + e(u.username) + ' · ' : ''}🆔 ${e(u.id)} · арна: ${e(u.source)}${u.referredBy ? ' (шақырған ' + e(u.referredBy) + ')' : ''}</div>
        <div class="adm-muted">тіркелген: ${fmtDT(u.createdAt)} · соңғы: ${fmtDT(u.lastAt)}${u.blocked ? ' · ⛔ ботты бұғаттаған' : ''}</div>
        <div class="adm-grid">${tile('Кредит', u.credits) + tile('Сатып алған', u.bought) + tile('Жасатқан', u.gens.length) + tile('Төлеген', money(u.paidSum))}</div>
        <div class="adm-actions">
          <button type="button" class="btn secondary small" data-credit="1">+1 кредит</button>
          <button type="button" class="btn secondary small" data-credit="ask">± кредит…</button>
          <button type="button" class="btn secondary small" data-msg="1">✉️ Бот атынан жазу</button>
          <a class="btn secondary small" href="tg://user?id=${e(u.id)}">💬 Telegram</a>
        </div>
        <div class="adm-h">Жасалымдар</div>
        <div class="list">${u.gens.map((g) => genRow(g, false)).join('') || '<p class="hint">Журналда жоқ</p>'}</div>
        <div class="adm-h">Төлемдер</div>
        <div class="list">${u.payments.map((p) => `<div class="adm-row static"><b>${money(p.amount)}</b> · ${p.credits} кредит · ${p.kind}<div class="adm-muted">${fmtDT(p.createdAt)}</div></div>`).join('') || '<p class="hint">Жоқ</p>'}</div>`;
      body.dataset.user = u.id;
      bind(body);
    } catch (err) { body.innerHTML = `<p class="hint">Қате: ${e(err.message)}</p>`; }
  }

  // ── Оқиғалар ────────────────────────────────────────────────────────────
  function bind(root) {
    root.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { st.days = +b.dataset.days; render(); }));
    root.querySelectorAll('[data-ufilter]').forEach((b) => b.addEventListener('click', () => { st.userFilter = b.dataset.ufilter; render(); }));
    root.querySelectorAll('[data-gfilter]').forEach((b) => b.addEventListener('click', () => { st.genFilter = b.dataset.gfilter; render(); }));
    root.querySelectorAll('[data-goto-gens]').forEach((b) => b.addEventListener('click', () => {
      st.genFilter = b.dataset.gotoGens; st.view = 'gens';
      document.querySelectorAll('#admNav .chip').forEach((x) => x.classList.toggle('active', x.dataset.view === 'gens'));
      render();
    }));
    root.querySelectorAll('[data-user]').forEach((b) => { if (b !== root) b.addEventListener('click', () => openUser(b.dataset.user)); });
    const q = root.querySelector('#admUserQ');
    if (q) {
      let t = null;
      q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.userQ = q.value; render().then(() => { const n = $('#admUserQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400); });
    }
    root.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await ctx.api(`/api/admin/gen/${encodeURIComponent(b.dataset.send)}/send`, { method: 'POST', body: '{}' });
        ctx.showToast(r.ok ? 'Файл Telegram-ға жіберілді' : r.message);
      } catch (err) { ctx.showToast('Қате: ' + err.message); }
      b.disabled = false;
    }));
    root.querySelectorAll('[data-credit]').forEach((b) => b.addEventListener('click', async () => {
      const id = $('#admUserBody').dataset.user;
      let n = 1;
      if (b.dataset.credit === 'ask') { n = parseInt(window.prompt('Неше кредит? (минус — алып тастау, -50..50)', '1'), 10); if (!n) return; }
      try {
        const r = await ctx.api(`/api/admin/user/${encodeURIComponent(id)}/credits`, { method: 'POST', body: JSON.stringify({ n }) });
        ctx.showToast(`Кредит: ${r.credits}`); openUser(id);
      } catch (err) { ctx.showToast('Қате: ' + err.message); }
    }));
    root.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', async () => {
      const id = $('#admUserBody').dataset.user;
      const text = window.prompt('Клиентке бот атынан хабарлама:');
      if (!text || !text.trim()) return;
      try { await ctx.api(`/api/admin/user/${encodeURIComponent(id)}/message`, { method: 'POST', body: JSON.stringify({ text }) }); ctx.showToast('Жіберілді'); } catch (err) { ctx.showToast('Қате: ' + err.message); }
    }));
  }

  window.DeadlineAdmin = { init };
})();
