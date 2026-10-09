/* DeadLine Mini App */
(function () {
  'use strict';

  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('secondary_bg_color'); } catch {}
    try { tg.setBackgroundColor('bg_color'); } catch {}
  }

  const state = {
    me: null,
    slideCount: 8,
    language: 'kk',
    mode: 'presentation',
    style: '',
    currentJobId: null,
    pollTimer: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function initDataHeader() {
    const h = {};
    if (tg?.initData) h['X-Telegram-Init-Data'] = tg.initData;
    return h;
  }

  async function api(path, opts = {}) {
    const url = path.startsWith('http') ? path : path;
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...initDataHeader(),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── Tabs ──────────────────────────────────────────────────────────────
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab').forEach((b) => b.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'history') loadHistory();
    });
  });

  // ── Chips ─────────────────────────────────────────────────────────────
  function bindChips(containerId, key) {
    const el = $(containerId);
    el.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      el.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state[key] = chip.dataset.v === '' ? '' : (isNaN(+chip.dataset.v) ? chip.dataset.v : +chip.dataset.v);
    });
  }
  function clampSlideCount(v) {
    const n = parseInt(v, 10);
    const max = state.mode === 'referat' ? 30 : 15;
    if (isNaN(n)) return state.mode === 'referat' ? 10 : 8;
    return Math.min(Math.max(n, 5), max);
  }
  const slideInput = $('#slideCountInput');
  slideInput.addEventListener('input', () => {
    state.slideCount = clampSlideCount(slideInput.value);
  });
  slideInput.addEventListener('blur', () => {
    const clamped = clampSlideCount(slideInput.value);
    slideInput.value = clamped;
    state.slideCount = clamped;
  });
  bindChips('#langChips', 'language');
  bindChips('#modeChips', 'mode');

  function applyMode() {
    const mode = state.mode;
    const isReferat = mode === 'referat';
    const isTemplate = mode === 'template';
    const isAi = mode === 'presentation';

    $$('.referat-only').forEach((el) => el.classList.toggle('hidden', !isReferat));
    $$('.ai-req').forEach((el) => el.classList.toggle('hidden', !isAi));
    $$('.tpl-only').forEach((el) => el.classList.toggle('hidden', !isTemplate));
    $$('.lang-card').forEach((el) => el.classList.toggle('hidden', isTemplate)); // шаблонда аударудың керегі жоқ

    $('#countLabel').textContent = isReferat ? 'Бет саны' : 'Слайд саны';
    $('#countHint').textContent = isReferat ? '5–30 аралығында' : '5–15 аралығында';
    $('#audienceLabel').textContent = isReferat ? 'Қосымша талаптар (опционал)' : 'Аудитория (опционал)';
    $('#audience').placeholder = isReferat ? 'Мысалы: 3 тарау, тек қазақстандық мысалдар...' : 'Студенттер, инвесторлар, команда...';
    $('#btnGenText').textContent = isReferat ? 'Реферат жасау' : 'Презентация жасау';
    $('#genHint').textContent = isReferat
      ? '1 кредит = 1 реферат · Word (.docx), ГОСТ форматы'
      : '1 кредит = 1 презентация · Сапа қақпасымен';

    $('#topicLabel').textContent = isTemplate ? 'Жаңа тақырып (шаблонға салынады)' : 'Тақырып';
    $('#topic').placeholder = isTemplate
      ? 'Мысалы: Қазақстан экономикасының даму кезеңдері'
      : 'Мысалы: Жасанды интеллекттің білім берудегі рөлі';
    $('#modeHint').textContent = isTemplate
      ? 'Клиенттің өз .pptx шаблонын өңделетін күйінде қайтарады: тек мәтін ауыстырылады, қораптар, түс, шрифт, макет өзгермейді.'
      : 'Тақырыптан толық презентация жасайды: құрылым, мәтін, визуал, layout — бәрін AI өзі шешеді.';

    const input = $('#slideCountInput');
    input.max = isReferat ? 30 : 15;
    input.value = isReferat ? 10 : 8;
    state.slideCount = parseInt(input.value, 10);
    $('#btnGenerate').disabled = false;
  }
  $('#modeChips').addEventListener('click', () => setTimeout(applyMode, 0));
  bindChips('#styleChips', 'style');
  applyMode();

  $('#topic').addEventListener('input', () => {
    $('#charCount').textContent = $('#topic').value.length;
  });

  // ── Load me ───────────────────────────────────────────────────────────
  async function loadMe() {
    try {
      const me = await api('/api/me');
      state.me = me;
      $('#creditsVal').textContent = me.credits;
      $('#statCredits').textContent = me.credits;
      $('#statTotal').textContent = me.total;
      $('#statRefs').textContent = me.refEarnings;
      $('#userName').textContent = [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Пайдаланушы';
      $('#userId').textContent = me.username ? `@${me.username}` : `ID ${me.id}`;
      $('#avatar').textContent = (me.firstName || 'D')[0].toUpperCase();
      $('#refLink').value = me.referralLink;
      $('#priceVal').textContent = me.price;
      if (me.plus) {
        $('#plusCredits').textContent = me.plus.credits;
        $('#plusPrice').textContent = me.plus.amount;
        $('#plusEach').textContent = `(≈ ${Math.round(me.plus.amount / me.plus.credits)}₸ / дана)`;
      }
      $('#kaspiPhone').textContent = me.kaspi?.phone || '';
      $('#kaspiName').textContent = me.kaspi?.name || '';
    } catch (e) {
      console.error(e);
      $('#creditsVal').textContent = '?';
      if (e.status === 401) {
        showToast('Telegram ішінен ашыңыз');
      }
    }
  }

  // ── Reference PPTX ────────────────────────────────────────────────────
  state.refId = null;
  $('#refFile').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    state.refId = null;
    if (!f) { $('#refInfo').textContent = ''; return; }
    if (!/\.pptx$/i.test(f.name)) { ev.target.value = ''; return showToast('Тек .pptx қабылданады'); }
    $('.tpl-upload').textContent = `📎 ${f.name} — басқасын таңдау`;
    if (f.size > 30 * 1024 * 1024) { ev.target.value = ''; return showToast('Файл 30 МБ-тан үлкен'); }
    $('#refInfo').textContent = 'Талдануда...';
    try {
      const r = await fetch('/api/reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...initDataHeader() },
        body: f,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Қате');
      state.refId = d.refId;
      $('#refInfo').textContent = '✓ Референс талданды\n' + (d.lines || []).join('\n');
    } catch (e) {
      ev.target.value = '';
      $('#refInfo').textContent = '';
      showToast(e.message || 'Талданбады');
    }
  });

  // ── Үлгі реферат (опционал) ───────────────────────────────────────────
  state.sampleId = null;
  $('#sampleFile').addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (!/\.(docx?|pdf|txt|rtf)$/i.test(f.name)) { ev.target.value = ''; return showToast('Word, PDF немесе TXT жүктеңіз'); }
    if (f.size > 30 * 1024 * 1024) { ev.target.value = ''; return showToast('Файл 30 МБ-тан үлкен'); }
    state.sampleId = null;
    $('#sampleBtn').textContent = `📎 ${f.name} — басқасын таңдау`;
    $('#sampleInfo').textContent = 'Оқылуда...';
    try {
      const r = await fetch('/api/material?name=' + encodeURIComponent(f.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name), ...initDataHeader() },
        body: f,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Файл оқылмады');
      state.sampleId = d.materialId;
      $('#sampleInfo').textContent = '✓ Үлгі қабылданды — реферат соның құрылымы мен стилімен жазылады';
    } catch (e) {
      $('#sampleBtn').textContent = '📎 Үлгі рефератты таңдау';
      $('#sampleInfo').textContent = 'Жүктемесеңіз де болады — реферат стандарт талаптармен жасалады.';
      showToast(e.message || 'Файл оқылмады');
    }
    ev.target.value = '';
  });

  state.materialIds = [];
  // ── Generate ──────────────────────────────────────────────────────────
  $('#btnGenerate').addEventListener('click', async () => {
    const topic = $('#topic').value.trim();
    if (topic.length < 3) {
      haptic('error');
      return showToast('Тақырыпты жазыңыз');
    }
    if (state.mode === 'template' && !state.refId) {
      haptic('error');
      return showToast('Алдымен шаблон (.pptx) жүктеңіз');
    }
    if (state.me && state.me.credits <= 0) {
      haptic('error');
      showToast('Кредит жоқ — Аккаунт бөліміне өтіңіз');
      return;
    }

    $('#btnGenerate').disabled = true;
    try {
      const res = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          topic,
          slideCount: state.slideCount,
          language: state.language,
          style: state.style || undefined,
          audience: $('#audience').value.trim() || undefined,
          mode: state.mode,
          requirements: state.mode === 'referat' ? undefined : (($('#requirements').value || '').trim() || undefined),
          materialIds: state.mode === 'template' ? state.materialIds : undefined,
          refId: state.mode === 'template' ? (state.refId || undefined) : undefined,
          sampleId: state.mode === 'referat' ? (state.sampleId || undefined) : undefined,
          pages: state.mode === 'referat' ? state.slideCount : undefined,
          university: ($('#university').value || '').trim() || undefined,
          faculty: ($('#faculty').value || '').trim() || undefined,
          department: ($('#department').value || '').trim() || undefined,
          group: ($('#groupName').value || '').trim() || undefined,
          city: ($('#city').value || '').trim() || undefined,
          performedBy: ($('#performedBy').value || '').trim() || undefined,
          checkedBy: ($('#checkedBy').value || '').trim() || undefined,
        }),
      });
      state.currentJobId = res.jobId;
      if (state.me) {
        state.me.credits = res.creditsLeft;
        $('#creditsVal').textContent = res.creditsLeft;
        $('#statCredits').textContent = res.creditsLeft;
      }
      showProgress(0, 'Кезекте', 'Басталуда...');
      haptic('medium');
      pollJob(res.jobId);
    } catch (e) {
      haptic('error');
      if (e.status === 402) showToast(e.data?.message || 'Кредит жеткіліксіз');
      else if (e.status === 429) showToast(e.data?.message || 'Тым жиі сұраныс');
      else showToast(e.message || 'Қате');
    } finally {
      $('#btnGenerate').disabled = false;
    }
  });

  function showProgress(pct, title, detail) {
    $('#progressOverlay').classList.remove('hidden');
    $('#resultCard').classList.add('hidden');
    $('#progressFill').style.width = `${pct}%`;
    $('#progressPct').textContent = `${pct}%`;
    if (title) $('#progressTitle').textContent = title;
    if (detail) $('#progressDetail').textContent = detail;
  }

  function hideProgress() {
    $('#progressOverlay').classList.add('hidden');
  }

  $('#btnCancelView').addEventListener('click', () => {
    hideProgress();
  });

  async function pollJob(jobId) {
    if (state.pollTimer) clearInterval(state.pollTimer);
    const tick = async () => {
      try {
        const job = await api(`/api/job/${jobId}`);
        const phaseTitles = {
          queued: 'Кезекте',
          start: 'Басталуда',
          content: 'Мазмұн жазылуда',
          qc: 'Сапа тексерісі',
          quality: 'Сапа циклі',
          narrative: 'Нарратив',
          composition: 'Композиция',
          sources: 'Дереккөздер',
          qa: 'Талаптар QA',
          template: 'Шаблонға мәтін салынуда',
          images: 'Суреттер',
          visual: 'Визуалдар',
          html: 'HTML құрастыру',
          render: 'Рендер',
          critic: 'Vision Critic',
          redesign: 'Қайта өңдеу',
          pptx: 'PPTX экспорт',
          outline: 'Құрылым',
          write: 'Мәтін жазылуда',
          fit: 'Көлем реттелуде',
          docx: 'Word құрастыру',
          done: 'Дайын',
          failed: 'Сәтсіз',
        };
        showProgress(
          job.progress || 0,
          phaseTitles[job.phase] || job.phase || 'Жұмыс істеуде',
          job.detail || ''
        );

        if (job.status === 'done') {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          hideProgress();
          showResult(job);
          haptic('success');
          loadMe();
        } else if (job.status === 'failed') {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
          hideProgress();
          haptic('error');
          showToast(job.detail || 'Сәтсіз болды, кредит қайтарылды');
          loadMe();
        }
      } catch (e) {
        console.error('poll', e);
      }
    };
    await tick();
    state.pollTimer = setInterval(tick, 1500);
  }

  function renderReqReport(rep) {
    const box = $('#reqReport');
    box.textContent = '';
    if (!rep || !rep.results || !rep.results.length) { box.classList.add('hidden'); return; }
    const sm = rep.summary || {};
    const h = document.createElement('div');
    h.className = 'req-head';
    h.textContent = sm.hardTotal ? `Талаптар: ${sm.hardPassed}/${sm.hardTotal} орындалды` : 'Талаптар';
    box.appendChild(h);
    const mark = { pass: '✅', fail: '❌', soft: '🔸', unverifiable: '➖' };
    for (const r of rep.results) {
      const row = document.createElement('div');
      row.className = 'req-row ' + r.status;
      let t = `${mark[r.status] || '•'} «${r.quote}»`;
      if (r.status === 'fail' && r.message) t += ' — ' + r.message;
      else if (r.status === 'soft') t += r.score == null ? ' — бағаланбады' : ` — ${Math.round(r.score * 100)}%${r.note ? ' (' + r.note + ')' : ''}`;
      else if (r.status === 'unverifiable') t += ' — тексерілмейді' + (r.message ? ': ' + r.message : '');
      row.textContent = t;
      box.appendChild(row);
    }
    for (const o of rep.overrides || []) {
      const row = document.createElement('div');
      row.className = 'req-row note';
      row.textContent = 'ℹ️ ' + o;
      box.appendChild(row);
    }
    box.classList.remove('hidden');
  }

  function renderTemplateReport(rep) {
    const box = $('#reqReport');
    if (!rep || !rep.checks || !rep.checks.length) return;
    const h = document.createElement('div');
    h.className = 'req-head';
    h.textContent = `🎨 ${rep.summary || 'Template compliance'}`;
    box.appendChild(h);
    for (const c of rep.checks) {
      const row = document.createElement('div');
      row.className = 'req-row ' + c.status;
      row.textContent = `${c.status === 'pass' ? '✅' : '❌'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`;
      box.appendChild(row);
    }
    box.classList.remove('hidden');
  }

  function showResult(job) {
    $('#resultCard').classList.remove('hidden');
    const ref = job.mode === 'referat';
    const tpl = job.mode === 'template';
    $('#resultTitle').textContent = job.title || (ref ? 'Реферат дайын!' : 'Презентация дайын!');
    $('#btnDlPptx').classList.toggle('hidden', ref);
    $('#btnDlHtml').classList.toggle('hidden', ref || tpl);
    $('#btnDlDocx').classList.toggle('hidden', !ref);
    $('#btnNew').textContent = ref ? 'Жаңа жұмыс' : 'Жаңа презентация';
    $('#resultScore').textContent = job.qualityScore != null
      ? `Сапа: ${Math.round(job.qualityScore)}/100${tpl ? ' · шаблоннан' : ''}`
      : (tpl ? 'Шаблон негізінде жасалды' : '');
    $('#reqReport').classList.add('hidden');
    renderReqReport(job.requirementsReport);
    renderTemplateReport(job.templateReport);
    state.currentJobId = job.id;
    $('#btnDlPptx').onclick = () => download(job.id, 'pptx');
    $('#btnDlHtml').onclick = () => download(job.id, 'html');
    $('#btnDlDocx').onclick = () => download(job.id, 'docx');
  }

  $('#btnNew').addEventListener('click', () => {
    $('#resultCard').classList.add('hidden');
    state.currentJobId = null;
  });

  async function download(jobId, type) {
    try {
      haptic('light');
      const headers = initDataHeader();
      const res = await fetch(`/api/job/${jobId}/download/${type}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sent) throw new Error(data.error === 'bot_unavailable' ? 'Бот қолжетімсіз' : 'Жіберу сәтсіз');
      showToast('Чатқа жіберілді ✅');
      haptic('success');
      if (tg?.close) {
        // let user switch to chat manually; do not auto-close
      }
    } catch (e) {
      showToast(e.message || 'Жіберу қатесі');
      haptic('error');
    }
  }

  // ── History ───────────────────────────────────────────────────────────
  async function loadHistory() {
    try {
      const { items } = await api('/api/history');
      const list = $('#historyList');
      const empty = $('#historyEmpty');
      if (!items || !items.length) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');
      list.innerHTML = items.map((h) => {
        const date = new Date(h.createdAt).toLocaleString('kk-KZ', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const score = h.qualityScore != null ? `⭐ ${Math.round(h.qualityScore)}` : '';
        return `<div class="hist-item">
          <div class="hist-title">${esc(h.title || h.topic || (h.mode === 'referat' ? 'Реферат' : 'Презентация'))}</div>
          <div class="hist-meta"><span>${date}</span><span>${score}</span></div>
          <div class="hist-actions">
            ${h.mode === 'referat'
              ? `<button class="btn secondary small" data-dl="${h.id}" data-type="docx">Word</button>`
              : `<button class="btn secondary small" data-dl="${h.id}" data-type="pptx">PPTX</button>
            <button class="btn secondary small" data-dl="${h.id}" data-type="html">HTML</button>`}
          </div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-dl]').forEach((btn) => {
        btn.addEventListener('click', () => download(btn.dataset.dl, btn.dataset.type));
      });
    } catch (e) {
      console.error(e);
    }
  }

  // ── Account actions ───────────────────────────────────────────────────
  $('#btnCopyRef').addEventListener('click', async () => {
    const link = $('#refLink').value;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Көшірілді');
      haptic('light');
    } catch {
      $('#refLink').select();
      showToast('Таңдалды — көшіріңіз');
    }
  });

  $('#btnOpenBot').addEventListener('click', () => {
    const uname = state.me?.referralLink?.match(/t\.me\/([^?]+)/)?.[1];
    if (tg?.openTelegramLink && uname) {
      tg.openTelegramLink(`https://t.me/${uname}`);
    } else if (uname) {
      window.open(`https://t.me/${uname}`, '_blank');
    }
  });

  // ── Utils ─────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function showToast(msg) {
    if (tg?.showAlert) {
      tg.showAlert(msg);
    } else {
      alert(msg);
    }
  }

  function haptic(type) {
    try {
      if (type === 'success') tg?.HapticFeedback?.notificationOccurred('success');
      else if (type === 'error') tg?.HapticFeedback?.notificationOccurred('error');
      else if (type === 'medium') tg?.HapticFeedback?.impactOccurred('medium');
      else tg?.HapticFeedback?.impactOccurred('light');
    } catch {}
  }

  // Boot
  loadMe();
})();
