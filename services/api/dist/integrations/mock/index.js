"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockLaborProvider = exports.MockOrdersProvider = exports.MockPaymentsProvider = exports.MockCustomersProvider = void 0;
exports.createMockProviders = createMockProviders;
const customers_1 = require("./customers");
const fixtures_1 = require("./fixtures");
const labor_1 = require("./labor");
const orders_1 = require("./orders");
const payments_1 = require("./payments");
function createMockProviders() {
    const store = (0, fixtures_1.createMockStore)();
    return {
        customers: new customers_1.MockCustomersProvider(store),
        payments: new payments_1.MockPaymentsProvider(store),
        orders: new orders_1.MockOrdersProvider(store),
        labor: new labor_1.MockLaborProvider(store),
    };
}
var customers_2 = require("./customers");
Object.defineProperty(exports, "MockCustomersProvider", { enumerable: true, get: function () { return customers_2.MockCustomersProvider; } });
var payments_2 = require("./payments");
Object.defineProperty(exports, "MockPaymentsProvider", { enumerable: true, get: function () { return payments_2.MockPaymentsProvider; } });
var orders_2 = require("./orders");
Object.defineProperty(exports, "MockOrdersProvider", { enumerable: true, get: function () { return orders_2.MockOrdersProvider; } });
var labor_2 = require("./labor");
Object.defineProperty(exports, "MockLaborProvider", { enumerable: true, get: function () { return labor_2.MockLaborProvider; } });
