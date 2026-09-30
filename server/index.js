/* 学军中学黑客松赛事系统 · 后端入口
   能力：选手认领 + 开放注册（自由选手）+ 邮箱验证码登录 + 资料自助管理 + 组队 + 队伍项目状态 + 管理员后台
   数据层：server/store.js 双模式（本地 SQLite / 扣子生产 PostgreSQL）
   运行：npm install && npm start（默认 http://localhost:3000）*/
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { sendCode, genCode } = require('./mail');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const WX = {
  appid: process.env.WECHAT_APPID || '',
  secret: process.env.WECHAT_APPSECRET || '',
  redirect: process.env.WECHAT_REDIRECT_URI || ''
};

/* ===== 工具 ===== */
/* contact 加密存储（AES-256-GCM）。生产环境必须配置 ENC_KEY（64 位 hex = 32 字节）。
   未配置时按明文兼容（开发/演示），并记录警告。 */
const ENC_KEY = process.env.ENC_KEY ? Buffer.from(process.env.ENC_KEY, 'hex') : null;
if (!ENC_KEY) console.warn('[warn] ENC_KEY 未配置：联系方式以明文存储，生产部署前请设置 64 位 hex 密钥');
function encContact(s) {
  if (!s || !ENC_KEY) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return 'enc:' + iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + ct.toString('hex');
}
function decContact(s) {
  if (!s || !s.startsWith('enc:')) return s;
  if (!ENC_KEY) return '';
  try {
    const parts = s.slice(4).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(parts[0], 'hex'));
    d.setAuthTag(Buffer.from(parts[1], 'hex'));
    return Buffer.concat([d.update(Buffer.from(parts[2], 'hex')), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, nickname: p.nickname, role: p.role,
    grade: p.grade, dorm: p.dorm, intro: p.intro, tags: p.tags,
    avatar: p.avatar, status: p.status, self_registered: !!p.self_registered,
    retired: !!p.retired
  };
}

/* 队伍状态机（前后端共用口径） */
const TEAM_STATUS = {
  recruiting: { label: '招募中', color: '#46F0C8', pct: 20 },
  formed:     { label: '已组队', color: '#8B7CFF', pct: 40 },
  developing: { label: '开发中', color: '#FFB454', pct: 60 },
  submitted:  { label: '已提交', color: '#4ADE9B', pct: 80 },
  judging:    { label: '评审中', color: '#FF5C8A', pct: 90 },
  finished:   { label: '已结束', color: '#5C6B8F', pct: 100 },
  disbanded:  { label: '已解散', color: '#FF4D4D', pct: 0 }
};

const SESSION_DAYS = 30;
function sessionAlive(createdAt) {
  if (!createdAt) return false;
  // 两种模式均存北京时间 'YYYY-MM-DD HH:MM:SS'
  const t = new Date(String(createdAt).replace(' ', 'T') + '+08:00');
  if (isNaN(t.getTime())) return false;
  return Date.now() - t.getTime() < SESSION_DAYS * 24 * 3600 * 1000;
}

async function getUserByToken(token) {
  if (!token) return null;
  try {
    const s = await store.get('SELECT user_id, created_at FROM sessions WHERE token = ?', token);
    if (!s || !sessionAlive(s.created_at)) return null;
    return await store.get('SELECT * FROM users WHERE id = ?', s.user_id);
  } catch (e) { return null; }
}

async function createSession(userId) {
  // 单会话：同一账号新登录立即作废旧 token（旧设备下次请求即被踢出）
  await store.run('DELETE FROM sessions WHERE user_id = ?', userId);
  const token = crypto.randomBytes(24).toString('hex');
  await store.run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', token, userId);
  return token;
}

/* ===== 限流（单机内存，重启清零可接受） ===== */
const rate = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const v = rate.get(key);
  if (!v || now - v.ts > windowMs) { rate.set(key, { ts: now, count: 1 }); return true; }
  if (v.count >= limit) return false;
  v.count++;
  return true;
}
function cleanupRate() { // 每 10 分钟清理过期键，防止内存膨胀
  const now = Date.now();
  for (const [k, v] of rate) if (now - v.ts > 10 * 60 * 1000) rate.delete(k);
}
setInterval(cleanupRate, 10 * 60 * 1000);

/* async handler 错误兜底（Express 4 不捕获 async 异常） */
const wrap = fn => (req, res) => {
  Promise.resolve(fn(req, res)).catch(e => {
    console.error('[api error]', req.method, req.path, e);
    if (!res.headersSent) res.status(500).json({ ok: false, msg: '服务器错误：' + e.message });
  });
};

/* ===== 公开：选手名单 / 赛程 / 公告 ===== */
app.get('/api/players', wrap(async (req, res) => {
  const list = await store.all('SELECT * FROM players WHERE retired != 1 ORDER BY id');
  res.json({ ok: true, players: list.map(publicPlayer) });
}));

app.get('/api/schedules', wrap(async (req, res) => {
  res.json({ ok: true, schedules: await store.all('SELECT * FROM schedules ORDER BY sort') });
}));

app.get('/api/announcements', wrap(async (req, res) => {
  res.json({ ok: true, announcements: await store.all('SELECT * FROM announcements ORDER BY pinned DESC, id DESC') });
}));

