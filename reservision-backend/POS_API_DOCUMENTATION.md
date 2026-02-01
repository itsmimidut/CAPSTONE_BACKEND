# POS (Point of Sale) API Documentation

## Overview
The POS API manages walk-in transactions and provides a catalog of services/items for sale.

## Base URL
```
http://localhost:8000/api/pos
```

## Endpoints

### Transactions

#### Get All Transactions
```http
GET /api/pos/transactions
```
**Response:**
```json
[
  {
    "transaction_id": 1,
    "receipt_no": "001",
    "items": [
      {"name": "Breakfast Set", "price": 350},
      {"name": "Coffee", "price": 80}
    ],
    "type": "Walk-in",
    "payment_method": "Cash",
    "total_amount": 430,
    "transaction_date": "2026-01-31",
    "transaction_time": "10:30:00",
    "created_at": "2026-01-31T10:30:00.000Z"
  }
]
```

#### Get Single Transaction
```http
GET /api/pos/transactions/:id
```

#### Create Transaction
```http
POST /api/pos/transactions
```
**Request Body:**
```json
{
  "receiptNo": "001",
  "items": [
    {"name": "Breakfast Set", "price": 350},
    {"name": "Coffee", "price": 80}
  ],
  "type": "Walk-in",
  "payment": "Cash",
  "total": 430,
  "date": "2026-01-31",
  "time": "10:30:00"
}
```

#### Delete Transaction
```http
DELETE /api/pos/transactions/:id
```

#### Clear All Transactions
```http
DELETE /api/pos/transactions
```

### Items/Services Catalog

#### Get All Items
```http
GET /api/pos/items
```
**Response:**
```json
[
  {
    "item_id": 1,
    "category": "restaurant",
    "name": "Breakfast Set",
    "price": 350,
    "description": "Complete breakfast meal",
    "available": true
  }
]
```

#### Get Items by Category
```http
GET /api/pos/items/category/:category
```
**Parameters:**
- `category`: restaurant, rooms, cottage, or event

## Database Schema

### pos_transactions
```sql
- transaction_id (INT, PRIMARY KEY, AUTO_INCREMENT)
- receipt_no (VARCHAR(50), UNIQUE)
- items (LONGTEXT) - JSON array
- type (VARCHAR(50))
- payment_method (VARCHAR(50))
- total_amount (DECIMAL(10,2))
- transaction_date (DATE)
- transaction_time (TIME)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

### pos_items
```sql
- item_id (INT, PRIMARY KEY, AUTO_INCREMENT)
- category (VARCHAR(50))
- name (VARCHAR(255))
- price (DECIMAL(10,2))
- description (TEXT)
- available (BOOLEAN)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

## Setup Instructions

1. **Run Database Migration**
   ```bash
   # Import the database-setup.sql file to create tables
   mysql -u your_username -p your_database < database-setup.sql
   ```

2. **Start Backend Server**
   ```bash
   cd CAPSTONE_BACKEND/reservision-backend
   npm start
   ```
   Server will run on `http://localhost:8000`

3. **Test the API**
   ```bash
   # Get all items
   curl http://localhost:8000/api/pos/items
   
   # Create a transaction
   curl -X POST http://localhost:8000/api/pos/transactions \
     -H "Content-Type: application/json" \
     -d '{
       "receiptNo": "001",
       "items": [{"name": "Coffee", "price": 80}],
       "payment": "Cash",
       "total": 80,
       "date": "2026-01-31",
       "time": "10:30:00"
     }'
   ```

## Integration with Frontend

The frontend POS component (`src/views/admin/POS.vue`) can now be connected to this API by:

1. Creating API service functions
2. Replacing local data with API calls
3. Implementing real-time transaction sync

Example API service:
```javascript
import axios from 'axios';

const API_BASE = 'http://localhost:8000/api/pos';

export const posAPI = {
  // Get all transactions
  getTransactions: () => axios.get(`${API_BASE}/transactions`),
  
  // Create transaction
  createTransaction: (data) => axios.post(`${API_BASE}/transactions`, data),
  
  // Get items
  getItems: () => axios.get(`${API_BASE}/items`),
  
  // Delete transaction
  deleteTransaction: (id) => axios.delete(`${API_BASE}/transactions/${id}`)
};
```
