# QUICK FIX - 500 Error: Unknown column 'type'

## ❌ Error Message
```
Error: Unknown column 'type' in 'field list'
POST http://localhost:8000/api/pos/eshop/order 500 (Internal Server Error)
```

## ✅ The Problem
Your `pos_transactions` table is missing the `type` column (and possibly other columns too).

## ✅ The Solution (2 minutes)

### Step 1: Open MySQL
```bash
mysql -u root -p
```
Enter your password when prompted.

### Step 2: Select Your Database
```sql
USE reservision_db;
```
(Replace `reservision_db` with your actual database name)

### Step 3: Run This SQL Command
```sql
ALTER TABLE pos_transactions
ADD COLUMN type VARCHAR(50) DEFAULT 'Walk-in',
ADD COLUMN location_type VARCHAR(50) NULL,
ADD COLUMN location_number VARCHAR(50) NULL,
ADD COLUMN delivery_notes TEXT NULL,
ADD COLUMN customer_id INT NULL,
ADD INDEX idx_location_type (location_type);
```

### Step 4: Verify It Worked
```sql
DESCRIBE pos_transactions;
```

You should now see these columns:
- ✅ `type`
- ✅ `location_type`
- ✅ `location_number`
- ✅ `delivery_notes`
- ✅ `customer_id`

### Step 5: Test the E-Shop Again
- Go back to your browser
- Try to place an order
- Should work now! 🎉

---

## Alternative: Run SQL File

If you prefer, run the SQL file directly:

```bash
mysql -u root -p reservision_db < FIX_MISSING_TYPE_COLUMN.sql
```

---

## What If I Get "Duplicate Column" Errors?

**That's OK!** It means some columns already exist. The error looks like:
```
ERROR 1060 (42S21): Duplicate column name 'location_type'
```

Just ignore those errors and continue. The important one is that `type` gets added.

---

## After Running the Fix

✅ The `type` column will be added  
✅ Order placement will work  
✅ Delivery location will be saved  
✅ No more 500 errors  

---

## Why This Happened

The `pos_transactions` table in your database wasn't created with all the required columns. This SQL adds them.

---

## ⚡ Super Quick Version

**Just copy and paste this into MySQL:**

```sql
USE reservision_db;

ALTER TABLE pos_transactions
ADD COLUMN type VARCHAR(50) DEFAULT 'Walk-in',
ADD COLUMN location_type VARCHAR(50) NULL,
ADD COLUMN location_number VARCHAR(50) NULL,
ADD COLUMN delivery_notes TEXT NULL,
ADD COLUMN customer_id INT NULL;

DESCRIBE pos_transactions;
```

Done! Now try placing an order again. ✨
