// /**
//  * ============================================================
//  * INVENTORY API - QUICK REFERENCE CHEAT SHEET
//  * ============================================================
//  * 
//  * All endpoints use BASE URL: http://localhost:8000/api/restaurant/inventory
//  * 
//  */

// // ============================================================
// // 1. GET ALL INVENTORY ITEMS
// // ============================================================
// // Retrieve all inventory with optional filters
// GET /
// ? status = good | low | critical    // Optional: filter by status
//         ? search = keyword               // Optional: search by item name

// // Response: { success: true, count: N, data: [...] }

// // JavaScript Example:
// const items = await fetch('http://localhost:8000/api/restaurant/inventory')
//     .then(r => r.json());


// // ============================================================
// // 2. GET SPECIFIC ITEM
// // ============================================================
// // Get details of one inventory item by ID
// GET /: id

// // Response: { success: true, data: {...} }

// // JavaScript Example:
// const item = await fetch('http://localhost:8000/api/restaurant/inventory/1')
//     .then(r => r.json());


// // ============================================================
// // 3. GET LOW STOCK ITEMS (ALERT)
// // ============================================================
// // Get items with low or critical stock - for alerts/notifications
// GET / status / low
//     ? critical = true               // Optional: only critical items
//         ? limit = 5                     // Optional: max results

// // Response: { success: true, count: N, data: [...] }

// // JavaScript Example (Dashboard Alert)
// const alertItems = await fetch('http://localhost:8000/api/restaurant/inventory/status/low')
//     .then(r => r.json())
//     .then(data => data.data);


// // ============================================================
// // 4. GET STATISTICS
// // ============================================================
// // Get inventory health overview for dashboard
// GET / stats

// // Response: 
// // {
// //   success: true,
// //   stats: {
// //     total_items: 45,
// //     good_status: 42,
// //     low_status: 2,
// //     critical_status: 1,
// //     total_unique_units: 8
// //   }
// // }

// // JavaScript Example:
// const stats = await fetch('http://localhost:8000/api/restaurant/inventory/stats')
//     .then(r => r.json());
// console.log(`${stats.stats.good_status}/${stats.stats.total_items} items in good stock`);


// // ============================================================
// // 5. CREATE NEW ITEM
// // ============================================================
// // Add a new item to inventory
// POST /
//     Body: {
//     item_name: "Chicken Breast",
//         quantity: 50,
//             unit: "kg",
//                 threshold: 10
// }

// // Response: { success: true, inventory_id: N, data: {...} }

// // JavaScript Example:
// const newItem = await fetch('http://localhost:8000/api/restaurant/inventory', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//         item_name: "Salmon Fillet",
//         quantity: 25,
//         unit: "pieces",
//         threshold: 5
//     })
// }).then(r => r.json());


// // ============================================================
// // 6. UPDATE ITEM (All Fields)
// // ============================================================
// // Update item details - provide only fields to change
// PUT /: id
// Body: {
//     item_name: "Salmon Fillet Premium",    // Optional
//         quantity: 30,                           // Optional
//             unit: "pieces",                         // Optional
//                 threshold: 8                            // Optional
// }

// // Response: { success: true, data: {...} }

// // JavaScript Example:
// await fetch('http://localhost:8000/api/restaurant/inventory/42', {
//     method: 'PUT',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//         quantity: 30,
//         threshold: 8
//     })
// });


// // ============================================================
// // 7. UPDATE QUANTITY (Most Common Operations)
// // ============================================================
// // Quick quantity update with 3 operations

// // A. ADD STOCK (Restocking/Delivery)
// // ----
// // When new stock arrives - INCREASES quantity
// PATCH /: id / quantity
// Body: {
//     quantity: 20,              // Amount to ADD
//         operation: "add"           // Current: 10kg + 20kg = 30kg
// }

// // JavaScript Example:
// await fetch('http://localhost:8000/api/restaurant/inventory/1/quantity', {
//     method: 'PATCH',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//         quantity: 20,
//         operation: 'add'
//     })
// });


// // B. REMOVE STOCK (Kitchen Usage)
// // ----
// // When staff uses item - DECREASES quantity
// PATCH /: id / quantity
// Body: {
//     quantity: 5,               // Amount to REMOVE
//         operation: "remove"        // Current: 25kg - 5kg = 20kg
// }

// // JavaScript Example (Chef used 3kg):
// await fetch('http://localhost:8000/api/restaurant/inventory/1/quantity', {
//     method: 'PATCH',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//         quantity: 3,
//         operation: 'remove'
//     })
// });


// // C. SET EXACT (Inventory Count)
// // ----
// // Physical count - SETS to exact value
// PATCH /: id / quantity
// Body: {
//     quantity: 32,              // EXACT amount after count
//         operation: "set"           // Set to exactly 32kg
// }

// // JavaScript Example (Physical inventory adjustment):
// await fetch('http://localhost:8000/api/restaurant/inventory/1/quantity', {
//     method: 'PATCH',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//         quantity: 32,
//         operation: 'set'
//     })
// });


// // ============================================================
// // 8. DELETE ITEM
// // ============================================================
// // Permanently remove item from inventory
// DELETE /: id

// // Response: { success: true, message: "...", deleted_id: N }

// // JavaScript Example:
// await fetch('http://localhost:8000/api/restaurant/inventory/42', {
//     method: 'DELETE'
// });


// // ============================================================
// // RESPONSE STATUS CODES
// // ============================================================
// // 200 - Success (GET, PUT, PATCH, DELETE)
// // 201 - Created (POST)
// // 400 - Bad Request (validation error)
// // 404 - Not Found (item doesn't exist)
// // 500 - Server Error (database error)


