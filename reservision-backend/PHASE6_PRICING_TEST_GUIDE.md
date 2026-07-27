# Phase 6 Pricing — Test Guide (Corrected)

Use this guide after running the test seed SQL.

## Setup (run once)

1. Start backend: `npm start` (port 8000)
2. In phpMyAdmin, run:
   - `schema/PHASE6_PRICING_TEST_DATA.sql`
3. For hourly/seasonal/promo tests, also run:
   - `schema/PHASE6_SWITCH_EVENT_TO_PER_HOUR.sql`

## Test item map (from your database)

| Purpose | item_id | Name | category_type | Test price | rate_type |
|--------|---------|------|---------------|------------|-----------|
| Room 2-night test | **2** | Studio Room 1 | room | ₱2,000/night | NULL |
| Cottage day test | **8** | COTTAGE | cottage | ₱1,500/day | per_day |
| Event area tests | **16** | Functional Hall | event | see below | per_event or per_hour |
| Security mismatch | **12** | FAMILY ROOM 1 | room | ₱4,000 | NULL |

> **Important:** Item **12 is a room**, not an event area.  
> Wrong: `inventory_item_id: 12` + `category_type: event` → must return `CATEGORY_MISMATCH`.

---

# A. API tests — `POST /api/pricing/quote`

```
POST http://localhost:8000/api/pricing/quote
Content-Type: application/json
X-CSRF-Token: <token from warmup request>
Cookie: csrf_token=<same token>
```

**Postman CSRF setup**

1. Send `GET http://localhost:8000/` first.
2. Copy `X-CSRF-Token` from response headers.
3. Add header `X-CSRF-Token: <token>` on POST.
4. In Postman Cookies for `localhost:8000`, ensure `csrf_token` cookie matches.

Automated run:

```bash
node scripts/phase6-pricing-test.mjs
node scripts/phase6-pricing-test.mjs --mode=hourly
```

---

## 1. Event per event (Functional Hall)

**Prerequisite:** `PHASE6_PRICING_TEST_DATA.sql` only (item 16 = ₱3,000, per_event)

Use a date **outside July** so seasonal pricing does not affect this base test:

```json
{
  "items": [
    {
      "inventory_item_id": 16,
      "category_type": "event",
      "booking_date": "2026-08-10",
      "start_time": "08:00",
      "end_time": "12:00"
    }
  ]
}
```

**Expected**

- name: Functional Hall
- base_price / final_subtotal: **₱3,000**
- rate_type: per_event (fixed price regardless of hours)

> If you use a **July** date instead, expect +20% seasonal (₱3,600) because `PHASE6 Peak Season` is active in July.

---

## 2. Event per hour

**Prerequisite:** run `PHASE6_SWITCH_EVENT_TO_PER_HOUR.sql` (item 16 = ₱1,000/hour)

```json
{
  "items": [
    {
      "inventory_item_id": 16,
      "category_type": "event",
      "booking_date": "2026-07-25",
      "start_time": "08:00",
      "end_time": "12:00"
    }
  ]
}
```

**Expected**

- 08:00–12:00 = 4 hours
- ₱1,000 × 4 = **₱4,000**

---

## 3. Room per night

```json
{
  "items": [
    {
      "inventory_item_id": 2,
      "category_type": "room",
      "check_in_date": "2026-07-20",
      "check_out_date": "2026-07-22"
    }
  ]
}
```

**Expected**

- July 20 → July 22 = **2 nights**
- ₱2,000 × 2 = **₱4,000**
- July 20 and July 21 occupied; July 22 is checkout day

---

## 4. Cottage day-use

```json
{
  "items": [
    {
      "inventory_item_id": 8,
      "category_type": "cottage",
      "booking_date": "2026-07-25"
    }
  ]
}
```

**Expected:** final_subtotal = **₱1,500**

---

## 5. Security — category mismatch (must fail)

```json
{
  "items": [
    {
      "inventory_item_id": 12,
      "category_type": "event",
      "booking_date": "2026-07-25",
      "start_time": "08:00",
      "end_time": "12:00"
    }
  ]
}
```

**Expected (HTTP 400)**

```json
{
  "success": false,
  "reason": "CATEGORY_MISMATCH",
  "message": "Category type mismatch. Selected item is room, but request used event."
}
```

