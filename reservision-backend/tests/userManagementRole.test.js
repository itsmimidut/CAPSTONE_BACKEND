import assert from 'node:assert/strict';
import test from 'node:test';
import { changeUserRole } from '../controllers/userManagementController.js';

test('an authenticated admin cannot change their own role', async () => {
    const req = {
        user: { id: 42, role: 'admin' },
        params: { id: '42' },
        body: { role: 'customer' },
    };
    const response = { statusCode: 200, payload: null };
    const res = {
        status(code) {
            response.statusCode = code;
            return this;
        },
        json(payload) {
            response.payload = payload;
            return this;
        },
    };

    await changeUserRole(req, res);

    assert.equal(response.statusCode, 409);
    assert.equal(response.payload.success, false);
    assert.equal(response.payload.code, 'SELF_ROLE_CHANGE_FORBIDDEN');
});
