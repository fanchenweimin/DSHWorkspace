const fs = require('node:fs');
const path = require('node:path');

const pidFile = path.join(__dirname, 'data', 'server.pid');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (!fs.existsSync(pidFile)) {
  console.log('没有找到 data/server.pid。');
  console.log('如果服务是在终端里启动的，回到那个窗口按 Ctrl+C。');
  console.log('也可以按端口查找后手动停止：');
  console.log('  Get-NetTCPConnection -LocalPort 8787 -State Listen | Select-Object OwningProcess');
  process.exit(1);
}

const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
if (!Number.isInteger(pid) || pid <= 0) {
  console.error('server.pid 内容无效，请手动检查。');
  process.exit(1);
}

if (!alive(pid)) {
  console.log(`记录中的进程 ${pid} 已经不在运行，清理 server.pid。`);
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // 忽略清理失败
  }
  process.exit(0);
}

try {
  process.kill(pid, 'SIGTERM');
  console.log(`已向服务进程 ${pid} 发送停止信号。`);
} catch (error) {
  console.error(`停止失败：${error.message}`);
  process.exit(1);
}

const started = Date.now();
const timer = setInterval(() => {
  if (!alive(pid)) {
    clearInterval(timer);
    try {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {
      // 服务自己会清理
    }
    console.log('服务已停止。');
    process.exit(0);
  }
  if (Date.now() - started > 4000) {
    clearInterval(timer);
    console.error('服务没有在 4 秒内退出。可以在任务管理器中结束这个 PID：' + pid);
    process.exit(1);
  }
}, 200);
