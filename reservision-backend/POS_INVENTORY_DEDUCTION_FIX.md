# POS Inventory Deduction Fix Guide

## Problem Identified

Your inventory isn't being reduced when orders are placed via **POS** because:

1. **Two separate ordering systems exist:**
   - ✅ **Restaurant Orders** (`/api/restaurant/orders`) - Deducts inventory automatically
   - ❌ **POS System** (`/api/pos/transactions`) - Just records sales, doesn't deduct inventory

2. **Adobong Baka has NO ingredients linked:** 
   - Even if inventory deduction was enabled, Adobong Baka needs ingredients linked to know what to deduct
   - Without ingredient links, the system can't deduct anything

---

## Solutions

### Solution 1: Link Ingredients to "Adobong Baka" (Required Either Way)

**Step 1: Check your inventory items**

Run this SQL query to see what you have:
```sql
SELECT inventory_id, item_name, quantity, unit 
FROM inventory 
ORDER BY inventory_id;
```

**Step 2: Check your menu items**

```sql
SELECT menu_id, name 
FROM menu_items 
WHERE name LIKE '%Adobong%' OR name LIKE '%baka%';
```

**Step 3: Link ingredients to Adobong Baka**

Based on your inventory and menu IDs, link ingredients. Example:

```sql
-- Replace menu_id (probably 1) and inventory_ids with your actual values
INSERT INTO menu_ingredients (menu_id, inventory_id, quantity_needed) 
VALUES 
  (1, 9, 0.25),   -- Beef - 0.25 kg per serving
  (1, 10, 0.05),  -- Soy Sauce - 0.05 L per serving  
  (1, 11, 0.01),  -- Vinegar - 0.01 L per serving
  (1, 12, 0.02);  -- Garlic - 0.02 kg per serving
```

**OR use the Frontend Modal (Much Easier!):**

1. Go to Inventory Management
2. Click **"Link Ingredients to Menu"** button
3. Select **"Adobong Baka"**
4. Click **"Add Ingredient"** for each ingredient
5. Select ingredient from dropdown
6. Enter quantity needed (e.g., 0.25 for 0.25 kg)
7. Click green **"Add"** button
8. Repeat for all ingredients
9. Click **"Save Links"**

---

### Solution 2: Enable Inventory Deduction in POS System (DONE ✅)

I've **already updated** the POS controller (`posController.js`) to automatically deduct inventory when transactions are created.

**What changed:**
- POS now queries for menu item ingredients by item name
- Deducts inventory for all ingredients when order is placed
- Updates inventory status (good/low/critical) automatically
- Uses database transactions for safety

**No restart needed!** Changes are already in effect.

---

## How It Works Now

### Scenario: Customer orders Adobong Baka via POS

**Before fix:**
```
POS Transaction created
  ↓
Inventory: No change
  ↓
Stock remains the same
```

**After fix:**
```
POS Transaction created
  ↓
System finds Adobong Baka in menu
  ↓
System finds linked ingredients (Beef, Soy Sauce, Vinegar, Garlic)
  ↓
Inventory automatically deducted:
  - Beef: 10kg → 9.75kg (-0.25)
  - Soy Sauce: 8.98L → 8.93L (-0.05)
  - Vinegar: 7.32L → 7.31L (-0.01)
  - Garlic: 4.66kg → 4.64kg (-0.02)
  ↓
Status updated (good/low/critical)
```

---

## Testing the Fix

### Using Postman

**Test POS Order with Inventory Deduction:**

```bash
POST http://localhost:8000/api/pos/transactions
Content-Type: application/json

{
  "receipt_no": "POS-002",
  "items": [
    {
      "name": "Adobong Baka",
      "price": 100,
      "menu_id": 1,
      "quantity": 1
    }
  ],
  "payment_method": "Cash",
  "total_amount": 100,
  "transaction_date": "2026-02-21",
  "transaction_time": "12:00:00"
}
```

**Expected Response:**
```json
{
  "message": "Transaction created successfully with inventory deduction",
  "transactionId": 123,
  "receiptNo": "POS-002"
}
```

**Check inventory was deducted:**
```bash
GET http://localhost:8000/api/restaurant/inventory
```

