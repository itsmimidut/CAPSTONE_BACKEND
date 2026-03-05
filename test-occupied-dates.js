/**
 * Test script to verify occupied-dates API responses
 * Run: node test-occupied-dates.js
 */

const BASE_URL = 'http://localhost:8000/api';

async function testOccupiedDates() {
    try {
        console.log('🧪 Testing occupied-dates endpoints...\n');

        // Test 1: Get all occupied dates
        console.log('1️⃣ Testing GET /api/bookings/occupied-dates (all items)');
        const allResponse = await fetch(`${BASE_URL}/bookings/occupied-dates`);
        const allData = await allResponse.json();
        console.log('Response:', JSON.stringify(allData, null, 2));
        console.log('Expected format: { success: true, data: { occupiedDates: [...], totalCount, bookingsAffecting } }');
        console.log('');

        // Test 2: Get occupied dates for specific item (assuming item ID 1 exists)
        console.log('2️⃣ Testing GET /api/bookings/occupied-dates/1 (specific item)');
        const itemResponse = await fetch(`${BASE_URL}/bookings/occupied-dates/1`);
        const itemData = await itemResponse.json();
        console.log('Response:', JSON.stringify(itemData, null, 2));
        console.log('Expected format: { success: true, data: { itemId, occupiedDates: [...], totalCount, bookingsAffecting } }');
        console.log('');

        // Verify data structure
        console.log('✅ Data structure verification:');
        if (allData.data && allData.data.occupiedDates) {
            console.log('✓ All items endpoint returns nested occupiedDates');
            if (allData.data.occupiedDates.length > 0) {
                console.log('✓ Sample occupied date:', allData.data.occupiedDates[0]);
            }
        } else {
            console.log('✗ ISSUE: occupiedDates not found in response');
        }

        if (itemData.data && itemData.data.occupiedDates) {
            console.log('✓ Single item endpoint returns nested occupiedDates');
            if (itemData.data.occupiedDates.length > 0) {
                console.log('✓ Sample occupied date:', itemData.data.occupiedDates[0]);
            }
        } else {
            console.log('✗ ISSUE: occupiedDates not found in response');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('Make sure the backend is running on localhost:8000');
    }
}

testOccupiedDates();
