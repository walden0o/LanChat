/**
 * 临时端到端验证脚本：模拟两个用户。
 * 用法：node test-e2e.cjs   （需服务端已在 localhost:3000 运行）
 */
const { io } = require('socket.io-client');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:1111';
const suf = Date.now().toString(36);

async function post(p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function get(p, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, data: await res.json() };
}

function connect(token) {
  const s = io(BASE, { auth: { token } });
  s.msgs = [];
  s.readEvents = [];
  s.on('message:new', (m) => s.msgs.push(m));
  s.on('read:update', (m) => s.readEvents.push(m));
  s.on('read:marks', (m) => (s.marks = m));
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const emit = (s, ev, payload) =>
  new Promise((res) => s.emit(ev, payload, res));

async function main() {
  // 1. 注册两个用户：alice（首个 → 管理员）、bob
  const a = await post('/register', { username: `alice_${suf}`, password: '123456', nickname: 'Alice' });
  const b = await post('/register', { username: `bob_${suf}`, password: '123456', nickname: 'Bob' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.data.user.isAdmin, true, '首个用户应为管理员');
  assert.equal(b.data.user.isAdmin, false);
  console.log('✓ 注册：alice(管理员) bob');

  // 2. 重复用户名应 409；弱密码 400
  assert.equal((await post('/register', { username: `alice_${suf}`, password: 'xxxxxx' })).status, 409);
  assert.equal((await post('/register', { username: 'ok', password: '123' })).status, 400);
  console.log('✓ 注册校验');

  // 3. 登录错误密码 401
  assert.equal((await post('/login', { username: `bob_${suf}`, password: 'wrong1' })).status, 401);
  const login = await post('/login', { username: `bob_${suf}`, password: '123456' });
  assert.equal(login.status, 200);
  console.log('✓ 登录校验');

  // 4. 连接 socket
  const sa = await connect(a.data.token);
  const sb = await connect(b.data.token);
  // 未带 token 的连接应被拒绝
  await assert.rejects(connect('bad-token'));
  console.log('✓ socket 鉴权（坏 token 被拒）');

  // 等待 presence
  await new Promise((r) => setTimeout(r, 300));

  // 5. 群聊消息
  await emit(sa, 'message:send', { to: null, type: 'text', content: '大家好' });
  await new Promise((r) => setTimeout(r, 300));
  const gmsg = sb.msgs.find((m) => m.content === '大家好');
  assert.ok(gmsg && gmsg.receiverId === null, 'bob 应收到群聊消息');
  assert.equal(gmsg.senderNickname, 'Alice');
  console.log('✓ 群聊收发');

  // 6. 私聊消息（第三人收不到）
  await emit(sb, 'message:send', { to: a.data.user.id, type: 'text', content: '私聊一下' });
  await new Promise((r) => setTimeout(r, 300));
  const pmsg = sa.msgs.find((m) => m.content === '私聊一下');
  assert.ok(pmsg && pmsg.receiverId === a.data.user.id, 'alice 应收到私聊');
  console.log('✓ 私聊收发');

  // 7. 历史接口
  const hist = await emit(sa, 'history:private', { userId: b.data.user.id });
  assert.ok(hist.some((m) => m.content === '私聊一下'), '私聊历史应含该消息');
  const ghist = await emit(sa, 'history:group', {});
  assert.ok(ghist.some((m) => m.content === '大家好'), '群聊历史应含该消息');
  console.log('✓ 历史记录');

  // 8. 文件上传 → 文件消息 → 下载
  const tmpFile = path.join(__dirname, 'test-中文文件.txt');
  fs.writeFileSync(tmpFile, '内网文件传输测试 123');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(tmpFile)]), 'test-中文文件.txt');
  const up = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.data.token}` },
    body: form,
  });
  const meta = await up.json();
  assert.equal(up.status, 200, '上传应成功');
  assert.equal(meta.name, 'test-中文文件.txt', '中文文件名应正确');
  await emit(sa, 'message:send', { to: null, type: 'file', content: meta });
  await new Promise((r) => setTimeout(r, 300));
  const fmsg = sb.msgs.find((m) => m.type === 'file');
  assert.ok(fmsg, 'bob 应收到文件消息');
  const dl = await fetch(`${BASE}/api/files/${meta.fileId}`, {
    headers: { Authorization: `Bearer ${b.data.token}` },
  });
  assert.equal(await dl.text(), '内网文件传输测试 123');
  // 未登录下载应 401
  const dlNoAuth = await fetch(`${BASE}/api/files/${meta.fileId}`);
  assert.equal(dlNoAuth.status, 401);
  console.log('✓ 文件上传/消息/下载/鉴权');

  // 8b. 图片上传 → 内联预览（inline + ?token= 鉴权 + Range 支持）
  // 字节内容无需是合法 PNG，服务端只按 multipart 的 Content-Type 记录 mime
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const pngForm = new FormData();
  pngForm.append('file', new Blob([png], { type: 'image/png' }), 'pic.png');
  const up2 = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.data.token}` },
    body: pngForm,
  });
  const meta2 = await up2.json();
  assert.equal(meta2.mime, 'image/png');
  // ?token= 鉴权（模拟 <img> 标签直接引用）
  const inline = await fetch(`${BASE}/api/files/${meta2.fileId}?token=${a.data.token}`);
  assert.equal(inline.status, 200);
  assert.match(inline.headers.get('content-disposition') || '', /^inline/);
  // Range 请求 → 206（视频拖进度条依赖）
  const range = await fetch(`${BASE}/api/files/${meta2.fileId}?token=${a.data.token}`, {
    headers: { Range: 'bytes=0-7' },
  });
  assert.equal(range.status, 206);
  console.log('✓ 图片内联预览 / ?token= 鉴权 / Range 支持');

  // 9. 已读回执：私聊上报 → 实时通知 + 重连回拉；群聊已读广播
  await emit(sa, 'message:send', { to: b.data.user.id, type: 'text', content: '看到没' });
  await sleep(300);
  // bob 上报已读他与 alice 的私聊
  sb.emit('read:update', { peerId: a.data.user.id });
  await sleep(300);
  const privRead = sa.readEvents.find((e) => e.peerId === b.data.user.id);
  assert.ok(privRead && privRead.lastReadId > 0, 'alice 应收到 bob 的已读上报');
  console.log('✓ 私聊已读上报');

  // alice 重连 → read:marks 回拉历史已读位置
  sa.disconnect();
  const sa2 = await connect(a.data.token);
  await sleep(300);
  assert.ok(
    sa2.marks?.private?.some((r) => r.user_id === b.data.user.id && r.last_read_id > 0),
    '重连后应回拉到 bob 的已读位置'
  );
  console.log('✓ 连接回拉已读位置');

  // 群聊已读：bob 打开群聊 → 所有人收到广播（含 alice）
  sb.emit('read:update', { conv: 'group' });
  await sleep(300);
  const grpRead = sa2.readEvents.find((e) => e.conv === 'group' && e.userId === b.data.user.id);
  assert.ok(grpRead && grpRead.lastReadId > 0, '应收到群聊已读广播');
  assert.ok(Array.isArray(sa2.marks?.group), 'read:marks 应含 group 字段');
  console.log('✓ 群聊已读人数');

  // 10. 管理员：bob 无权访问 /users，alice 可以
  assert.equal((await get('/users', b.data.token)).status, 403);
  const users = (await get('/users', a.data.token)).data.users;
  assert.ok(users.length >= 2);
  console.log('✓ 管理员用户列表权限');

  // 10. 禁用 bob → bob 的 socket 被踢
  const kickedP = new Promise((r) => sb.on('kicked', r));
  const dis = await post(`/users/${b.data.user.id}/disable`, {}, a.data.token);
  assert.equal(dis.data.isDisabled, true);
  await Promise.race([kickedP, new Promise((_, rej) => setTimeout(() => rej(new Error('no kicked')), 2000))]);
  console.log('✓ 禁用用户并踢下线');

  // 禁用后 bob 无法登录
  assert.equal((await post('/login', { username: `bob_${suf}`, password: '123456' })).status, 403);
  console.log('✓ 禁用后无法登录');

  // 11. 删除 bob
  const del = await fetch(`${BASE}/api/users/${b.data.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${a.data.token}` },
  });
  assert.equal(del.status, 200);
  console.log('✓ 删除用户');

  sa2.disconnect(); sb.disconnect();
  fs.unlinkSync(tmpFile);
  console.log('\n全部通过 ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ 失败:', e);
  process.exit(1);
});
