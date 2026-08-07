import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizePosTransactionItem,
    normalizePosTransactionItems,
    insertNormalizedPosTransactionItems,
    PosTransactionItemValidationError,
} from '../services/posTransactionItemService.js';

test('normalizes current E-Shop shape while preserving line order and customization', () => {
    const lines = normalizePosTransactionItems([
        {
            menu_id: 15,
            name: 'Halo-Halo',
            price: '120.00',
            quantity: 2,
            subtotal: 240,
            customization: { sizeLabel: 'Large', addOns: [{ name: 'Ice cream' }] },
        },
        { name: 'Coffee', price: 80, qty: 1 },
    ]);

    assert.equal(lines[0].lineNumber, 1);
    assert.equal(lines[0].menuId, 15);
    assert.equal(lines[0].productNameSnapshot, 'Halo-Halo');
    assert.equal(lines[0].quantity, 2);
    assert.equal(lines[0].lineTotalSnapshot, 240);
    assert.deepEqual(lines[0].modifiersSnapshot, {
        sizeLabel: 'Large',
        addOns: [{ name: 'Ice cream' }],
    });
    assert.equal(lines[1].lineNumber, 2);
    assert.equal(lines[1].menuId, null);
    assert.equal(lines[1].lineTotalSnapshot, 80);
});

test('supports audited historical aliases and leaves a missing menu ID null', () => {
    const line = normalizePosTransactionItem({
        product_name: 'Pancit',
        unit_price: 150,
        qty: 3,
        line_total: 450,
        modifiers: [{ name: 'Spicy' }],
    }, 0);

    assert.equal(line.menuId, null);
    assert.equal(line.quantity, 3);
    assert.equal(line.unitPriceSnapshot, 150);
    assert.equal(line.lineTotalSnapshot, 450);
});

for (const [name, item, code] of [
    ['missing name', { price: 10, quantity: 1 }, 'MISSING_PRODUCT_NAME'],
    ['invalid quantity', { name: 'Tea', price: 10, quantity: 0 }, 'INVALID_QUANTITY'],
    ['invalid price', { name: 'Tea', price: 'not-money', quantity: 1 }, 'INVALID_UNIT_PRICE'],
]) {
    test(`rejects ${name}`, () => {
        assert.throws(
            () => normalizePosTransactionItem(item, 0),
            (error) => error instanceof PosTransactionItemValidationError && error.code === code,
        );
    });
}

test('inserts stable lines with legacy and snapshot columns in one caller transaction', async () => {
    const calls = [];
    const connection = {
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/SELECT menu_id FROM menu_items/i.test(sql)) return [[]];
            return [{ affectedRows: 1 }];
        },
    };

    const normalized = await insertNormalizedPosTransactionItems(connection, {
        transactionId: 99,
        receiptNo: 'ESHOP-99',
        items: [
            { menu_id: 7, name: 'Tea', price: 25, quantity: 2, subtotal: 50 },
            { name: 'Cake', price: 60, quantity: 1, subtotal: 60 },
        ],
    });

    assert.equal(calls.length, 3);

    const [firstInsert, missingMenuLookup, secondInsert] = calls;
    assert.match(firstInsert.sql, /INSERT\s+INTO\s+pos_transaction_items/i);
    assert.match(firstInsert.sql, /line_number/);
    assert.equal(firstInsert.params[0], 99);
    assert.equal(firstInsert.params[1], 'ESHOP-99');
    assert.equal(firstInsert.params[3], 7);
    assert.equal(firstInsert.params[8], 1);

    assert.match(missingMenuLookup.sql, /SELECT\s+menu_id\s+FROM\s+menu_items/i);
    assert.deepEqual(missingMenuLookup.params, ['Cake']);

    assert.match(secondInsert.sql, /INSERT\s+INTO\s+pos_transaction_items/i);
    assert.equal(secondInsert.params[0], 99);
    assert.equal(secondInsert.params[3], null);
    assert.equal(secondInsert.params[8], 2);
    assert.equal(normalized[1].menuId, null);
});