// // ============================================================
// // ERROR RESPONSE FORMAT
// // ============================================================
// {
//     "success": false,
//         "error": "Error type",
//             "message": "Detailed error description"
// }


// // ============================================================
// // COMMON RESPONSE STRUCTURE
// // ============================================================

// // Success responses always have:
// {
//     "success": true,
//         "data": {... },          // For single item
//     "count": N,             // For lists
//         "message": "..."        // For operations
// }

// // Error responses always have:
// {
//     "success": false,
//         "error": "Error Type",
//             "message": "Details"
// }


// // ============================================================
// // INVENTORY STATUS LOGIC
// // ============================================================

// if (quantity <= threshold / 2)  → status = "critical"  ⚠️ URGENT
// if (quantity <= threshold)      → status = "low"       ⚠️ WARNING
// if (quantity > threshold)       → status = "good"      ✓ OK

// // Examples:
// // Threshold = 10
// // quantity = 3   → "critical" (3 <= 5)
// // quantity = 8   → "low" (8 <= 10 but > 5)
// // quantity = 15  → "good" (15 > 10)


// // ============================================================
// // UNIT EXAMPLES
// // ============================================================
// // kg, g, mg          - Weight/Mass
// // liters, ml         - Volume/Liquid
// // pieces, units      - Count
// // bundles, packs     - Groups
// // boxes, cartons     - Containers
// // sheets, rolls      - Flat items


// // ============================================================
// // STEP-BY-STEP: ADD NEW ITEM TO INVENTORY
// // ============================================================

// async function addInventoryItem(name, qty, unit, threshold) {
//     try {
//         // Create item
//         const response = await fetch('http://localhost:8000/api/restaurant/inventory', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 item_name: name,
//                 quantity: qty,
//                 unit: unit,
//                 threshold: threshold
//             })
//         });

//         if (!response.ok) {
//             const error = await response.json();
//             throw new Error(error.message);
//         }

//         const result = await response.json();
//         console.log('✓ Item created:', result.inventory_id);
//         return result.data;

//     } catch (error) {
//         console.error('✗ Failed to add item:', error.message);
//     }
// }

// // Usage:
// addInventoryItem('Chicken Breast', 50, 'kg', 10);


// // ============================================================
// // STEP-BY-STEP: RESTOCK ITEM
// // ============================================================

// async function restockItem(itemId, amount) {
//     try {
//         const response = await fetch(
//             `http://localhost:8000/api/restaurant/inventory/${itemId}/quantity`,
//             {
//                 method: 'PATCH',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({
//                     quantity: amount,
//                     operation: 'add'
//                 })
//             }
//         );

//         if (!response.ok) throw new Error('Restock failed');

//         const result = await response.json();
//         console.log(`✓ Restocked: ${result.previousQuantity} → ${result.newQuantity} ${result.data.unit}`);
//         return result.data;

//     } catch (error) {
//         console.error('✗ Restock failed:', error.message);
//     }
// }

// // Usage:
// restockItem(1, 20);  // Add 20 units to item 1


// // ============================================================
// // STEP-BY-STEP: GET LOW STOCK ALERT
// // ============================================================

// async function checkLowStock() {
//     try {
//         const response = await fetch('http://localhost:8000/api/restaurant/inventory/status/low');
//         const data = await response.json();

//         if (data.count === 0) {
//             console.log('✓ All items well stocked!');
//             return;
//         }

//         console.log(`⚠️ ${data.count} items need restocking:`);
//         data.data.forEach(item => {
//             const alert = item.status === 'critical' ? '🔴 CRITICAL' : '🟡 LOW';
//             console.log(`  ${alert}: ${item.item_name} - ${item.quantity}${item.unit}`);
//         });

//     } catch (error) {
//         console.error('✗ Failed to check stock:', error);
//     }
// }

// // Usage:
// checkLowStock();


// // ============================================================
// // TESTING WITH CURL COMMANDS
// // ============================================================

// // Get all items:
// curl http://localhost:8000/api/restaurant/inventory

// // Get item by ID:
// curl http://localhost:8000/api/restaurant/inventory/1

// // Get low stock items:
// curl http://localhost:8000/api/restaurant/inventory/status/low

// // Get statistics:
// curl http://localhost:8000/api/restaurant/inventory/stats

// // Create item:
// curl - X POST http://localhost:8000/api/restaurant/inventory \
// -H "Content-Type: application/json" \
// -d '{"item_name":"Chicken","quantity":50,"unit":"kg","threshold":10}'

// // Update item:
// curl - X PUT http://localhost:8000/api/restaurant/inventory/1 \
// -H "Content-Type: application/json" \
// -d '{"quantity":30}'

// // Restock (add 20):
// curl - X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \
// -H "Content-Type: application/json" \
// -d '{"quantity":20,"operation":"add"}'

// // Use item (remove 5):
// curl - X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \
// -H "Content-Type: application/json" \
// -d '{"quantity":5,"operation":"remove"}'

// // Adjust to count (set exact):
// curl - X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \
// -H "Content-Type: application/json" \
// -d '{"quantity":28,"operation":"set"}'

// // Delete item:
// curl - X DELETE http://localhost:8000/api/restaurant/inventory/1


// // ============================================================
// // KEY POINTS
// // ============================================================

// // 1. Status is AUTO-CALCULATED based on quantity vs threshold
// // 2. Use PATCH /quantity for quick updates (add, remove, set)
// // 3. Use PUT for full item updates
// // 4. DELETE is permanent - implement confirmation in UI
// // 5. All operations return success flag in response
// // 6. Check 'status' and 'count' for alerts and dashboards
// // 7. last_restocked auto-updates on any quantity change
