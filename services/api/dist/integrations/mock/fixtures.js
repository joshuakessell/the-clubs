"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMockStore = createMockStore;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function resolveFixturePath(fileName) {
    const localPath = node_path_1.default.resolve(__dirname, 'fixtures', fileName);
    if (node_fs_1.default.existsSync(localPath))
        return localPath;
    const sourcePath = node_path_1.default.resolve(process.cwd(), 'services', 'api', 'src', 'integrations', 'mock', 'fixtures', fileName);
    if (node_fs_1.default.existsSync(sourcePath))
        return sourcePath;
    throw new Error(`Mock fixtures not found: ${fileName}`);
}
function loadJson(fileName) {
    const filePath = resolveFixturePath(fileName);
    const raw = node_fs_1.default.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}
function findNextSequence(ids, prefix) {
    let max = 0;
    for (const id of ids) {
        if (!id.startsWith(prefix))
            continue;
        const suffix = id.slice(prefix.length);
        const num = Number(suffix);
        if (Number.isFinite(num)) {
            max = Math.max(max, Math.trunc(num));
        }
    }
    return max + 1;
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function createMockStore() {
    const customers = loadJson('customers.json').customers ?? [];
    const payments = loadJson('payments.json').payments ?? [];
    const refunds = loadJson('refunds.json').refunds ?? [];
    const ordersFixture = loadJson('orders.json');
    const shiftsFixture = loadJson('shifts.json');
    const breaks = loadJson('breaks.json').breaks ?? [];
    const orders = (ordersFixture.orders ?? []).map((order) => ({
        ...order,
        lineItems: order.lineItems ?? [],
    }));
    const store = {
        customers: clone(customers),
        payments: clone(payments),
        refunds: clone(refunds),
        orders: clone(orders),
        shifts: clone(shiftsFixture.shifts ?? []),
        timeclockSessions: clone(shiftsFixture.timeclockSessions ?? []),
        breaks: clone(breaks),
        counters: {
            customer: findNextSequence(customers.map((item) => item.externalId), 'mock-cust-'),
            payment: findNextSequence(payments.map((item) => item.externalId), 'mock-pay-'),
            refund: findNextSequence(refunds.map((item) => item.externalId), 'mock-refund-'),
            order: findNextSequence(orders.map((item) => item.externalId), 'mock-order-'),
        },
    };
    return store;
}