/* ===== 认证：当前登录态 ===== */
app.get('/api/me', wrap(async (req, res) => {
  const user = await getUserByToken(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.json({ ok: true, authed: false });
  const player = user.player_id ? await store.get('SELECT * FROM players WHERE id = ?', user.player_id) : null;
  res.json({
    ok: true, authed: true,
    user: {
      id: user.id, email: user.email, is_admin: !!user.is_admin,
      player: player ? { ...publicPlayer(player), contact: decContact(player.contact) || '' } : null,
      wechat_bound: !!user.wechat_openid
    }
  });
}));

/* ===== 我的资料：自助更新（认领选手 name 锁定，自由选手可改全部） ===== */
app.put('/api/me/player', wrap(async (req, res) => {
  const user = await getUserByToken(req.headers.authorization?.replace('Bearer ', ''));
  if (!user) return res.status(401).json({ ok: false, msg: '未登录' });
  if (!user.player_id) return res.status(400).json({ ok: false, msg: '还没有选手身份，请先认领或注册' });
  const p = await store.get('SELECT * FROM players WHERE id = ?', user.player_id);
  if (!p) return res.status(404).json({ ok: false, msg: '选手不存在' });
  const owned = p.claimed_by === user.id;
  if (!owned) return res.status(403).json({ ok: false, msg: '只能编辑自己的资料' });
  const isFree = !!p.self_registered; // 自由注册选手可改姓名；认领选手姓名锁定防冒领
  const { name, nickname, role, grade, intro, tags, avatar, contact } = req.body || {};
  await store.run(`UPDATE players SET
      name = CASE WHEN ? = 1 THEN ? ELSE name END,
      nickname = ?, role = ?, grade = ?, intro = ?, tags = ?, avatar = ?, contact = ?
    WHERE id = ?`,
    isFree ? 1 : 0, String(name || p.name).trim() || p.name,
    String(nickname ?? '').trim(), String(role ?? '').trim(), String(grade ?? '').trim(),
    String(intro ?? '').trim(), String(tags ?? '').trim(), String(avatar ?? '').trim(),
    encContact(String(contact ?? '').trim()), p.id);
  const np = await store.get('SELECT * FROM players WHERE id = ?', p.id);
  res.json({ ok: true, player: { ...publicPlayer(np), contact: decContact(np.contact) || '' } });
}));

/* ===== 我的资料：撤下/恢复公开展示（PIPL 删除权入口） ===== */
app.post('/api/me/visibility', requirePlayer, wrap(async (req, res) => {
  const visible = !!req.body?.visible;
  await store.run('UPDATE players SET retired = ? WHERE id = ?', visible ? 0 : 1, req.user.player_id);
  res.json({ ok: true, msg: visible ? '已恢复公开展示' : '已撤下你的资料，主页不再显示。随时可恢复。' });
}));

/* ===== 认领：邮箱绑定（微信为可选的防冒领校验，前端默认不再要求） ===== */
app.post('/api/claims', wrap(async (req, res) => {
  const { player_id, wechat } = req.body || {};
  const pid = parseInt(player_id, 10);
  if (!pid) return res.status(400).json({ ok: false, msg: '缺少选手' });
  const p = await store.get('SELECT * FROM players WHERE id = ?', pid);
  if (!p) return res.status(404).json({ ok: false, msg: '选手不存在' });
  if (p.status === 'claimed') return res.status(409).json({ ok: false, msg: '该身份已被认领' });
  // 微信已可选：传了才做防冒领校验，不传直接走邮箱绑定（管理员后台可复核/释放）
  if (wechat) {
    if (!p.wechat) return res.status(409).json({ ok: false, msg: '该选手未登记微信号，无法校验' });
    if (String(p.wechat).trim().toLowerCase() !== String(wechat).trim().toLowerCase()) {
      return res.status(403).json({ ok: false, msg: '微信号与报名登记不一致，无法认领' });
    }
  }
  const claimToken = crypto.randomBytes(16).toString('hex');
  await store.run('INSERT INTO claims (player_id, wechat, claim_token, status) VALUES (?, ?, ?, ?)',
    pid, String(wechat || '').trim(), claimToken, 'pending');
  res.json({ ok: true, claim_token: claimToken, player: { id: p.id, name: p.name } });
}));

/* ===== 试验期：体验登录（仅 MAIL_MODE=dev 启用，正式上线自动失效）
   两个模拟账号：金熙林 / 回响 Bot，均免邮箱、标记 is_demo，发布前可一键清除 ===== */
const DEMO_ACCOUNTS = {
  jinxilin: { email: 'demo@xjhack.local', name: '金熙林' },
  bot: { email: 'demo.bot@xjhack.local', name: '回响 Bot' }
};
async function demoLoginFor(which) {
  const D = DEMO_ACCOUNTS[which];
  if (!D) return { error: '未知的演示账号' };
  // 找或建体验账号（email 以 @xjhack.local 结尾 = 模拟账号标识）
  let user = await store.get('SELECT * FROM users WHERE email = ?', D.email);
  if (!user) {
    await store.run("INSERT INTO users (email, is_admin) VALUES (?, 0) RETURNING id", D.email);
    user = await store.get('SELECT * FROM users WHERE email = ?', D.email);
  }
  // 找演示选手；不存在（如首次登录回响 Bot）则自动创建 is_demo 选手
  let target = await store.get('SELECT * FROM players WHERE name = ?', D.name);
  if (!target) {
    const r = await store.run(`INSERT INTO players (name, role, intro, tags, status, self_registered, claimed_by, claim_email, is_demo)
      VALUES (?, ?, ?, ?, 'unclaimed', 1, NULL, NULL, 1) RETURNING id`, D.name, 'AI',
      '模拟演示选手：AI 方向，用于系统试验与功能演示，正式发布前会清除。',
      'AI应用 演示 测试');
    target = await store.get('SELECT * FROM players WHERE id = ?', Number(r.lastInsertRowid));
  }
  // 若演示选手已被他人认领，试验期直接接管
  if (target.status === 'claimed' && target.claimed_by !== user.id) {
    await store.run('UPDATE players SET claimed_by = NULL, claim_email = NULL, status = ? WHERE id = ?', 'unclaimed', target.id);
  }
  // 绑定演示选手 → 体验账号（并标记 is_demo=1，保证发布前 cleanup 能完整清除）
  await store.run("UPDATE players SET claimed_by = ?, claim_email = ?, status = 'claimed', is_demo = 1 WHERE id = ?", user.id, D.email, target.id);
  await store.run('UPDATE users SET player_id = ? WHERE id = ?', target.id, user.id);
  // 清理残留 pending 认领，幂等写入 bound 记录
  await store.run("UPDATE claims SET status = 'released' WHERE player_id = ? AND status = 'pending'", target.id);
  const bound = await store.get('SELECT id FROM claims WHERE player_id = ? AND email = ? AND status = ?', target.id, D.email, 'bound');
  if (!bound) {
    await store.run('INSERT INTO claims (player_id, wechat, claim_token, email, status) VALUES (?, ?, ?, ?, ?)',
      target.id, String(target.wechat || '').trim(), crypto.randomBytes(16).toString('hex'), D.email, 'bound');
  }
  const token = await createSession(user.id);
  return {
    ok: true, token, msg: `已以「${D.name}」身份登录（试验期体验登录）`,
    user: {
      id: user.id, email: user.email, is_admin: !!user.is_admin,
      player: { ...publicPlayer(target), contact: '' }, wechat_bound: false
    }
  };
}

app.post('/api/demo/login', wrap(async (req, res) => {
  if (process.env.MAIL_MODE !== 'dev') return res.status(403).json({ ok: false, msg: '体验登录仅试验期可用' });
  const which = String(req.body?.demo || 'jinxilin');
  const r = await demoLoginFor(which);
  if (r.error) return res.status(404).json({ ok: false, msg: r.error });
  res.json(r);
}));

/* ===== 管理员密码登录（区别于邮箱验证码通道，独立账号「管理员」） ===== */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
app.post('/api/auth/admin-login', wrap(async (req, res) => {
  const pwd = String(req.body?.password || '');
  if (!ADMIN_PASSWORD) return res.status(500).json({ ok: false, msg: '服务器未配置管理员密码（.env 的 ADMIN_PASSWORD）' });
  const a = crypto.createHash('sha256').update(pwd).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(403).json({ ok: false, msg: '密码错误' });
  const EMAIL = 'admin@xjhack.local';
  let user = await store.get('SELECT * FROM users WHERE email = ?', EMAIL);
  if (!user) {
    await store.run('INSERT INTO users (email, is_admin) VALUES (?, 1) RETURNING id', EMAIL);
    user = await store.get('SELECT * FROM users WHERE email = ?', EMAIL);
  }
  if (!user.is_admin) {
    await store.run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
    user = await store.get('SELECT * FROM users WHERE email = ?', EMAIL);
  }
  const token = await createSession(user.id);
  res.json({
    ok: true, token, msg: '已以「管理员」身份登录',
    user: { id: user.id, email: user.email, is_admin: true, player: null, wechat_bound: false }
  });
}));

/* ===== 发布前清理：一键删除全部模拟账号与演示数据（不留痕迹） ===== */
app.post('/api/admin/cleanup-demo', requireAdmin, wrap(async (req, res) => {
  // 模拟账号 = email 以 @xjhack.local 结尾（排除正式管理员 admin@xjhack.local）
  const demoUsers = await store.all("SELECT id FROM users WHERE email LIKE '%@xjhack.local' AND email != 'admin@xjhack.local'");
  const uid = demoUsers.map(u => u.id);
  const demoPlayers = await store.all('SELECT id FROM players WHERE is_demo = 1');
  const pid = demoPlayers.map(p => p.id);
  // 先解除正常用户对演示选手的引用（不应存在，防御）
  if (pid.length) await store.run(`UPDATE users SET player_id = NULL WHERE player_id IN (${pid.map(() => '?').join(',')})`, ...pid);
  // 演示选手领导的队伍 → 连成员/申请一起删
  let tid = [];
  if (pid.length) {
    const teams = await store.all(`SELECT id FROM teams WHERE leader_id IN (${pid.map(() => '?').join(',')})`, ...pid);
    tid = teams.map(t => t.id);
  }
  if (tid.length) {
    await store.run(`DELETE FROM team_members WHERE team_id IN (${tid.map(() => '?').join(',')})`, ...tid);
    await store.run(`DELETE FROM team_requests WHERE team_id IN (${tid.map(() => '?').join(',')})`, ...tid);
    await store.run(`DELETE FROM teams WHERE id IN (${tid.map(() => '?').join(',')})`, ...tid);
  }
  if (pid.length) {
    await store.run(`DELETE FROM claims WHERE player_id IN (${pid.map(() => '?').join(',')})`, ...pid);
    await store.run(`DELETE FROM waiting_pool WHERE player_id IN (${pid.map(() => '?').join(',')})`, ...pid);
  }
  if (uid.length) await store.run(`DELETE FROM sessions WHERE user_id IN (${uid.map(() => '?').join(',')})`, ...uid);
  if (pid.length) await store.run(`DELETE FROM players WHERE id IN (${pid.map(() => '?').join(',')})`, ...pid);
  if (uid.length) await store.run(`DELETE FROM users WHERE id IN (${uid.map(() => '?').join(',')})`, ...uid);
  res.json({ ok: true, msg: `已清除模拟账号 ${uid.length} 个 / 演示选手 ${pid.length} 位 / 演示队伍 ${tid.length} 支（数据不可恢复）` });
}));

/* ===== 认证：邮箱验证码 ===== */
app.post('/api/auth/request-code', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, msg: '邮箱格式不对' });
  // 限流：同一邮箱 60 秒 1 封；同一 IP 60 秒 5 封（防刷邮件/爆破）
  if (!rateLimit('em:' + email, 1, 60 * 1000)) return res.status(429).json({ ok: false, msg: '发送太频繁，请 60 秒后再试' });
  if (!rateLimit('ip:' + (req.ip || 'unknown'), 5, 60 * 1000)) return res.status(429).json({ ok: false, msg: '发送太频繁，请稍后再试' });
  const code = genCode();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await store.run('INSERT INTO codes (email, code, expires_at) VALUES (?, ?, ?)', email, code, expires);
  let dev = false;
  try {
    const r = await sendCode(email, code);
    dev = !!r.dev;
  } catch (e) {
    return res.status(500).json({ ok: false, msg: '验证码发送失败：' + e.message });
  }
  res.json({ ok: true, dev, devCode: dev ? code : undefined });
}));

