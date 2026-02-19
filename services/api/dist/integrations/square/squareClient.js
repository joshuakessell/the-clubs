"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSquareLocationId = getSquareLocationId;
exports.getSquareClient = getSquareClient;
const square_1 = require("square");
let squareClient = null;
function resolveEnvironment() {
    const raw = process.env.SQUARE_ENVIRONMENT?.toLowerCase();
    if (raw === 'sandbox')
        return square_1.Environment.Sandbox;
    return square_1.Environment.Production;
}
function getSquareLocationId() {
    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) {
        throw new Error('Missing SQUARE_LOCATION_ID');
    }
    return locationId;
}
function getSquareClient() {
    if (squareClient)
        return squareClient;
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    if (!accessToken) {
        throw new Error('Missing SQUARE_ACCESS_TOKEN');
    }
    squareClient = new square_1.Client({
        accessToken,
        environment: resolveEnvironment(),
    });
    return squareClient;
}
