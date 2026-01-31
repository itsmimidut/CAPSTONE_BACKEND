# Postman Testing Guide for Restaurant Management API

## Prerequisites
1. **Postman** installed ([Download here](https://www.postman.com/downloads/))
2. **Backend server running** on `http://localhost:8000`
3. **MySQL database** running with the restaurant tables created

## Base URL
```
http://localhost:8000/api/restaurant
```

---

## 1. Testing Tables Endpoints

### GET All Tables
**Method**: `GET`  
**URL**: `http://localhost:8000/api/restaurant/tables`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK - Array of all tables

```json
[
  {
    "table_id": 1,
    "table_number": 1,
    "capacity": 4,
    "status": "available",
    "guests": 0,
    "notes": "",
    "ordered_time": null
  }
]
```

---

### GET Single Table by ID
**Method**: `GET`  
**URL**: `http://localhost:8000/api/restaurant/tables/1`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK - Single table object

```json
{
  "table_id": 1,
  "table_number": 1,
  "capacity": 4,
  "status": "available",
  "guests": 0,
  "notes": "",
  "ordered_time": null
}
```

---

### POST Create New Table
**Method**: `POST`  
**URL**: `http://localhost:8000/api/restaurant/tables`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "table_number": 5,
  "capacity": 6,
  "status": "available",
  "notes": "Corner table near window"
}
```

**Expected Response**: 201 Created
```json
{
  "message": "Table created successfully",
  "table_id": 5
}
```

---

### PUT Update Table
**Method**: `PUT`  
**URL**: `http://localhost:8000/api/restaurant/tables/1`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "number": 1,
  "capacity": 5,
  "status": "reserved",
  "notes": "VIP table"
}
```

**Expected Response**: 200 OK
```json
{
  "message": "Table updated successfully"
}
```

---

### PATCH Update Table Status Only
**Method**: `PATCH`  
**URL**: `http://localhost:8000/api/restaurant/tables/1/status`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "status": "occupied"
}
```

**Valid statuses**: `available`, `occupied`, `reserved`, `maintenance`

**Expected Response**: 200 OK
```json
{
  "message": "Table status updated successfully"
}
```

---

### DELETE Delete Table
**Method**: `DELETE`  
**URL**: `http://localhost:8000/api/restaurant/tables/5`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK
```json
{
  "message": "Table deleted successfully"
}
```

---

## 2. Testing Menu Endpoints

### GET All Menu Items
**Method**: `GET`  
**URL**: `http://localhost:8000/api/restaurant/menu`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK

---

### POST Create Menu Item
**Method**: `POST`  
**URL**: `http://localhost:8000/api/restaurant/menu`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "name": "Caesar Salad",
  "category": "Appetizers",
  "price": 320,
  "prep_time": 5,
  "available": true
}
```

**Expected Response**: 201 Created

---

### PUT Update Menu Item
**Method**: `PUT`  
**URL**: `http://localhost:8000/api/restaurant/menu/1`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "name": "Caesar Salad",
  "category": "Appetizers",
  "price": 350,
  "prep_time": 5,
  "available": true
}
```

**Expected Response**: 200 OK

---

### PATCH Toggle Menu Item Availability
**Method**: `PATCH`  
**URL**: `http://localhost:8000/api/restaurant/menu/1/availability`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "available": false
}
```

**Expected Response**: 200 OK

---

### DELETE Delete Menu Item
**Method**: `DELETE`  
**URL**: `http://localhost:8000/api/restaurant/menu/1`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK

---

## 3. Testing Inventory Endpoints

### GET All Inventory Items
**Method**: `GET`  
**URL**: `http://localhost:8000/api/restaurant/inventory`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK

---

### POST Create Inventory Item
**Method**: `POST`  
**URL**: `http://localhost:8000/api/restaurant/inventory`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "item_name": "Salmon Fillet",
  "quantity": 10,
  "unit": "kg",
  "threshold": 5
}
```

**Expected Response**: 201 Created

---

### PUT Update Inventory Item
**Method**: `PUT`  
**URL**: `http://localhost:8000/api/restaurant/inventory/1`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "item_name": "Salmon Fillet",
  "quantity": 15,
  "unit": "kg",
  "threshold": 5
}
```

**Expected Response**: 200 OK

---

### PATCH Update Inventory Quantity
**Method**: `PATCH`  
**URL**: `http://localhost:8000/api/restaurant/inventory/1/quantity`  
**Headers**:
- `Content-Type: application/json`

**Body** (raw JSON):
```json
{
  "quantity": 20,
  "operation": "set"
}
```

**Valid operations**: `set`, `add`, `subtract`

**Expected Response**: 200 OK

---

### DELETE Delete Inventory Item
**Method**: `DELETE`  
**URL**: `http://localhost:8000/api/restaurant/inventory/1`  
**Headers**: None required  
**Body**: None  
**Expected Response**: 200 OK

---

## 4. Step-by-Step Testing in Postman

### Step 1: Create a New Request
1. Open Postman
2. Click **+** to create new tab or **New** → **Request**
3. Set Method (GET, POST, PUT, etc.)
4. Paste the URL

### Step 2: Add Headers (for POST/PUT/PATCH)
1. Click **Headers** tab
2. Add:
   - **Key**: `Content-Type`
   - **Value**: `application/json`

### Step 3: Add Request Body (for POST/PUT/PATCH)
1. Click **Body** tab
2. Select **raw**
3. Select **JSON** from dropdown
4. Paste the JSON body

### Step 4: Send Request
1. Click **Send**
2. Check the response in the **Body** section below

### Step 5: View Response Status
- **200 OK** - Request successful
- **201 Created** - Resource created successfully
- **400 Bad Request** - Invalid data sent
- **404 Not Found** - Resource not found
- **500 Internal Server Error** - Server error

---

## 5. Complete Testing Workflow

**Quick test sequence:**

1. **GET** `/tables` - View all tables
2. **POST** `/tables` - Create new table (with `number`, `capacity`, etc.)
3. **GET** `/tables/1` - Get the created table
4. **PUT** `/tables/1` - Update the table
5. **DELETE** `/tables/1` - Delete the table
6. Repeat same pattern for `/menu` and `/inventory`

---

## 6. Common Issues & Fixes

### Error: Cannot POST /tables
- ✅ Make sure backend is running: `npm start`
- ✅ Check URL is exactly: `http://localhost:8000/api/restaurant/tables`

### Error: 400 Bad Request
- ✅ Check field names match (use `number`, not `table_number`)
- ✅ Make sure all required fields are present
- ✅ Make sure JSON is valid (use Postman's JSON validation)

### Error: 500 Internal Server Error
- ✅ Check backend console for error details
- ✅ Verify MySQL database is running
- ✅ Check database schema is created

### Error: Cannot connect to localhost:8000
- ✅ Start the backend: `npm start` in the backend folder
- ✅ Check the server is actually running on port 8000

---

## 7. Using Postman Collections (Optional)

**To save all requests as a collection:**

1. Create all your requests in separate tabs
2. Click **File** → **Export**
3. Select requests to export
4. Save as JSON file

**To import a collection:**

1. Click **Import**
2. Select the JSON file
3. All requests will be available

---

## Next Steps

Once all endpoints are working in Postman:
1. ✅ Frontend is already connected and will use these endpoints
2. ✅ Test the UI to ensure data flows correctly
3. ✅ Monitor backend console for any errors
4. ✅ Check database to verify data is being saved