app.post('/api/auth/verify-code', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const claimToken = String(req.body?.claim_token || '');
  if (!email || !code) return res.status(400).json({ ok: false, msg: '缺少邮箱或验证码' });

  const c = await store.get('SELECT * FROM codes WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1', email);
  if (!c) return res.status(400).json({ ok: false, msg: '请先获取验证码' });
  if (new Date(c.expires_at) < new Date()) return res.status(400).json({ ok: false, msg: '验证码已过期，请重新获取' });
  if (c.attempts >= 5) return res.status(429).json({ ok: false, msg: '尝试次数过多，请重新获取验证码' });
  if (c.code !== code) {
    await store.run('UPDATE codes SET attempts = attempts + 1 WHERE id = ?', c.id);
    return res.status(403).json({ ok: false, msg: '验证码错误' });
  }
  await store.run('UPDATE codes SET used = 1 WHERE id = ?', c.id);

  // 找或建用户
  let user = await store.get('SELECT * FROM users WHERE email = ?', email);
  let isNew = false;
  if (!user) {
    isNew = true;
    const isAdmin = ADMIN_EMAILS.includes(email) ? 1 : 0;
    await store.run('INSERT INTO users (email, is_admin) VALUES (?, ?) RETURNING id', email, isAdmin);
    user = await store.get('SELECT * FROM users WHERE email = ?', email);
  }

  // 若携带认领 token，完成身份绑定
  let boundPlayer = null;
  if (claimToken) {
    const claim = await store.get('SELECT * FROM claims WHERE claim_token = ? AND status = ?', claimToken, 'pending');
    if (claim) {
      const p = await store.get('SELECT * FROM players WHERE id = ?', claim.player_id);
      if (!p || p.status === 'claimed') {
        await store.run('UPDATE claims SET status = ? WHERE id = ?', 'released', claim.id);
        return res.status(409).json({ ok: false, msg: '该身份刚被他人认领，请刷新重试' });
      }
      await store.run('UPDATE players SET claimed_by = ?, claim_email = ?, status = ? WHERE id = ?',
        user.id, email, 'claimed', p.id);
      await store.run('UPDATE users SET player_id = ? WHERE id = ?', p.id, user.id);
      await store.run('UPDATE claims SET email = ?, status = ? WHERE id = ?', email, 'bound', claim.id);
      boundPlayer = publicPlayer(p);
    }
  } else if (!user.player_id && !user.is_admin) {
    // 开放注册：登录即创建自由选手身份（资料可自助完善）；管理员账号不参与选手身份
    const prefix = email.split('@')[0].slice(0, 12) || '新选手';
    const r = await store.run('INSERT INTO players (name, role, status, self_registered, claimed_by, claim_email) VALUES (?, ?, ?, 1, ?, ?) RETURNING id',
      prefix, '', 'claimed', user.id, email);
    const pid = Number(r.lastInsertRowid);
    await store.run('UPDATE users SET player_id = ? WHERE id = ?', pid, user.id);
    boundPlayer = publicPlayer(await store.get('SELECT * FROM players WHERE id = ?', pid));
  }

  const token = await createSession(user.id);
  const playerOf = async id => {
    const p = id ? await store.get('SELECT * FROM players WHERE id = ?', id) : null;
    return p ? publicPlayer(p) : null;
  };
  res.json({
    ok: true, token, isNew,
    user: {
      id: user.id, email: user.email, is_admin: !!user.is_admin,
      player: boundPlayer ? { ...boundPlayer, contact: '' } : await playerOf(user.player_id),
      wechat_bound: !!user.wechat_openid
    }
  });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) await store.run('DELETE FROM sessions WHERE token = ?', token);
  res.json({ ok: true });
}));

