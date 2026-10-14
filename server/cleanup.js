/**
 * 过期数据清理：消息与文件的保留期为 TTL_DAYS 天（默认 5）。
 * 启动时执行一次，之后每小时执行一次。
 *
 * 清理顺序：过期文件记录 → 过期消息 → 引用已不存在文件的"死"文件消息 → 磁盘文件。
 * 用户账号不过期。
 */
const path = require('path');
const fs = require('fs');
const { db, stmt, TTL_DAYS } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const INTERVAL_MS = 60 * 60 * 1000;

/** 执行一轮清理，返回各表删除条数。 */
function cleanup() {
  const storedNames = stmt.expiredFiles.all().map((f) => f.stored_name);
  const counts = db.transaction(() => ({
    files: stmt.deleteExpiredFiles.run().changes,
    messages: stmt.deleteExpiredMessages.run().changes,
    orphanFileMessages: stmt.deleteOrphanFileMessages.run().changes,
  }))();
  let unlinked = 0;
  for (const name of storedNames) {
    try {
      fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
      unlinked++;
    } catch {
      /* 文件可能已被删，忽略 */
    }
  }
  return { ...counts, unlinked };
}

/** 启动定时清理：立即跑一轮，之后每小时跑。 */
function startCleanupJob() {
  const run = () => {
    const c = cleanup();
    if (c.messages || c.files || c.orphanFileMessages) {
      console.log(
        `[local-qq] 过期清理：消息 ${c.messages}、文件 ${c.files}（磁盘 ${c.unlinked}）、死文件消息 ${c.orphanFileMessages}`
      );
    }
  };
  run();
  setInterval(run, INTERVAL_MS).unref(); // unref：不阻止进程退出
  console.log(`[local-qq] 数据有效期 ${TTL_DAYS} 天，每小时自动清理过期消息与文件`);
}

module.exports = { startCleanupJob, cleanup };
