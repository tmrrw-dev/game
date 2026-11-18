require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'game.sqlite'));
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV_MODE = process.env.DEV_MODE === 'true';

app.use(express.json({limit:'32kb'}));
app.use(express.static(path.join(__dirname,'public')));

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
`);

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256',secret).update(dataCheckString).digest('hex');
  const a=Buffer.from(hash,'hex'), b=Buffer.from(expected,'hex');
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  const authDate=Number(params.get('auth_date')||0);
  if(!authDate || Date.now()/1000-authDate>86400) return null;
  try { return JSON.parse(params.get('user')||'{}'); } catch { return null; }
}

function authenticate(req,res,next) {
  const initData=req.get('x-telegram-init-data') || '';
  const user=verifyTelegramInitData(initData);
  if(user && user.id) { req.playerId=String(user.id); req.username=user.username||user.first_name||'Miner'; return next(); }
  if(DEV_MODE) { req.playerId='local-demo'; req.username='Local Miner'; return next(); }
  return res.status(401).json({error:'Telegram authentication failed. Open this app inside Telegram.'});
}
function getPlayer(id,username) {
  let p=db.prepare('SELECT * FROM players WHERE telegram_id=?').get(id);
  if(!p) {
    const now=Math.floor(Date.now()/1000);
    db.prepare('INSERT INTO players(telegram_id,username,last_claim,created_at) VALUES(?,?,?,?)').run(id,username,now,now);
    p=db.prepare('SELECT * FROM players WHERE telegram_id=?').get(id);
  } else if(username && username!==p.username) {
    db.prepare('UPDATE players SET username=? WHERE telegram_id=?').run(username,id);
    p.username=username;
  }
  return p;
}
const costs=p=>({gpu:Math.floor(50*Math.pow(1.18,p.gpu)),asic:Math.floor(350*Math.pow(1.22,p.asic)),boost:Math.floor(100*Math.pow(1.65,p.boosts))});
const rate=p=>p.gpu + p.asic*8;
const clickPower=p=>1+p.boosts;

function settle(p) {
  const now=Math.floor(Date.now()/1000);
  const elapsed=Math.max(0,Math.min(8*60*60,now-p.last_claim));
  const earned=Math.floor(elapsed*rate(p));
  if(earned>0 || now!==p.last_claim) {
    db.prepare('UPDATE players SET sat=sat+?,last_claim=? WHERE telegram_id=?').run(earned,now,p.telegram_id);
    p.sat+=earned;p.last_claim=now;
  }
  return earned;
}
function snapshot(p,offline=0) {
  return {username:p.username,sat:Math.floor(p.sat),gram:Number(p.gram),gpu:p.gpu,asic:p.asic,boosts:p.boosts,
    rate:rate(p),clickPower:clickPower(p),costs:costs(p),totalClicks:p.total_clicks,offlineEarned:offline};
}

app.get('/api/session',authenticate,(req,res)=>{
  const p=getPlayer(req.playerId,req.username);const offline=settle(p);
  res.json(snapshot(p,offline));
});
app.post('/api/mine',authenticate,(req,res)=>{
  const p=getPlayer(req.playerId,req.username);settle(p);
  const gain=clickPower(p);
  db.prepare('UPDATE players SET sat=sat+?,total_clicks=total_clicks+1 WHERE telegram_id=?').run(gain,p.telegram_id);
  p.sat+=gain;p.total_clicks++;
  res.json({gain,...snapshot(p)});
});
app.post('/api/buy',authenticate,(req,res)=>{
  const type=String(req.body?.type||'');
  if(!['gpu','asic','boost'].includes(type)) return res.status(400).json({error:'Unknown item'});
  const p=getPlayer(req.playerId,req.username);settle(p);
  const price=costs(p)[type];
  if(p.sat<price) return res.status(400).json({error:'Not enough SAT'});
  const col=type==='gpu'?'gpu':type==='asic'?'asic':'boosts';
  db.prepare(`UPDATE players SET sat=sat-?, ${col}=${col}+1 WHERE telegram_id=?`).run(price,p.telegram_id);
  const updated=db.prepare('SELECT * FROM players WHERE telegram_id=?').get(p.telegram_id);
  res.json(snapshot(updated));
});
app.get('/api/leaderboard',authenticate,(req,res)=>{
  const rows=db.prepare('SELECT username, gpu, asic, (gpu+asic*8) AS rate FROM players ORDER BY rate DESC LIMIT 20').all();
  res.json(rows);
});
app.get('/health',(_,res)=>res.json({ok:true,version:'0.2.0'}));
app.listen(PORT,()=>console.log(`SATOSHI server listening on :${PORT}`));
