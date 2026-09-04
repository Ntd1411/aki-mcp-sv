const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CDP = require('chrome-remote-interface');
const { getPostmanPaths } = require('./postman-paths');

// Việc duy nhất Postman-side (event listener qua CDP domain) không làm được:
// đọc cổng DevTools thật từ đĩa và tự spawn app khi nó chưa chạy. Dùng chung
// cho index.js, cdp-launch.js, debug-chat.js thay vì mỗi nơi tự đọc một kiểu.
class PostmanSession {
  static getDevToolsPort() {
    let devToolsFile = '';
    if (process.platform === 'darwin') {
      devToolsFile = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Postman', 'DevToolsActivePort');
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
      devToolsFile = path.join(appData, 'Postman', 'DevToolsActivePort');
    } else {
      devToolsFile = path.join(process.env.HOME || '', '.config', 'Postman', 'DevToolsActivePort');
    }

    if (fs.existsSync(devToolsFile)) {
      try {
        const lines = fs.readFileSync(devToolsFile, 'utf8').trim().split('\n');
        return parseInt(lines[0], 10);
      } catch (e) {
        return 9222;
      }
    }
    return 9222;
  }

  // Launch flags: docs/arch/cdp-controller.md § Launch flags
  static launchArgs(port) {
    return [
      `--remote-debugging-port=${port}`,
      '--disable-blink-features=AutomationControlled',
    ];
  }

  static async ensureRunning() {
    const port = PostmanSession.getDevToolsPort();
    try {
      await CDP.List({ port });
      console.log(`✅ CDP đang chạy trên port ${port}`);
      return port;
    } catch (e) {
      console.log(`🚀 Tự động mở Postman kèm cờ CDP trên port ${port}...`);
      const args = PostmanSession.launchArgs(port);
      const { execPath } = getPostmanPaths();
      if (execPath && fs.existsSync(execPath)) {
        spawn(execPath, args, { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', ['-a', 'Postman', '--args', ...args], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('postman', args, { detached: true, stdio: 'ignore' }).unref();
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return port;
    }
  }
}

module.exports = { PostmanSession };
