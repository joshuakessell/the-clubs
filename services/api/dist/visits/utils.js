"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateTotalHours = calculateTotalHours;
exports.calculateTotalHoursWithExtension = calculateTotalHoursWithExtension;
exports.getLatestBlockEnd = getLatestBlockEnd;
function calculateTotalHours(blocks) {
    return blocks.reduce((sum, block) => {
        const hours = (new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0);
}
function calculateTotalHoursWithExtension(blocks, extensionHours) {
    return calculateTotalHours(blocks) + extensionHours;
}
function getLatestBlockEnd(blocks) {
    if (blocks.length === 0)
        return null;
    return blocks.reduce((latest, block) => {
        if (!latest || block.ends_at > latest)
            return block.ends_at;
        return latest;
    }, null);
}
