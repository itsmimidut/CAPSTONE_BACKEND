/**
 * ============================================================
























































































































































































































































































































































































































































































































































































































































































































































































































- [Database Setup](./database-setup.sql)- [Server Setup Guide](./README.md)- [Main API Documentation](./API_DOCUMENTATION.md)## Related Documentation---- ⚠️ TODO: Implement audit logging for changes- ⚠️ TODO: Add role-based access control (admin only)- ⚠️ TODO: Add authentication/authorization- ✅ CORS enabled for frontend communication- ✅ SQL injection prevented with prepared statements- ✅ All inputs are validated and sanitized## Security Considerations---5. **Schedule low-stock checks** instead of on-demand for better performance4. **Implement pagination** for large inventories3. **Use filtering** (status filter) instead of fetching all items2. **Batch updates** when updating multiple items1. **Cache inventory list** in frontend to reduce API calls## Performance Tips---**Solution:** Ensure server has CORS enabled (already configured in server.js)### Issue: CORS errors**Solution:** Status is auto-calculated. Ensure threshold values are set correctly### Issue: Status not updating**Solution:** The API prevents negative quantities with the 'remove' operation (uses Math.max)### Issue: Quantity going negative**Solution:** Check that item_name is unique and all required fields are provided### Issue: Getting 500 error when creating item## Troubleshooting---```}  return true;  }    throw new Error('Threshold must be greater than 0');  if (isNaN(item.threshold) || item.threshold <= 0) {  }    throw new Error('Quantity must be a non-negative number');  if (isNaN(item.quantity) || item.quantity < 0) {  }    throw new Error('Item name is required');  if (!item.item_name || item.item_name.trim() === '') {function validateInventoryItem(item) {```javascript### Validate user input before sending```console.log('Success:', data);const data = await response.json();}  return;  console.error('API Error:', error);  const error = await response.json();if (!response.ok) {const response = await fetch(`http://localhost:8000/api/restaurant/inventory/${id}`);```javascript### Always check response status## Error Handling Best Practices---```</script>})  fetchLowStock()  fetchInventory()onMounted(() => {}  }    fetchInventory()    })      method: 'DELETE'    await fetch(`http://localhost:8000/api/restaurant/inventory/${itemId}`, {  if (confirm('Are you sure?')) {const deleteItem = async (itemId) => {// Delete item}  fetchLowStock()  fetchInventory()  })    body: JSON.stringify({ quantity: 10, operation: 'add' })    headers: { 'Content-Type': 'application/json' },    method: 'PATCH',  await fetch(`http://localhost:8000/api/restaurant/inventory/${itemId}/quantity`, {const restockItem = async (itemId) => {// Restock item (add 10 units)}  lowStockItems.value = data.data  const data = await response.json()  const response = await fetch('http://localhost:8000/api/restaurant/inventory/status/low')const fetchLowStock = async () => {// Fetch low stock items}  allItems.value = data.data  const data = await response.json()  const response = await fetch('http://localhost:8000/api/restaurant/inventory')const fetchInventory = async () => {// Fetch all itemsconst lowStockItems = ref([])const allItems = ref([])import { ref, onMounted } from 'vue'<script setup></template>  </div>    </table>      </tbody>        </tr>          </td>            <button @click="deleteItem(item.inventory_id)">Delete</button>            <button @click="editItem(item)">Edit</button>            <button @click="restockItem(item.inventory_id)">Restock</button>          <td>          <td :class="`status-${item.status}`">{{ item.status }}</td>          <td>{{ item.unit }}</td>          <td>{{ item.quantity }}</td>          <td>{{ item.item_name }}</td>        <tr v-for="item in allItems" :key="item.inventory_id">      <tbody>      </thead>        </tr>          <th>Actions</th>          <th>Status</th>          <th>Unit</th>          <th>Quantity</th>          <th>Item Name</th>        <tr>      <thead>    <table>    <!-- All Inventory Items -->    </div>      </ul>        </li>          {{ item.item_name }}: {{ item.quantity }}{{ item.unit }} (Threshold: {{ item.threshold }})        <li v-for="item in lowStockItems" :key="item.inventory_id">      <ul>      <h3>⚠️ Low Stock Alert</h3>    <div v-if="lowStockItems.length > 0" class="alert-warning">    <!-- Low Stock Alert -->  <div class="inventory-dashboard"><template>```vue### Vue.js Component Example## Frontend Integration Examples---```console.log(`Critical: ${stats.stats.critical_status}`);console.log(`Low Stock: ${stats.stats.low_status}`);console.log(`Healthy: ${stats.stats.good_status}`);console.log(`Total Items: ${stats.stats.total_items}`);const stats = await response.json();const response = await fetch('http://localhost:8000/api/restaurant/inventory/stats');// Get statistics for dashboard```javascriptDisplay inventory health overview### Use Case 5: Dashboard Analytics```});  })    operation: 'set'    quantity: 32,  body: JSON.stringify({  headers: { 'Content-Type': 'application/json' },  method: 'PATCH',await fetch('http://localhost:8000/api/restaurant/inventory/2/quantity', {// Adjust to actual count```javascriptCount actual stock and adjust system (found 32kg when system shows 28kg)### Use Case 4: Physical Inventory Count```});  })    operation: 'add'    quantity: 50,  body: JSON.stringify({  headers: { 'Content-Type': 'application/json' },  method: 'PATCH',await fetch('http://localhost:8000/api/restaurant/inventory/5/quantity', {// Add 50kg fish to inventory```javascriptWhen supplier delivers 50kg of fish### Use Case 3: Receive New Stock Delivery```});  })    operation: 'remove'    quantity: 3,  body: JSON.stringify({  headers: { 'Content-Type': 'application/json' },  method: 'PATCH',await fetch('http://localhost:8000/api/restaurant/inventory/1/quantity', {// Reduce chicken stock by 3kg```javascriptWhen chef uses 3kg of chicken in a dish### Use Case 2: Kitchen Staff Uses Ingredient```console.log('Critical items:', critical);const critical = lowItems.data.filter(item => item.status === 'critical');// Display critical items first (most urgent)const lowItems = await response.json();const response = await fetch('http://localhost:8000/api/restaurant/inventory/status/low');// Fetch low stock items for staff briefing```javascriptGet all low/critical items to prioritize restocking### Use Case 1: Morning Stock Check## Common Use Cases---```curl -X DELETE http://localhost:8000/api/restaurant/inventory/42```bash#### Example- **404**: Item not found- **400**: Invalid ID format#### Error Responses- In production, require admin confirmation- Consider implementing soft delete (status flag) for audit trail- ⚠️ **This action is permanent and cannot be undone**#### Warnings```}  "deleted_id": 42  "message": "Inventory item deleted successfully",  "success": true,{```json#### Response (200 OK)| id | integer | Yes | Inventory item ID ||-----------|------|----------|-------------|| Parameter | Type | Required | Description |#### URL Parameters```DELETE /api/restaurant/inventory/:id```**Permanently remove an item from inventory**### 8. DELETE INVENTORY ITEM---```  }'    "operation": "set"    "quantity": 25,  -d '{  -H "Content-Type: application/json" \curl -X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \```bash**Physical count adjustment:**```  }'    "operation": "remove"    "quantity": 3,  -d '{  -H "Content-Type: application/json" \curl -X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \```bash**Use 3kg in kitchen:**```  }'    "operation": "add"    "quantity": 20,  -d '{  -H "Content-Type: application/json" \curl -X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \```bash**Restock with 20kg:**#### Examples- **404**: Item not found  ```  { "success": false, "error": "Invalid operation" }  ```json- **400**: Invalid operation#### Error Responses```}  }    "last_restocked": "2024-01-30T14:30:00.000Z"    "status": "good",    "threshold": 10,    "unit": "kg",    "quantity": 30,    "item_name": "Chicken Breast",    "inventory_id": 1,  "data": {  "newStatus": "good",  "newQuantity": 30,  "previousQuantity": 20,  "operation": "add",  "message": "Inventory quantity updated successfully",  "success": true,{```json#### Response (200 OK)```}  "operation": "set"  "quantity": 25,{```json- Example: Current 20kg, Set to 25kg = 25kg- Use case: After physical inventory count- Sets stock to exact value**3. Set (Count Adjustment)**```}  "operation": "remove"  "quantity": 5,{```json- Use case: Kitchen using ingredients- Example: Current 20kg - Remove 5kg = 15kg- Never goes below 0 (prevents negative inventory)- Decreases stock by specified amount**2. Remove (Usage)**```}  "operation": "add"  "quantity": 10,{```json- Use case: Receiving new stock delivery- Example: Current 20kg + Add 10kg = 30kg- Increases stock by specified amount**1. Add (Restocking)**#### Operations| operation | string | No | 'add'\|'remove'\|'set' | Operation type (default: 'set') || quantity | number | Yes | >= 0 | Amount to add/remove/set ||-------|------|----------|--------|-------------|| Field | Type | Required | Values | Description |#### Body Parameters```}  "operation": "add"  "quantity": 10,{```json#### Request Body| id | integer | Yes | Inventory item ID ||-----------|------|----------|-------------|| Parameter | Type | Required | Description |#### URL Parameters```PATCH /api/restaurant/inventory/:id/quantity```**Update stock quantity with operations (add, remove, set)**### 7. UPDATE INVENTORY QUANTITY---```  }'    "threshold": 20    "quantity": 55,  -d '{  -H "Content-Type: application/json" \curl -X PUT http://localhost:8000/api/restaurant/inventory/42 \```bash#### Example- **400**: Invalid quantity (negative)- **404**: Item not found- **400**: Invalid ID#### Error Responses- **good**: quantity > threshold- **low**: threshold / 2 < quantity <= threshold- **critical**: quantity <= threshold / 2- Status is automatically recalculated based on new quantity#### Status Recalculation```}  }    "updated_at": "2024-01-30T15:10:00.000Z"    "status": "good",    "threshold": 20,    "unit": "pieces",    "quantity": 55,    "item_name": "Salmon Fillet Premium",    "inventory_id": 42,  "data": {  "message": "Inventory item updated successfully",  "success": true,{```json#### Response (200 OK)```}  "threshold": 20  "unit": "pieces",  "quantity": 55,  "item_name": "Salmon Fillet Premium",{```json#### Request Body (All Optional)| id | integer | Yes | Inventory item ID ||-----------|------|----------|-------------|| Parameter | Type | Required | Description |#### URL Parameters```PUT /api/restaurant/inventory/:id```**Update details of an existing inventory item**### 6. UPDATE INVENTORY ITEM---```  }'    "threshold": 15    "unit": "pieces",    "quantity": 50,    "item_name": "Salmon Fillet",  -d '{  -H "Content-Type: application/json" \curl -X POST http://localhost:8000/api/restaurant/inventory \```bash#### Example  ```  }    "message": "An inventory item with this name already exists"    "error": "Item already exists",    "success": false,  {  ```json- **400**: Duplicate item name  ```  }    "message": "item_name, quantity, unit, and threshold are required"    "error": "Validation failed",    "success": false,  {  ```json- **400**: Validation error#### Error Responses- **threshold**: Must be a number > 0- **unit**: Must be provided- **quantity**: Must be a number >= 0- **item_name**: Must be provided and unique (case-insensitive)#### Validation Rules```}  }    "updated_at": "2024-01-30T14:25:00.000Z"    "created_at": "2024-01-30T14:25:00.000Z",    "last_restocked": "2024-01-30T14:25:00.000Z",    "status": "good",    "threshold": 15,    "unit": "pieces",    "quantity": 50,    "item_name": "Salmon Fillet",    "inventory_id": 42,  "data": {  "inventory_id": 42,  "message": "Inventory item created successfully",  "success": true,{```json#### Response (201 Created)| threshold | number | Yes | Low stock alert level (must be > 0) || unit | string | Yes | Unit of measurement || quantity | number | Yes | Current stock amount || item_name | string | Yes | Name of item (must be unique) ||-------|------|----------|-------------|| Field | Type | Required | Description |#### Request Parameters```}  "threshold": 15  "unit": "pieces",  "quantity": 50,  "item_name": "Salmon Fillet",{```json#### Request Body```POST /api/restaurant/inventory```**Add a new item to the inventory system**### 5. CREATE INVENTORY ITEM---```curl http://localhost:8000/api/restaurant/inventory/stats```bash#### ExamplePerfect for dashboard analytics and quick inventory health checks.#### Usage```}  }    "total_unique_units": 8    "critical_status": 1,    "low_status": 2,    "good_status": 42,    "total_items": 45,  "stats": {  "success": true,{```json#### Response (200 OK)```GET /api/restaurant/inventory/stats```**Get overview statistics for inventory dashboard**### 4. GET INVENTORY STATISTICS---```curl "http://localhost:8000/api/restaurant/inventory/status/low?limit=5"```bash**Get top 5 low stock items:**```curl "http://localhost:8000/api/restaurant/inventory/status/low?critical=true"```bash**Get only critical items:**```curl http://localhost:8000/api/restaurant/inventory/status/low```bash**Get all low/critical items:**#### Examples```}  ]    }      "last_restocked": "2024-01-24T14:00:00.000Z"      "status": "low",      "threshold": 15,      "unit": "kg",      "quantity": 7,      "item_name": "Fish Fillet",      "inventory_id": 3,    {    },      "last_restocked": "2024-01-20T08:00:00.000Z"      "status": "critical",      "threshold": 10,      "unit": "liters",      "quantity": 3,      "item_name": "Beef Stock",      "inventory_id": 2,    {  "data": [  "count": 2,  "success": true,{```json#### Response (200 OK)| limit | integer | Maximum number of results (e.g., top 5) || critical | boolean | If 'true', return only critical items ||-----------|------|-------------|| Parameter | Type | Description |#### Query Parameters (Optional)```GET /api/restaurant/inventory/status/low```**Retrieve items with low or critical stock levels**### 3. GET LOW STOCK ITEMS---```curl http://localhost:8000/api/restaurant/inventory/1```bash#### Example  ```  { "success": false, "error": "Inventory item not found" }  ```json- **404**: Item not found  ```  { "success": false, "error": "Invalid inventory ID" }  ```json- **400**: Invalid ID format#### Error Responses```}  }    "updated_at": "2024-01-25T10:30:00.000Z"    "created_at": "2024-01-01T08:00:00.000Z",    "last_restocked": "2024-01-25T10:30:00.000Z",    "status": "good",    "threshold": 10,    "unit": "kg",    "quantity": 25.5,    "item_name": "Chicken Breast",    "inventory_id": 1,  "data": {  "success": true,{```json#### Response (200 OK)| id | integer | Yes | Inventory item ID ||-----------|------|----------|-------------|| Parameter | Type | Required | Description |#### URL Parameters```GET /api/restaurant/inventory/:id```**Retrieve details for a specific inventory item**### 2. GET SINGLE INVENTORY ITEM---```curl "http://localhost:8000/api/restaurant/inventory?search=chicken"```bash**Search for items containing "chicken":**```curl "http://localhost:8000/api/restaurant/inventory?status=low"```bash**Get only low stock items:**```curl http://localhost:8000/api/restaurant/inventory```bash**Get all items:**#### Examples```}  ]    }      "updated_at": "2024-01-25T10:30:00.000Z"      "created_at": "2024-01-01T08:00:00.000Z",      "last_restocked": "2024-01-25T10:30:00.000Z",      "status": "good",      "threshold": 10,      "unit": "kg",      "quantity": 25.5,      "item_name": "Chicken Breast",      "inventory_id": 1,    {  "data": [  "count": 3,  "success": true,{```json#### Response (200 OK)| search | string | Search items by name (partial match) || status | string | Filter by status: 'good', 'low', 'critical' ||-----------|------|-------------|| Parameter | Type | Description |#### Query Parameters (Optional)```GET /api/restaurant/inventory```**Retrieve all inventory items with optional filtering**### 1. GET ALL INVENTORY ITEMS## API Endpoints---- **good**: `quantity > threshold` (Healthy: above threshold)- **low**: `threshold / 2 < quantity <= threshold` (Warning: below threshold)- **critical**: `quantity <= threshold / 2` (Urgent: less than half threshold)### Status Logic- **updated_at**: Record last modification timestamp- **created_at**: Record creation timestamp- **last_restocked**: When item was last restocked- **status**: Stock level status ('good', 'low', 'critical')- **threshold**: Low stock alert level- **unit**: Unit of measurement (kg, g, liters, pieces, etc.)- **quantity**: Current stock amount- **item_name**: Name of the item (must be unique)- **inventory_id**: Unique identifier (auto-generated)### Field Descriptions```);  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  last_restocked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  status ENUM('good', 'low', 'critical') DEFAULT 'good',  threshold DECIMAL(10, 2) NOT NULL,  unit VARCHAR(50) NOT NULL,  quantity DECIMAL(10, 2) NOT NULL,  item_name VARCHAR(255) NOT NULL UNIQUE,  inventory_id INT PRIMARY KEY AUTO_INCREMENT,CREATE TABLE inventory (```sql### Inventory Table Structure## Database Schema---**Base URL:** `http://localhost:8000/api/restaurant/inventory`The Inventory Management API handles all restaurant food and supplies inventory tracking. It includes stock level monitoring, low stock alerts, quantity adjustments, and inventory analytics.## Overview * INVENTORY ROUTES
 * ============================================================
 * 
 * PURPOSE:
 * - Define all REST API endpoints for inventory management
 * - Route HTTP requests to appropriate controller functions
 * - Handle inventory CRUD operations and stock level tracking
 * 
 * BASE URL: /api/restaurant/inventory
 * 
 * ENDPOINTS:
 * 
 * 1. GET /
 *    - Retrieve all inventory items
 *    - Optional filters: status, search
 *    - Response: Array of inventory items
 * 
 * 2. GET /status/low
 *    - Retrieve items with low or critical stock
 *    - Used for restocking alerts
 *    - Response: Array of low-stock items
 * 
 * 3. GET /stats
 *    - Get inventory statistics
 *    - Used for dashboard analytics
 *    - Response: Object with count statistics
 * 
 * 4. GET /:id
 *    - Retrieve single inventory item by ID
 *    - Response: Single item object
 * 
 * 5. POST /
 *    - Create new inventory item
 *    - Body: item_name, quantity, unit, threshold
 *    - Response: Success message with new item_id
 * 
 * 6. PUT /:id
 *    - Update inventory item (full update)
 *    - Body: Any combination of item fields
 *    - Response: Updated item object
 * 
 * 7. PATCH /:id/quantity
 *    - Update quantity only (partial update)
 *    - Operations: add, remove, set
 *    - Response: Quantity update confirmation
 * 
 * 8. DELETE /:id
 *    - Delete inventory item permanently
 *    - Response: Success confirmation
 * 
 * ERROR HANDLING:
 * - All endpoints return structured JSON with success flag
 * - Validation errors return 400 status
 * - Not found errors return 404 status
 * - Database errors return 500 status
 * 
 * USAGE EXAMPLE (Frontend):
 * // Get all inventory
 * const response = await fetch('http://localhost:8000/api/restaurant/inventory');
 * const items = await response.json();
 * 
 * // Add new item
 * await fetch('http://localhost:8000/api/restaurant/inventory', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     item_name: 'Chicken Breast',
 *     quantity: 50,
 *     unit: 'kg',
 *     threshold: 10
 *   })
 * });
 * 
 * // Restock item (add 20kg)
 * await fetch('http://localhost:8000/api/restaurant/inventory/1/quantity', {
 *   method: 'PATCH',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     quantity: 20,
 *     operation: 'add'
 *   })
 * });
 * 
 * // Use item (remove 5kg)
 * await fetch('http://localhost:8000/api/restaurant/inventory/1/quantity', {
 *   method: 'PATCH',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     quantity: 5,
 *     operation: 'remove'
 *   })
 * });
 */

