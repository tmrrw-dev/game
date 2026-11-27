(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = id => document.getElementById(id);
  const initData = tg?.initData || '';

  let player = null;
  let busy = false;
  let activePage = 'farm';
  let halvingData = null;

const HALVING_DATES = [
  Date.UTC(2027, 1, 1),
  Date.UTC(2027, 2, 3),
  Date.UTC(2027, 3, 2),
  Date.UTC(2027, 4, 12),
  Date.UTC(2027, 6, 1),
  Date.UTC(2027, 7, 30)
];

  async function api(url, options = {}) {
    const r = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
        ...(options.headers || {})
      }
    });

    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(d.error || 'Ошибка соединения');
    }

    return d;
  }

  function toast(msg) {
    const e = $('toast');
    if (!e) return;

    e.textContent = msg;
    e.classList.add('show');

    clearTimeout(toast.t);

    toast.t = setTimeout(() => {
      e.classList.remove('show');
    }, 2200);
  }

  function number(v) {
    return Math.floor(Number(v || 0)).toLocaleString('ru-RU');
  }

  function sat(v) {
    return Number(v || 0).toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  function renderHalving(info) {
  if (!info) return;

  halvingData = info;

  const completed = Math.max(
    0,
    Math.min(5, Number(info.completedHalvings || 0))
  );

  const percent = Number(
    info.rewardPercent ?? (Number(info.factor ?? 1) * 100)
  );

  if ($('halvingStage')) {
    $('halvingStage').textContent =
      completed === 0 ? 'LAUNCH' : `HALVING #${completed}`;
  }

  if ($('halvingPercent')) {
    $('halvingPercent').textContent =
      `${Number(percent).toLocaleString('ru-RU', {
        maximumFractionDigits: 3
      })}%`;
  }

  const rawNextAt = info.nextAt;
  let nextAt = null;

  if (typeof rawNextAt === 'number') {
    nextAt = rawNextAt < 1e12 ? rawNextAt * 1000 : rawNextAt;
  } else if (rawNextAt) {
    nextAt = Date.parse(rawNextAt);
  }

  if ($('halvingTimer')) {
    if (!Number.isFinite(nextAt)) {
      $('halvingTimer').textContent = 'ВСЕ ЭТАПЫ ПРОЙДЕНЫ';
    } else {
      const left = Math.max(0, nextAt - Date.now());
      const days = Math.floor(left / 86400000);
      const hours = Math.floor((left % 86400000) / 3600000);
      const minutes = Math.floor((left % 3600000) / 60000);
      const seconds = Math.floor((left % 60000) / 1000);

      $('halvingTimer').textContent =
        `${days}д ${String(hours).padStart(2, '0')}:` +
        `${String(minutes).padStart(2, '0')}:` +
        `${String(seconds).padStart(2, '0')}`;
    }
  }

  const now = Date.now();
  const start = HALVING_DATES[completed];
  const end = HALVING_DATES[completed + 1];

  if ($('halvingProgress')) {
    let progress = 0;

    if (now >= HALVING_DATES[5]) {
      progress = 100;
    } else if (now >= start && end) {
      progress = ((now - start) / (end - start)) * 100;
    }

    $('halvingProgress').style.width =
      `${Math.max(0, Math.min(100, progress))}%`;
  }

  document.querySelectorAll('.halving-history > div')
    .forEach((item, index) => {
      item.classList.toggle('halving-done', index <= completed);
      item.classList.toggle('halving-current', index === completed);
    });
}

function render(d) {
  player = d;

  if (d.halving) renderHalving(d.halving);

    if ($('sat')) $('sat').textContent = sat(d.sat);
    if ($('gram')) $('gram').textContent = Number(d.gram || 0).toFixed(2);
    if ($('rate')) $('rate').textContent = sat(d.rate);
    if ($('perClick')) $('perClick').textContent = number(d.clickPower);
    if ($('clicks')) $('clicks').textContent = number(d.totalClicks);

    if ($('gpuOwned')) $('gpuOwned').textContent = number(d.gpu);

    if ($('asicOwned')) {
      $('asicOwned').textContent = number(
        d.asic + d.asicMk2 + d.asicMk3
      );
    }

    
const gpuBase =
  Number(d.gpu || 0) + Number(d.gpuPower || 0);

const asicBase =
  Number(d.asic || 0) * 2 +
  Number(d.asicMk2 || 0) * 20 +
  Number(d.asicMk3 || 0) * 50;

const baseTotal = gpuBase + asicBase;

const multiplier = baseTotal > 0
  ? Number(d.rate || 0) / baseTotal
  : 1;

const halvingFactor = Number(d.halving?.factor ?? 1);
const incomeMultiplier = 0.05 * 0.95 * halvingFactor;

if ($('gpuIncome')) {
  $('gpuIncome').textContent =
    sat(gpuBase * multiplier * incomeMultiplier);
}

if ($('asicIncome')) {
  $('asicIncome').textContent =
    sat(asicBase * multiplier * incomeMultiplier);
}

if ($('farmIncome')) {
  $('farmIncome').textContent =
    sat(Number(d.rate || 0) * incomeMultiplier);
}

    if ($('gpuCost')) $('gpuCost').textContent = number(d.costs.gpu);
    if ($('asicCost')) $('asicCost').textContent = number(d.costs.asic);
    if ($('boostCost')) $('boostCost').textContent = number(d.costs.boost);

    if ($('ownedCount')) {
      $('ownedCount').textContent =
        `${d.gpu + d.asic + d.asicMk2 + d.asicMk3} устройств`;
    }

    document.querySelectorAll('[data-cost]').forEach(b => {
      const t = b.dataset.type;

      b.disabled = d.sat < d.costs[t];

      const price = b.parentElement.querySelector('[data-price]');

      if (price) {
        price.textContent = number(d.costs[t]);
      }
    });

    const summary = $('upgradeSummary');

    if (summary) {
      summary.innerHTML = `
        <div class="extra-line">
          <span>Охлаждение</span>
          <b>${d.cooling} ур.</b>
        </div>

        <div class="extra-line">
          <span>Энергосистема</span>
          <b>${d.energy} ур.</b>
        </div>

        <div class="extra-line">
          <span>Автоматизация</span>
          <b>${d.automation} ур.</b>
        </div>

        <div class="extra-line">
          <span>Бонус GPU-сета</span>
          <b>+${d.bonuses.gpuSet}%</b>
        </div>

        <div class="extra-line">
          <span>Бонус ASIC-сета</span>
          <b>+${d.bonuses.asicSet}%</b>
        </div>
      `;
    }

    const rar = $('raritySummary');

    if (rar) {
      rar.innerHTML = Object.entries(d.rarityCounts || {})
        .map(([k, v]) => `
          <span class="rarity ${k}">
            ${k.toUpperCase()} <b>${v}</b>
          </span>
        `)
        .join('');
    }
  }

  async function refresh() {
    try {
const d = await api('/api/session');

render(d);

if (!d.halving) {
  try {
    renderHalving(await api('/api/halving'));
  } catch (_) {
    // Совместимость со старой версией сервера.
  }
}

      if (d.offlineEarned > 0) {
        toast(`Пока тебя не было: +${sat(d.offlineEarned)} SAT`);
      }
    } catch (e) {
      toast(e.message);
    }
  }

  // Центральная кнопка майнинга.
  async function mine() {
    if (busy) return;

    busy = true;

    try {
      const d = await api('/api/mine', {
        method: 'POST'
      });

      render(d);

      const b = $('mineButton');

      if (b) {
        b.classList.add('is-pressed');

        setTimeout(() => {
          b.classList.remove('is-pressed');
        }, 100);
      }

      const f = document.createElement('div');

      f.className = 'float';
      f.textContent = `+${sat(d.gain)} SAT`;

      const r = b?.getBoundingClientRect();

      if (r) {
        f.style.left = `${r.left + r.width / 2}px`;
        f.style.top = `${r.top}px`;
      }

      document.body.appendChild(f);

      setTimeout(() => f.remove(), 750);

    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  // Покупка оборудования.
  async function buy(type) {
    if (busy) return;

    busy = true;

    try {
      const d = await api('/api/buy', {
        method: 'POST',
        body: JSON.stringify({ type })
      });

      render(d);

      const names = {
        gpu: 'GPU приобретена — проверь редкость в инвентаре',
        asic: 'ASIC куплен',
        boost: 'Усиление клика куплено',
        asic_mk2: 'ASIC MK2 установлен',
        asic_mk3: 'ASIC MK3 установлен',
        cooling: 'Охлаждение улучшено',
        energy: 'Энергосистема улучшена',
        automation: 'Автоматизация улучшена'
      };

      toast(names[type] || 'Покупка успешна');

      if (type === 'gpu') {
        loadInventory();
      }

    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  function ensurePanel() {
    let p = $('extraPanel');

    if (p) return p;

    p = document.createElement('section');
    p.id = 'extraPanel';
    p.className = 'extra-panel';
    p.hidden = true;

    document.querySelector('.shop')?.after(p);

    return p;
  }

  // Переключение экранов.
  function showPage(page) {
    activePage = page;

    const panel = ensurePanel();

    const farm = document.querySelector('.balances');
    const minePanel = document.querySelector('.mine-panel');
    const shop = document.querySelector('.shop');

    const isFarm = page === 'farm' || page === 'shop';

    if (farm) farm.hidden = !isFarm;
    if (minePanel) minePanel.hidden = !isFarm;
    if (shop) shop.hidden = !isFarm;

    panel.hidden = isFarm;

    document.querySelectorAll('.bottom-nav button')
      .forEach(b => b.classList.remove('nav-active'));

    ({
      farm: document.querySelector('.bottom-nav button:first-child'),
      shop: $('navShop'),
      pool: $('navPool'),
      rank: $('navRank'),
         inventory: $('navInventory'),
      referrals: $('navReferrals')
    })[page]?.classList.add('nav-active');

    if (page === 'pool') loadPool();
    if (page === 'rank') loadLeaderboard();
    if (page === 'inventory') loadInventory();
    if (page === 'referrals') loadReferrals();
      // Реферальная программа.
  async function loadReferrals() {
    const p = ensurePanel();

    p.hidden = false;
    p.innerHTML = '<div class="extra-card">ЗАГРУЗКА РЕФЕРАЛЬНОЙ ПРОГРАММЫ...</div>';

    try {
      const d = await api('/api/referrals');

      p.innerHTML = `
        <div class="extra-heading">
          <small>SATOSHI PARTNERS PROGRAM</small>
          <h2>Реферальная программа</h2>
          <p>Приглашай игроков и получай SAT с их добычи.</p>
        </div>

        <div class="extra-card referral-main">
          <small>ТВОЙ РЕФЕРАЛЬНЫЙ БАЛАНС</small>
          <strong>${sat(d.earned)} SAT</strong>
          <span>Всего заработано на приглашениях</span>
        </div>

        <div class="extra-grid">
          <div class="extra-card">
            <small>ПРИГЛАШЕНО</small>
            <strong>${number(d.invited)}</strong>
          </div>

          <div class="extra-card">
            <small>АКТИВИРОВАНО</small>
            <strong>${number(d.activated)}</strong>
          </div>
        </div>

        <div class="extra-card">
          <h3>ТВОЯ ПЕРСОНАЛЬНАЯ ССЫЛКА</h3>

          <input
            id="referralLink"
            class="referral-input"
            type="text"
            readonly
            value="${escapeHtml(d.link)}"
          >

          <button type="button" class="inventory-link" id="copyReferral">
            КОПИРОВАТЬ ССЫЛКУ
          </button>
        </div>

        <div class="extra-card">
          <h3>УСЛОВИЯ НАГРАЖДЕНИЯ</h3>

          <div class="referral-reward">
            <b>+${number(d.fixedReward)} SAT</b>
            <span>За первую добычу приглашённого игрока</span>
          </div>

          <div class="referral-reward">
            <b>${number(d.percentage)}%</b>
            <span>От каждой добычи приглашённого игрока</span>
          </div>

          <p class="extra-note">
            Награда автоматически поступает на твой баланс SAT.
            Приглашённый игрок также получает обычную награду за добычу.
          </p>
        </div>
      `;

      $('copyReferral')?.addEventListener('click', async () => {
        const input = $('referralLink');

        try {
          await navigator.clipboard.writeText(d.link);
          toast('Реферальная ссылка скопирована!');
        } catch (e) {
          input?.select();
          input?.setSelectionRange(0, 99999);

          const copied = document.execCommand('copy');
          toast(copied ? 'Ссылка скопирована!' : 'Выдели и скопируй ссылку');
        }
      });

    } catch (e) {
      p.innerHTML = `<div class="extra-card">${escapeHtml(e.message)}</div>`;
    }
  }
    if (page === 'inventory') loadInventory();

    if (page === 'shop') {
      shop?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    } else {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }

  // Экран майнинг-пула.
  async function loadPool() {
    const p = ensurePanel();

    p.hidden = false;
    p.innerHTML = '<div class="extra-card">ЗАГРУЗКА МАЙНИНГ-ПУЛА...</div>';

    try {
      const d = await api('/api/pool');

      p.innerHTML = `
        <div class="extra-heading">
          <small>SHARED MINING NETWORK</small>
          <h2>Майнинг-пул</h2>
          <p>5% каждой добычи попадает в общий фонд.</p>
        </div>

        <div class="extra-card pool-fund">
          <small>ОБЩИЙ ФОНД СЕГОДНЯ</small>
          <strong>${sat(d.fund)} SAT</strong>
          <span>Раунд ${d.round}</span>
        </div>

        <div class="extra-grid">
          <div class="extra-card">
            <small>УЧАСТНИКИ</small>
            <strong>${number(d.participants)}</strong>
          </div>

          <div class="extra-card">
            <small>МОЩНОСТЬ СЕТИ</small>
            <strong>${sat(d.totalPower)}</strong>
          </div>
        </div>

        <div class="extra-card">
          <h3>ТВОЙ ВКЛАД</h3>

          <div class="extra-line">
            <span>Мощность</span>
            <b>${sat(d.myPower)}</b>
          </div>

          <div class="extra-line">
            <span>Активность</span>
            <b>${number(d.myActivity)}</b>
          </div>

          <div class="extra-line">
            <span>Оценка награды</span>
            <b>${sat(d.estimatedReward)} SAT</b>
          </div>
        </div>

        <div class="extra-card">
          <h3>РАСПРЕДЕЛЕНИЕ НАГРАД</h3>

          <div class="reward-bar">
            <i style="width:70%"></i>
          </div>

          <div class="extra-line">
            <span>Мощность фермы</span>
            <b>70%</b>
          </div>

          <div class="reward-bar activity">
            <i style="width:30%"></i>
          </div>

          <div class="extra-line">
            <span>Активность игроков</span>
            <b>30%</b>
          </div>

          <p class="extra-note">
            Награда начисляется при завершении суточного раунда.
          </p>
        </div>
      `;

    } catch (e) {
      p.innerHTML = `<div class="extra-card">${e.message}</div>`;
    }
  }

  // Экран рейтинга.
  async function loadLeaderboard() {
    const p = ensurePanel();

    p.hidden = false;
    p.innerHTML = '<div class="extra-card">ЗАГРУЗКА РЕЙТИНГА...</div>';

    try {
      const d = await api('/api/leaderboard');

      const rows = d.players.map((x, i) => `
        <div class="rank-row">
          <span class="rank-number">${i + 1}</span>

          <div class="rank-person">
            <b>${escapeHtml(x.username || 'Miner')}</b>
            <small>
              ${number(x.gpu)} GPU · ${number(x.asic)} ASIC
            </small>
          </div>

          <div class="rank-power">
            <b>${number(x.rate)}</b>
            <small>SAT/SEC</small>
          </div>
        </div>
      `).join('');

      p.innerHTML = `
        <div class="extra-heading">
          <small>GLOBAL MINERS</small>
          <h2>Рейтинг игроков</h2>
        </div>

        <div class="extra-card my-rank">
          <small>ТВОЯ ПОЗИЦИЯ</small>
          <strong>${d.myPosition ? `#${d.myPosition}` : '—'}</strong>
        </div>

        <div class="extra-card">
          <div class="rank-header">
            <span>ИГРОК</span>
            <span>МОЩНОСТЬ</span>
          </div>

          ${rows || '<p>Пока нет игроков.</p>'}
        </div>
      `;

    } catch (e) {
      p.innerHTML = `<div class="extra-card">${e.message}</div>`;
    }
  }

  // Экран коллекции видеокарт.
  async function loadInventory() {
    const p = ensurePanel();

    p.hidden = false;
    p.innerHTML = '<div class="extra-card">ЗАГРУЗКА ИНВЕНТАРЯ...</div>';

    try {
      const d = await api('/api/inventory');

      const rows = d.items.map(x => `
        <div class="gpu-card ${x.rarity}">
          <div>
            <b>${x.rarity.toUpperCase()} GPU</b>
            <small>
              Мощность: +${x.power} ·
              ${new Date(x.acquired_at * 1000).toLocaleDateString('ru-RU')}
            </small>
          </div>
          <span>◆</span>
        </div>
      `).join('');

      p.innerHTML = `
        <div class="extra-heading">
          <small>HARDWARE COLLECTION</small>
          <h2>Коллекция GPU</h2>
          <p>Редкость определяется случайно при покупке.</p>
        </div>

        <div class="extra-card">
          <div class="rarity-list">
            ${Object.entries(d.rarityCounts).map(([k, v]) => `
              <span class="rarity ${k}">
                ${k.toUpperCase()} <b>${v}</b>
              </span>
            `).join('')}
          </div>
        </div>

        <div class="extra-card">
          ${rows || '<p>Пока нет видеокарт. Купи GPU в магазине.</p>'}
        </div>
      `;

    } catch (e) {
      p.innerHTML = `<div class="extra-card">${e.message}</div>`;
    }
  }

  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  // Дополнительный магазин.
  function addShop() {
    const shop = document.querySelector('.shop');

    if (!shop || $('advancedShop')) return;

    const section = document.createElement('section');

    section.id = 'advancedShop';

    section.innerHTML = `
      <div class="section-heading">
        <div>
          <small>GENERATION II / III</small>
          <h2>Новое оборудование</h2>
        </div>
      </div>

      ${card(
        'asic_mk2',
        'ASIC / TITAN MK2',
        '+20 SAT / сек · Второе поколение',
        'ASIC II'
      )}

      ${card(
        'asic_mk3',
        'ASIC / TITAN MK3',
        '+50 SAT / сек · Третье поколение',
        'ASIC III'
      )}

      <div class="section-heading upgrade-heading">
        <div>
          <small>FARM SYSTEMS</small>
          <h2>Инфраструктура</h2>
        </div>
      </div>

      ${card(
        'cooling',
        'Жидкостное охлаждение',
        '+5% к мощности за уровень',
        'COOL'
      )}

      ${card(
        'energy',
        'Энергосистема',
        '+10% к мощности за уровень',
        'POWER'
      )}

      ${card(
        'automation',
        'Автоматизация',
        '+5% к мощности за уровень',
        'AUTO'
      )}

      <div class="extra-card">
        <h3>ПРОГРЕСС И БОНУСЫ</h3>
        <div id="upgradeSummary"></div>

        <h3>РЕДКОСТЬ ВИДЕОКАРТ</h3>
        <div id="raritySummary" class="rarity-list"></div>

        <button class="inventory-link" id="openInventory">
          ОТКРЫТЬ ИНВЕНТАРЬ GPU →
        </button>
      </div>
    `;

    shop.appendChild(section);

    section.querySelectorAll('[data-type]').forEach(b => {
      b.addEventListener('click', () => buy(b.dataset.type));
    });

    $('openInventory')?.addEventListener(
      'click',
      () => showPage('inventory')
    );

    const nav = document.querySelector('.bottom-nav');

    if (nav && !$('navInventory')) {
      const b = document.createElement('button');

      b.id = 'navInventory';
      b.innerHTML = '<span>▤</span>GPU';

      b.addEventListener('click', () => {
        showPage('inventory');
      });

      nav.appendChild(b);
    }

    if (nav && !$('navReferrals')) {
      const b = document.createElement('button');

      b.id = 'navReferrals';
      b.innerHTML = '<span>♧</span>REF';

      b.addEventListener('click', () => {
        showPage('referrals');
      });

      nav.appendChild(b);
    }

    if (nav) {
      nav.style.gridTemplateColumns = 'repeat(6, minmax(0, 1fr))';
    }
  }

  function card(type, title, desc, icon) {
    return `
      <article class="item">
        <div class="item-icon">${icon}</div>

        <div class="item-info">
          <b>${title}</b>
          <small>${desc}</small>

          <strong>
            Цена: <span data-price>0</span> SAT
          </strong>
        </div>

        <button
          type="button"
          data-type="${type}"
          data-cost
        >
          КУПИТЬ
        </button>
      </article>
    `;
  }

  // Стили новых экранов.
  function addStyles() {
    if ($('v3styles')) return;

    const s = document.createElement('style');

    s.id = 'v3styles';

    s.textContent = `
      [hidden] {
        display: none !important;
      }

      .extra-panel {
        margin-top: 20px;
      }

      .extra-heading {
        margin: 8px 0 14px;
      }

      .extra-heading small,
      .extra-card > small {
        font-size: 9px;
        color: var(--muted);
        letter-spacing: 1px;
      }

      .extra-heading h2 {
        font-size: 20px;
        margin: 8px 0;
      }

      .extra-heading p,
      .extra-note {
        font-size: 10px;
        color: var(--muted);
        line-height: 1.6;
      }

      .extra-card {
        background: var(--panel);
        border: 1px solid var(--line);
        padding: 14px;
        margin-bottom: 10px;
      }

      .extra-card h3 {
        font-size: 11px;
        margin: 0 0 13px;
        color: var(--gold);
      }

      .pool-fund strong,
      .my-rank strong {
        display: block;
        font-size: 28px;
        color: var(--gold);
        margin: 12px 0;
      }

      .pool-fund span {
        font-size: 9px;
        color: var(--muted);
      }

      .extra-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .extra-grid .extra-card strong {
        display: block;
        font-size: 20px;
        color: var(--gold);
        margin-top: 10px;
      }

      .extra-line {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 0;
        border-bottom: 1px solid var(--line);
        font-size: 10px;
      }

      .extra-line span {
        color: var(--muted);
      }

      .extra-line b {
        color: var(--gold);
      }

      .reward-bar {
        height: 7px;
        background: #30323a;
        margin: 10px 0 5px;
      }

      .reward-bar i {
        display: block;
        height: 100%;
        background: var(--gold);
      }

      .reward-bar.activity i {
        background: var(--green);
      }

      .rank-header,
      .rank-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .rank-header {
        font-size: 8px;
        color: var(--muted);
        padding-bottom: 10px;
      }

      .rank-row {
        padding: 11px 0;
        border-top: 1px solid var(--line);
      }

      .rank-number {
        width: 23px;
        color: var(--gold);
        font-weight: bold;
      }

      .rank-person {
        flex: 1;
        min-width: 0;
      }

      .rank-person b,
      .rank-person small,
      .rank-power b,
      .rank-power small {
        display: block;
      }

      .rank-person b {
        font-size: 10px;
      }

      .rank-person small,
      .rank-power small {
        font-size: 8px;
        color: var(--muted);
        margin-top: 5px;
      }

      .rank-power {
        text-align: right;
      }

      .rank-power b {
        font-size: 11px;
        color: var(--gold);
      }

      .rarity-list {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin: 8px 0 12px;
      }

      .rarity {
        font-size: 8px;
        padding: 7px;
        border: 1px solid var(--line);
        color: var(--white);
      }

      .rarity b {
        margin-left: 5px;
      }

      .rarity.common {
        color: #b7bdc8;
      }

      .rarity.rare {
        color: #65a9ff;
      }

      .rarity.epic {
        color: #c28aff;
      }

      .rarity.legendary {
        color: #ffc857;
        border-color: #8c6a2c;
      }

      .gpu-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        border-bottom: 1px solid var(--line);
      }

      .gpu-card b,
      .gpu-card small {
        display: block;
      }

      .gpu-card b {
        font-size: 10px;
      }

      .gpu-card small {
        font-size: 8px;
        color: var(--muted);
        margin-top: 5px;
      }

      .gpu-card span {
        font-size: 18px;
      }

      .gpu-card.rare b {
        color: #65a9ff;
      }

      .gpu-card.epic b {
        color: #c28aff;
      }

      .gpu-card.legendary b {
        color: #ffc857;
      }

      .inventory-link {
        width: 100%;
        padding: 12px;
        margin-top: 10px;
        background: #2a2418;
        color: var(--gold);
        border: 1px solid #9b783d;
        font: 10px 'Roboto Mono';
      }

      .item button:disabled {
        opacity: 0.35;
      }
            .referral-main strong {
        display: block;
        font-size: 30px;
        color: var(--gold);
        margin: 14px 0 7px;
      }

      .referral-main span {
        font-size: 9px;
        color: var(--muted);
      }

      .referral-input {
        width: 100%;
        box-sizing: border-box;
        padding: 12px;
        margin: 5px 0 10px;
        background: #101114;
        border: 1px solid var(--line);
        color: var(--gold);
        font: 10px 'Roboto Mono';
        border-radius: 4px;
      }

      .referral-reward {
        padding: 12px 0;
        border-bottom: 1px solid var(--line);
      }

      .referral-reward b {
        display: block;
        color: var(--gold);
        font-size: 19px;
        margin-bottom: 5px;
      }

      .referral-reward span {
        color: var(--muted);
        font-size: 9px;
      }

      #navReferrals,
      #navInventory {
        font-size: 8px;
        min-width: 0;
        padding-left: 2px;
        padding-right: 2px;
      }

      #navReferrals span,
      #navInventory span {
        display: block;
        font-size: 15px;
        margin-bottom: 3px;
      }
    `;

    document.head.appendChild(s);
  }

  // Подключение кнопок старого интерфейса.
  $('mineButton')?.addEventListener('click', mine);

  $('buyGpu')?.addEventListener('click', () => buy('gpu'));
  $('buyAsic')?.addEventListener('click', () => buy('asic'));
  $('buyBoost')?.addEventListener('click', () => buy('boost'));

  document.querySelector(
    '.bottom-nav button:first-child'
  )?.addEventListener('click', () => showPage('farm'));

  $('navShop')?.addEventListener(
    'click',
    () => showPage('shop')
  );

  $('navPool')?.addEventListener(
    'click',
    () => showPage('pool')
  );

  $('navRank')?.addEventListener(
    'click',
    () => showPage('rank')
  );

  addStyles();
  addShop();
  refresh();
  
// Обновление обратного отсчёта SAT HALVING.
setInterval(() => {
  if (halvingData) renderHalving(halvingData);
}, 1000);
  // Локальное обновление отображаемого баланса.
  setInterval(() => {
    if (
      !player ||
      activePage === 'pool' ||
      activePage === 'rank' ||
      activePage === 'inventory'
    ) {
      return;
    }

    player.sat += player.rate * 0.05 * 0.95 * (halvingData?.factor ?? 1);

    if ($('sat')) {
      $('sat').textContent = sat(player.sat);
    }
  }, 1000);
})();