/* ===== 微信扫码登录 ===== */
app.get('/api/auth/wechat/start', (req, res) => {
  if (!WX.appid || !WX.redirect) {
    return res.json({ ok: true, enabled: false, msg: '微信登录未配置（需开放平台 AppID + 备案域名回调）' });
  }
  const state = crypto.randomBytes(12).toString('hex');
  const url = 'https://open.weixin.qq.com/connect/qrconnect?' +
    `appid=${encodeURIComponent(WX.appid)}&redirect_uri=${encodeURIComponent(WX.redirect)}` +
    '&response_type=code&scope=snsapi_login&state=' + state + '#wechat_redirect';
  res.json({ ok: true, enabled: true, url });
});

app.get('/api/auth/wechat/callback', wrap(async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('缺少 code');
  try {
    const r = await fetch('https://api.weixin.qq.com/sns/oauth2/access_token?' +
      `appid=${encodeURIComponent(WX.appid)}&secret=${encodeURIComponent(WX.secret)}` +
      `&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
    const d = await r.json();
    if (!d.openid) return res.status(500).send('微信授权失败：' + (d.errmsg || JSON.stringify(d)));
    // 已绑定 openid 的旧用户直接登录；新用户创建账号（后续可在认领页绑定选手）
    let user = await store.get('SELECT * FROM users WHERE wechat_openid = ?', d.openid);
    if (!user) {
      await store.run('INSERT INTO users (email, wechat_openid) VALUES (?, ?) RETURNING id', `wx_${d.openid}@wechat.local`, d.openid);
      user = await store.get('SELECT * FROM users WHERE wechat_openid = ?', d.openid);
    }
    const token = await createSession(user.id);
    // 简化交付：回调页内联把 token 写入 localStorage 并跳回首页
    res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录成功</title></head>
<body style="background:#070b14;color:#e8eeff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:center">
  <p style="font-size:20px">微信登录成功，正在跳转…</p>
</div>
<script>
  localStorage.setItem('xjhack_token', ${JSON.stringify(token)});
  location.href = '/';
</script>
</body></html>`);
  } catch (e) {
    res.status(500).send('微信回调处理失败：' + e.message);
  }
}));

