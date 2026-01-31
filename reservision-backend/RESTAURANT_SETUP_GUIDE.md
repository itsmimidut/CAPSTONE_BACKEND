# Restaurant Management Module - Setup Guide

## Overview
This guide walks through setting up the Restaurant Management backend for Tables, Orders, Menu, and Inventory management.

## What Was Created

### 1. Database Schema (schema/restaurant.sql)
- **restaurant_tables**: Manage physical tables in the restaurant
- **menu_items**: Store menu items with pricing and availability
- **orders**: Track customer orders
- **order_items**: Line items within each order
- **inventory**: Track stock levels for ingredients/supplies

### 2. Controllers
- **tablesController.js** - Table CRUD operations and status management
- **ordersController.js** - Order creation, status updates, and item tracking
- **menuController.js** - Menu item management and availability control
- **inventoryController.js** - Stock tracking with threshold alerts

### 3. API Routes
- **routes/restaurant/tables.js** - /api/restaurant/tables endpoints
- **routes/restaurant/orders.js** - /api/restaurant/orders endpoints
- **routes/restaurant/menu.js** - /api/restaurant/menu endpoints
- **routes/restaurant/inventory.js** - /api/restaurant/inventory endpoints

### 4. Frontend Store
- **stores/restaurant.js** - Pinia store for state management with all CRUD actions

### 5. Documentation
- **API_DOCUMENTATION.md** - Complete API reference guide

---

## Setup Instructions

### Step 1: Create Database Tables

Run the SQL schema to create all necessary tables:

```bash
mysql -u root < schema/restaurant.sql
```

Or copy the contents of `schema/restaurant.sql` and run in MySQL Workbench/CLI:

```sql
-- Login to MySQL
mysql -u root

-- Use your database
USE eduardos;

-- Paste the contents of schema/restaurant.sql
```

### Step 2: Verify Server.js Routes

Check that `server.js` has the new routes added:
```javascript
import tablesRoutes from "./routes/restaurant/tables.js";
import ordersRoutes from "./routes/restaurant/orders.js";
import menuRoutes from "./routes/restaurant/menu.js";
import inventoryRoutes from "./routes/restaurant/inventory.js";

// In the middleware section:
app.use("/api/restaurant/tables", tablesRoutes);
app.use("/api/restaurant/orders", ordersRoutes);
app.use("/api/restaurant/menu", menuRoutes);
app.use("/api/restaurant/inventory", inventoryRoutes);
```

### Step 3: Start Backend Server

```bash
cd reservision-backend
npm start
# or
node server.js
```

Server should run on `http://localhost:8000`

### Step 4: Test Endpoints

Use Postman or similar API client to test:

```
GET http://localhost:8000/api/restaurant/tables
GET http://localhost:8000/api/restaurant/orders
GET http://localhost:8000/api/restaurant/menu
GET http://localhost:8000/api/restaurant/inventory
```

All should return sample data from the schema.

### Step 5: Update Frontend Components

In your RestaurantManagement.vue or individual tab components, import and use the store:

```javascript
import { useRestaurantStore } from '@/stores/restaurant'

export default {
  setup() {
    const restaurant = useRestaurantStore()
    
    // Fetch all data on mount
    onMounted(async () => {
      await restaurant.initializeRestaurantData()
    })
    
    return { restaurant }
  }
}
```

### Step 6: Connect Frontend Actions to Backend

Replace mock data handlers with actual API calls:

**Tables Example:**
```javascript
// Instead of local state updates:
const updateTableStatus = async (tableId, status) => {
  await restaurant.updateTableStatus(tableId, status)
}

const deleteTable = async (tableId) => {
  await restaurant.deleteTable(tableId)
}
```

**Orders Example:**
```javascript
const createOrder = async (orderData) => {
  try {
    await restaurant.createOrder(orderData)
    await restaurant.fetchOrders()
  } catch (error) {
    console.error('Failed to create order:', error)
  }
}
```

**Menu Example:**
```javascript
const toggleMenuAvailability = async (menuId, available) => {
  await restaurant.toggleMenuItemAvailability(menuId, available)
}
```

**Inventory Example:**
```javascript
const updateStock = async (inventoryId, quantity, operation) => {
  await restaurant.updateInventoryQuantity(inventoryId, quantity, operation)
}
```

---

## Project Structure

```
backend/
├── controllers/
│   ├── tablesController.js
│   ├── ordersController.js
│   ├── menuController.js
│   └── inventoryController.js
├── routes/
│   ├── restaurant/
│   │   ├── tables.js
│   │   ├── orders.js
│   │   ├── menu.js
│   │   └── inventory.js
│   ├── rooms.js
│   ├── promos.js
│   └── seasonalPricing.js
├── schema/
│   └── restaurant.sql
├── server.js (UPDATED)
├── config/
│   └── db.js
└── API_DOCUMENTATION.md

frontend/
├── src/
│   ├── stores/
│   │   ├── restaurant.js (NEW)
│   │   └── rooms.js
│   ├── views/
│   │   └── RestaurantManagement.vue
│   ├── components/
│   │   ├── restaurant/
│   │   │   ├── TablesSection.vue
│   │   │   ├── OrdersSection.vue
│   │   │   ├── MenuSection.vue
│   │   │   └── InventorySection.vue
│   │   ├── AdminHeader.vue
│   │   └── AdminSidebar.vue
```

