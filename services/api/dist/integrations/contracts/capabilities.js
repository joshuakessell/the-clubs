"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_CAPABILITIES = void 0;
exports.PROVIDER_CAPABILITIES = {
    mock: {
        supportsCardPayments: true,
        supportsCashPayments: true,
        customers: {
            search: true,
            lookupByExternalId: true,
            upsertMirror: true,
        },
        payments: {
            card: true,
            cash: true,
            listPayments: true,
            listRefunds: true,
            refund: true,
        },
        orders: {
            create: true,
            addLineItem: true,
            finalizePaid: true,
            lookupByExternalId: true,
        },
        labor: {
            shifts: true,
            timeclock: true,
            breaks: true,
        },
    },
    square: {
        supportsCardPayments: true,
        supportsCashPayments: false,
        customers: {
            search: true,
            lookupByExternalId: true,
            upsertMirror: true,
        },
        payments: {
            card: true,
            cash: false,
            listPayments: true,
            listRefunds: false,
            refund: false,
        },
        orders: {
            create: true,
            addLineItem: true,
            finalizePaid: true,
            lookupByExternalId: true,
        },
        labor: {
            shifts: true,
            timeclock: true,
            breaks: true,
        },
    },
};