/* ===== 组队 ===== */
async function requirePlayer(req, res, next) {
  try {
    const user = await getUserByToken(req.headers.authorization?.replace('Bearer ', ''));
    if (!user) return res.status(401).json({ ok: false, msg: '未登录' });
    if (!user.player_id) return res.status(403).json({ ok: false, msg: '需要先认领或注册选手身份，才能参与组队' });
    req.user = user;
    next();
  } catch (e) { res.status(401).json({ ok: false, msg: '未登录' }); }
}

async function teamDetail(team, viewerId) {
  const members = await store.all('SELECT p.id, p.name, p.nickname, p.role, p.avatar FROM team_members m JOIN players p ON p.id = m.player_id WHERE m.team_id = ? ORDER BY m.id', team.id);
  const requests = await store.all('SELECT r.id, r.player_id, r.msg, r.status, r.created_at, p.name, p.role, p.avatar FROM team_requests r JOIN players p ON p.id = r.player_id WHERE r.team_id = ? ORDER BY r.id DESC', team.id);
  const leader = await store.get('SELECT id, name, nickname, role, avatar FROM players WHERE id = ?', team.leader_id) || null;
  const myReq = viewerId ? await store.get("SELECT * FROM team_requests WHERE team_id = ? AND player_id = ? AND status = 'pending'", team.id, viewerId) : null;
  return {
    id: team.id, name: team.name, slogan: team.slogan, role_needs: team.role_needs,
    intro: team.intro, project_name: team.project_name, project_desc: team.project_desc,
    project_status: team.project_status, status: team.status,
    created_at: team.created_at,
    leader, members, member_count: members.length,
    requests,
    statusMeta: TEAM_STATUS[team.project_status] || TEAM_STATUS.recruiting,
    my_role: !viewerId ? 'guest' :
      (team.leader_id === viewerId ? 'leader' :
        (members.some(m => m.id === viewerId) ? 'member' : (myReq ? 'pending' : 'guest')))
  };
}

app.get('/api/teams', wrap(async (req, res) => {
  const viewer = await getUserByToken(req.headers.authorization?.replace('Bearer ', ''));
  const list = await store.all("SELECT * FROM teams WHERE status != 'disbanded' ORDER BY id DESC");
  res.json({ ok: true, teams: await Promise.all(list.map(t => teamDetail(t, viewer?.player_id || null))) });
}));

app.get('/api/teams/mine', requirePlayer, wrap(async (req, res) => {
  const pid = req.user.player_id;
  const led = await store.all('SELECT * FROM teams WHERE leader_id = ? AND status != ? ORDER BY id DESC', pid, 'disbanded');
  const joined = await store.all('SELECT t.* FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.player_id = ? AND t.leader_id != ? AND t.status != ? ORDER BY t.id DESC', pid, pid, 'disbanded');
  const reqs = await store.all('SELECT r.*, t.name AS team_name, t.project_status FROM team_requests r JOIN teams t ON t.id = r.team_id WHERE r.player_id = ? AND r.status = ? ORDER BY r.id DESC', pid, 'pending');
  const results = await store.all('SELECT r.id AS request_id, r.status, t.name AS team_name FROM team_requests r JOIN teams t ON t.id = r.team_id WHERE r.player_id = ? AND r.status IN (?, ?) ORDER BY r.id DESC LIMIT 10', pid, 'accepted', 'rejected');
  res.json({
    ok: true,
    led: await Promise.all(led.map(t => teamDetail(t, pid))),
    joined: await Promise.all(joined.map(t => teamDetail(t, pid))),
    pending: reqs, results
  });
}));

app.post('/api/teams', requirePlayer, wrap(async (req, res) => {
  const { name, slogan, role_needs, intro, project_name, project_desc } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ ok: false, msg: '队伍名称不能为空' });
  const r = await store.run('INSERT INTO teams (name, slogan, role_needs, intro, project_name, project_desc, project_status, leader_id, status) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id',
    String(name).trim(), String(slogan || '').trim(), String(role_needs || '').trim(), String(intro || '').trim(),
    String(project_name || '').trim(), String(project_desc || '').trim(), 'recruiting', req.user.player_id, 'recruiting');
  const tid = Number(r.lastInsertRowid);
  await store.run('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)', tid, req.user.player_id);
  res.json({ ok: true, id: tid });
}));

