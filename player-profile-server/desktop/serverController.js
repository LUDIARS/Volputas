const path = require('node:path');

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

class DesktopServerController {
  constructor({
    forkProcess,
    modulePath = path.join(__dirname, 'serverProcess.js'),
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    onDiagnostic = (message) => process.stderr.write(`[desktop-server] ${message}\n`),
  }) {
    if (typeof forkProcess !== 'function') {
      throw new TypeError('forkProcess is required');
    }
    this.forkProcess = forkProcess;
    this.modulePath = modulePath;
    this.startupTimeoutMs = startupTimeoutMs;
    this.onDiagnostic = onDiagnostic;
    this.child = null;
  }

  async start() {
    if (this.child) throw new Error('Desktop server is already running');

    const child = this.forkProcess(this.modulePath, [], {
      cwd: path.dirname(this.modulePath),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.#forwardDiagnostics(child.stdout);
    this.#forwardDiagnostics(child.stderr);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        this.child = null;
        reject(new Error('Timed out while starting the Volputas desktop server'));
      }, this.startupTimeoutMs);

      const settleError = (error) => {
        if (settled) {
          this.onDiagnostic(error.message);
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.child = null;
        reject(error);
      };

      child.once('error', settleError);
      child.once('exit', (code) => {
        const exitedWhileOwned = this.child === child;
        if (exitedWhileOwned) this.child = null;
        if (!settled) {
          settleError(new Error(`Volputas desktop server exited with code ${code}`));
        } else if (exitedWhileOwned && code !== 0) {
          this.onDiagnostic(`Volputas desktop server exited with code ${code}`);
        }
      });
      child.on('message', (message) => {
        if (settled || message?.type !== 'ready') return;
        settled = true;
        clearTimeout(timer);
        resolve(message.url);
      });
    });
  }

  stop() {
    if (!this.child) return false;
    const child = this.child;
    this.child = null;
    return child.kill();
  }

  #forwardDiagnostics(stream) {
    if (!stream) return;
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const message = chunk.trim();
      if (message) this.onDiagnostic(message);
    });
  }
}

module.exports = { DEFAULT_STARTUP_TIMEOUT_MS, DesktopServerController };
