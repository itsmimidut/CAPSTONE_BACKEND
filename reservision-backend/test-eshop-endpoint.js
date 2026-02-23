/**
 * Test E-Shop Order API Endpoint
 * Run this to verify the endpoint is working
 * 
 * Usage: node test-eshop-endpoint.js
 */

// Test if server is running
async function testEshopEndpoint() {
    const testOrder = {
        cart: [
            {
                name: "Beef Mami Noodle Soup",
                price: 185,
                qty: 2
            }
        ],
        locationType: "Room",
        locationNumber: "101",
        deliveryNotes: "Test order",
        totalAmount: 370
    };

    console.log('🧪 Testing E-Shop Order Endpoint...\n');
    console.log('📤 Sending test order to: http://localhost:8000/api/pos/eshop/order');
    console.log('📦 Test Data:', JSON.stringify(testOrder, null, 2));
    console.log('\n⏳ Waiting for response...\n');

    try {
        const response = await fetch('http://localhost:8000/api/pos/eshop/order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testOrder)
        });

        console.log('📊 Response Status:', response.status, response.statusText);

        const text = await response.text();
        console.log('📄 Raw Response:', text.substring(0, 200));

        try {
            const data = JSON.parse(text);
            console.log('\n✅ SUCCESS! Response Data:');
            console.log(JSON.stringify(data, null, 2));
        } catch (e) {
            console.log('\n❌ FAILED - Response is not JSON');
            console.log('Full response:', text);
        }

    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('   1. Is the backend server running? (npm start in CAPSTONE_BACKEND/reservision-backend)');
        console.log('   2. Check server.js console for errors');
        console.log('   3. Verify port 8000 is accessible');
    }
}

// Test if the POS routes are loaded
async function testPosRoutes() {
    console.log('\n🔍 Testing if POS routes are accessible...\n');

    const endpoints = [
        'http://localhost:8000/api/pos/items',
        'http://localhost:8000/api/pos/transactions',
    ];

    for (const url of endpoints) {
        try {
            const response = await fetch(url);
            console.log(`✅ ${url} - ${response.status}`);
        } catch (error) {
            console.log(`❌ ${url} - FAILED`);
        }
    }
}

// Run tests
(async () => {
    await testPosRoutes();
    console.log('\n' + '='.repeat(50) + '\n');
    await testEshopEndpoint();
})();