app.put('/api/teams/:id', requirePlayer, wrap(async (req, res) => {
  const team = await store.get('SELECT * FROM teams WHERE id = ?', parseInt(req.params.id, 10));
  if (!team) return res.status(404).json({ ok: false, msg: '队伍不存在' });
  if (team.leader_id !== req.user.player_id) return res.status(403).json({ ok: false, msg: '只有队长可以编辑队伍' });
  const { name, slogan, role_needs, intro, project_name, project_desc, project_status, status } = req.body || {};
  const ps = project_status || status || team.project_status;
  if (ps && !TEAM_STATUS[ps]) return res.status(400).json({ ok: false, msg: '无效的队伍状态' });
  await store.run('UPDATE teams SET name=?, slogan=?, role_needs=?, intro=?, project_name=?, project_desc=?, project_status=?, status=? WHERE id=?',
    String(name || team.name).trim(), String(slogan ?? team.slogan).trim(), String(role_needs ?? team.role_needs).trim(),
    String(intro ?? team.intro).trim(), String(project_name ?? team.project_name).trim(), String(project_desc ?? team.project_desc).trim(),
    ps, ps === 'disbanded' ? 'disbanded' : team.status, team.id);
  res.json({ ok: true, team: await teamDetail(await store.get('SELECT * FROM teams WHERE id = ?', team.id), req.user.player_id) });
}));

app.post('/api/teams/:id/join', requirePlayer, wrap(async (req, res) => {
  const team = await store.get("SELECT * FROM teams WHERE id = ? AND status != 'disbanded'", parseInt(req.params.id, 10));
  if (!team) return res.status(404).json({ ok: false, msg: '队伍不存在或已解散' });
  if (team.project_status === 'finished' || team.project_status === 'judging') return res.status(409).json({ ok: false, msg: '队伍已进入项目阶段，暂不接受加入' });
  if (team.leader_id === req.user.player_id) return res.status(409).json({ ok: false, msg: '你是队长，无需申请' });
  const inTeam = await store.get('SELECT 1 FROM team_members WHERE team_id = ? AND player_id = ?', team.id, req.user.player_id);
  if (inTeam) return res.status(409).json({ ok: false, msg: '你已在该队伍中' });
  const dup = await store.get("SELECT 1 FROM team_requests WHERE team_id = ? AND player_id = ? AND status = 'pending'", team.id, req.user.player_id);
  if (dup) return res.status(409).json({ ok: false, msg: '已提交过申请，等待队长处理' });
  const msg = String(req.body?.msg || '').trim();
  await store.run('INSERT INTO team_requests (team_id, player_id, msg) VALUES (?, ?, ?)', team.id, req.user.player_id, msg);
  res.json({ ok: true, msg: '申请已提交，等待队长确认' });
}));

app.post('/api/teams/:id/requests/:rid', requirePlayer, wrap(async (req, res) => {
  const team = await store.get("SELECT * FROM teams WHERE id = ? AND status != 'disbanded'", parseInt(req.params.id, 10));
  if (!team) return res.status(404).json({ ok: false, msg: '队伍不存在' });
  if (team.leader_id !== req.user.player_id) return res.status(403).json({ ok: false, msg: '只有队长可以处理申请' });
  const reqRow = await store.get("SELECT * FROM team_requests WHERE id = ? AND team_id = ? AND status = 'pending'", parseInt(req.params.rid, 10), team.id);
  if (!reqRow) return res.status(404).json({ ok: false, msg: '申请不存在或已处理' });
  const action = req.body?.action;
  if (action === 'accept') {
    const dup = await store.get('SELECT 1 FROM team_members WHERE team_id = ? AND player_id = ?', team.id, reqRow.player_id);
    if (!dup) await store.run('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)', team.id, reqRow.player_id);
    await store.run("UPDATE team_requests SET status = 'accepted' WHERE id = ?", reqRow.id);
    return res.json({ ok: true, msg: '已接受，新成员加入队伍' });
  }
  if (action === 'reject') {
    await store.run("UPDATE team_requests SET status = 'rejected' WHERE id = ?", reqRow.id);
    return res.json({ ok: true, msg: '已拒绝申请' });
  }
  res.status(400).json({ ok: false, msg: '无效操作（accept / reject）' });
}));

app.post('/api/teams/:id/leave', requirePlayer, wrap(async (req, res) => {
  const team = await store.get('SELECT * FROM teams WHERE id = ?', parseInt(req.params.id, 10));
  if (!team) return res.status(404).json({ ok: false, msg: '队伍不存在' });
  if (team.leader_id === req.user.player_id) return res.status(409).json({ ok: false, msg: '队长不能退出，可解散队伍' });
  const r = await store.run('DELETE FROM team_members WHERE team_id = ? AND player_id = ?', team.id, req.user.player_id);
  if (!r.changes) return res.status(409).json({ ok: false, msg: '你不在该队伍中' });
  res.json({ ok: true, msg: '已退出队伍' });
}));

app.post('/api/teams/:id/disband', requirePlayer, wrap(async (req, res) => {
  const team = await store.get('SELECT * FROM teams WHERE id = ?', parseInt(req.params.id, 10));
  if (!team) return res.status(404).json({ ok: false, msg: '队伍不存在' });
  if (team.leader_id !== req.user.player_id) return res.status(403).json({ ok: false, msg: '只有队长可以解散队伍' });
  await store.run("UPDATE teams SET status = 'disbanded', project_status = 'disbanded' WHERE id = ?", team.id);
  await store.run("DELETE FROM team_requests WHERE team_id = ? AND status = 'pending'", team.id);
  res.json({ ok: true, msg: '队伍已解散' });
}));

