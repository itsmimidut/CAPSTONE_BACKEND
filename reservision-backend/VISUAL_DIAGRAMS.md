# Restaurant Management Module - Visual Diagrams

## Database Relationships Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    RESTAURANT DATABASE                          │
└─────────────────────────────────────────────────────────────────┘

                    restaurant_tables
                    ┌──────────────┐
                    │ table_id (PK)│
                    │ table_number │
                    │ capacity     │
                    │ status       │ ──────┐
                    │ guests       │       │
                    │ ordered_time │       │
                    │ notes        │       │
                    └──────────────┘       │
                            ▲              │
                            │              │ 1 to N
                            │              │
                            │              ▼
                            │      ┌──────────────┐
                            │      │ orders       │
                            │      ├──────────────┤
                            │      │ order_id (PK)│
                    ┌────────┘      │ table_id (FK)│
                    │               │ status       │
                    │               │ special_     │
                    │               │ requests     │
                    │               └──────────────┘
                    │                       ▲
                    │                       │
                    │                       │ 1 to N
                    │                       │
                    │                       ▼
                    │               ┌──────────────┐
                    │               │ order_items  │
                    │               ├──────────────┤
                    │               │ order_item_id│
                    │               │ order_id (FK)│
                    │               │ menu_id (FK) │ ──────┐
                    │               │ quantity     │       │
                    │               │ unit_price   │       │
                    │               │ special_notes│       │
                    │               └──────────────┘       │
                    │                                      │
                    │                                      │ N to 1
                    │                                      │
                    │                                      ▼
                    │                            ┌──────────────┐
                    │                            │ menu_items   │
                    │                            ├──────────────┤
                    │                            │ menu_id (PK) │
                    │                            │ name         │
                    │                            │ price        │
                    │                            │ category     │
                    │                            │ available    │
                    │                            │ prep_time    │
                    │                            │ description  │
                    │                            │ image_url    │
                    │                            └──────────────┘
                    │
                    └──────┬─────────────┬──────────────────┬─────────┐
                           │             │                  │         │
                           ▼             ▼                  ▼         ▼
                    ┌──────────────┐
                    │ inventory    │
                    ├──────────────┤
                    │ inventory_id │
                    │ item_name    │
                    │ quantity     │
                    │ unit         │
                    │ threshold    │
                    │ status       │
                    │ last_restocked
                    └──────────────┘

Legend:
─────── One-to-Many (1:N) Relationship
(PK) Primary Key
(FK) Foreign Key
```

---

## API Request/Response Flow

```
┌──────────────────────────────────┐
│   Vue Component                  │
│  ┌─────────────────────────────┐ │
│  │ RestaurantManagement.vue    │ │
│  │ Tables/Orders/Menu/Inventory│ │
│  └────────────┬────────────────┘ │
│               │                   │
│               │ Import & Use      │
│               ▼                   │
│  ┌─────────────────────────────┐ │
│  │ Pinia Store (restaurant.js) │ │
│  │ • State                     │ │
│  │ • Getters                   │ │
│  │ • Actions                   │ │
│  └────────────┬────────────────┘ │
└───────────────┼──────────────────┘
                │
                │ HTTP Request (Axios)
                │
    ┌───────────▼─────────────┐
    │  Express.js Server      │
    │  (port 8000)            │
    │                         │
    │  ┌────────────────────┐ │
    │  │ Route Layer        │ │
    │  │ /api/restaurant/..│ │
    │  └─────────┬──────────┘ │
    │            │            │
    │            ▼            │
    │  ┌────────────────────┐ │
    │  │ Controller Logic   │ │
    │  │ • CRUD operations  │ │
    │  │ • Validation       │ │
    │  │ • Error handling   │ │
    │  └─────────┬──────────┘ │
    │            │            │
    │            ▼            │
    │  ┌────────────────────┐ │
    │  │ Database Query     │ │
    │  │ (mysql2/promise)   │ │
    │  └─────────┬──────────┘ │
    └────────────┼────────────┘
                 │
                 │ SQL
                 │
    ┌────────────▼─────────────┐
    │  MySQL Database          │
    │  (eduardos)              │
    │  ┌─────────────────────┐ │
    │  │ Tables, Orders, etc │ │
    │  └─────────────────────┘ │
    └──────────────────────────┘
```

---

## Data Flow for Creating an Order

```
┌──────────────────────────────────────────────────────────────┐
│               CREATE ORDER FLOW (POST)                       │
└──────────────────────────────────────────────────────────────┘

