# E-Shop Backend Implementation Guide

## Overview
Backend integration for Stage 3 (Checkout) has been implemented to save customer orders with delivery information.

---

## Database Structure

### Modified Table: `pos_transactions`

#### New Columns Added:
```sql
location_type VARCHAR(50)     -- Room, Cottage, or Day Guest
location_number VARCHAR(50)   -- Room/Cottage number (NULL for Day Guest)
delivery_notes TEXT           -- Special delivery instructions
customer_id INT               -- User ID if customer is logged in (optional)
```

#### Complete Table Structure:
```sql
pos_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(50) UNIQUE,        -- Format: ESHOP-20260223-1234
  items LONGTEXT,                       -- JSON array of cart items
  type VARCHAR(50),                     -- 'Walk-in' or 'E-Shop'
  payment_method VARCHAR(50),           -- 'Cash on Delivery'
  total_amount DECIMAL(10,2),           -- Final total with discounts
  transaction_date DATE,
  transaction_time TIME,
  location_type VARCHAR(50),            -- NEW
  location_number VARCHAR(50),          -- NEW
  delivery_notes TEXT,                  -- NEW
  customer_id INT,                      -- NEW
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

---

## API Endpoint

### Create E-Shop Order
**Endpoint:** `POST /api/pos/eshop/order`

**Request Body:**
```json
{
  "cart": [
    {
      "name": "Beef Mami Noodle Soup",
      "price": 185,
      "qty": 2
    },
    {
      "name": "Mango Shake (Large)",
      "price": 95,
      "qty": 1
    }
  ],
  "locationType": "Room",
  "locationNumber": "101",
  "deliveryNotes": "Please knock gently, baby sleeping",
  "totalAmount": 465,
  "customerId": null
}
```

**Success Response (201):**
```json
{
  "success": true,
  "orderId": 42,
  "receiptNo": "ESHOP-20260223-4521",
  "message": "Order placed successfully! Your food will be delivered in 30-45 minutes.",
  "estimatedDelivery": "30-45 minutes",
  "deliveryLocation": "Room 101"
}
```

**Error Response (400/500):**
```json
{
  "error": "Cart is required and must contain at least one item",
  "details": "Validation error message"
}
```

---

## Backend Features

### ✅ Features Implemented:

1. **Order Validation**
   - Cart must have at least 1 item
   - Location type is required
   - Location number required (except Day Guest)
   - Total amount must be > 0

2. **Unique Receipt Number Generation**
   - Format: `ESHOP-YYYYMMDD-####`
   - Example: `ESHOP-20260223-4521`

3. **Inventory Deduction**
   - Automatically deducts ingredients from inventory
   - Updates inventory status (good/low/critical)
   - Uses menu_ingredients table for recipe mapping

4. **Transaction Atomicity**
   - Uses database transactions (BEGIN/COMMIT/ROLLBACK)
   - All-or-nothing: either full order succeeds or fails completely
   - Prevents partial inventory deduction

5. **Delivery Information Storage**
   - Location type (Room/Cottage/Day Guest)
   - Location number
   - Special delivery instructions
   - Customer ID (if logged in)

---

## Frontend Integration

### Updated Function: `placeOrder()`

**Location:** `ResortEShop.vue` (Line ~565)

**What it does:**
1. Validates location is saved
2. Validates cart has items
3. Prepares order data payload
4. Sends POST request to backend
5. Shows success toast notification
6. Clears cart and resets form
7. Handles errors gracefully

**Code:**
```javascript
const placeOrder = async () => {
  if (!locationSaved.value) return alert('Please set your delivery location first')
  if (cart.value.length === 0) return alert('Your cart is empty')
  
  try {
    const orderData = {
      cart: cart.value.map(item => ({
        name: item.name,
        price: item.price,
        qty: item.qty
      })),
      locationType: currentLocType.value,
      locationNumber: locationNumber.value,
      deliveryNotes: locationNotes.value,
      totalAmount: calculateTotalWithDiscount.value
    }

    const response = await fetch(`${API_BASE}/eshop/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    })

    const result = await response.json()
    if (!response.ok) throw new Error(result.error)

    // Success - show notification and reset
    showToast.value = true
    cart.value = []
    locationSaved.value = false
    locationNumber.value = ''
    locationNotes.value = ''
    currentStage.value = 1
    
    setTimeout(() => showToast.value = false, 4000)
  } catch (error) {
    alert(`Failed to place order: ${error.message}`)
  }
}
```

---

## Database Migration Steps

### Step 1: Run SQL Migration
Execute this file to add new columns:
```bash
mysql -u your_user -p your_database < ADD_ESHOP_COLUMNS_TO_POS.sql
```

Or run directly in MySQL:
```sql
USE your_database;