/* ===== 管理员 ===== */
async function requireAdmin(req, res, next) {
  try {
    const user = await getUserByToken(req.headers.authorization?.replace('Bearer ', ''));
    if (!user) return res.status(401).json({ ok: false, msg: '未登录' });
    if (!user.is_admin) return res.status(403).json({ ok: false, msg: '无管理员权限' });
    req.user = user;
    next();
  } catch (e) { res.status(401).json({ ok: false, msg: '未登录' }); }
}

app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
  res.json({
    ok: true,
    total: Number((await store.get('SELECT COUNT(*) c FROM players')).c),
    claimed: Number((await store.get("SELECT COUNT(*) c FROM players WHERE status='claimed'")).c),
    claims: await store.all('SELECT c.id, c.wechat, c.email, c.status, c.created_at, p.name, p.role FROM claims c LEFT JOIN players p ON p.id = c.player_id ORDER BY c.id DESC'),
    schedules: await store.all('SELECT * FROM schedules ORDER BY sort'),
    announcements: await store.all('SELECT * FROM announcements ORDER BY pinned DESC, id DESC'),
    players: (await store.all('SELECT * FROM players ORDER BY id')).map(p => ({ ...p, contact: decContact(p.contact) || '' })),
    teams: await store.all("SELECT t.*, (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS member_count FROM teams t ORDER BY t.id DESC"),
    pool: await store.all('SELECT w.id, w.msg, w.created_at, p.name, p.role, p.grade FROM waiting_pool w JOIN players p ON p.id = w.player_id WHERE w.status = ? ORDER BY w.id', 'waiting')
  });
}));

/* ===== 等待池（组队截止后未组队选手的兜底匹配） ===== */
app.get('/api/pool', wrap(async (req, res) => {
  const user = await getUserByToken(req.headers.authorization?.replace('Bearer ', ''));
  const waiting = Number((await store.get("SELECT COUNT(*) c FROM waiting_pool WHERE status = 'waiting'")).c);
  let me = null;
  if (user && user.player_id) {
    const w = await store.get('SELECT * FROM waiting_pool WHERE player_id = ?', user.player_id);
    if (w) me = { id: w.id, msg: w.msg || '', created_at: w.created_at };
  }
  if (user && user.is_admin) {
    const entries = await store.all('SELECT w.id, w.msg, w.created_at, p.name, p.role, p.grade, p.avatar FROM waiting_pool w JOIN players p ON p.id = w.player_id WHERE w.status = ? ORDER BY w.id', 'waiting');
    return res.json({ ok: true, waiting, me, entries });
  }
  res.json({ ok: true, waiting, me });
}));

app.post('/api/pool/join', requirePlayer, wrap(async (req, res) => {
  const pid = req.user.player_id;
  const inActive = await store.get(
    "SELECT COUNT(*) c FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.player_id = ? AND t.status != 'disbanded'", pid);
  const inLed = await store.get("SELECT COUNT(*) c FROM teams WHERE leader_id = ? AND status != 'disbanded'", pid);
  if (Number(inActive.c) > 0 || Number(inLed.c) > 0) return res.status(400).json({ ok: false, msg: '你已经在队伍中，无需进入等待池' });
  const exist = await store.get('SELECT * FROM waiting_pool WHERE player_id = ?', pid);
  if (exist) return res.status(409).json({ ok: false, msg: '你已经在等待池中' });
  const msg = String(req.body?.msg || '').trim().slice(0, 200);
  await store.run('INSERT INTO waiting_pool (player_id, msg) VALUES (?, ?)', pid, msg);
  res.json({ ok: true, msg: '已进入等待池，组委会将协助补位' });
}));

app.post('/api/pool/leave', requirePlayer, wrap(async (req, res) => {
  await store.run('DELETE FROM waiting_pool WHERE player_id = ?', req.user.player_id);
  res.json({ ok: true, msg: '已退出等待池' });
}));

app.post('/api/admin/pool/:id/remove', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, msg: '缺少参数' });
  await store.run('DELETE FROM waiting_pool WHERE id = ?', id);
  res.json({ ok: true, msg: '已移除' });
}));

app.post('/api/admin/pool/:id/assign', requireAdmin, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const teamId = parseInt(req.body?.team_id, 10);
  const w = await store.get('SELECT * FROM waiting_pool WHERE id = ?', id);
  if (!w) return res.status(404).json({ ok: false, msg: '等待者不存在或已处理' });
  const t = await store.get("SELECT * FROM teams WHERE id = ? AND status != 'disbanded'", teamId);
  if (!t) return res.status(400).json({ ok: false, msg: '目标队伍不存在' });
  const dup = Number((await store.get('SELECT COUNT(*) c FROM team_members WHERE team_id = ? AND player_id = ?', teamId, w.player_id)).c);
  if (dup) return res.status(400).json({ ok: false, msg: '该选手已在此队伍中' });
  await store.run('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)', teamId, w.player_id);
  await store.run('DELETE FROM waiting_pool WHERE id = ?', id);
  res.json({ ok: true, msg: '已分配入队' });
}));

