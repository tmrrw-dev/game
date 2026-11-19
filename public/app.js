
(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = (id) => document.getElementById(id);
  const initData = tg?.initData || '';

  let player = null;
  let busy = false;
  let activePage = 'farm';

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Ошибка соединения');
    }

    return data;
  }

  function toast(message) {
    const el = $('toast');
    if (!el) return;

    el.textContent = message;
    el.classList.add('show');

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function number(value) {
    return Math.floor(Number(value || 0)).toLocaleString('ru-RU');
  }

  function render(data) {
    player = data;

    if ($('sat')) $('sat').textContent = number(data.sat);
    if ($('gram')) $('gram').textContent = Number(data.gram || 0).toFixed(2);
    if ($('rate')) $('rate').textContent = number(data.rate);
    if ($('perClick')) $('perClick').textContent = number(data.clickPower);
    if ($('clicks')) $('clicks').textContent = number(data.totalClicks);

    if ($('gpuOwned')) $('gpuOwned').textContent = number(data.gpu);
    if ($('asicOwned')) $('asicOwned').textContent = number(data.asic);
    if ($('gpuIncome')) $('gpuIncome').textContent = number(data.gpu);
    if ($('asicIncome')) $('asicIncome').textContent = number(data.asic * 8);
    if ($('farmIncome')) $('farmIncome').textContent = number(data.rate);

    if ($('gpuCost')) $('gpuCost').textContent = number(data.costs.gpu);
    if ($('asicCost')) $('asicCost').textContent = number(data.costs.asic);
    if ($('boostCost')) $('boostCost').textContent = number(data.costs.boost);

    if ($('ownedCount')) {
      $('ownedCount').textContent =
        `${data.gpu + data.asic} устройств`;
    }

    const buttons = [
      ['buyGpu', data.costs.gpu],
      ['buyAsic', data.costs.asic],
      ['buyBoost', data.costs.boost]
    ];

    buttons.forEach(([id, price]) => {
      if ($(id)) $(id).disabled = data.sat < price;
    });
  }

  async function refresh() {
    try {
      const data = await api('/api/session');
      render(data);

      if (data.offlineEarned > 0) {
        toast(`Пока тебя не было: +${number(data.offlineEarned)} SAT`);
      }
    } catch (error) {
      toast(error.message);
    }
  }

  async function mine() {
    if (busy) return;

    busy = true;

    try {
      const data = await api('/api/mine', { method: 'POST' });
      render(data);

      const button = $('mineButton');
      if (button) {
        button.classList.add('is-pressed');
        setTimeout(() => button.classList.remove('is-pressed'), 100);
      }

      const float = document.createElement('div');
      float.className = 'float';
      float.textContent = `+${number(data.gain)} SAT`;

      const rect = $('mineButton')?.getBoundingClientRect();
      if (rect) {
        float.style.left = `${rect.left + rect.width / 2}px`;
        float.style.top = `${rect.top}px`;
      }

      document.body.appendChild(float);
      setTimeout(() => float.remove(), 750);
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
    }
  }

  async function buy(type) {
    if (busy) return;

    busy = true;

    try {
      const data = await api('/api/buy', {
        method: 'POST',
        body: JSON.stringify({ type })
      });

      render(data);

      const names = {
        gpu: 'GPU куплена',
        asic: 'ASIC куплен',
        boost: 'Улучшение куплено'
      };

      toast(names[type]);
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
    }
  }

  function ensureExtraPanel() {
    let panel = $('extraPanel');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'extraPanel';
    panel.className = 'extra-panel';
    panel.hidden = true;

    const shop = document.querySelector('.shop');
    if (shop) shop.after(panel);
    else document.querySelector('.app')?.appendChild(panel);

    return panel;
  }

  function showPage(page) {
    activePage = page;

    const panel = ensureExtraPanel();
    const farm = document.querySelector('.balances');
    const minePanel = document.querySelector('.mine-panel');
    const shop = document.querySelector('.shop');

    const isFarm = page === 'farm' || page === 'shop';

    if (farm) farm.hidden = !isFarm;
    if (minePanel) minePanel.hidden = !isFarm;
    if (shop) shop.hidden = !isFarm;
    panel.hidden = isFarm;

    document.querySelectorAll('.bottom-nav button').forEach(button => {
      button.classList.remove('nav-active');
    });

    const activeButton = {
      farm: document.querySelector('.bottom-nav button:first-child'),
      shop: $('navShop'),
      pool: $('navPool'),
      rank: $('navRank')
    }[page];

    activeButton?.classList.add('nav-active');

    if (page === 'pool') loadPool();
    if (page === 'rank') loadLeaderboard();

    if (page === 'shop') {
      shop?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function loadPool() {
    const panel = ensureExtraPanel();
    panel.hidden = false;
    panel.innerHTML = '<div class="extra-card">ЗАГРУЗКА МАЙНИНГ-ПУЛА...</div>';

    try {
      const data = await api('/api/pool');

      panel.innerHTML = `
        <div class="extra-heading">
          <small>SHARED MINING NETWORK</small>
          <h2>Майнинг-пул</h2>
          <p>Ежедневное распределение общего фонда.</p>
        </div>

        <div class="extra-card pool-fund">
          <small>ОБЩИЙ ФОНД СЕГОДНЯ</small>
          <strong>${number(data.fund)} SAT</strong>
          <span>Раунд ${data.round}</span>
        </div>

        <div class="extra-grid">
          <div class="extra-card">
            <small>УЧАСТНИКИ</small>
            <strong>${number(data.participants)}</strong>
          </div>
          <div class="extra-card">
            <small>МОЩНОСТЬ СЕТИ</small>
            <strong>${number(data.totalPower)}</strong>
          </div>
        </div>

        <div class="extra-card">
          <h3>ТВОЙ ВКЛАД</h3>
          <div class="extra-line"><span>Мощность</span><b>${number(data.myPower)}</b></div>
          <div class="extra-line"><span>Активность</span><b>${number(data.myActivity)}</b></div>
          <div class="extra-line"><span>Оценка награды</span><b>${number(data.estimatedReward)} SAT</b></div>
        </div>

        <div class="extra-card">
          <h3>СИСТЕМА НАГРАД</h3>
          <div class="reward-bar"><i style="width:70%"></i></div>
          <div class="extra-line"><span>Мощность фермы</span><b>70%</b></div>
          <div class="reward-bar activity"><i style="width:30%"></i></div>
          <div class="extra-line"><span>Активность игроков</span><b>30%</b></div>
          <p class="extra-note">Оценка награды меняется по мере поступления средств и активности других игроков. Расчёт выполняется при завершении суточного раунда.</p>
        </div>
      `;
    } catch (error) {
      panel.innerHTML = `<div class="extra-card">${error.message}</div>`;
    }
  }

  async function loadLeaderboard() {
    const panel = ensureExtraPanel();
    panel.hidden = false;
    panel.innerHTML = '<div class="extra-card">ЗАГРУЗКА РЕЙТИНГА...</div>';

    try {
      const data = await api('/api/leaderboard');

      const rows = data.players.map((item, index) => `
        <div class="rank-row">
          <span class="rank-number">${index + 1}</span>
          <div class="rank-person">
            <b>${escapeHtml(item.username || 'Miner')}</b>
            <small>${number(item.gpu)} GPU · ${number(item.asic)} ASIC</small>
          </div>
          <div class="rank-power">
            <b>${number(item.rate)}</b>
            <small>SAT/SEC</small>
          </div>
        </div>
      `).join('');

      panel.innerHTML = `
        <div class="extra-heading">
          <small>GLOBAL MINERS</small>
          <h2>Рейтинг игроков</h2>
          <p>Топ-20 майнеров по мощности фермы.</p>
        </div>

        <div class="extra-card my-rank">
          <small>ТВОЯ ПОЗИЦИЯ</small>
          <strong>${data.myPosition ? `#${data.myPosition}` : '—'}</strong>
        </div>

        <div class="extra-card">
          <div class="rank-header"><span>МЕСТО / ИГРОК</span><span>МОЩНОСТЬ</span></div>
          ${rows || '<p>Пока нет игроков в рейтинге.</p>'}
        </div>
      `;
    } catch (error) {
      panel.innerHTML = `<div class="extra-card">${error.message}</div>`;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function addStyles() {
    if ($('extraStyles')) return;

    const style = document.createElement('style');
    style.id = 'extraStyles';
    style.textContent = `
      [hidden]{display:none!important}
      .extra-panel{margin-top:20px}
      .extra-heading{margin:8px 0 14px}
      .extra-heading small,.extra-card>small{font-size:9px;color:var(--muted);letter-spacing:1px}
      .extra-heading h2{font-size:20px;margin:8px 0}
      .extra-heading p,.extra-note{font-size:10px;color:var(--muted);line-height:1.6}
      .extra-card{background:var(--panel);border:1px solid var(--line);padding:14px;margin-bottom:10px}
      .extra-card h3{font-size:11px;margin:0 0 13px;color:var(--gold)}
      .pool-fund strong,.my-rank strong{display:block;font-size:28px;color:var(--gold);margin:12px 0}
      .pool-fund span{font-size:9px;color:var(--muted)}
      .extra-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .extra-grid .extra-card strong{display:block;font-size:20px;color:var(--gold);margin-top:10px}
      .extra-line{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:10px}
      .extra-line span{color:var(--muted)}
      .extra-line b{color:var(--gold)}
      .reward-bar{height:7px;background:#30323a;margin:10px 0 5px}
      .reward-bar i{display:block;height:100%;background:var(--gold)}
      .reward-bar.activity i{background:var(--green)}
      .rank-header,.rank-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .rank-header{font-size:8px;color:var(--muted);padding-bottom:10px}
      .rank-row{padding:11px 0;border-top:1px solid var(--line)}
      .rank-number{width:23px;color:var(--gold);font-weight:bold;font-size:12px}
      .rank-person{flex:1;min-width:0}
      .rank-person b,.rank-person small,.rank-power b,.rank-power small{display:block}
      .rank-person b{font-size:10px;overflow:hidden;text-overflow:ellipsis}
      .rank-person small,.rank-power small{font-size:8px;color:var(--muted);margin-top:5px}
      .rank-power{text-align:right}
      .rank-power b{font-size:11px;color:var(--gold)}
    `;

    document.head.appendChild(style);
  }

  $('mineButton')?.addEventListener('click', mine);
  $('buyGpu')?.addEventListener('click', () => buy('gpu'));
  $('buyAsic')?.addEventListener('click', () => buy('asic'));
  $('buyBoost')?.addEventListener('click', () => buy('boost'));

  document.querySelector('.bottom-nav button:first-child')
    ?.addEventListener('click', () => showPage('farm'));

  $('navShop')?.addEventListener('click', () => showPage('shop'));
  $('navPool')?.addEventListener('click', () => showPage('pool'));
  $('navRank')?.addEventListener('click', () => showPage('rank'));

  addStyles();
  refresh();

  // Обновляем отображение пассивного дохода.
  setInterval(() => {
    if (!player || activePage === 'pool' || activePage === 'rank') return;

    player.sat += player.rate;
    if ($('sat')) $('sat').textContent = number(player.sat);
  }, 1000);
})();