You should see the Beef, Soy Sauce, Vinegar, and Garlic quantities reduced.

---

## API Changes

### POS Transaction Request Format (Updated)

```javascript
{
  "receipt_no": "POS-003",
  "items": [
    {
      "name": "Adobong Baka",        // Required: Item name
      "price": 100,                   // Required: Item price
      "menu_id": 1,                   // Optional: Menu ID (auto-lookup if not provided)
      "quantity": 2                   // Optional: Quantity (default: 1)
    }
  ],
  "payment_method": "Cash",           // Required
  "total_amount": 200,                // Required
  "transaction_date": "2026-02-21",  // Optional
  "transaction_time": "12:00:00"     // Optional
}
```

---

## Step-by-Step Implementation

### Step 1: Link Ingredients via Modal (Recommended)

1. Open your restaurant app
2. Navigate to **Inventory Management**
3. Click **"Link Ingredients to Menu"** button
4. Select **"Adobong Baka"** from dropdown
5. Click **"Add Ingredient"**
6. For each ingredient needed:
   - Select ingredient from list
   - Enter quantity (e.g., 0.25)
   - Click green **"Add"** button
7. After adding all ingredients, click **"Save Links"**
8. Verify in **"View Menu Links"** section

### Step 2: Test POS Order

1. Create a new POS transaction with Adobong Baka
2. Go to Inventory Management
3. Check that ingredient quantities decreased
4. Verify status shows correct level (good/low/critical)

---

## Troubleshooting

### Inventory Still Not Deducting

**Check 1: Is Adobong Baka in menu_items?**
```sql
SELECT * FROM menu_items WHERE name = 'Adobong Baka';
```
- If no results: Restaurant system can't find it
- Solution: Add it via admin panel or use a different name

**Check 2: Are ingredients linked?**
```sql
SELECT m.name, i.item_name, mi.quantity_needed
FROM menu_ingredients mi
JOIN menu_items m ON mi.menu_id = m.menu_id
JOIN inventory i ON mi.inventory_id = i.inventory_id
WHERE m.name = 'Adobong Baka';
```
- If no results: No ingredients linked
- Solution: Use the modal to add ingredients

**Check 3: Check backend logs**
- Look for error messages in terminal output
- Verify database connection is working

**Check 4: Verify database tables exist**
```sql
SHOW TABLES LIKE '%menu%';
SHOW TABLES LIKE '%inventory%';
```

---

## Database Verification Queries

```sql
-- 1. Check menu items
SELECT menu_id, name, price FROM menu_items WHERE available = 1;

-- 2. Check inventory
SELECT inventory_id, item_name, quantity, unit, status FROM inventory;

-- 3. Check menu-ingredient links
SELECT 
  m.menu_id, m.name as menu_name,
  i.inventory_id, i.item_name,
  mi.quantity_needed, i.unit
FROM menu_ingredients mi
JOIN menu_items m ON mi.menu_id = m.menu_id
JOIN inventory i ON mi.inventory_id = i.inventory_id
ORDER BY m.name;

-- 4. View POS transactions
SELECT * FROM pos_transactions ORDER BY created_at DESC LIMIT 5;

-- 5. View Restaurant Orders
SELECT * FROM orders ORDER BY created_at DESC LIMIT 5;
```

---

## Summary

✅ **What's Fixed:**
- POS system now deducts inventory automatically
- Database transactions ensure atomic operations
- Inventory status updates (good/low/critical)
- Both POS and Restaurant systems work with inventory

✅ **What You Need to Do:**
1. Link ingredients to "Adobong Baka" (use the modal - easiest!)
2. Test by placing a POS order
3. Verify inventory decreased in the Inventory Management page

✅ **Going Forward:**
- Always link ingredients for new menu items
- Use either POS or Restaurant Orders - both will deduct inventory
- Check inventory levels in the Inventory Management dashboard

---

## Quick Start

1. **Add ingredients to Adobong Baka** (via modal or SQL)
2. **Create a new POS transaction** with Adobong Baka
3. **Check Inventory Management** - you should see quantities reduced!

If it still doesn't work, check the troubleshooting section above.
