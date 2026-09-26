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
  bindChips('#slideChips', 'slideCount');
  bindChips('#langChips', 'language');
  bindChips('#styleChips', 'style');

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

  // ── Generate ──────────────────────────────────────────────────────────
  $('#btnGenerate').addEventListener('click', async () => {
    const topic = $('#topic').value.trim();
    if (topic.length < 3) {
      haptic('error');
      return showToast('Тақырыпты жазыңыз');
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
          images: 'Суреттер',
          visual: 'Визуалдар',
          html: 'HTML құрастыру',
          render: 'Рендер',
          critic: 'Vision Critic',
          redesign: 'Қайта өңдеу',
          pptx: 'PPTX экспорт',
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

  function showResult(job) {
    $('#resultCard').classList.remove('hidden');
    $('#resultTitle').textContent = job.title || 'Презентация дайын!';
    $('#resultScore').textContent = job.qualityScore != null
      ? `Сапа: ${Math.round(job.qualityScore)}/100`
      : '';
    state.currentJobId = job.id;
    $('#btnDlPptx').onclick = () => download(job.id, 'pptx');
    $('#btnDlHtml').onclick = () => download(job.id, 'html');
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
      if (!res.ok) throw new Error('Жүктеу сәтсіз');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      let name = type === 'pptx' ? 'presentation.pptx' : 'presentation.html';
      const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
      if (m) name = decodeURIComponent(m[1] || m[2]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      if (tg?.showPopup) {
        // optional
      }
    } catch (e) {
      showToast(e.message || 'Жүктеу қатесі');
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
          <div class="hist-title">${esc(h.title || h.topic || 'Презентация')}</div>
          <div class="hist-meta"><span>${date}</span><span>${score}</span></div>
          <div class="hist-actions">
            <button class="btn secondary small" data-dl="${h.id}" data-type="pptx">PPTX</button>
            <button class="btn secondary small" data-dl="${h.id}" data-type="html">HTML</button>
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
