/* scripts/export_data.js —— 把本地 SQLite 真实数据导出为 data/export.json
   用途：扣子（Coze）PostgreSQL 部署首次启动时自动导入，保证线上带真实数据。
   规则：排除临时表（sessions 登录令牌 / codes 验证码）；演示选手「金熙林」导出时置为未认领，
   避免绑定本地演示账号导致线上无法认领。用法：node scripts/export_data.js */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'xjhack.db');

const EXPORT_TABLES = ['players', 'users', 'claims', 'schedules', 'announcements', 'teams', 'team_members', 'team_requests', 'waiting_pool'];

const db = new DatabaseSync(DB_PATH);
const out = {};
for (const t of EXPORT_TABLES) {
  const rows = db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
  out[t] = rows;
}
// 演示选手「金熙林」线上置为未认领（避免绑定 demo@xjhack.local 演示账号）
const demo = out.players.find(p => p.name === '金熙林');
if (demo) {
  demo.claimed_by = null;
  demo.claim_email = null;
  demo.status = 'unclaimed';
  console.log('[export] 金熙林已置为未认领（线上可被真实选手认领）');
}
// 联系人联系方式：导出时置空（由选手登录后自行填写，避免明文/演示数据外泄）
let cleared = 0;
for (const p of out.players) {
  if (p.contact && p.contact !== '') { p.contact = null; cleared++; }
}
if (cleared) console.log(`[export] 已清空 ${cleared} 位选手的联系方式字段`);
// 体验登录账号保留无妨（MAIL_MODE != dev 时体验登录自动失效），但保险起见标记
const f = path.join(__dirname, '..', 'data', 'export.json');
fs.writeFileSync(f, JSON.stringify(out));
const size = (fs.statSync(f).size / 1024).toFixed(1);
console.log(`[export] 完成 → data/export.json（${size} KB，${EXPORT_TABLES.length} 张表）`);
db.close();
