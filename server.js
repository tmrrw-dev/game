
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
  telegram_id TEXT PRIMARY KEY,
  username TEXT,
  sat REAL NOT NULL DEFAULT 0,
  gram REAL NOT NULL DEFAULT 0,
  gpu INTEGER NOT NULL DEFAULT 0,
  asic INTEGER NOT NULL DEFAULT 0,
  boosts INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  last_claim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  round_id TEXT NOT NULL,
  fund REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pool_entries (
  round_id TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  power REAL NOT NULL DEFAULT 0,
  activity INTEGER NOT NULL DEFAULT 0,
  reward REAL NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS pool_history (
  round_id TEXT PRIMARY KEY,
  fund REAL NOT NULL,
  participants INTEGER NOT NULL,
  distributed REAL NOT NULL,
  finished_at INTEGER NOT NULL
);
`);

// Миграция старой базы: добавляем время последнего клика.
const playerColumns = db.prepare('PRAGMA table_info(players)').all();
if (!playerColumns.some(c => c.name === 'last_click')) {
  db.exec('ALTER TABLE players ADD COLUMN last_click INTEGER NOT NULL DEFAULT 0');
}

function dayId(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

const today = dayId();

db.prepare(`
  INSERT OR IGNORE INTO pool_state (id, round_id, fund)
  VALUES (1, ?, 0)
`).run(today);

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const expected = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
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
  const initData = req.get('x-telegram-init-data') || '';
  const user = verifyTelegramInitData(initData);

  if (user && user.id) {
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
  let player = db.prepare(
    'SELECT * FROM players WHERE telegram_id = ?'
  ).get(id);

  if (!player) {
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO players
      (telegram_id, username, last_claim, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, username, now, now);

    player = db.prepare(
      'SELECT * FROM players WHERE telegram_id = ?'
    ).get(id);
  } else if (username && username !== player.username) {
    db.prepare(
      'UPDATE players SET username = ? WHERE telegram_id = ?'
    ).run(username, id);

    player.username = username;
  }

  return player;
}

function costs(player) {
  return {
    gpu: Math.floor(50 * Math.pow(1.18, player.gpu)),
    asic: Math.floor(350 * Math.pow(1.22, player.asic)),
    boost: Math.floor(100 * Math.pow(1.65, player.boosts))
  };
}

function power(player) {
  return player.gpu + player.asic * 8;
}

function clickPower(player) {
  return 1 + player.boosts;
}

// Начисление награды за завершившийся раунд.
// 70% веса — мощность, 30% — активность.
function finishRound(oldRoundId) {
  const state = db.prepare(
    'SELECT * FROM pool_state WHERE id = 1'
  ).get();

  if (!state || state.round_id !== oldRoundId) return;

  const entries = db.prepare(`
    SELECT * FROM pool_entries
    WHERE round_id = ?
  `).all(oldRoundId);

  const fund = Number(state.fund || 0);
  if (!entries.length || fund <= 0) return;

  const totalPower = entries.reduce((sum, e) => sum + e.power, 0);
  const totalActivity = entries.reduce((sum, e) => sum + e.activity, 0);

  let distributed = 0;

  const pay = db.transaction(() => {
    for (const entry of entries) {
      const powerShare = totalPower > 0
        ? entry.power / totalPower
        : 0;

      const activityShare = totalActivity > 0
        ? entry.activity / totalActivity
        : 0;

      const score = powerShare * 0.7 + activityShare * 0.3;
      const reward = Math.floor(fund * score * 100) / 100;

      if (reward <= 0) continue;

      db.prepare(`
        UPDATE players
        SET sat = sat + ?
        WHERE telegram_id = ?
      `).run(reward, entry.telegram_id);

      db.prepare(`
        UPDATE pool_entries
        SET reward = ?, claimed = 1
        WHERE round_id = ? AND telegram_id = ?
      `).run(reward, oldRoundId, entry.telegram_id);

      distributed += reward;
    }

    db.prepare(`
      INSERT OR REPLACE INTO pool_history
      (round_id, fund, participants, distributed, finished_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      oldRoundId,
      fund,
      entries.length,
      distributed,
      Math.floor(Date.now() / 1000)
    );
  });

  pay();
}

function ensurePoolRound() {
  const currentDay = dayId();
  const state = db.prepare(
    'SELECT * FROM pool_state WHERE id = 1'
  ).get();

  if (state.round_id !== currentDay) {
    finishRound(state.round_id);

    db.prepare(`
      UPDATE pool_state
      SET round_id = ?, fund = 0
      WHERE id = 1
    `).run(currentDay);
  }
}

function addPoolFund(amount) {
  if (amount <= 0) return;

  ensurePoolRound();

  db.prepare(`
    UPDATE pool_state
    SET fund = fund + ?
    WHERE id = 1
  `).run(amount);
}

function updatePoolEntry(player, activity = 0) {
  ensurePoolRound();

  const roundId = dayId();
  const playerPower = power(player);

  db.prepare(`
    INSERT INTO pool_entries
    (round_id, telegram_id, power, activity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(round_id, telegram_id)
    DO UPDATE SET
      power = excluded.power,
      activity = MIN(500, pool_entries.activity + excluded.activity)
  `).run(roundId, player.telegram_id, playerPower, activity);
}