ALTER TABLE pos_transactions
ADD COLUMN location_type VARCHAR(50) NULL,
ADD COLUMN location_number VARCHAR(50) NULL,
ADD COLUMN delivery_notes TEXT NULL,
ADD COLUMN customer_id INT NULL,
ADD INDEX idx_location_type (location_type);
```

### Step 2: Verify Migration
```sql
DESCRIBE pos_transactions;
```

Should show the new columns:
- location_type
- location_number
- delivery_notes
- customer_id

---

## Recommendations

### ✅ Current Implementation (Recommended)
**Store everything in `pos_transactions` table**

**Pros:**
- Simple structure
- All order data in one place
- Easy to query
- Uses existing table
- JSON items column is flexible

**Cons:**
- Items stored as JSON (not normalized)
- Can't easily query individual items

---

### Alternative: Normalized Structure (If Needed in Future)

**Option A: Separate Line Items Table**
```sql
CREATE TABLE pos_transaction_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL,
  item_name VARCHAR(255),
  quantity INT,
  unit_price DECIMAL(10,2),
  subtotal DECIMAL(10,2),
  FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id) ON DELETE CASCADE
);
```

**When to use:**
- Need advanced reporting per item
- Want to query "most ordered items"
- Need to join items with other tables

**Option B: Separate Delivery Info Table**
```sql
CREATE TABLE pos_delivery_info (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL UNIQUE,
  location_type VARCHAR(50),
  location_number VARCHAR(50),
  delivery_notes TEXT,
  delivery_status ENUM('pending', 'preparing', 'delivered'),
  delivered_at TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id) ON DELETE CASCADE
);
```

**When to use:**
- Tracking delivery status is critical
- Need delivery person assignment
- Want delivery history separate from transactions

---

## Sample Order Data

### Example 1: Room Order
```json
{
  "receipt_no": "ESHOP-20260223-1001",
  "type": "E-Shop",
  "location_type": "Room",
  "location_number": "101",
  "delivery_notes": "Please knock gently",
  "items": [
    {"name": "Beef Mami Noodle Soup", "quantity": 2, "price": 185, "subtotal": 370},
    {"name": "Mango Shake (Large)", "quantity": 1, "price": 95, "subtotal": 95}
  ],
  "total_amount": 415.00,
  "payment_method": "Cash on Delivery"
}
```

### Example 2: Day Guest Order
```json
{
  "receipt_no": "ESHOP-20260223-1002",
  "type": "E-Shop",
  "location_type": "Day Guest",
  "location_number": null,
  "delivery_notes": "By the pool area",
  "items": [
    {"name": "Crispy Calamari", "quantity": 1, "price": 240, "subtotal": 240}
  ],
  "total_amount": 240.00,
  "payment_method": "Cash on Delivery"
}
```

---

## Testing the API

### Using Postman/Thunder Client:

1. **Start Backend Server**
   ```bash
   cd CAPSTONE_BACKEND/reservision-backend
   npm start
   ```

2. **Test Endpoint**
   ```
   POST http://localhost:8000/api/pos/eshop/order
   Content-Type: application/json
   
   {
     "cart": [
       {"name": "Beef Mami Noodle Soup", "price": 185, "qty": 2}
     ],
     "locationType": "Room",
     "locationNumber": "101",
     "deliveryNotes": "Test order",
     "totalAmount": 370
   }
   ```

3. **Verify in Database**
   ```sql
   SELECT * FROM pos_transactions WHERE type = 'E-Shop' ORDER BY id DESC LIMIT 1;
   ```

---

## Files Modified

### Backend:
1. ✅ `controllers/posController.js` - Added `createEshopOrder` function (Line ~280)
2. ✅ `routes/pos.js` - Added route `POST /eshop/order` (Line ~16)
3. ✅ `ADD_ESHOP_COLUMNS_TO_POS.sql` - Database migration file

### Frontend:
4. ✅ `ResortEShop.vue` - Updated `placeOrder()` function (Line ~565)

---

## Next Steps (Optional Enhancements)

### 1. Add Order Status Tracking
- Add `order_status` column: pending → preparing → ready → delivered
- Create admin page to update order status
- Show order status to customers

### 2. Add Customer Authentication
- Link orders to logged-in users via `customer_id`
- Show order history in customer dashboard
- Save delivery addresses

### 3. Add Real-time Notifications
- WebSocket/Socket.io for order updates
- Push notifications when order is ready
- SMS notifications

### 4. Add Order History for Customers
- Create endpoint: `GET /api/pos/eshop/orders/:customerId`
- Show past orders in customer account
- Reorder functionality

### 5. Add Payment Integration
- GCash API integration
- PayMaya integration
- E-wallet payments

---

## Summary

✅ **Recommendation: Use current implementation (pos_transactions with new columns)**

**Why:**
- Simple and effective
- Easy to maintain
- Meets all current requirements
- Can scale later if needed

**What's stored:**
- ✅ Cart items (JSON)
- ✅ Delivery location (Room/Cottage/Day Guest)
- ✅ Location number
- ✅ Special instructions
- ✅ Total amount with discounts
- ✅ Unique receipt number
- ✅ Timestamp
- ✅ Customer ID (optional)

**What happens:**
1. Customer completes checkout (Stage 3)
2. Frontend sends order to backend
3. Backend validates data
4. Generates unique receipt number
5. Deducts inventory ingredients
6. Saves to pos_transactions table
7. Returns success with receipt number
8. Frontend shows success message
9. Cart is cleared

🎉 **Implementation Complete!**