---

# B. Seasonal pricing

Seed creates:

- **PHASE6 Peak Season**
- category: event
- dates: 2026-07-01 to 2026-07-31
- +20% (`percentage_increase`, value 20)

**Prerequisite:** hourly mode (item 16 = ₱1,000/hour)

### Inside July (2026-07-25)

- Base: ₱4,000
- Seasonal adjustment: +₱800
- Seasonal price: ₱4,800
- Final subtotal: ₱4,800

### Outside July (2026-08-05)

- Final subtotal: ₱4,000 only (no seasonal adjustment)

---

# C. Promo tests

Seed creates:

| Code | Discount | Dates | Applies to |
|------|----------|-------|------------|
| PHASE6EVT10 | 10% | Jul 2026 | events / item 16 |
| PHASE6EXPIRED | 10% | Jan 2026 (past) | events / item 16 |

Get promo_id after seed:

```sql
SELECT promo_id, code FROM promos WHERE code = 'PHASE6EVT10';
-- Expected promo_id: 2 (after fresh seed)
```

### With promo (hourly + seasonal inside July)

```json
{
  "items": [
    {
      "inventory_item_id": 16,
      "category_type": "event",
      "booking_date": "2026-07-25",
      "start_time": "08:00",
      "end_time": "12:00",
      "promo_id": <PHASE6EVT10 promo_id>
    }
  ]
}
```

**Expected**

- Base: ₱4,000
- Seasonal +20%: ₱4,800
- Promo 10% on seasonal price: -₱480
- **Final: ₱4,320**

Promo is applied **after** seasonal price.

### Expired promo (negative test)

Use `promo_id` from `PHASE6EXPIRED` with July booking date.

**Expected:** promo_discount = 0, final = ₱4,800

---

# D. Customer UI test

1. Customer booking page → select **Functional Hall** (item 16)
2. Pick date/time (e.g. Jul 25, 08:00–12:00)
3. Add to cart → go to booking confirmation

**Expected on confirmation page**

- Quote loaded from backend (`/api/pricing/quote`)
- Breakdown visible:
  - Base Price
  - Seasonal Adjustment
  - Promo Discount (if promo selected)
  - Subtotal / Official Total

Example (hourly + season + promo):

```
Functional Hall
₱1,000/hour × 4 hours = ₱4,000
Seasonal Adjustment: +₱800
Promo Discount: -₱480
Subtotal: ₱4,320
```

4. Click checkout

**Expected:** payment/booking uses **₱4,320**, not any frontend-edited value.

---

# E. Tamper / security test

1. Open booking confirmation → F12 DevTools
2. Try to change displayed total or cart object to ₱1
3. Complete checkout

**Expected**

- Backend ignores frontend `total` / `subtotal`
- Saved booking uses backend-calculated amount

---

# F. Database checks after booking

```sql
SELECT id, pricing_total, total_amount, status
FROM bookings
ORDER BY id DESC
LIMIT 5;
```

```sql
SELECT
  booking_id,
  inventory_item_id,
  base_price,
  seasonal_price,
  seasonal_adjustment,
  promo_discount,
  final_subtotal,
  pricing_notes
FROM booking_items
ORDER BY id DESC
LIMIT 10;
```

**Expected example (hourly + season + promo)**

| field | value |
|-------|-------|
| base_price | 4000 |
| seasonal_price | 4800 |
| seasonal_adjustment | 800 |
| promo_discount | 480 |
| final_subtotal | 4320 |

---

# Final checklist

```
[ ] Event per_event (item 16) = ₱3,000
[ ] Event per_hour (item 16) = ₱4,000 for 4 hours
[ ] Room 2 nights (item 2) = ₱4,000
[ ] Cottage day (item 8) = ₱1,500
[ ] Category mismatch (item 12 as event) = CATEGORY_MISMATCH
[ ] Seasonal applies inside July
[ ] Seasonal does not apply in August
[ ] Promo applies after seasonal
[ ] Expired promo does not apply
[ ] Customer confirmation shows backend quote
[ ] Checkout uses backend total (tamper ignored)
[ ] bookings.pricing_total correct
[ ] booking_items breakdown saved
```