import express from 'express';
import * as inventoryController from '../../controllers/inventoryController.js';

const router = express.Router();

// ============================================================
// GET ROUTES
// ============================================================

/**
 * Route: GET /api/restaurant/inventory
 * Handler: getAllInventory
 * Purpose: Fetch all inventory items with optional filters
 */
router.get('/', inventoryController.getAllInventory);

/**
 * Route: GET /api/restaurant/inventory/status/low
 * Handler: getLowStockItems
 * Purpose: Get items that need restocking (low or critical status)
 * Note: Place this BEFORE /:id route to match exact path
 */
router.get('/status/low', inventoryController.getLowStockItems);

/**
 * Route: GET /api/restaurant/inventory/stats
 * Handler: getInventoryStats
 * Purpose: Get inventory dashboard statistics
 * Note: Place this BEFORE /:id route to match exact path
 */
router.get('/stats', inventoryController.getInventoryStats);

/**
 * Route: GET /api/restaurant/inventory/:id
 * Handler: getInventoryItem
 * Purpose: Get single inventory item details
 */
router.get('/:id', inventoryController.getInventoryItem);

// ============================================================
// POST ROUTES (Create)
// ============================================================

/**
 * Route: POST /api/restaurant/inventory
 * Handler: createInventoryItem
 * Purpose: Add new item to inventory
 * Body: { item_name, quantity, unit, threshold }
 */
