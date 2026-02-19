"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaneIdSchema = void 0;
exports.parseLaneIdOptional = parseLaneIdOptional;
const zod_1 = require("zod");
/**
 * Canonical lane id format used across kiosk/register apps: "lane-1", "lane-2", ...
 *
 * Notes:
 * - We intentionally avoid enforcing an upper bound here; deployments may have varying lane counts.
 * - This is NOT an authorization check. It's input validation to prevent arbitrary strings.
 */
exports.LaneIdSchema = zod_1.z
    .string()
    .trim()
    .regex(/^lane-[1-9]\d*$/, { message: 'Invalid laneId (expected format lane-<number>)' });
function parseLaneIdOptional(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    const parsed = exports.LaneIdSchema.safeParse(trimmed);
    return parsed.success ? parsed.data : undefined;
}
