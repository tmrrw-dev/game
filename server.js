require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV_MODE = process.env.DEV_MODE === 'true';
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const db = new Database(path.join(DB_DIR, 'game.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  telegram_id TEXT PRIMARY KEY, username TEXT, sat REAL NOT NULL DEFAULT 0,
  gram REAL NOT NULL DEFAULT 0, gpu INTEGER NOT NULL DEFAULT 0,
  asic INTEGER NOT NULL DEFAULT 0, boosts INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0, last_claim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pool_state (
  id INTEGER PRIMARY KEY CHECK(id=1), round_id TEXT NOT NULL, fund REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pool_entries (
  round_id TEXT NOT NULL, telegram_id TEXT NOT NULL, power REAL NOT NULL DEFAULT 0,
  activity INTEGER NOT NULL DEFAULT 0, reward REAL NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(round_id,telegram_id)
);
CREATE TABLE IF NOT EXISTS pool_history (
  round_id TEXT PRIMARY KEY, fund REAL NOT NULL, participants INTEGER NOT NULL,
  distributed REAL NOT NULL, finished_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gpu_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
  rarity TEXT NOT NULL, power INTEGER NOT NULL, acquired_at INTEGER NOT NULL
);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('players', 'last_click', 'INTEGER NOT NULL DEFAULT 0');

for (const [name, def] of [
  ['gpu_power', 'INTEGER NOT NULL DEFAULT 0'],
  ['asic_mk2', 'INTEGER NOT NULL DEFAULT 0'],
  ['asic_mk3', 'INTEGER NOT NULL DEFAULT 0'],
  ['cooling', 'INTEGER NOT NULL DEFAULT 0'],
  ['energy', 'INTEGER NOT NULL DEFAULT 0'],
  ['automation', 'INTEGER NOT NULL DEFAULT 0']
]) {
  ensureColumn('players', name, def);
}

const dayId = (t = Date.now()) =>
  new Date(t).toISOString().slice(0, 10);

db.prepare(
  'INSERT OR IGNORE INTO pool_state(id,round_id,fund) VALUES(1,?,0)'
).run(dayId());

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const expected = crypto
    .createHmac('sha256', secret)
    .update(check)
    .digest('hex');

  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(params.get('user') || '{}');
  } catch {
    return null;
  }
}

function authenticate(req, res, next) {
  const user = verifyTelegramInitData(
    req.get('x-telegram-init-data') || ''
  );

  if (user?.id) {
    req.playerId = String(user.id);
    req.username = user.username || user.first_name || 'Miner';
    return next();
  }

  if (DEV_MODE) {
    req.playerId = 'local-demo';
    req.username = 'Local Miner';
    return next();
  }

  return res.status(401).json({
    error: 'Открой игру через Telegram.'
  });
}

function getPlayer(id, username) {
  let p = db.prepare(
    'SELECT * FROM players WHERE telegram_id=?'
  ).get(id);

  if (!p) {
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO players(telegram_id,username,last_claim,created_at)
      VALUES(?,?,?,?)
    `).run(id, username, now, now);

    p = db.prepare(
      'SELECT * FROM players WHERE telegram_id=?'
    ).get(id);
  } else if (username && username !== p.username) {
    db.prepare(
      'UPDATE players SET username=? WHERE telegram_id=?'
    ).run(username, id);

    p.username = username;
  }

  return p;
}

const cost = (base, level, scale) =>
  Math.floor(base * Math.pow(scale, level));

function costs(p) {
  return {
    gpu: cost(50, p.gpu, 1.18),
    asic: cost(350, p.asic, 1.22),
    boost: cost(100, p.boosts, 1.65),

    asic_mk2: cost(1200, p.asic_mk2, 1.24),
    asic_mk3: cost(6000, p.asic_mk3, 1.27),

    cooling: cost(500, p.cooling, 1.55),
    energy: cost(900, p.energy, 1.6),
    automation: cost(1500, p.automation, 1.7)
  };
}

function setBonuses(p) {
  const gpuCount = Number(p.gpu || 0);

  const asicCount =
    Number(p.asic || 0) +
    Number(p.asic_mk2 || 0) +
    Number(p.asic_mk3 || 0);

  return {
    gpuSet: gpuCount >= 5 ? 5 : 0,
    asicSet: asicCount >= 3 ? 10 : 0
  };
}

function power(p) {
  const raw =
    Number(p.gpu || 0) +
    Number(p.gpu_power || 0) +
    Number(p.asic || 0) * 8 +
    Number(p.asic_mk2 || 0) * 20 +
    Number(p.asic_mk3 || 0) * 50;

  const bonus = setBonuses(p);

  return raw *
    (1 + Number(p.cooling || 0) * 0.05 +
         Number(p.energy || 0) * 0.10) *
    (1 + (bonus.gpuSet + bonus.asicSet) / 100) *
    (1 + Number(p.automation || 0) * 0.05);
}

function clickPower(p) {
  return 1 + Number(p.boosts || 0);
}

// Редкость GPU определяется только на сервере.
function gpuDrop() {
  const n = Math.random();

  if (n < 0.01) {
    return { rarity: 'legendary', power: 8 };
  }

  if (n < 0.08) {
    return { rarity: 'epic', power: 4 };
  }

  if (n < 0.28) {
    return { rarity: 'rare', power: 2 };
  }

  return { rarity: 'common', power: 1 };
}

function finishRound(oldRoundId) {
  const state = db.prepare(
    'SELECT * FROM pool_state WHERE id=1'
  ).get();

  if (!state || state.round_id !== oldRoundId) return;

  const entries = db.prepare(
    'SELECT * FROM pool_entries WHERE round_id=?'
  ).all(oldRoundId);

  const fund = Number(state.fund || 0);

  if (!entries.length || fund <= 0) {
    db.prepare(`
      INSERT OR REPLACE INTO pool_history
      (round_id,fund,participants,distributed,finished_at)
      VALUES(?,?,?,?,?)
    `).run(
      oldRoundId,
      fund,
      entries.length,
      0,
      Math.floor(Date.now() / 1000)
    );

    return;
  }

  const totalPower = entries.reduce(
    (s, e) => s + e.power, 0
  );

  const totalActivity = entries.reduce(
    (s, e) => s + e.activity, 0
  );

  let distributed = 0;

  db.transaction(() => {
    for (const e of entries) {
      const ps = totalPower > 0 ? e.power / totalPower : 0;
      const as = totalActivity > 0 ? e.activity / totalActivity : 0;

      const reward = Math.floor(
        fund * (ps * 0.7 + as * 0.3) * 100
      ) / 100;

      if (reward <= 0) continue;

      db.prepare(
        'UPDATE players SET sat=sat+? WHERE telegram_id=?'
      ).run(reward, e.telegram_id);

      db.prepare(`
        UPDATE pool_entries
        SET reward=?,claimed=1
        WHERE round_id=? AND telegram_id=?
      `).run(reward, oldRoundId, e.telegram_id);

      distributed += reward;
    }

    db.prepare(`
      INSERT OR REPLACE INTO pool_history
      (round_id,fund,participants,distributed,finished_at)
      VALUES(?,?,?,?,?)
    `).run(
      oldRoundId,
      fund,
      entries.length,
      distributed,
      Math.floor(Date.now() / 1000)
    );
  })();
}

function ensurePoolRound() {
  const current = dayId();

  const state = db.prepare(
    'SELECT * FROM pool_state WHERE id=1'
  ).get();

  if (state.round_id !== current) {
    finishRound(state.round_id);

    db.prepare(
      'UPDATE pool_state SET round_id=?,fund=0 WHERE id=1'
    ).run(current);
  }
}

function addPoolFund(amount) {
  if (amount <= 0) return;

  ensurePoolRound();

  db.prepare(
    'UPDATE pool_state SET fund=fund+? WHERE id=1'
  ).run(amount);
}

function updatePoolEntry(p, activity = 0) {
  ensurePoolRound();

  db.prepare(`
    INSERT INTO pool_entries(round_id,telegram_id,power,activity)
    VALUES(?,?,?,?)
    ON CONFLICT(round_id,telegram_id)
    DO UPDATE SET
      power=excluded.power,
      activity=MIN(500,pool_entries.activity+excluded.activity)
  `).run(
    dayId(),
    p.telegram_id,
    power(p),
    activity
  );
}

function settle(p) {
  const now = Math.floor(Date.now() / 1000);

  const elapsed = Math.max(
    0,
    Math.min(8 * 3600, now - Number(p.last_claim || now))
  );

  const gross = elapsed * power(p);
  const poolPart = gross * 0.05;
  const earned = gross - poolPart;

  if (elapsed > 0) {
    db.prepare(`
      UPDATE players
      SET sat=sat+?,last_claim=?
      WHERE telegram_id=?
    `).run(earned, now, p.telegram_id);

    p.sat = Number(p.sat || 0) + earned;
    p.last_claim = now;

    addPoolFund(poolPart);
  }

  return earned;
}

function snapshot(p, offline = 0) {
  const counts = db.prepare(`
    SELECT rarity,COUNT(*) AS count
    FROM gpu_inventory
    WHERE telegram_id=?
    GROUP BY rarity
  `).all(p.telegram_id);

  const rarityCounts = {
    common: 0,
    rare: 0,
    epic: 0,
    legendary: 0
  };

  counts.forEach(x => {
    rarityCounts[x.rarity] = x.count;
  });

  return {
    username: p.username,
    sat: Math.floor(Number(p.sat || 0) * 100) / 100,
    gram: Number(p.gram || 0),

    gpu: p.gpu,
    asic: p.asic,
    boosts: p.boosts,

    rate: power(p),
    clickPower: clickPower(p),
    costs: costs(p),

    totalClicks: p.total_clicks,
    offlineEarned: offline,

    gpuPower: p.gpu_power || 0,
    asicMk2: p.asic_mk2 || 0,
    asicMk3: p.asic_mk3 || 0,

    cooling: p.cooling || 0,
    energy: p.energy || 0,
    automation: p.automation || 0,

    bonuses: setBonuses(p),
    rarityCounts
  };
}

// Загрузка игрока.
app.get('/api/session', authenticate, (req, res) => {
  const p = getPlayer(req.playerId, req.username);
  const offline = settle(p);

  updatePoolEntry(p, 0);

  const updated = db.prepare(
    'SELECT * FROM players WHERE telegram_id=?'
  ).get(p.telegram_id);

  res.json(snapshot(updated, offline));
});

// Клик по центральной кнопке.
app.post('/api/mine', authenticate, (req, res) => {
  const p = getPlayer(req.playerId, req.username);

  settle(p);

  const now = Date.now();

  if (now - Number(p.last_click || 0) < 120) {
    return res.status(429).json({
      error: 'Слишком быстро. Попробуй ещё раз.'
    });
  }

  const gain = clickPower(p);
  const poolPart = gain * 0.05;
  const earned = gain - poolPart;

  db.prepare(`
    UPDATE players
    SET sat=sat+?,
        total_clicks=total_clicks+1,
        last_click=?
    WHERE telegram_id=?
  `).run(earned, now, p.telegram_id);

  addPoolFund(poolPart);

  p.sat = Number(p.sat || 0) + earned;
  p.total_clicks++;
  p.last_click = now;

  updatePoolEntry(p, 1);

  const updated = db.prepare(
    'SELECT * FROM players WHERE telegram_id=?'
  ).get(p.telegram_id);

  res.json({
    gain: earned,
    ...snapshot(updated)
  });
});

// Разрешённые типы покупок.
const purchaseTypes = {
  gpu: { column: 'gpu' },
  asic: { column: 'asic' },
  boost: { column: 'boosts' },

  asic_mk2: { column: 'asic_mk2' },
  asic_mk3: { column: 'asic_mk3' },

  cooling: { column: 'cooling' },
  energy: { column: 'energy' },
  automation: { column: 'automation' }
};

// Покупка оборудования и улучшений.
app.post('/api/buy', authenticate, (req, res) => {
  const type = String(req.body?.type || '');
  const item = purchaseTypes[type];

  if (!item) {
    return res.status(400).json({
      error: 'Неизвестное улучшение.'
    });
  }

  const p = getPlayer(req.playerId, req.username);

  settle(p);

  const price = costs(p)[type];

  if (p.sat < price) {
    return res.status(400).json({
      error: 'Недостаточно SAT.'
    });
  }

  try {
    db.transaction(() => {
      const result = db.prepare(`
        UPDATE players
        SET sat=sat-?,
            ${item.column}=${item.column}+1
        WHERE telegram_id=? AND sat>=?
      `).run(price, p.telegram_id, price);

      if (result.changes !== 1) {
        throw new Error('Недостаточно SAT.');
      }

      // При покупке GPU выдаём случайную редкость.
      if (type === 'gpu') {
        const drop = gpuDrop();

        db.prepare(`
          UPDATE players
          SET gpu_power=gpu_power+?
          WHERE telegram_id=?
        `).run(drop.power - 1, p.telegram_id);

        db.prepare(`
          INSERT INTO gpu_inventory
          (telegram_id,rarity,power,acquired_at)
          VALUES(?,?,?,?)
        `).run(
          p.telegram_id,
          drop.rarity,
          drop.power,
          Math.floor(Date.now() / 1000)
        );
      }
    })();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const updated = db.prepare(
    'SELECT * FROM players WHERE telegram_id=?'
  ).get(p.telegram_id);

  updatePoolEntry(updated, 0);

  res.json(snapshot(updated));
});

// Инвентарь видеокарт.
app.get('/api/inventory', authenticate, (req, res) => {
  const p = getPlayer(req.playerId, req.username);

  const items = db.prepare(`
    SELECT id,rarity,power,acquired_at
    FROM gpu_inventory
    WHERE telegram_id=?
    ORDER BY id DESC
    LIMIT 50
  `).all(p.telegram_id);

  res.json({
    items,
    rarityCounts: snapshot(p).rarityCounts
  });
});

// Информация о майнинг-пуле.
app.get('/api/pool', authenticate, (req, res) => {
  const p = getPlayer(req.playerId, req.username);

  settle(p);
  updatePoolEntry(p, 0);

  const state = db.prepare(
    'SELECT * FROM pool_state WHERE id=1'
  ).get();

  const entries = db.prepare(`
    SELECT e.telegram_id,e.power,e.activity,p.username
    FROM pool_entries e
    JOIN players p ON p.telegram_id=e.telegram_id
    WHERE e.round_id=?
  `).all(state.round_id);

  const tp = entries.reduce((s, e) => s + e.power, 0);
  const ta = entries.reduce((s, e) => s + e.activity, 0);

  const mine = entries.find(
    e => e.telegram_id === p.telegram_id
  );

  const estimate =
    (tp > 0 ? (mine?.power || 0) / tp * 0.7 : 0) +
    (ta > 0 ? (mine?.activity || 0) / ta * 0.3 : 0);

  res.json({
    round: state.round_id,
    fund: Number(state.fund.toFixed(2)),
    participants: entries.length,

    totalPower: tp,
    totalActivity: ta,

    myPower: mine?.power || 0,
    myActivity: mine?.activity || 0,

    estimatedReward: Number(
      (state.fund * estimate).toFixed(2)
    ),

    powerWeight: 70,
    activityWeight: 30
  });
});

// Рейтинг игроков.
app.get('/api/leaderboard', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT username,sat,gpu,asic,boosts,total_clicks,
      (gpu+asic*8+asic_mk2*20+asic_mk3*50+gpu_power) AS rate
    FROM players
    ORDER BY rate DESC,total_clicks DESC,sat DESC
    LIMIT 20
  `).all();

  const mine = db.prepare(
    'SELECT * FROM players WHERE telegram_id=?'
  ).get(req.playerId);

  const myRate = mine ? power(mine) : 0;

  const position = db.prepare(`
    SELECT COUNT(*)+1 AS position
    FROM players
    WHERE (gpu+asic*8+asic_mk2*20+asic_mk3*50+gpu_power)>?
  `).get(myRate);

  res.json({
    players: rows,
    myPosition: position?.position || null
  });
});

app.get('/health', (_, res) => {
  res.json({ ok: true, version: '0.3.0' });
});

app.listen(PORT, () => {
  console.log(`SATOSHI server listening on :${PORT}`);
});