---

## API Endpoints Quick Reference

### Tables
- `GET /api/restaurant/tables` - Get all tables
- `GET /api/restaurant/tables/:id` - Get specific table
- `POST /api/restaurant/tables` - Create table
- `PUT /api/restaurant/tables/:id` - Update table
- `PATCH /api/restaurant/tables/:id/status` - Update status
- `DELETE /api/restaurant/tables/:id` - Delete table

### Orders
- `GET /api/restaurant/orders` - Get all orders
- `GET /api/restaurant/orders/:id` - Get specific order
- `GET /api/restaurant/orders/table/:tableId` - Get orders by table
- `POST /api/restaurant/orders` - Create order
- `PATCH /api/restaurant/orders/:id/status` - Update order status
- `DELETE /api/restaurant/orders/:id` - Delete order

### Menu
- `GET /api/restaurant/menu` - Get all menu items
- `GET /api/restaurant/menu/categories` - Get categories
- `GET /api/restaurant/menu/category/:category` - Get items by category
- `GET /api/restaurant/menu/:id` - Get specific item
- `POST /api/restaurant/menu` - Create menu item
- `PUT /api/restaurant/menu/:id` - Update menu item
- `PATCH /api/restaurant/menu/:id/availability` - Toggle availability
- `DELETE /api/restaurant/menu/:id` - Delete menu item

### Inventory
- `GET /api/restaurant/inventory` - Get all items
- `GET /api/restaurant/inventory/:id` - Get specific item
- `GET /api/restaurant/inventory/status/low` - Get low stock
- `POST /api/restaurant/inventory` - Create item
- `PUT /api/restaurant/inventory/:id` - Update item
- `PATCH /api/restaurant/inventory/:id/quantity` - Update quantity
- `DELETE /api/restaurant/inventory/:id` - Delete item

---

## Sample Frontend Implementation

### RestaurantManagement.vue
```vue
<script setup>
import { ref, onMounted } from 'vue'
import { useRestaurantStore } from '@/stores/restaurant'
import TablesSection from '@/components/restaurant/TablesSection.vue'
import OrdersSection from '@/components/restaurant/OrdersSection.vue'
import MenuSection from '@/components/restaurant/MenuSection.vue'
import InventorySection from '@/components/restaurant/InventorySection.vue'

const restaurant = useRestaurantStore()
const activeTab = ref('tables')

onMounted(async () => {
  await restaurant.initializeRestaurantData()
})
</script>

<template>
  <div class="restaurant-management">
    <div class="tabs">
      <button 
        :class="{ active: activeTab === 'tables' }"
        @click="activeTab = 'tables'">
        Tables
      </button>
      <button 
        :class="{ active: activeTab === 'orders' }"
        @click="activeTab = 'orders'">
        Orders
      </button>
      <button 
        :class="{ active: activeTab === 'menu' }"
        @click="activeTab = 'menu'">
        Menu
      </button>
      <button 
        :class="{ active: activeTab === 'inventory' }"
        @click="activeTab = 'inventory'">
        Inventory
      </button>
    </div>

    <TablesSection v-if="activeTab === 'tables'" />
    <OrdersSection v-if="activeTab === 'orders'" />
    <MenuSection v-if="activeTab === 'menu'" />
    <InventorySection v-if="activeTab === 'inventory'" />
  </div>
</template>
```

---

## Testing Checklist

- [ ] Database tables created successfully
- [ ] Server starts without errors
- [ ] GET endpoints return sample data
- [ ] POST endpoint creates new records
- [ ] PUT/PATCH endpoints update records
- [ ] DELETE endpoints remove records
- [ ] Frontend connects to API
- [ ] Store actions execute successfully
- [ ] Component displays real data from backend
- [ ] CRUD operations update UI correctly

---

## Troubleshooting

### Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```
- Ensure MySQL is running
- Check database credentials in `config/db.js`

### Route Not Found
```
Cannot POST /api/restaurant/orders
```
- Verify `server.js` imports and registers routes
- Check route file exports use `module.exports`

### CORS Issues
```
Access to XMLHttpRequest blocked by CORS policy
```
- CORS is already enabled in `server.js`
- Check frontend is using correct API_BASE URL

### Port Already in Use
```
listen EADDRINUSE: address already in use :::8000
```
```bash
# Kill process on port 8000
lsof -i :8000
kill -9 <PID>
```

---

## Next Steps

1. Create individual tab components in `components/restaurant/`
2. Implement real-time data updates with WebSockets (optional)
3. Add pagination for large datasets
4. Implement user authentication/authorization
5. Add data export functionality (PDF, CSV)
6. Create reports and analytics dashboard
