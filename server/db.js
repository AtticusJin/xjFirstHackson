/* 数据库初始化（Node 内置 SQLite，零原生依赖） */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { PLAYERS, SCHEDULES, ANNOUNCEMENTS, AV } = require('./seed-data');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'xjhack.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nickname TEXT,
  role TEXT,
  grade TEXT,
  dorm TEXT,
  intro TEXT,
  tags TEXT,
  wechat TEXT,
  avatar TEXT,
  claimed_by INTEGER,
  claim_email TEXT,
  status TEXT DEFAULT 'unclaimed',
  self_registered INTEGER DEFAULT 0,
  contact TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  player_id INTEGER,
  wechat_openid TEXT UNIQUE,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  wechat TEXT,
  email TEXT,
  claim_token TEXT UNIQUE,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT, time TEXT, title TEXT, desc TEXT, status TEXT, sort INTEGER
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT, title TEXT, body TEXT, time TEXT, pinned INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slogan TEXT,
  role_needs TEXT,
  intro TEXT,
  project_name TEXT,
  project_desc TEXT,
  project_status TEXT DEFAULT 'recruiting',
  leader_id INTEGER NOT NULL,
  status TEXT DEFAULT 'recruiting',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  joined_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS team_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  msg TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS waiting_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL UNIQUE,
  msg TEXT,
  status TEXT DEFAULT 'waiting',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);
/* 老库升级：补列（幂等） */
try { db.exec("ALTER TABLE players ADD COLUMN self_registered INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE players ADD COLUMN contact TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE players ADD COLUMN retired INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE waiting_pool ADD COLUMN note TEXT"); } catch (e) {}

/* seed：仅在表为空时填充 */
function seedIfEmpty() {
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM players').get();
  if (cnt.c > 0) return;
  const ins = db.prepare('INSERT INTO players (name,nickname,role,grade,dorm,intro,tags,wechat,avatar,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
  PLAYERS.forEach((p, i) => ins.run(p.name, p.nickname, p.role, p.grade, p.dorm, p.intro, p.tags, p.wechat, AV[i] || null, 'unclaimed'));
  const insS = db.prepare('INSERT INTO schedules (day,time,title,desc,status,sort) VALUES (?,?,?,?,?,?)');
  SCHEDULES.forEach(s => insS.run(s.day, s.time, s.title, s.desc, s.status, s.sort));
  const insA = db.prepare('INSERT INTO announcements (tag,title,body,time,pinned) VALUES (?,?,?,?,?)');
  ANNOUNCEMENTS.forEach(a => insA.run(a.tag, a.title, a.body, a.time, a.pinned));
  console.log(`[db] seed 完成：${PLAYERS.length} 选手 / ${SCHEDULES.length} 赛程 / ${ANNOUNCEMENTS.length} 公告`);
}
seedIfEmpty();

module.exports = db;