function settle(player) {
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(
    0,
    Math.min(8 * 60 * 60, now - player.last_claim)
  );

  const gross = elapsed * power(player);
  const poolPart = gross * 0.05;
  const earned = gross - poolPart;

  if (elapsed > 0) {
    db.prepare(`
      UPDATE players
      SET sat = sat + ?, last_claim = ?
      WHERE telegram_id = ?
    `).run(earned, now, player.telegram_id);

    player.sat += earned;
    player.last_claim = now;

    addPoolFund(poolPart);
  }

  return Math.floor(earned);
}

function snapshot(player, offline = 0) {
  const currentPower = power(player);

  return {
    username: player.username,
    sat: Math.floor(player.sat * 100) / 100,
    gram: Number(player.gram || 0),
    gpu: player.gpu,
    asic: player.asic,
    boosts: player.boosts,
    rate: currentPower,
    clickPower: clickPower(player),
    costs: costs(player),
    totalClicks: player.total_clicks,
    offlineEarned: offline
  };
}

app.get('/api/session', authenticate, (req, res) => {
  const player = getPlayer(req.playerId, req.username);
  const offline = settle(player);

  updatePoolEntry(player, 0);

  const updated = db.prepare(
    'SELECT * FROM players WHERE telegram_id = ?'
  ).get(player.telegram_id);

  res.json(snapshot(updated, offline));
});

app.post('/api/mine', authenticate, (req, res) => {
  const player = getPlayer(req.playerId, req.username);
  settle(player);

  const now = Math.floor(Date.now() / 1000);

  // Простая защита от автоматической отправки сотен кликов в секунду.
  if (now - player.last_click < 0.12) {
    return res.status(429).json({ error: 'Слишком быстро. Попробуй ещё раз.' });
  }

  const gain = clickPower(player);
  const poolPart = gain * 0.05;
  const earned = gain - poolPart;

  db.prepare(`
    UPDATE players
    SET sat = sat + ?,
        total_clicks = total_clicks + 1,
        last_click = ?
    WHERE telegram_id = ?
  `).run(earned, now, player.telegram_id);

  addPoolFund(poolPart);

  player.sat += earned;
  player.total_clicks += 1;
  player.last_click = now;

  updatePoolEntry(player, 1);

  const updated = db.prepare(
    'SELECT * FROM players WHERE telegram_id = ?'
  ).get(player.telegram_id);

  res.json({
    gain: earned,
    ...snapshot(updated)
  });
});

app.post('/api/buy', authenticate, (req, res) => {
  const type = String(req.body?.type || '');

  if (!['gpu', 'asic', 'boost'].includes(type)) {
    return res.status(400).json({ error: 'Неизвестный товар.' });
  }

  const player = getPlayer(req.playerId, req.username);
  settle(player);

  const price = costs(player)[type];

  if (player.sat < price) {
    return res.status(400).json({ error: 'Недостаточно SAT.' });
  }

  const column = type === 'boost' ? 'boosts' : type;

  const buy = db.transaction(() => {
    const result = db.prepare(`
      UPDATE players
      SET sat = sat - ?, ${column} = ${column} + 1
      WHERE telegram_id = ? AND sat >= ?
    `).run(price, player.telegram_id, price);

    if (result.changes !== 1) {
      throw new Error('Недостаточно SAT.');
    }
  });

  try {
    buy();
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const updated = db.prepare(
    'SELECT * FROM players WHERE telegram_id = ?'
  ).get(player.telegram_id);

  updatePoolEntry(updated, 0);

  res.json(snapshot(updated));
});

app.get('/api/pool', authenticate, (req, res) => {
  const player = getPlayer(req.playerId, req.username);
  settle(player);
  updatePoolEntry(player, 0);

  const state = db.prepare(
    'SELECT * FROM pool_state WHERE id = 1'
  ).get();

  const entries = db.prepare(`
    SELECT
      e.telegram_id,
      e.power,
      e.activity,
      p.username
    FROM pool_entries e
    JOIN players p ON p.telegram_id = e.telegram_id
    WHERE e.round_id = ?
  `).all(state.round_id);

  const totalPower = entries.reduce((s, e) => s + e.power, 0);
  const totalActivity = entries.reduce((s, e) => s + e.activity, 0);

  const mine = entries.find(e => e.telegram_id === player.telegram_id);

  const myPowerShare = mine && totalPower > 0
    ? mine.power / totalPower
    : 0;

  const myActivityShare = mine && totalActivity > 0
    ? mine.activity / totalActivity
    : 0;

  const estimatedShare = myPowerShare * 0.7 + myActivityShare * 0.3;

  res.json({
    round: state.round_id,
    fund: Number(state.fund.toFixed(2)),
    participants: entries.length,
    totalPower,
    totalActivity,
    myPower: mine?.power || 0,
    myActivity: mine?.activity || 0,
    estimatedReward: Number((state.fund * estimatedShare).toFixed(2)),
    powerWeight: 70,
    activityWeight: 30
  });
});

app.get('/api/leaderboard', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT
      username,
      sat,
      gpu,
      asic,
      boosts,
      total_clicks,
      (gpu + asic * 8) AS rate
    FROM players
    ORDER BY rate DESC, total_clicks DESC, sat DESC
    LIMIT 20
  `).all();

  const rank = db.prepare(`
    SELECT COUNT(*) + 1 AS position
    FROM players
    WHERE (gpu + asic * 8) > (
      SELECT (gpu + asic * 8)
      FROM players WHERE telegram_id = ?
    )
  `).get(req.playerId);

  res.json({
    players: rows,
    myPosition: rank?.position || null
  });
});

app.get('/health', (_, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`SATOSHI server listening on :${PORT}`);
});
