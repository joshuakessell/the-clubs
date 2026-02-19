"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundDownTo15Minutes = roundDownTo15Minutes;
exports.formatRoundedDuration = formatRoundedDuration;
exports.buildSystemLateFeeNote = buildSystemLateFeeNote;
exports.stripSystemLateFeeNotes = stripSystemLateFeeNotes;
const SYSTEM_LATE_FEE_PREFIX = '[SYSTEM_LATE_FEE_PENDING]';
function roundDownTo15Minutes(minutes) {
    const safe = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
    return Math.floor(safe / 15) * 15;
}
function formatRoundedDuration(minutesRoundedDownTo15) {
    if (minutesRoundedDownTo15 < 60) {
        const m = minutesRoundedDownTo15;
        return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
    }
    const h = Math.floor(minutesRoundedDownTo15 / 60);
    const m = minutesRoundedDownTo15 % 60;
    return `${h}h ${m}m`;
}
function buildSystemLateFeeNote({ lateMinutes, visitDate, feeAmount, }) {
    const rounded = roundDownTo15Minutes(lateMinutes);
    const dur = formatRoundedDuration(rounded);
    // Example required format:
    // “Late fee: customer was 1h 15m late on last visit on 2026-01-12.”
    // We include amount for clarity but keep the same core sentence.
    return `${SYSTEM_LATE_FEE_PREFIX} Late fee ($${feeAmount.toFixed(2)}): customer was ${dur} late on last visit on ${visitDate}.`;
}
function stripSystemLateFeeNotes(notes) {
    const raw = typeof notes === 'string' ? notes : '';
    if (!raw.trim())
        return null;
    const kept = raw
        .split('\n')
        .filter((line) => !line.startsWith(SYSTEM_LATE_FEE_PREFIX))
        .join('\n')
        .trim();
    return kept ? kept : null;
}
