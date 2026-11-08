const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const pidFile = path.join(root, 'data', 'server.pid');
const port = Number(process.env.PORT) || 8787;
const url = `http://127.0.0.1:${port}/api/health`;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function running() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

(async () => {
  if (await running()) {
    console.log(`游戏已经在运行：http://127.0.0.1:${port}`);
    console.log('如需重启，先运行 stop-game.cmd。');
    return;
  }
  if (fs.existsSync(pidFile)) {
    const oldPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (Number.isInteger(oldPid) && oldPid > 0 && alive(oldPid)) {
      console.log(`检测到旧进程 ${oldPid} 仍占用，但服务没有响应。请先运行 stop-game.cmd。`);
      process.exitCode = 1;
      return;
    }
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // 忽略
    }
  }
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  for (let i = 0; i < 25; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await running()) {
      console.log(`游戏已启动：http://127.0.0.1:${port}`);
      console.log('停止服务：双击 stop-game.cmd，或运行 node stop.js。');
      return;
    }
  }
  console.error('启动超时。请查看 data/server.pid，或手动运行 node src/index.js。');
  process.exitCode = 1;
})();
