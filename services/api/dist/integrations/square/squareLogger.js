"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logSquareEvent = logSquareEvent;
function logSquareEvent(level, event, meta) {
    const payload = {
        ts: new Date().toISOString(),
        level,
        scope: 'integrations.square',
        event,
        ...(meta ?? {}),
    };
    try {
        process.stderr.write(`${JSON.stringify(payload)}\n`);
    }
    catch {
        // Ignore logging failures.
    }
}
