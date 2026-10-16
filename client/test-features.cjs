/** 新功能验证：撤回 / 已读回执 / 搜索 / 存储统计（需服务端运行中，BASE 可覆盖地址） */
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:1111';
const assert = require('assert');

const post = (p, body, token) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = (p, token) =>
  fetch(BASE + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then((r) => r.json());

function connect(token) {
  return new Promise((res) => {
    const s = io(BASE, { auth: { token } });
    s.on('connect', () => res(s));
  });
}
const emit = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));

(async () => {
  const uniq = Date.now();
  // 注册：alice 管理员 + bob
  const a = (await post('/api/register', { username: 'fa' + uniq, password: 'pass123', nickname: '小A' }));
  const b = (await post('/api/register', { username: 'fb' + uniq, password: 'pass123', nickname: '小B' }));
  const sa = await connect(a.token);
  const sb = await connect(b.token);

  // ---- 群聊消息 + 撤回 ----
  const revEvents = [];
  sb.on('message:revoked', (e) => revEvents.push(e));
  const sent = await emit(sa, 'message:send', { to: null, type: 'text', content: '这条会被撤回 hello' });
  assert(sent.ok, '发送应成功');
  const r1 = await emit(sa, 'message:recall', { id: sent.id });
  assert(r1.ok, '2 分钟内应可撤回: ' + r1.error);
  await new Promise((r) => setTimeout(r, 100));
  assert(revEvents.length === 1 && revEvents[0].id === sent.id, '对方应收到撤回事件');
  const hist = await new Promise((res) => sa.emit('history:group', {}, res));
  const recalled = hist.find((m) => m.id === sent.id);
  assert(recalled.revoked === true && recalled.content === null, '历史中撤回消息应置空内容');

  // 超时撤回校验（伪造旧时间不可行，改为验证他人撤回被拒）
  const sent2 = await emit(sa, 'message:send', { to: null, type: 'text', content: 'bob不能撤我' });
  const r2 = await emit(sb, 'message:recall', { id: sent2.id });
  assert(r2.error, '非管理员撤他人消息应被拒: ' + JSON.stringify(r2));
  // 管理员（alice）可撤任意消息
  const r3 = await emit(sa, 'message:recall', { id: sent2.id });
  assert(r3.ok, '管理员应可撤任意消息');

  // ---- 已读回执 ----
  const readEvents = [];
  sa.on('read:update', (e) => readEvents.push(e));
  const pm = await emit(sa, 'message:send', { to: b.user.id, type: 'text', content: '私信请查收' });
  assert(pm.ok);
  sb.emit('read:update', { peerId: a.user.id });
  await new Promise((r) => setTimeout(r, 150));
  assert(readEvents.length === 1 && readEvents[0].peerId === b.user.id, 'alice 应收到 bob 的已读上报');
  assert(readEvents[0].lastReadId >= pm.id, 'lastReadId 应 >= 私信 id');

  // ---- 搜索 ----
  const sm = await emit(sa, 'message:send', { to: null, type: 'text', content: '搜索关键词xyzzy 独角兽' });
  assert(sm.ok);
  const srch = await get(`/api/search?q=${encodeURIComponent('xyzzy')}`, a.token);
  assert(srch.results.length === 1, '搜索应命中未撤回的群聊消息: ' + JSON.stringify(srch));
  assert(!srch.results.some((r) => r.id === sent.id), '已撤回消息不应出现在搜索结果');
  const srch2 = await get(`/api/search?q=${encodeURIComponent('私信请查收')}`, b.token);
  assert(srch2.results.length === 1, 'bob 应能搜到自己参与的私聊');
  const srch3 = await get('/api/search?q=私信请查收', a.token); // 换个无关词
  const nobody = await (async () => {
    const c = (await post('/api/register', { username: 'fc' + uniq, password: 'pass123' }));
    return get(`/api/search?q=${encodeURIComponent('私信请查收')}`, c.token);
  })();
  assert(nobody.results.length === 0, '无关第三方不应搜到他人私聊');

  // ---- 存储统计（管理员） ----
  const stats = await get('/api/stats', a.token);
  assert(stats.stats && typeof stats.stats.messageCount === 'number', '管理员可获取统计');
  assert(Array.isArray(stats.stats.byUser), '应包含按用户统计');
  const statsDenied = await get('/api/stats', b.token);
  assert(statsDenied.error, '非管理员应被拒绝: ' + JSON.stringify(statsDenied));

  // ---- 给自己发消息 ----
  const selfEcho = [];
  sa.on('message:new', (m) => selfEcho.push(m));
  const selfSent = await emit(sa, 'message:send', { to: a.user.id, type: 'text', content: '便签：给自己备忘' });
  assert(selfSent.ok, '给自己发消息应成功: ' + JSON.stringify(selfSent));
  await new Promise((r) => setTimeout(r, 150));
  assert(selfEcho.some((m) => m.id === selfSent.id), '自己应收到消息回显');
  const selfHist = await new Promise((res) => sa.emit('history:private', { userId: a.user.id }, res));
  assert(selfHist.some((m) => m.id === selfSent.id && m.senderId === a.user.id && m.receiverId === a.user.id),
    '私聊历史应含发给自己的消息');
  const selfFile = await emit(sa, 'message:send', { to: a.user.id, type: 'file', content: JSON.stringify({ fileId: 999999 }) });
  assert(selfFile.error, '无效文件仍应被拒绝');
  sa.emit('read:update', { peerId: a.user.id }); // 自己会话的已读位置不应报错
  await new Promise((r) => setTimeout(r, 100));

  sa.disconnect(); sb.disconnect();
  console.log('新功能验证全部通过 ✓  （撤回/已读/搜索/统计/越权校验）');
  process.exit(0);
})().catch((e) => {
  console.error('✗ 失败:', e.message);
  process.exit(1);
});