/* 管理员：队伍状态调整 / 解散 */
app.put('/api/admin/teams/:id/status', requireAdmin, wrap(async (req, res) => {
  const team = await store.get('SELECT * FROM teams WHERE id = ?', parseInt(req.params.id, 10));
  if (!team) return res.status(404).json({ ok: false, msg: '队伍不存在' });
  const ps = String(req.body?.project_status || '').trim();
  if (!TEAM_STATUS[ps]) return res.status(400).json({ ok: false, msg: '无效的队伍状态' });
  await store.run('UPDATE teams SET project_status = ?, status = ? WHERE id = ?', ps, ps === 'disbanded' ? 'disbanded' : 'recruiting', team.id);
  if (ps === 'disbanded') await store.run("DELETE FROM team_requests WHERE team_id = ? AND status = 'pending'", team.id);
  res.json({ ok: true });
}));

app.put('/api/admin/schedules/:id', requireAdmin, wrap(async (req, res) => {
  const { day, time, title, desc, status, sort } = req.body || {};
  await store.run('UPDATE schedules SET day=?, time=?, title=?, desc=?, status=?, sort=? WHERE id=?',
    day || '', time || '', title || '', desc || '', status || 'todo', parseInt(sort || 0, 10), parseInt(req.params.id, 10));
  res.json({ ok: true });
}));
app.post('/api/admin/schedules', requireAdmin, wrap(async (req, res) => {
  const { day, time, title, desc, status, sort } = req.body || {};
  const r = await store.run('INSERT INTO schedules (day,time,title,desc,status,sort) VALUES (?,?,?,?,?,?) RETURNING id',
    day || '', time || '', title || '', desc || '', status || 'todo', parseInt(sort || 0, 10));
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));
app.delete('/api/admin/schedules/:id', requireAdmin, wrap(async (req, res) => {
  await store.run('DELETE FROM schedules WHERE id = ?', parseInt(req.params.id, 10));
  res.json({ ok: true });
}));

app.put('/api/admin/announcements/:id', requireAdmin, wrap(async (req, res) => {
  const { tag, title, body, time, pinned } = req.body || {};
  await store.run('UPDATE announcements SET tag=?, title=?, body=?, time=?, pinned=? WHERE id=?',
    tag || '', title || '', body || '', time || '', pinned ? 1 : 0, parseInt(req.params.id, 10));
  res.json({ ok: true });
}));
app.post('/api/admin/announcements', requireAdmin, wrap(async (req, res) => {
  const { tag, title, body, time, pinned } = req.body || {};
  const r = await store.run('INSERT INTO announcements (tag,title,body,time,pinned) VALUES (?,?,?,?,?) RETURNING id',
    tag || '', title || '', body || '', time || '', pinned ? 1 : 0);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));
app.delete('/api/admin/announcements/:id', requireAdmin, wrap(async (req, res) => {
  await store.run('DELETE FROM announcements WHERE id = ?', parseInt(req.params.id, 10));
  res.json({ ok: true });
}));

app.post('/api/admin/claims/:id/release', requireAdmin, wrap(async (req, res) => {
  const claim = await store.get('SELECT * FROM claims WHERE id = ?', parseInt(req.params.id, 10));
  if (!claim) return res.status(404).json({ ok: false, msg: '认领记录不存在' });
  await store.run('UPDATE players SET claimed_by = NULL, claim_email = NULL, status = ? WHERE id = ?', 'unclaimed', claim.player_id);
  await store.run('UPDATE users SET player_id = NULL WHERE player_id = ?', claim.player_id);
  await store.run('UPDATE claims SET status = ? WHERE id = ?', 'released', claim.id);
  res.json({ ok: true });
}));

app.post('/api/admin/players', requireAdmin, wrap(async (req, res) => {
  const { name, nickname, role, grade, dorm, intro, tags, wechat, avatar } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, msg: '缺少姓名' });
  const r = await store.run('INSERT INTO players (name,nickname,role,grade,dorm,intro,tags,wechat,avatar,status) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id',
    name, nickname || '', role || '', grade || '', dorm || '', intro || '', tags || '', wechat || '', avatar || '', 'unclaimed');
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));
app.put('/api/admin/players/:id', requireAdmin, wrap(async (req, res) => {
  const { role, grade, dorm, status } = req.body || {};
  await store.run('UPDATE players SET role=?, grade=?, dorm=?, status=? WHERE id=?',
    role || '', grade || '', dorm || '', status || 'unclaimed', parseInt(req.params.id, 10));
  res.json({ ok: true });
}));

/* ===== 启动：初始化数据层 → 联系方式加密迁移 → 监听 ===== */
async function boot() {
  await store.init();
  // 启动迁移：把已有明文 contact 加密（幂等）
  if (ENC_KEY) {
    try {
      const plain = await store.all("SELECT id, contact FROM players WHERE contact IS NOT NULL AND contact != '' AND contact NOT LIKE 'enc:%'");
      for (const r of plain) await store.run('UPDATE players SET contact = ? WHERE id = ?', encContact(r.contact), r.id);
      if (plain.length) console.log(`[migrate] 已加密 ${plain.length} 条联系方式的明文存量`);
    } catch (e) { console.warn('[migrate] 联系方式加密迁移失败：' + e.message); }
  }
  app.listen(PORT, () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    const lan = Object.values(nets).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`\n  XJHACK 赛事系统已启动（数据层：${store.mode}）`);
    console.log(`  本机访问：http://localhost:${PORT}`);
    if (lan.length) console.log(`  局域网访问：${lan.map(a => `http://${a}:${PORT}`).join('  /  ')}`);
    console.log(`  管理员邮箱：${ADMIN_EMAILS.join(', ') || '未配置（.env 的 ADMIN_EMAILS）'}`);
    console.log(`  微信登录：${WX.appid ? '已配置' : '未配置（.env 的 WECHAT_APPID / WECHAT_REDIRECT_URI）'}\n`);
  });
}
boot().catch(e => { console.error('[boot] 启动失败：', e); process.exit(1); });
