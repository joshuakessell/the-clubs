"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedProgress = void 0;
class SeedProgress {
    total;
    current = 0;
    title;
    message = '';
    lastRenderAt = 0;
    lastLineLength = 0;
    lastLoggedPercent = -1;
    lastNonTtyLogAt = 0;
    enabled;
    isTTY;
    constructor(options = {}) {
        const { total = 0, title = 'Seeding demo', enabled = true } = options;
        this.total = Math.max(0, Math.floor(total));
        this.title = title;
        this.enabled = enabled;
        this.isTTY = Boolean(process.stdout.isTTY);
    }
    addTotal(amount) {
        if (!this.enabled)
            return;
        const delta = Math.floor(amount);
        if (!Number.isFinite(delta) || delta <= 0)
            return;
        this.total += delta;
        this.render(true);
    }
    setMessage(message) {
        if (!this.enabled)
            return;
        this.message = message;
        this.render(true);
    }
    tick(message, increment = 1) {
        if (!this.enabled)
            return;
        const delta = Math.floor(increment);
        if (message)
            this.message = message;
        if (Number.isFinite(delta) && delta > 0) {
            this.current += delta;
        }
        if (this.current > this.total) {
            this.total = this.current;
        }
        this.render();
    }
    log(message) {
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
    done(message) {
        if (!this.enabled)
            return;
        if (message)
            this.message = message;
        if (this.total <= 0) {
            this.total = 1;
        }
        this.current = this.total;
        this.render(true);
        if (this.isTTY) {
            process.stdout.write('\n');
        }
    }
    render(force = false) {
        if (!this.enabled)
            return;
        const now = Date.now();
        if (!force && now - this.lastRenderAt < 60)
            return;
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
            const padding = this.lastLineLength > line.length ? ' '.repeat(this.lastLineLength - line.length) : '';
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
exports.SeedProgress = SeedProgress;
