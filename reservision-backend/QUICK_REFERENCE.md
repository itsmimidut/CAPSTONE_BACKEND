# Restaurant Management - Quick Command Reference

## Database Setup

### Create Tables (Choose One)

**Option 1: Via MySQL CLI**
```bash
mysql -u root < schema/restaurant.sql
```

**Option 2: Via MySQL Workbench**
1. Open MySQL Workbench
2. File → Open SQL Script → Select `schema/restaurant.sql`
3. Click Execute (⚡) button

**Option 3: Direct SQL**
```bash
mysql -u root
USE eduardos;
-- Paste contents of schema/restaurant.sql
```

---

## Backend Setup & Testing

### Start Server
```bash
npm start
# or
node server.js
```
Expected output:
```
Server running at http://localhost:8000
```

### Test API Endpoints

**Using curl:**
```bash
# Test Tables
curl http://localhost:8000/api/restaurant/tables

# Test Orders
curl http://localhost:8000/api/restaurant/orders

# Test Menu
curl http://localhost:8000/api/restaurant/menu

# Test Inventory
curl http://localhost:8000/api/restaurant/inventory
```

**Using Postman:**
1. Create new collection "Restaurant API"
2. Import endpoints from API_DOCUMENTATION.md
3. Test GET requests first
4. Test POST/PUT/DELETE with request bodies

---

## Frontend Integration

### Install Dependencies (if needed)
```bash
npm install axios pinia
```

### Import Store in Component
```javascript
import { useRestaurantStore } from '@/stores/restaurant'

const restaurant = useRestaurantStore()
```

### Initialize Data
```javascript
import { onMounted } from 'vue'

onMounted(async () => {
  await restaurant.initializeRestaurantData()
})
```

### Use in Template
```vue
<template>
  <div>
    <!-- Display Tables -->
    <div v-for="table in restaurant.tables" :key="table.table_id">
      {{ table.table_number }} - {{ table.status }}
    </div>
  </div>
</template>
```

---

## Common Operations

### Tables

**Get all tables**
```bash
curl http://localhost:8000/api/restaurant/tables
```

**Create new table**
```bash
curl -X POST http://localhost:8000/api/restaurant/tables \
  -H "Content-Type: application/json" \
  -d '{
    "table_number": 5,
    "capacity": 4,
    "status": "available",
    "notes": "Corner table"
  }'
```

**Update table status**
```bash
curl -X PATCH http://localhost:8000/api/restaurant/tables/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "occupied"}'
```

**Delete table**
```bash
curl -X DELETE http://localhost:8000/api/restaurant/tables/1
```

### Orders

**Get all orders**
```bash
curl http://localhost:8000/api/restaurant/orders
```

**Create order**
```bash
curl -X POST http://localhost:8000/api/restaurant/orders \
  -H "Content-Type: application/json" \
  -d '{
    "table_id": 1,
    "items": [
      {"menu_id": 1, "quantity": 2, "unit_price": 320}
    ],
    "special_requests": "No croutons"
  }'
```

**Update order status**
```bash
curl -X PATCH http://localhost:8000/api/restaurant/orders/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "preparing"}'
```

### Menu

**Get all menu items**
```bash
curl http://localhost:8000/api/restaurant/menu
```

**Get menu by category**
```bash
curl http://localhost:8000/api/restaurant/menu/category/Mains
```

**Create menu item**
```bash
curl -X POST http://localhost:8000/api/restaurant/menu \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Grilled Chicken",
    "price": 450,
    "category": "Mains",
    "available": true,
    "prep_time": 20
  }'
```

**Toggle availability**
```bash
curl -X PATCH http://localhost:8000/api/restaurant/menu/1/availability \
  -H "Content-Type: application/json" \
  -d '{"available": false}'
```

### Inventory

**Get all inventory**
```bash
curl http://localhost:8000/api/restaurant/inventory
```

**Get low stock items**
```bash
curl http://localhost:8000/api/restaurant/inventory/status/low
```

**Add to inventory**
```bash
curl -X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \
  -H "Content-Type: application/json" \
  -d '{"quantity": 5, "operation": "add"}'
```

**Remove from inventory**
```bash
curl -X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \
  -H "Content-Type: application/json" \
  -d '{"quantity": 3, "operation": "remove"}'
```

**Set exact quantity**
```bash
curl -X PATCH http://localhost:8000/api/restaurant/inventory/1/quantity \
  -H "Content-Type: application/json" \
  -d '{"quantity": 10, "operation": "set"}'
```

---

## Frontend Store Usage Examples