Step 1: Frontend Component
┌──────────────────────────────┐
│ User clicks "Place Order"    │
│ Submits form with:           │
│ - table_id: 1                │
│ - items: [                   │
│    {menu_id: 1, qty: 2},    │
│    {menu_id: 2, qty: 1}     │
│  ]                           │
│ - special_requests: "..."    │
└─────────────┬────────────────┘
              │
Step 2: Pinia Store
              │
              ▼
┌──────────────────────────────┐
│ restaurant.createOrder()     │
│ ├─ HTTP POST to /orders     │
│ ├─ Send order data          │
│ ├─ Handle response          │
│ └─ Call fetchOrders()       │
└─────────────┬────────────────┘
              │
Step 3: HTTP Request
              │
              ▼
┌──────────────────────────────┐
│ Express Server               │
│ POST /api/restaurant/orders  │
└─────────────┬────────────────┘
              │
Step 4: Route Handler
              │
              ▼
┌──────────────────────────────┐
│ routes/restaurant/orders.js  │
│ → ordersController.create()  │
└─────────────┬────────────────┘
              │
Step 5: Controller Logic
              │
              ▼
┌──────────────────────────────┐
│ 1. Validate input            │
│ 2. Start transaction         │
│ 3. Insert order              │
│ 4. Get order_id              │
│ 5. Insert order_items        │
│ 6. Update table status       │
│ 7. Commit transaction        │
│ 8. Return success            │
└─────────────┬────────────────┘
              │
Step 6: Database
              │
              ▼
┌──────────────────────────────┐
│ MySQL Transactions:          │
│ ├─ INSERT INTO orders        │
│ ├─ INSERT INTO order_items   │
│ └─ UPDATE restaurant_tables  │
└─────────────┬────────────────┘
              │
Step 7: Response
              │
              ▼
┌──────────────────────────────┐
│ {                            │
│   message: "Order created", │
│   order_id: 4               │
│ }                            │
└─────────────┬────────────────┘
              │
Step 8: Frontend Update
              │
              ▼
┌──────────────────────────────┐
│ Store refetches all orders   │
│ UI updates automatically     │
│ Show success message         │
└──────────────────────────────┘
```

---

## File Structure Visualization

```
┌─────────────────────────────────────────────────────┐
│          RESTAURANT MANAGEMENT MODULE               │
└─────────────────────────────────────────────────────┘

BACKEND
├─ controllers/
│  ├─ tablesController.js ..................... 87 lines
│  ├─ ordersController.js ................... 145 lines
│  ├─ menuController.js ..................... 135 lines
│  └─ inventoryController.js ............... 167 lines
│  └─ [Total: 434 lines of business logic]
│
├─ routes/
│  └─ restaurant/
│     ├─ tables.js ........................... 19 lines
│     ├─ orders.js ........................... 22 lines
│     ├─ menu.js ............................ 26 lines
│     └─ inventory.js ........................ 23 lines
│     └─ [Total: 90 lines of routing]
│
├─ schema/
│  └─ restaurant.sql ..................... 150+ lines
│     ├─ restaurant_tables
│     ├─ menu_items
│     ├─ orders
│     ├─ order_items
│     └─ inventory
│
├─ server.js [UPDATED]
│  └─ +4 imports
│  └─ +4 route registrations
│
└─ Documentation/
   ├─ API_DOCUMENTATION.md ............. Complete API ref
   ├─ RESTAURANT_SETUP_GUIDE.md ........ Setup instructions
   ├─ IMPLEMENTATION_SUMMARY.md ........ Overview
   ├─ QUICK_REFERENCE.md .............. Command reference
   ├─ README.md ........................ Delivery package
   ├─ DELIVERY_CHECKLIST.md ........... Completion status
   └─ This file ........................ Diagrams

FRONTEND
└─ src/
   └─ stores/
      └─ restaurant.js ............... 270+ lines
         ├─ State (4 collections)
         ├─ Getters (11 computed)
         └─ Actions (28 async methods)
         
[Total: 1,744+ lines of code and documentation]
```

---

## API Endpoint Categories

```
┌────────────────────────────────────────────────────────┐
│         27 REST API ENDPOINTS                          │
└────────────────────────────────────────────────────────┘

