/* 把飞书电子表格导出的 CSV 导入选手池
   用法：npm run import -- data/players.csv
   列（CSV 表头，可缺省）：name,nickname,role,grade,dorm,intro,tags,wechat,avatar,status
   表头用英文；导出的飞书表（姓名/昵称/方向/年级/宿舍/介绍/技能/微信/头像链接）先改名对齐即可 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

function parseCsv(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const file = process.argv[2] || 'data/players.csv';
const p = path.resolve(file);
if (!fs.existsSync(p)) { console.error('文件不存在：' + p); process.exit(1); }
const rows = parseCsv(fs.readFileSync(p, 'utf8'));
const head = rows[0].map(h => h.trim().toLowerCase());
const idx = k => head.indexOf(k);
const data = rows.slice(1).filter(r => r[idx('name')] && r[idx('name')].trim() !== '');

const ins = db.prepare('INSERT INTO players (name,nickname,role,grade,dorm,intro,tags,wechat,avatar,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
// 导入即替换：清空选手池，避免与演示 seed 数据混存
db.prepare('DELETE FROM players').run();
db.prepare("DELETE FROM sqlite_sequence WHERE name='players'").run();
let n = 0;
for (const r of data) {
  const g = k => (idx(k) >= 0 ? r[idx(k)] : '').trim();
  ins.run(g('name'), g('nickname'), g('role'), g('grade'), g('dorm'), g('intro'), g('tags'), g('wechat'), g('avatar'), g('status') || 'unclaimed');
  n++;
}
console.log(`导入完成：${n} 位选手（共读取 ${data.length} 行有效数据）`);