```javascript
import { useRestaurantStore } from '@/stores/restaurant'

const restaurant = useRestaurantStore()

// Initialize all data
await restaurant.initializeRestaurantData()

// Tables
await restaurant.fetchTables()
await restaurant.createTable({ table_number: 5, capacity: 4 })
await restaurant.updateTableStatus(1, 'occupied')
const occupiedTables = restaurant.getOccupiedTables

// Orders
await restaurant.fetchOrders()
await restaurant.createOrder({ table_id: 1, items: [...] })
const pendingOrders = restaurant.getPendingOrders

// Menu
await restaurant.fetchMenuItems()
const categories = await restaurant.getCategories()
await restaurant.toggleMenuItemAvailability(1, false)

// Inventory
await restaurant.fetchInventory()
const lowStock = restaurant.getLowStockItems
await restaurant.updateInventoryQuantity(1, 5, 'add')
```

---

## Error Handling

### Check Server Logs
```bash
# If using npm start, logs show in console
# Look for error messages starting with "Error"
```

### Common Issues

**Connection Refused**
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```
Solution: Ensure MySQL is running
```bash
# Windows
net start MySQL80

# macOS
brew services start mysql

# Linux
sudo systemctl start mysql
```

**Port Already in Use**
```
EADDRINUSE: address already in use :::8000
```
Solution: Kill process or use different port
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :8000
kill -9 <PID>
```

**Module Not Found**
```
Cannot find module './routes/restaurant/tables.js'
```
Solution: Ensure route files are in correct directory

**Database Not Found**
```
ER_BAD_DB_ERROR: Unknown database 'eduardos'
```
Solution: Update database name in config/db.js or use existing database

---

## File Locations

**Backend Files:**
```
reservision-backend/
├── controllers/
│   ├── tablesController.js
│   ├── ordersController.js
│   ├── menuController.js
│   └── inventoryController.js
├── routes/
│   └── restaurant/
│       ├── tables.js
│       ├── orders.js
│       ├── menu.js
│       └── inventory.js
├── schema/
│   └── restaurant.sql
├── server.js
└── API_DOCUMENTATION.md
```

**Frontend Files:**
```
reservision/src/
└── stores/
    └── restaurant.js
```

---

## Verification Checklist

- [ ] MySQL is running
- [ ] Database tables created (`mysql -u root -e "USE eduardos; SHOW TABLES;"`)
- [ ] Server starts without errors
- [ ] GET /api/restaurant/tables returns data
- [ ] GET /api/restaurant/orders returns data
- [ ] GET /api/restaurant/menu returns data
- [ ] GET /api/restaurant/inventory returns data
- [ ] Frontend store imported correctly
- [ ] initializeRestaurantData() executes without errors
- [ ] Components display real data from backend

---

## Useful MySQL Commands

```bash
# Login
mysql -u root

# Show databases
SHOW DATABASES;

# Use database
USE eduardos;

# Show tables
SHOW TABLES;

# Show table structure
DESCRIBE restaurant_tables;

# Show table data
SELECT * FROM restaurant_tables;

# Count records
SELECT COUNT(*) FROM restaurant_tables;

# Check for errors
SELECT * FROM restaurant_tables WHERE status = 'invalid';
```

---

## Documentation Files

- **API_DOCUMENTATION.md** - Complete API reference (endpoints, formats, codes)
- **RESTAURANT_SETUP_GUIDE.md** - Step-by-step setup instructions
- **IMPLEMENTATION_SUMMARY.md** - Overview of all created files
- **This file** - Quick command reference

---

## Quick Test Script

Save as `test-api.sh`:
```bash
#!/bin/bash

BASE_URL="http://localhost:8000/api/restaurant"

echo "Testing Restaurant API..."
echo ""

echo "Testing Tables..."
curl -s $BASE_URL/tables | jq . | head -20
echo ""

echo "Testing Orders..."
curl -s $BASE_URL/orders | jq . | head -20
echo ""

echo "Testing Menu..."
curl -s $BASE_URL/menu | jq . | head -20
echo ""

echo "Testing Inventory..."
curl -s $BASE_URL/inventory | jq . | head -20
echo ""

echo "All tests completed!"
```

Run with:
```bash
chmod +x test-api.sh
./test-api.sh
```

---

## Performance Tips

1. **Database Indexing**: Add indexes on frequently queried columns
2. **Pagination**: Implement for large datasets
3. **Caching**: Cache menu items and categories
4. **Lazy Loading**: Load orders/inventory only when needed
5. **Real-time Updates**: Consider WebSockets for live order updates

---

## Support

For detailed information:
- API endpoints → See `API_DOCUMENTATION.md`
- Setup issues → See `RESTAURANT_SETUP_GUIDE.md`
- File overview → See `IMPLEMENTATION_SUMMARY.md`