TABLES (6)
├─ GET    /tables              ← Read all
├─ GET    /tables/:id          ← Read one
├─ POST   /tables              ← Create
├─ PUT    /tables/:id          ← Update all fields
├─ PATCH  /tables/:id/status   ← Update status only
└─ DELETE /tables/:id          ← Delete

ORDERS (6)
├─ GET    /orders              ← Read all
├─ GET    /orders/:id          ← Read with items
├─ GET    /orders/table/:id    ← Read by table
├─ POST   /orders              ← Create (with transaction)
├─ PATCH  /orders/:id/status   ← Update status
└─ DELETE /orders/:id          ← Delete

MENU (8)
├─ GET    /menu                ← Read all
├─ GET    /menu/categories     ← List categories
├─ GET    /menu/category/:cat  ← Read by category
├─ GET    /menu/:id            ← Read one
├─ POST   /menu                ← Create
├─ PUT    /menu/:id            ← Update
├─ PATCH  /menu/:id/avail      ← Toggle availability
└─ DELETE /menu/:id            ← Delete

INVENTORY (7)
├─ GET    /inventory           ← Read all
├─ GET    /inventory/:id       ← Read one
├─ GET    /inventory/status/low ← Read low stock
├─ POST   /inventory           ← Create
├─ PUT    /inventory/:id       ← Update
├─ PATCH  /inventory/:id/qty   ← Update quantity
└─ DELETE /inventory/:id       ← Delete

HTTP Methods Used:
✓ GET    - Fetch data
✓ POST   - Create new records
✓ PUT    - Update entire record
✓ PATCH  - Partial updates
✓ DELETE - Remove records
```

---

## State Management Architecture

```
┌─────────────────────────────────────────────────┐
│         PINIA STORE STRUCTURE                   │
│         (restaurant.js)                         │
└─────────────────────────────────────────────────┘

STATE
├─ tables: []           ← All restaurant tables
├─ orders: []           ← All customer orders
├─ menuItems: []        ← All menu items
├─ inventory: []        ← All inventory items
├─ loading: false       ← Request state
└─ error: null          ← Error messages

GETTERS (Computed Properties)
├─ getTableById         → Find table by ID
├─ getOrderById         → Find order by ID
├─ getMenuItemById      → Find menu item by ID
├─ getInventoryById     → Find inventory item by ID
├─ getOccupiedTables    → Filter occupied
├─ getAvailableTables   → Filter available
├─ getReservedTables    → Filter reserved
├─ getLowStockItems     → Filter low stock
└─ getPendingOrders     → Filter pending orders

ACTIONS (Methods)
├─ Tables (5)
│  ├─ fetchTables()
│  ├─ createTable()
│  ├─ updateTable()
│  ├─ updateTableStatus()
│  └─ deleteTable()
│
├─ Orders (5)
│  ├─ fetchOrders()
│  ├─ fetchOrdersByTable()
│  ├─ createOrder()
│  ├─ updateOrderStatus()
│  └─ deleteOrder()
│
├─ Menu (7)
│  ├─ fetchMenuItems()
│  ├─ getMenuByCategory()
│  ├─ getCategories()
│  ├─ createMenuItem()
│  ├─ updateMenuItem()
│  ├─ toggleMenuItemAvailability()
│  └─ deleteMenuItem()
│
├─ Inventory (5)
│  ├─ fetchInventory()
│  ├─ createInventoryItem()
│  ├─ updateInventoryItem()
│  ├─ updateInventoryQuantity()
│  └─ deleteInventoryItem()
│
└─ Initialization (1)
   └─ initializeRestaurantData()
```

---

## Controller Methods Diagram

```
┌──────────────────────────────────────────────────┐
│      CONTROLLER METHODS MAPPING                  │
└──────────────────────────────────────────────────┘

HTTP REQUEST
    │
    ├─ GET /api/restaurant/tables
    │  └─→ tablesController.getAllTables()
    │      └─ SELECT * FROM restaurant_tables
    │
    ├─ GET /api/restaurant/tables/:id
    │  └─→ tablesController.getTable()
    │      └─ SELECT * FROM restaurant_tables WHERE id=?
    │
    ├─ POST /api/restaurant/tables
    │  └─→ tablesController.createTable()
    │      └─ INSERT INTO restaurant_tables VALUES(...)
    │
    ├─ PUT /api/restaurant/tables/:id
    │  └─→ tablesController.updateTable()
    │      └─ UPDATE restaurant_tables SET ... WHERE id=?
    │
    ├─ PATCH /api/restaurant/tables/:id/status
    │  └─→ tablesController.updateTableStatus()
    │      └─ UPDATE restaurant_tables SET status=? WHERE id=?
    │
    └─ DELETE /api/restaurant/tables/:id
       └─→ tablesController.deleteTable()
           └─ DELETE FROM restaurant_tables WHERE id=?