router.post('/', inventoryController.createInventoryItem);

// ============================================================
// PUT ROUTES (Full Update)
// ============================================================

/**
 * Route: PUT /api/restaurant/inventory/:id
 * Handler: updateInventoryItem
 * Purpose: Update all or partial details of inventory item
 * Body: { item_name?, quantity?, unit?, threshold? }
 */
router.put('/:id', inventoryController.updateInventoryItem);

// ============================================================
// PATCH ROUTES (Partial Update)
// ============================================================

/**
 * Route: PATCH /api/restaurant/inventory/:id/quantity
 * Handler: updateInventoryQuantity
 * Purpose: Update only quantity with operations (add, remove, set)
 * Body: { quantity, operation: 'add'|'remove'|'set' }
 * 
 * Operations:
 * - 'add': Increase quantity (restocking)
 * - 'remove': Decrease quantity (usage)
 * - 'set': Set to exact value (inventory count)
 */
router.patch('/:id/quantity', inventoryController.updateInventoryQuantity);

// ============================================================
// DELETE ROUTES
// ============================================================

/**
 * Route: DELETE /api/restaurant/inventory/:id
 * Handler: deleteInventoryItem
 * Purpose: Permanently remove item from inventory
 */
router.delete('/:id', inventoryController.deleteInventoryItem);

export default router;
