/* server/store.js —— 双模式数据层
   - SQLite（本地默认，Node 内置 node:sqlite，零原生依赖，数据文件 data/xjhack.db）
   - PostgreSQL（扣子编程生产部署：检测到 DATABASE_URL 时自动启用，需 npm 依赖 pg）
   统一 API：init / get / all / run / exec（全部为异步 Promise）
   SQL 参数占位符统一使用 ?（内部自动翻译为 PG 的 $1..$n）
   时间口径：两种模式均存北京时间字符串 'YYYY-MM-DD HH:MM:SS'（SQLite localtime / PG Asia/Shanghai） */
const path = require('path');
const fs = require('fs');

const PG_URL = (process.env.DATABASE_URL || '').trim();
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'xjhack.db');

let sqlite = null;
let pgClient = null;
let mode = PG_URL ? 'pg' : 'sqlite';

/* SQL 参数占位符 ? -> $1..$n（本项目 SQL 的字符串字面量中不含 ?，安全） */
function qmarks(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/* PG 方言兼容：desc 是 PG 保留字（SQLite 允许作列名）。
   仅定向转义本项目用到 desc 列的两类位置（INSERT 列清单中的 `desc,` / UPDATE 的 `desc=?`），
   避免误伤 ORDER BY ... DESC（其后不是逗号/等号）。 */
function pgCompat(sql) {
  let s = qmarks(sql);
  s = s.replace(/\bdesc\b(?=\s*[,=])/g, '"desc"');
  return s;
}

/* ===== 建表 DDL（两套，语义一致） ===== */
const DDL_SQLITE = `
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
  contact TEXT,
  is_demo INTEGER DEFAULT 0,
  retired INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  player_id INTEGER,
  wechat_openid TEXT UNIQUE,
  password_hash TEXT,
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
  tag TEXT, title TEXT, body TEXT, time TEXT, pinned INTEGER DEFAULT 0,
  published INTEGER DEFAULT 1
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
CREATE TABLE IF NOT EXISTS site_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS site_like_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS site_like_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  ip TEXT,
  like_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS player_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  like_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(target_id, user_id, like_date)
);
`;

/* PG 版 DDL：逐条执行（pg 不支持多语句 query） */
const DDL_PG = [
  `CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, nickname TEXT, role TEXT, grade TEXT, dorm TEXT,
    intro TEXT, tags TEXT, wechat TEXT, avatar TEXT, claimed_by INTEGER, claim_email TEXT,
    status TEXT DEFAULT 'unclaimed', self_registered INTEGER DEFAULT 0, contact TEXT, is_demo INTEGER DEFAULT 0, retired INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, email TEXT UNIQUE, player_id INTEGER, wechat_openid TEXT UNIQUE,
    password_hash TEXT, is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS claims (
    id SERIAL PRIMARY KEY, player_id INTEGER NOT NULL, wechat TEXT, email TEXT, claim_token TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS codes (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL, code TEXT NOT NULL, attempts INTEGER DEFAULT 0,
    expires_at TEXT NOT NULL, used INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY, day TEXT, time TEXT, title TEXT, "desc" TEXT, status TEXT, sort INTEGER)`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY, tag TEXT, title TEXT, body TEXT, time TEXT, pinned INTEGER DEFAULT 0, published INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, slogan TEXT, role_needs TEXT, intro TEXT,
    project_name TEXT, project_desc TEXT, project_status TEXT DEFAULT 'recruiting',
    leader_id INTEGER NOT NULL, status TEXT DEFAULT 'recruiting',
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY, team_id INTEGER NOT NULL, player_id INTEGER NOT NULL,
    joined_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS team_requests (
    id SERIAL PRIMARY KEY, team_id INTEGER NOT NULL, player_id INTEGER NOT NULL, msg TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS waiting_pool (
    id SERIAL PRIMARY KEY, player_id INTEGER NOT NULL UNIQUE, msg TEXT,
    status TEXT DEFAULT 'waiting', note TEXT,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS site_likes (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS site_like_ips (
    id SERIAL PRIMARY KEY, ip TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS site_like_log (
    id SERIAL PRIMARY KEY, user_id INTEGER, ip TEXT, like_date TEXT NOT NULL,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'))) `,
  `CREATE TABLE IF NOT EXISTS player_likes (
    id SERIAL PRIMARY KEY, target_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    like_date TEXT NOT NULL,
    created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS')),
    UNIQUE(target_id, user_id, like_date)) `
];

/* 老库升级：补列（两种模式均幂等） */
async function migrate() {
  if (mode === 'pg') {
    const stmts = [
      'ALTER TABLE players ADD COLUMN IF NOT EXISTS self_registered INTEGER DEFAULT 0',
      'ALTER TABLE players ADD COLUMN IF NOT EXISTS contact TEXT',
      'ALTER TABLE players ADD COLUMN IF NOT EXISTS retired INTEGER DEFAULT 0',
      'ALTER TABLE players ADD COLUMN IF NOT EXISTS is_demo INTEGER DEFAULT 0',
      'ALTER TABLE waiting_pool ADD COLUMN IF NOT EXISTS note TEXT',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT'
    ];
    for (const s of stmts) { try { await pgClient.query(s); } catch (e) {} }
  } else {
    const stmts = [
      'ALTER TABLE players ADD COLUMN self_registered INTEGER DEFAULT 0',
      'ALTER TABLE players ADD COLUMN contact TEXT',
      'ALTER TABLE players ADD COLUMN retired INTEGER DEFAULT 0',
      'ALTER TABLE players ADD COLUMN is_demo INTEGER DEFAULT 0',
      'ALTER TABLE waiting_pool ADD COLUMN note TEXT',
      'ALTER TABLE users ADD COLUMN password_hash TEXT'
    ];
    for (const s of stmts) { try { sqlite.exec(s); } catch (e) {} }
  }
}

/* ===== 数据导入：优先 export.json（真实数据快照），其次内置 seed ===== */
const TABLES = ['players', 'users', 'claims', 'schedules', 'announcements', 'teams', 'team_members', 'team_requests', 'waiting_pool', 'site_likes', 'site_like_ips', 'site_like_log', 'player_likes'];

async function importExportJson() {
  const f = path.join(__dirname, '..', 'data', 'export.json');
  if (!fs.existsSync(f)) return false;
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const t of TABLES) {
    const rows = data[t];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    // 占位符按模式生成：pg 用 $1..$n，sqlite 用 ?（node:sqlite 不支持 $1 数字命名参数）
    const ph = cols.map((_, i) => (mode === 'pg' ? `$${i + 1}` : '?')).join(',');
    const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${ph})`;
    for (const r of rows) {
      if (mode === 'pg') await pgClient.query(pgCompat(sql), cols.map(c => r[c] ?? null));
      else sqlite.prepare(sql).run(...cols.map(c => r[c] ?? null));
    }
    // 修复自增序列，避免后续 INSERT 主键冲突
    if (mode === 'pg') {
      try { await pgClient.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), (SELECT MAX(id) FROM ${t}))`); } catch (e) {}
    }
  }
  console.log(`[store] 已从 export.json 导入真实数据（${TABLES.filter(t => data[t]?.length).map(t => t + ':' + data[t].length).join(' / ')}）`);
  return true;
}

function seedIfEmpty() {
  const cnt = sqlite.prepare('SELECT COUNT(*) AS c FROM players').get();
  if (cnt.c > 0) return;
  const { PLAYERS, SCHEDULES, ANNOUNCEMENTS, AV } = require('./seed-data');
  const ins = sqlite.prepare('INSERT INTO players (name,nickname,role,grade,dorm,intro,tags,wechat,avatar,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
  PLAYERS.forEach((p, i) => ins.run(p.name, p.nickname, p.role, p.grade, p.dorm, p.intro, p.tags, p.wechat, AV[i] || null, 'unclaimed'));
  const insS = sqlite.prepare('INSERT INTO schedules (day,time,title,desc,status,sort) VALUES (?,?,?,?,?,?)');
  SCHEDULES.forEach(s => insS.run(s.day, s.time, s.title, s.desc, s.status, s.sort));
  const insA = sqlite.prepare('INSERT INTO announcements (tag,title,body,time,pinned) VALUES (?,?,?,?,?)');
  ANNOUNCEMENTS.forEach(a => insA.run(a.tag, a.title, a.body, a.time, a.pinned));
  console.log(`[store] seed 完成：${PLAYERS.length} 选手 / ${SCHEDULES.length} 赛程 / ${ANNOUNCEMENTS.length} 公告`);
}

/* ===== 初始化 ===== */
async function init() {
  if (mode === 'pg') {
    const { Client } = require('pg');
    const ssl = /sslmode=require|ssl=true/i.test(PG_URL) ? { rejectUnauthorized: false } : false;
    pgClient = new Client({ connectionString: PG_URL, ssl });
    await pgClient.connect();
    for (const d of DDL_PG) await pgClient.query(d);
    await migrate();
    const cnt = await pgClient.query('SELECT COUNT(*) c FROM players');
    if (Number(cnt.rows[0].c) === 0) {
      const ok = await importExportJson();
      if (!ok) {
        const { PLAYERS, SCHEDULES, ANNOUNCEMENTS, AV } = require('./seed-data');
        // 内置 seed 极少用到（真实场景走 export.json），逐条插入
        for (let i = 0; i < PLAYERS.length; i++) {
          const p = PLAYERS[i];
          await pgClient.query('INSERT INTO players (name,nickname,role,grade,dorm,intro,tags,wechat,avatar,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [p.name, p.nickname, p.role, p.grade, p.dorm, p.intro, p.tags, p.wechat, AV[i] || null, 'unclaimed']);
        }
        for (const s of SCHEDULES) await pgClient.query('INSERT INTO schedules (day,time,title,desc,status,sort) VALUES ($1,$2,$3,$4,$5,$6)', [s.day, s.time, s.title, s.desc, s.status, s.sort]);
        for (const a of ANNOUNCEMENTS) await pgClient.query('INSERT INTO announcements (tag,title,body,time,pinned) VALUES ($1,$2,$3,$4,$5)', [a.tag, a.title, a.body, a.time, a.pinned]);
        console.log(`[store] PG seed 完成：${PLAYERS.length} 选手`);
      }
    }
    console.log(`[store] PostgreSQL 模式已连接（${PG_URL.replace(/:[^:@/]+@/, ':***@')}）`);
  } else {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    sqlite = new DatabaseSync(DB_PATH);
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec(DDL_SQLITE);
    migrate();
    const cnt = sqlite.prepare('SELECT COUNT(*) AS c FROM players').get();
    if (cnt.c === 0) {
      const ok = await importExportJson();
      if (!ok) seedIfEmpty();
    }
    console.log(`[store] SQLite 模式已打开（${DB_PATH}）`);
  }
  return store;
}

/* ===== 统一查询 API（async） ===== */
async function get(sql, ...args) {
  if (mode === 'pg') {
    const r = await pgClient.query(pgCompat(sql), args.length ? args : undefined);
    return r.rows[0];
  }
  return sqlite.prepare(sql).get(...args);
}
async function all(sql, ...args) {
  if (mode === 'pg') {
    const r = await pgClient.query(pgCompat(sql), args.length ? args : undefined);
    return r.rows;
  }
  return sqlite.prepare(sql).all(...args);
}
async function run(sql, ...args) {
  if (mode === 'pg') {
    const r = await pgClient.query(pgCompat(sql), args.length ? args : undefined);
    return { changes: r.rowCount ?? 0, lastInsertRowid: r.rows && r.rows[0] ? r.rows[0].id : null };
  }
  const s = sqlite.prepare(sql);
  const r = s.run(...args);
  return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
}
async function exec(sql) {
  if (mode === 'pg') { await pgClient.query(sql); return; }
  sqlite.exec(sql);
}

const store = { init, get, all, run, exec, get mode() { return mode; } };
module.exports = store;