[Similar patterns for Orders, Menu, and Inventory]
```

---

## Database Query Examples

```
CREATE TABLES
├─ restaurant_tables
│  ├─ 4 sample tables
│  └─ Statuses: available, occupied, reserved, maintenance
│
├─ menu_items
│  ├─ 5 sample items
│  └─ Categories: Appetizers, Mains, Desserts
│
├─ orders
│  ├─ 3 sample orders
│  └─ Statuses: pending, preparing, ready, served, completed
│
├─ order_items
│  ├─ 5 sample items linked to orders
│  └─ With quantities and prices
│
└─ inventory
   ├─ 4 sample items
   └─ Status: good, low, critical (based on threshold)
```

---

## Component Integration Flow

```
┌─────────────────────────────────────┐
│  RestaurantManagement.vue           │
│  (Main view with 4 tabs)            │
└──────────────────┬──────────────────┘
                   │
        ┌──────────┼──────────┬──────────┬──────────┐
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
    │Tables  │ │Orders  │ │Menu    │ │Inventory │
    │Section │ │Section │ │Section │ │Section   │
    └───┬────┘ └───┬────┘ └───┬────┘ └────┬─────┘
        │          │          │           │
        └──────────┴──────────┴───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Pinia Store          │
        │ (restaurant.js)      │
        │ • Actions            │
        │ • State              │
        │ • Getters            │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ API (Axios HTTP)     │
        │ Base: localhost:8000 │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Express.js Server    │
        │ Routes & Controllers │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ MySQL Database       │
        │ 5 tables with data   │
        └──────────────────────┘
```

---

## Status Transitions Diagram

```
TABLE STATUS
─────────────
available ──┐
            ├─→ occupied ──→ available (customer leaves)
            │               └─→ reserved (prep for next)
            │
reserved  ──→ occupied ──→ available
            
maintenance (out of service)

ORDER STATUS
────────────
pending ──→ preparing ──→ ready ──→ served ──→ completed
   │
   └──────────────────────────────────→ cancelled

INVENTORY STATUS
────────────────
            ┌─→ good (quantity > threshold)
threshold ─┤
            └─→ low (quantity ≤ threshold)
              └─→ critical (quantity ≈ 0)
```

---

## Error Handling Flow

```
┌─────────────────────────┐
│ Frontend Request        │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Backend Processing      │
└────────────┬────────────┘
             │
      ┌──────┴──────┐
      │             │
      ▼             ▼
   Success      Error
      │             │
      ▼             ▼
 ┌─────────┐  ┌──────────────┐
 │ 200 OK  │  │ Check Code:  │
 │         │  ├─ 400 Bad Req │
 │ Return  │  ├─ 404 Not Fnd │
 │ Data    │  ├─ 500 Server  │
 └─────────┘  └──────┬───────┘
      │               │
      └───────┬───────┘
              │
              ▼
      ┌───────────────┐
      │ Store Updates │
      │ State/Error   │
      └───────┬───────┘
              │
              ▼
      ┌───────────────┐
      │ UI Updates    │
      │ Component Re  │
      │ -renders      │
      └───────────────┘
```

---

## Quick Setup Timeline

```
TIME    STEP                              COMMAND
────────────────────────────────────────────────────────────────
00:00   Create Database                  mysql -u root < schema/restaurant.sql
        └─ 5 tables created
        └─ Sample data loaded
        
05:00   Start Server                     npm start
        └─ 27 endpoints ready
        
10:00   Test Endpoints                   curl http://localhost:8000/api/restaurant/...
        └─ Verify all working
        
15:00   Import Store                     import { useRestaurantStore } ...
        └─ Setup in components
        
30:00   Initialize Data                  await restaurant.initializeRestaurantData()
        └─ All data loaded
        
45:00   Integrate Components             Display real data in template
        └─ Replace mock data
        
120:00+ Customization                    Add forms, modals, validation
        └─ Complete custom UI
```

---

*All diagrams created to support Restaurant Management Module documentation*
*For detailed information, see accompanying documentation files*
