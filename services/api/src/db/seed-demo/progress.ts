type ProgressOptions = {
  total?: number;
  title?: string;
  enabled?: boolean;
};

export type ProgressReporter = {
  addTotal: (amount: number) => void;
  tick: (message?: string, increment?: number) => void;
  setMessage: (message: string) => void;
  log: (message: string) => void;
  done: (message?: string) => void;
};

export class SeedProgress implements ProgressReporter {
  private total: number;
  private current = 0;
  private title: string;
  private message = '';
  private lastRenderAt = 0;
  private lastLineLength = 0;
  private lastLoggedPercent = -1;
  private lastNonTtyLogAt = 0;
  private enabled: boolean;
  private isTTY: boolean;

  constructor(options: ProgressOptions = {}) {
    const { total = 0, title = 'Seeding demo', enabled = true } = options;
    this.total = Math.max(0, Math.floor(total));
    this.title = title;
    this.enabled = enabled;
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  addTotal(amount: number): void {
    if (!this.enabled) return;
    const delta = Math.floor(amount);
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.total += delta;
    this.render(true);
  }

  setMessage(message: string): void {
    if (!this.enabled) return;
    this.message = message;
    this.render(true);
  }

  tick(message?: string, increment = 1): void {
    if (!this.enabled) return;
    const delta = Math.floor(increment);
    if (message) this.message = message;
    if (Number.isFinite(delta) && delta > 0) {
      this.current += delta;
    }
    if (this.current > this.total) {
      this.total = this.current;
    }
    this.render();
  }

  log(message: string): void {
    if (!this.enabled) {
      console.log(message);
      return;
    }
    if (this.isTTY) {
      process.stdout.write('\n');
    }
    console.log(message);
    this.render(true);
  }

  done(message?: string): void {
    if (!this.enabled) return;
    if (message) this.message = message;
    if (this.total <= 0) {
      this.total = 1;
    }
    this.current = this.total;
    this.render(true);
    if (this.isTTY) {
      process.stdout.write('\n');
    }
  }

  private render(force = false): void {
    if (!this.enabled) return;
    const now = Date.now();
    if (!force && now - this.lastRenderAt < 60) return;

    const safeTotal = Math.max(this.total, 1);
    const ratio = Math.min(this.current / safeTotal, 1);
    const percent = Math.round(ratio * 100);
    const barWidth = 28;
    const filled = Math.round(ratio * barWidth);
    const bar = `${'='.repeat(filled)}${'-'.repeat(barWidth - filled)}`;
    const suffix = this.message ? ` ${this.message}` : '';
    const line = `${this.title} [${bar}] ${this.current}/${this.total} ${percent}%${suffix}`;

    this.lastRenderAt = now;

    if (this.isTTY) {
      const padding =
        this.lastLineLength > line.length ? ' '.repeat(this.lastLineLength - line.length) : '';
      process.stdout.write(`\r${line}${padding}`);
      this.lastLineLength = line.length;
      return;
    }

    if (force || percent !== this.lastLoggedPercent) {
      this.lastLoggedPercent = percent;
      this.lastNonTtyLogAt = now;
      console.log(`${this.title} ${percent}% (${this.current}/${this.total})${suffix}`);
      return;
    }

    // In CI (non-TTY), long-running steps can appear "stuck" when percent doesn't change.
    // Emit a heartbeat log occasionally to confirm work is still in progress.
    if (now - this.lastNonTtyLogAt > 15000) {
      this.lastNonTtyLogAt = now;
      console.log(`${this.title} ${percent}% (${this.current}/${this.total})${suffix}`);
    }
  }
}
