# Restaurant Management API Documentation

## Base URL
```
http://localhost:8000/api/restaurant
```

## Endpoints

### Tables Management

#### GET /tables
Get all restaurant tables
- **Response**: Array of table objects
- **Status**: 200

#### GET /tables/:id
Get single table by ID
- **Parameters**: `id` (table_id)
- **Response**: Single table object
- **Status**: 200 or 404

#### POST /tables
Create new table
- **Body**: 
  ```json
  {
    "table_number": 1,
    "capacity": 4,
    "status": "available",
    "notes": "Window seat"
  }
  ```
- **Response**: `{ message: "Table created successfully", table_id: 1 }`
- **Status**: 201

#### PUT /tables/:id
Update table details
- **Parameters**: `id` (table_id)
- **Body**: 
  ```json
  {
    "table_number": 1,
    "capacity": 4,
    "status": "available",
    "guests": 0,
    "notes": "Updated notes"
  }
  ```
- **Status**: 200

#### PATCH /tables/:id/status
Update table status only
- **Parameters**: `id` (table_id)
- **Body**: 
  ```json
  {
    "status": "occupied"
  }
  ```
- **Valid statuses**: available, occupied, reserved, maintenance
- **Status**: 200

#### DELETE /tables/:id
Delete table
- **Parameters**: `id` (table_id)
- **Status**: 200 or 404

---

### Orders Management

#### GET /orders
Get all orders
- **Response**: Array of order objects with table information
- **Status**: 200

#### GET /orders/:id
Get single order with items
- **Parameters**: `id` (order_id)
- **Response**: Order object with items array
- **Status**: 200 or 404

#### GET /orders/table/:tableId
Get orders for specific table
- **Parameters**: `tableId` (table_id)
- **Response**: Array of orders for that table
- **Status**: 200

#### POST /orders
Create new order
- **Body**: 
  ```json
  {
    "table_id": 1,
    "items": [
      {
        "menu_id": 1,
        "quantity": 2,
        "unit_price": 320
      },
      {
        "menu_id": 2,
        "quantity": 1,
        "unit_price": 580
      }
    ],
    "special_requests": "No croutons"
  }
  ```
- **Response**: `{ message: "Order created successfully", order_id: 1 }`
- **Status**: 201
- **Note**: Automatically updates table status to "occupied"

#### PATCH /orders/:id/status
Update order status
- **Parameters**: `id` (order_id)
- **Body**: 
  ```json
  {
    "status": "preparing"
  }
  ```
- **Valid statuses**: pending, preparing, ready, served, completed, cancelled
- **Status**: 200

#### DELETE /orders/:id
Delete order
- **Parameters**: `id` (order_id)
- **Status**: 200 or 404

---

### Menu Management

#### GET /menu
Get all menu items
- **Response**: Array of menu items ordered by category
- **Status**: 200

#### GET /menu/categories
Get all menu categories
- **Response**: Array of category names
- **Status**: 200

#### GET /menu/category/:category
Get menu items by category
- **Parameters**: `category` (category name)
- **Response**: Array of menu items in that category (only available items)
- **Status**: 200

#### GET /menu/:id
Get single menu item
- **Parameters**: `id` (menu_id)
- **Response**: Single menu item object
- **Status**: 200 or 404

#### POST /menu
Create menu item
- **Body**: 
  ```json
  {
    "name": "Grilled Salmon",
    "price": 580,
    "category": "Mains",
    "available": true,
    "prep_time": 25,
    "description": "Fresh Atlantic salmon with herbs",
    "image_url": "https://example.com/salmon.jpg"
  }
  ```
- **Response**: `{ message: "Menu item created successfully", menu_id: 1 }`
- **Status**: 201

#### PUT /menu/:id
Update menu item
- **Parameters**: `id` (menu_id)
- **Body**: Same as POST (all fields)
- **Status**: 200

#### PATCH /menu/:id/availability
Toggle menu item availability
- **Parameters**: `id` (menu_id)
- **Body**: 
  ```json
  {
    "available": false
  }
  ```
- **Status**: 200

#### DELETE /menu/:id
Delete menu item
- **Parameters**: `id` (menu_id)
- **Status**: 200 or 404

---

### Inventory Management

#### GET /inventory
Get all inventory items
- **Response**: Array of inventory items
- **Status**: 200

#### GET /inventory/:id
Get single inventory item
- **Parameters**: `id` (inventory_id)
- **Response**: Single inventory item object
- **Status**: 200 or 404

#### GET /inventory/status/low
Get low stock items
- **Response**: Array of items with quantity <= threshold
- **Status**: 200

#### POST /inventory
Create inventory item
- **Body**: 
  ```json
  {
    "item_name": "Salmon Fillet",
    "quantity": 10,
    "unit": "kg",
    "threshold": 8
  }
  ```
- **Response**: `{ message: "Inventory item created successfully", inventory_id: 1 }`
- **Status**: 201

