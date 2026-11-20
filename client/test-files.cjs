/**
 * 文件管理验证：列表 / 删除 / 级联删消息 / 磁盘清理 / 越权拒绝。
 * 需服务端运行中；地址可用 BASE 覆盖，默认 localhost:1111。
 * 注意：测试会在数据库中残留测试账号与消息，建议在测试实例上运行。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const BASE = process.env.BASE || 'http://localhost:1111';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const req = (p, { method = 'GET', token, body } = {}) =>
  fetch(BASE + p, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

function connect(token) {
  return new Promise((res) => {
    const s = io(BASE, { auth: { token } });
    s.on('connect', () => res(s));
  });
}
const emit = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));

/** 上传一个真实文件，返回 { fileId, name, size }。 */
async function upload(token, name, content) {
  const fd = new FormData();
  fd.append('file', new Blob([content]), name);
  const r = await fetch(BASE + '/api/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return r.json();
}

(async () => {
  const uniq = Date.now().toString().slice(-6);

  // 管理员（首个注册用户自动成为管理员）+ 普通用户
  const admin = (await req('/api/register', { method: 'POST', body: { username: 'ma' + uniq, password: 'pass123', nickname: '管理员' } })).data;
  const member = (await req('/api/register', { method: 'POST', body: { username: 'mu' + uniq, password: 'pass123', nickname: '成员' } })).data;
  const sa = await connect(admin.token);
  const sm = await connect(member.token);

  // --- 准备：上传 2 个文件，其中一个发成消息 ---
  const f1 = await upload(admin.token, '报告A.txt', 'A'.repeat(100));
  const f2 = await upload(admin.token, '图片B.png', 'B'.repeat(2048));
  assert(f1.fileId && f2.fileId, '上传应成功');

  // 只把 f1 发成消息，f2 只存不发
  const sent = await emit(sa, 'message:send', { to: null, type: 'file', content: f1 });
  assert(sent.ok, '文件消息应发送成功');

  // --- 列表 ---
  const list = await req('/api/files', { token: admin.token });
  assert(list.status === 200, `管理员列文件应 200，实际 ${list.status}`);
  const names = list.data.files.map((f) => f.name);
  assert(names.includes('报告A.txt') && names.includes('图片B.png'), '列表应含两个文件');
  const f1row = list.data.files.find((f) => f.id === f1.fileId);
  assert(f1row.uploaderNickname === '管理员', '应带上传者昵称');
  assert(f1row.size === 100, '文件大小应正确');

  // 记录磁盘上的实际文件数，用于后续验证删除确实落到磁盘
  const diskBefore = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;

  // 越权：普通用户不能列文件/删文件
  const deniedList = await req('/api/files', { token: member.token });
  assert(deniedList.status === 403, `普通用户列文件应 403，实际 ${deniedList.status}`);
  const deniedDel = await req(`/api/files/${f1.fileId}`, { method: 'DELETE', token: member.token });
  assert(deniedDel.status === 403, `普通用户删文件应 403，实际 ${deniedDel.status}`);

  // 删除不存在的文件 → 404
  const notFound = await req('/api/files/999999', { method: 'DELETE', token: admin.token });
  assert(notFound.status === 404, `删不存在的文件应 404，实际 ${notFound.status}`);

  // --- 实时通知：删除应广播 file:deleted ---
  const deletedEvents = [];
  sm.on('file:deleted', (e) => deletedEvents.push(e));

  // --- 删除未发消息的文件 f2：磁盘文件消失，记录消失，无关联消息 ---
  const beforeCount = (await req('/api/files', { token: admin.token })).data.files.length;
  const del2 = await req(`/api/files/${f2.fileId}`, { method: 'DELETE', token: admin.token });
  assert(del2.data.ok && del2.data.deletedMessages === 0, '删未引用文件：deletedMessages 应为 0');
  const afterCount = (await req('/api/files', { token: admin.token })).data.files.length;
  assert(afterCount === beforeCount - 1, '列表应少一个文件');
  // f2 的删除也应实时通知（监听器注册后即生效）
  await new Promise((r) => setTimeout(r, 200));
  assert(deletedEvents.some((e) => e.id === f2.fileId), 'f2 删除应广播 file:deleted');

  // --- 删除已发消息的文件 f1：级联删除该消息 ---
  const del1 = await req(`/api/files/${f1.fileId}`, { method: 'DELETE', token: admin.token });
  assert(del1.data.ok, '删除应成功');
  assert(del1.data.deletedMessages === 1, `应连带删 1 条消息，实际 ${del1.data.deletedMessages}`);

  await new Promise((r) => setTimeout(r, 200));
  assert(deletedEvents.some((e) => e.id === f1.fileId), 'f1 删除应广播 file:deleted');

  // 历史里不应再有该文件消息
  const hist = await new Promise((res) => sa.emit('history:group', {}, res));
  assert(!hist.some((m) => m.type === 'file' && m.id === sent.id), '历史中该文件消息应已删除');

  // 文件接口应 404
  const gone = await req(`/api/files/${f1.fileId}`, { token: admin.token });
  assert(gone.status === 404, `已删文件应 404，实际 ${gone.status}`);

  // 两个文件都应已从磁盘移除
  const diskAfter = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0;
  assert(diskAfter === diskBefore - 2, `磁盘文件应减少 2 个：前 ${diskBefore} → 后 ${diskAfter}`);

  // --- 上传仍正常（回归） ---
  const f3 = await upload(member.token, '回归C.txt', 'C'.repeat(50));
  assert(f3.fileId, '删除功能不应影响上传');
  await req(`/api/files/${f3.fileId}`, { method: 'DELETE', token: admin.token });

  // ---- 上传大小上限（管理员可设置，运行时生效，默认 20GB） ----
  const limit0 = (await req('/api/files/limit', { token: member.token })).data;
  assert(limit0.maxUploadMb === 20480, '默认上限应为 20480MB (20GB): ' + JSON.stringify(limit0));
  const badSet = await req('/api/storage-settings', { method: 'POST', token: admin.token, body: { maxUploadMb: 0 } });
  assert(badSet.status === 400, '非法上限（0）应被拒绝');
  const overCap = await req('/api/storage-settings', { method: 'POST', token: admin.token, body: { maxUploadMb: 20481 } });
  assert(overCap.status === 400, '超过硬顶（20481MB）应被拒绝');
  const denied = await req('/api/storage-settings', { method: 'POST', token: member.token, body: { maxUploadMb: 1 } });
  assert(denied.status === 403, '非管理员不能改上限');
  const set1 = (await req('/api/storage-settings', { method: 'POST', token: admin.token, body: { maxUploadMb: 1 } })).data;
  assert(set1.settings.maxUploadMb === 1, '设置 1MB 上限应生效');
  const limitNow = (await req('/api/files/limit', { token: member.token })).data;
  assert(limitNow.maxUploadMb === 1, '普通用户应能查到新上限');
  const tooBig = await upload(admin.token, '超大.txt', 'X'.repeat(2 * 1024 * 1024));
  assert(tooBig.error && /上限/.test(tooBig.error), '超限上传应被拒绝: ' + JSON.stringify(tooBig));
  const okSmall = await upload(admin.token, '小文件.txt', 'ok');
  assert(okSmall.fileId, '限内上传仍应成功');
  await req('/api/storage-settings', { method: 'POST', token: admin.token, body: { maxUploadMb: 20480 } });

  sa.disconnect();
  sm.disconnect();
  console.log('文件管理验证全部通过 ✓  （列表/删除/级联删消息/磁盘清理/实时通知/越权拒绝/回归/上传上限）');
  process.exit(0);
})().catch((e) => {
  console.error('✗ 失败:', e.message);
  process.exit(1);
});