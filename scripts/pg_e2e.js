/* PG 模式端到端验证（对 localhost:3101） */
const BASE = 'http://localhost:3101';
const TEAM_LABEL = { recruiting: '招募中', formed: '已组队', developing: '开发中', submitted: '已提交', judging: '评审中', finished: '已结束', disbanded: '已解散' };
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? '→ ' + JSON.stringify(extra) : ''); }
}
async function j(url, opt) {
  const r = await fetch(BASE + url, { headers: { 'content-type': 'application/json', ...(opt?.token ? { authorization: 'Bearer ' + opt.token } : {}) }, ...(opt?.body ? { body: JSON.stringify(opt.body) } : {}), method: opt?.method || 'GET' });
  return r.json();
}

(async () => {
  console.log('== 1. 公开数据 ==');
  const players = (await j('/api/players')).players;
  ok('选手名单 58 位（不含撤下）', players.length === 58, players.length);
  const kylin = players.find(p => p.name === '金熙林');
  ok('金熙林在名单且未认领', kylin && kylin.status === 'unclaimed', kylin && { status: kylin.status, tags: kylin.tags });
  const sched = (await j('/api/schedules')).schedules;
  ok('赛程 7 项（desc 字段可读）', sched.length === 7 && typeof sched[0].desc === 'string', sched.length);

  console.log('== 2. 体验登录（dev 模式）==');
  const demo = await j('/api/demo/login', { method: 'POST' });
  ok('demo 登录 → 金熙林', demo.ok && demo.user?.player?.name === '金熙林', demo);
  const dT = demo.token;
  const me = await j('/api/me', { token: dT });
  ok('/api/me 金熙林 + tags', me.authed && me.user.player.tags.includes('Python'), me.user?.player?.tags);
  const teams = await j('/api/teams', { token: dT });
  const myTeam = teams.teams.find(t => t.name === '新·AI 小队');
  ok('组队广场：金熙林是新·AI小队队长', myTeam && myTeam.my_role === 'leader', myTeam && myTeam.my_role);
  ok('队伍状态机元数据对应 project_status', myTeam && myTeam.statusMeta.label === (TEAM_LABEL[myTeam.project_status] || '?'), myTeam && myTeam.statusMeta);

  console.log('== 3. 开放注册（新自由选手）==');
  const email = 'test_e2e_' + Date.now() + '@xjhack.test';
  const rc = await j('/api/auth/request-code', { method: 'POST', body: { email } });
  ok('验证码请求成功', rc.ok && rc.dev, rc);
  const vc = await j('/api/auth/verify-code', { method: 'POST', body: { email, code: rc.devCode } });
  ok('注册即建自由选手（lastInsertRowid PG 正常）', vc.ok && vc.user.player.self_registered === true, vc);
  const nT = vc.token, nId = vc.user.player.id;
  const upd = await j('/api/me/player', { method: 'PUT', token: nT, body: { name: '测试选手', role: '后端', intro: 'PG 模式验证', tags: 'Node.js PostgreSQL', contact: '138-0000-0000' } });
  ok('自助更新资料+联系方式', upd.ok && upd.player.tags === 'Node.js PostgreSQL' && upd.player.contact === '138-0000-0000', upd);
  const vis = await j('/api/me/visibility', { method: 'POST', token: nT, body: { visible: false } });
  ok('撤下资料', vis.ok);
  const players2 = (await j('/api/players')).players;
  ok('公开列表已不含测试选手', players2.length === 58, players2.length);
  await j('/api/me/visibility', { method: 'POST', token: nT, body: { visible: true } });
  ok('恢复展示', (await j('/api/players')).players.length === 59, '');

  console.log('== 4. 建队 + 状态流转 ==');
  const team = await j('/api/teams', { method: 'POST', token: nT, body: { name: 'PG测试队', project_name: 'AI 助手', role_needs: '前端' } });
  ok('建队（RETURNING id）', team.ok && team.id > 0, team);
  const tid = team.id;
  const st = await j('/api/teams/' + tid, { method: 'PUT', token: nT, body: { project_status: 'developing' } });
  ok('状态流转 recruiting→developing', st.ok && st.team.statusMeta.label === '开发中', st);
  const join = await j('/api/teams/' + tid + '/join', { method: 'POST', token: dT, body: { msg: '金熙林请求加入' } });
  ok('金熙林申请加入 PG测试队', join.ok, join);
  const list2 = await j('/api/teams', { token: nT });
  const teamDetail = list2.teams.find(t => t.id === tid);
  const reqId = teamDetail.requests.find(r => r.player_id === 79)?.id;
  const acc = await j('/api/teams/' + tid + '/requests/' + reqId, { method: 'POST', token: nT, body: { action: 'accept' } });
  ok('队长接受申请', acc.ok, acc);
  const mine2 = await j('/api/teams/mine', { token: dT });
  ok('金熙林加入成功', mine2.joined.some(t => t.name === 'PG测试队'), mine2.joined.map(t => t.name));
  const leave = await j('/api/teams/' + tid + '/leave', { method: 'POST', token: dT });
  ok('退出队伍', leave.ok, leave);
  const dis = await j('/api/teams/' + tid + '/disband', { method: 'POST', token: nT });
  ok('解散队伍', dis.ok, dis);

  console.log('== 5. 认领流程（PG RETURNING + claims）==');
  const free = (await j('/api/players')).players.find(p => p.status === 'unclaimed' && p.name !== '金熙林' && p.name !== '测试选手');
  const claim = await j('/api/claims', { method: 'POST', body: { player_id: free.id } });
  ok('创建认领', claim.ok && claim.claim_token, claim);
  const email2 = 'claim_' + Date.now() + '@xjhack.test';
  const rc2 = await j('/api/auth/request-code', { method: 'POST', body: { email: email2 } });
  const vc2 = await j('/api/auth/verify-code', { method: 'POST', body: { email: email2, code: rc2.devCode, claim_token: claim.claim_token } });
  ok('验证码认领成功', vc2.ok && vc2.user.player.name === free.name, vc2);
  const p3 = (await j('/api/players')).players.find(p => p.id === free.id);
  ok('该选手已认领', p3.status === 'claimed', p3 && p3.status);

  console.log('== 6. 等待池 ==');
  const pool = await j('/api/pool/join', { method: 'POST', token: nT, body: { msg: '求组队' } });
  ok('进入等待池', pool.ok, pool);
  const poolMe = await j('/api/pool', { token: nT });
  ok('等待池显示自己', poolMe.ok && poolMe.me && poolMe.waiting >= 1, poolMe);
  await j('/api/pool/leave', { method: 'POST', token: nT });
  ok('退出等待池', true);

  console.log('== 7. 管理员 ==');
  const aEmail = 'admin@xjhack.local';
  const ra = await j('/api/auth/request-code', { method: 'POST', body: { email: aEmail } });
  const va = await j('/api/auth/verify-code', { method: 'POST', body: { email: aEmail, code: ra.devCode } });
  ok('管理员登录', va.ok && va.user.is_admin === true, va.user && va.user.is_admin);
  const aT = va.token;
  const ov = await j('/api/admin/overview', { token: aT });
  ok('管理后台总览（含解密联系方式）', ov.ok && ov.total >= 58 && typeof ov.players[0].contact === 'string', ov.total);
  const sAdd = await j('/api/admin/schedules', { method: 'POST', token: aT, body: { day: 'Day 3', title: '颁奖', desc: '大礼堂', status: 'todo', sort: 99 } });
  ok('管理员新增赛程', sAdd.ok && sAdd.id > 0, sAdd);
  const aAdd = await j('/api/admin/announcements', { method: 'POST', token: aT, body: { tag: '公告', title: '测试公告', body: '正文', time: '12:00' } });
  ok('管理员新增公告', aAdd.ok && aAdd.id > 0, aAdd);
  await j('/api/admin/players', { method: 'POST', token: aT, body: { name: '管理员添加' } });
  const aP = await j('/api/admin/players', { method: 'POST', token: aT, body: { name: '管理员添加' } }); ok('管理员添加选手', aP.ok, aP);

  console.log('\n结果：通过', pass, '项 / 失败', fail, '项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('执行异常:', e); process.exit(1); });