#### PUT /inventory/:id
Update inventory item
- **Parameters**: `id` (inventory_id)
- **Body**: 
  ```json
  {
    "item_name": "Salmon Fillet",
    "quantity": 10,
    "unit": "kg",
    "threshold": 8
  }
  ```
- **Status**: 200

#### PATCH /inventory/:id/quantity
Update inventory quantity
- **Parameters**: `id` (inventory_id)
- **Body**: 
  ```json
  {
    "quantity": 5,
    "operation": "add"
  }
  ```
- **Valid operations**: 
  - `"add"` - Add to current quantity
  - `"remove"` - Subtract from current quantity
  - `"set"` - Set exact quantity (default)
- **Response**: `{ message: "...", newQuantity: 15 }`
- **Status**: 200

#### DELETE /inventory/:id
Delete inventory item
- **Parameters**: `id` (inventory_id)
- **Status**: 200 or 404

---

## Database Schema

### restaurant_tables
- `table_id` INT PRIMARY KEY AUTO_INCREMENT
- `table_number` INT UNIQUE NOT NULL
- `capacity` INT NOT NULL
- `status` ENUM('available', 'occupied', 'reserved', 'maintenance')
- `guests` INT DEFAULT 0
- `ordered_time` DATETIME NULL
- `notes` TEXT
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

### menu_items
- `menu_id` INT PRIMARY KEY AUTO_INCREMENT
- `name` VARCHAR(255) NOT NULL
- `price` DECIMAL(10, 2) NOT NULL
- `category` VARCHAR(100) NOT NULL
- `available` BOOLEAN DEFAULT TRUE
- `prep_time` INT DEFAULT 15 (minutes)
- `description` TEXT
- `image_url` VARCHAR(500)
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

### orders
- `order_id` INT PRIMARY KEY AUTO_INCREMENT
- `table_id` INT NOT NULL FK
- `status` ENUM('pending', 'preparing', 'ready', 'served', 'completed', 'cancelled')
- `special_requests` TEXT
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

### order_items
- `order_item_id` INT PRIMARY KEY AUTO_INCREMENT
- `order_id` INT NOT NULL FK
- `menu_id` INT NOT NULL FK
- `quantity` INT NOT NULL DEFAULT 1
- `unit_price` DECIMAL(10, 2) NOT NULL
- `special_notes` TEXT
- `created_at` TIMESTAMP

### inventory
- `inventory_id` INT PRIMARY KEY AUTO_INCREMENT
- `item_name` VARCHAR(255) UNIQUE NOT NULL
- `quantity` DECIMAL(10, 2) NOT NULL
- `unit` VARCHAR(50) NOT NULL
- `threshold` DECIMAL(10, 2) NOT NULL
- `status` ENUM('good', 'low', 'critical')
- `last_restocked` TIMESTAMP
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

---

## Frontend Integration (Pinia Store)

### Import
```javascript
import { useRestaurantStore } from '@/stores/restaurant'

const restaurant = useRestaurantStore()
```

### Initialize Data
```javascript
await restaurant.initializeRestaurantData() // Fetches all data
```

### Tables
```javascript
await restaurant.fetchTables()
await restaurant.createTable(tableData)
await restaurant.updateTable(id, tableData)
await restaurant.updateTableStatus(id, status)
await restaurant.deleteTable(id)

// Getters
restaurant.getOccupiedTables
restaurant.getAvailableTables
restaurant.getReservedTables
```

### Orders
```javascript
await restaurant.fetchOrders()
await restaurant.fetchOrdersByTable(tableId)
await restaurant.createOrder(orderData)
await restaurant.updateOrderStatus(id, status)
await restaurant.deleteOrder(id)

// Getters
restaurant.getPendingOrders
```

### Menu
```javascript
await restaurant.fetchMenuItems()
await restaurant.getMenuByCategory(category)
await restaurant.getCategories()
await restaurant.createMenuItem(menuData)
await restaurant.updateMenuItem(id, menuData)
await restaurant.toggleMenuItemAvailability(id, available)
await restaurant.deleteMenuItem(id)
```

### Inventory
```javascript
await restaurant.fetchInventory()
await restaurant.createInventoryItem(data)
await restaurant.updateInventoryItem(id, data)
await restaurant.updateInventoryQuantity(id, quantity, operation)
await restaurant.deleteInventoryItem(id)

// Getters
restaurant.getLowStockItems
```

---

## Error Handling

All endpoints return error responses in the format:
```json
{
  "error": "Error message describing what went wrong"
}
```

Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (missing/invalid data)
- `404` - Not Found
- `500` - Server Error

---

## Notes

1. **Image Storage**: Menu items use `image_url` for storing external image links or base64 data
2. **Status Updates**: Table status automatically updates when orders are created
3. **Inventory Tracking**: Status automatically updates based on quantity vs threshold
4. **Transactions**: Order creation uses database transactions to ensure data consistency
5. **Timestamps**: All records include `created_at` and `updated_at` timestamps automatically
