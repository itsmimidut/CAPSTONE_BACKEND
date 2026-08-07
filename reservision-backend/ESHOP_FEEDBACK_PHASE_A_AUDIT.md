# Phase A — eShop Feedback Schema and Workflow Audit

Audit date: 2026-07-28  
Scope: live database schema/data plus the current backend and frontend implementations  
Result: audit only; no application code or database schema/data was changed

## Executive decision

The proposed verified-purchase feedback feature is feasible, but Phase B must extend
the existing `pos_transaction_items` table rather than create a second line-item
table.

The first release should make only authenticated customer E-Shop orders reviewable.
An item becomes eligible when its order has reached `delivered` or `picked_up`, the
order is not voided/cancelled, the customer owns the order through the trusted
server-side relationship, and the 30-day window calculated from fulfillment history
has not expired.

Item-level refund eligibility cannot currently be enforced. The installed refund
model is booking-specific and has no relationship to POS transactions or POS lines.
This limitation must either be accepted for the MVP or resolved with a separate POS
refund design before feedback eligibility is released.

## 1. Live transaction schema

The live `pos_transactions` definition confirms:

| Concern | Confirmed value |
|---|---|
| Primary key | `id INT(11) NOT NULL AUTO_INCREMENT` |
| Signedness | Signed |
| Customer owner | `customer_id INT(11) NULL` |
| User owner | `user_id INT(11) NULL` |
| Receipt/reference | `receipt_no VARCHAR(50) NULL`, unique |
| Transaction type | `type VARCHAR(50)`, default `Walk-in` |
| Items | `items LONGTEXT` with `JSON_VALID(items)` check |
| Payment status | `payment_status VARCHAR(20)`, default `PENDING` |
| Fulfillment method | `fulfillment_method` |
| Fulfillment status | `fulfillment_status` |
| Fulfillment update time | `fulfillment_updated_at` |
| Fulfillment actor/reason | `fulfillment_updated_by`, `fulfillment_cancel_reason` |
| General status | `status`, default `ACTIVE` |
| Void data | `voided_at`, `voided_by`, `void_reason` |
| Created time | `created_at` |
| General updated time | None |
| Dedicated completion time | None |
| POS refund fields | None |

`user_id` has a foreign key to `user.user_id`. The live transaction table does not
have a foreign key on `customer_id`, even though the application uses that column as
the canonical E-Shop owner.

Parent ID types relevant to Phase B are signed `INT(11)`:

- `pos_transactions.id`
- `customers.customer_id`
- `customers.user_id`
- `user.user_id`
- `menu_items.menu_id`

New foreign-key columns must match those types exactly.

## 2. Exact E-Shop transaction type

The persisted value is:

```text
E-Shop
```

The live distribution at audit time was:

```text
Walk-in: 83
E-Shop:   8
```

Comparisons should be centralized. A later helper should trim and lowercase the
stored value and treat `e-shop` as the normalized database comparison value. It
should not silently assume that the live value is `eshop`.

## 3. Trusted customer ownership

The confirmed ownership path is:

```text
authenticated req.user.id
        -> customers.user_id
        -> customers.customer_id
        -> pos_transactions.customer_id
```

`resolveCustomerIdForUser()` in `controllers/posController.js` implements the first
lookup. `createEshopOrder` writes both the authenticated `user_id` and resolved
`customer_id`. `getMyEshopOrders` derives the customer ID server-side and filters by
that value.

Feedback services must repeat this trusted derivation and must never accept a
request-body `customerId` as ownership proof. Transactions missing the canonical
customer linkage should not be eligible.

## 4. Actual items JSON and canonical mapping

The eight live E-Shop rows contained valid, non-empty JSON arrays. The current
checkout shape is:

```json
[
  {
    "menu_id": null,
    "name": "Americano",
    "price": 160,
    "quantity": 1,
    "subtotal": 160,
    "image_url": "",
    "customization": {
      "sizeId": "regular",
      "sizeLabel": "Regular",
      "sizePriceDelta": 150,
      "addOns": [
        {
          "id": "whip-cream",
          "name": "Whip Cream",
          "price": 10
        }
      ],
      "specialRequest": ""
    }
  }
]
```

Older E-Shop rows use a smaller shape:

```json
[
  {
    "name": "Product name",
    "price": 100,
    "quantity": 1,
    "subtotal": 100
  }
]
```

Confirmed mapping:

| JSON source | Normalized destination |
|---|---|
| Array index + 1 | `line_number` |
| `item.menu_id` | `menu_id`, nullable |
| `item.name` | `item_name` snapshot |
| `item.quantity` | `quantity` |
| `item.price` | `unit_price` snapshot |
| `item.subtotal` | `line_total` |
| `item.customization` | `customization_snapshot`, nullable JSON |
| `item.image_url` | optional image snapshot |

`price` in the E-Shop path is the charged unit price supplied by the cart, including
the selected customization price. `subtotal` is calculated as `price * quantity`.

No inspected E-Shop order contained nested/stringified arrays, modifier-only lines,
discount lines, tax lines, or delivery-fee lines. This is a small live sample, so
the backfill must still validate every row rather than assume all historical data
matches it.

### JSON quality

At audit time, the eight E-Shop records had:

- zero `NULL` item payloads;
- zero empty strings;
- zero invalid JSON values;
- zero empty arrays;
- names, quantities, prices, and subtotals on every inspected item.

Historical items commonly lack `menu_id`, `image_url`, and `customization`. Missing
`menu_id` is safe if retained as `NULL`. A missing name or price must be reported
and excluded rather than invented. Quantity may default to `1` only for shapes that
the existing transaction code demonstrably treats that way.

## 5. Existing normalized POS line table

`pos_transaction_items` already exists in the live database:

| Column | Definition |
|---|---|
| `line_id` | signed `INT(11)`, auto-increment primary key |
| `transaction_id` | signed `INT(11)`, required |
| `receipt_no` | `VARCHAR(50)`, required |
| `item_name` | `VARCHAR(255)`, required |
| `menu_id` | signed `INT(11)`, nullable |
| `quantity` | signed `INT(11)`, default `1` |
| `unit_price` | `DECIMAL(10,2)`, required |
| `line_total` | `DECIMAL(10,2)`, required |
| `booking_reference` | nullable |
| `created_at` | timestamp |

Its transaction foreign key uses `ON DELETE CASCADE`. Its menu foreign key uses
`ON DELETE SET NULL ON UPDATE CASCADE`.

The table currently contains normalized lines from the generic POS creation path,
but the E-Shop checkout path does not insert them. Phase B must alter this table and
backfill E-Shop lines; it must not create another table with the same purpose.

Recommended additions:

```text
line_number INT NULL during migration, then NOT NULL for E-Shop writes
customization_snapshot JSON/LONGTEXT NULL
image_url_snapshot VARCHAR(...) NULL, if the UI requires an immutable image
UNIQUE(transaction_id, line_number)
```

The uniqueness constraint supplies a stable identity even when an order contains
two visually identical product lines.

## 6. Product catalog relationship

The product table is `menu_items` with:

- primary key `menu_id INT(11)`;
- product name in `name`;
- base price in `price`;
- active/hidden behavior through `available`;
- category and size/add-on data in the existing menu model.

The admin API supports permanent hard deletion:

```sql
DELETE FROM menu_items WHERE menu_id = ?
```

Therefore, preserving a nullable menu relationship is correct. Historical product
feedback must render from transaction snapshots, not depend on a still-existing
catalog row. `ON DELETE SET NULL` on the existing line-item relation is appropriate.

Current order history tries to fill a missing `menu_id` and image by matching the
historical item name to the current catalog. This is useful only as a conservative
backfill aid. It is not a durable identity rule because names can change or collide.

## 7. Fulfillment states and completion time

The implemented state machines are:

```text
Delivery:
received -> preparing -> out_for_delivery -> delivered

Pickup:
received -> preparing -> ready_for_pickup -> picked_up

Cancellation:
cancelled
```

The exact live terminal values are:

```text
delivered
picked_up
```

The normalized eligibility set should be:

```js
new Set(["delivered", "picked_up"])
```

Live transaction counts at audit time were six `preparing`, one `picked_up`, one
`delivered`, and 83 `NULL` fulfillment statuses belonging to Walk-in transactions.

### Authoritative timestamp

`pos_fulfillment_history.created_at` for the row whose `to_status` is `delivered`
or `picked_up` is the authoritative fulfillment time. This table records every
transition and references `pos_transactions.id`.

`pos_transactions.fulfillment_updated_at` is an acceptable fallback for legacy
terminal transactions only when a matching history event does not exist. Order
`created_at` must never start the 30-day review window.

A new `fulfilled_at` column is not required for correctness because reliable
history exists. It may be added later as a denormalized cache, but history should
remain the source of truth.

Payment status is not a safe fulfillment proxy: a live picked-up order still had
`PENDING`. Initial eligibility should be driven by fulfillment plus non-voided
ownership, not by payment status unless the business adds and consistently enforces
a separate paid-order requirement.

## 8. Refund, cancellation, and void representation

E-Shop cancellation is represented through `fulfillment_status = 'cancelled'`,
the fulfillment history/reason fields, and transaction void fields/status where the
void operation is used.

The existing `refunds` table is tied to bookings. It has no:

- `pos_transaction_id`;
- `pos_transaction_item_id`;
- refunded/cancelled item quantity;
- reliable E-Shop line allocation.

Consequences:

- fully or partially refunded E-Shop quantities cannot be calculated;
- product-specific refund eligibility cannot be enforced;
- booking refunds must not be incorrectly joined to E-Shop orders.

MVP eligibility can safely reject cancelled and voided orders. It cannot honestly
claim item-refund enforcement. If refund enforcement is mandatory, Phase B is
blocked until a POS refund header/line model identifies original transaction lines
and refunded quantities.

## 9. Transaction creation paths

Two relevant write paths were confirmed in `controllers/posController.js`:

1. `createTransaction` creates general/staff POS transactions. If
   `pos_transaction_items` exists, it inserts normalized lines after the transaction.
2. `createEshopOrder` creates authenticated customer orders with type `E-Shop`,
   resolved ownership, JSON items, initial fulfillment state, and fulfillment
   history. It does not insert `pos_transaction_items`.

Initial feedback scope should include only path 2. Walk-in, anonymous cash,
staff-created, imported, and unrelated restaurant/booking orders should not become
reviewable merely because a normalized POS line exists.

Phase B must insert the E-Shop transaction, its normalized lines, and initial
fulfillment history in one database transaction. It should preserve the legacy JSON
payload during compatibility rollout.

## 10. Customer order history and API

The authenticated endpoint is:

```http
GET /api/pos/orders/me
```

`server.js` protects `/api/pos` with `requirePosAuth`. `getMyEshopOrders` derives
the customer server-side and selects that customer's `E-Shop` transactions.

The response currently exposes the transaction fields and a parsed `items` array,
including:

- transaction `id`;
- `receipt_no`;
- fulfillment method/status/update fields;
- customer/user IDs to the authenticated owner;
- legacy JSON item objects.

It does not expose a stable item-line identifier or an authoritative fulfilled
timestamp. The name-based catalog enrichment is not a stable substitute.

The primary frontend integration point is:

```text
src/components/Customer/OrderHistory.vue
```

It is used by the customer dashboard/activity experience and
`src/views/website/MyOrders.vue`. Items are rendered inside each expanded order
card and currently use their array index as the Vue key.

Phase B should extend each response item with:

```json
{
  "transactionItemId": 801,
  "lineNumber": 1,
  "menuItemId": 42,
  "productName": "Halo-Halo",
  "quantity": 2,
  "fulfilledAt": "..."
}
```

The feedback actions belong inside each expanded item row:

```text
Leave Review / View Review / Edit Review / Restore Review
```

The existing order-level Reorder and Delete actions should remain order-level.

## 11. Notification integration

`services/eshopFulfillmentService.js` owns fulfillment transitions. It:

1. opens a transaction;
2. locks and validates the E-Shop order;
3. updates `pos_transactions`;
4. inserts `pos_fulfillment_history`;
5. commits;
6. emits fulfillment updates and sends the current generic notification.

`createCustomerNotification` already supports an `eventKey` and a supplied database
connection. `emitPersistedCustomerNotification` supports emission after commit.

For a transition to `delivered` or `picked_up`, Phase B should create the invitation
inside the same transaction using:

```text
product_feedback_invitation:transaction:{transactionId}
```

After commit, it should emit the persisted notification. The unique event key makes
retries idempotent and prevents one notification per item from flooding the user.

## 12. Reusable feedback components

| Existing code | Classification |
|---|---|
| Rating/title/comment limits in `feedbackRules.js` | Generic and reusable |
| Moderation statuses/transitions in `feedbackRules.js` | Generic and reusable |
| Booking eligibility rules in `feedbackRules.js` | Booking-specific; leave isolated |
| Validation primitives in `feedbackValidator.js` | Extractable, but current create schema is booking-specific |
| Name masking in `feedbackDisplay.js` | Generic and reusable |
| `auditLogger.js` | Generic and reusable |
| `customerNotificationService.js` | Generic and reusable |
| `StarRating.vue` | Generic and reusable |
| `FeedbackForm.vue` | Booking-specific wrapper/content; adapt through a new product form |
| Existing feedback modal/card | Reusable presentation ideas, but require product-specific wrappers |
| Booking `feedbackService` | Keep separate from a new E-Shop feedback service |

Shared primitives may be extracted with regression tests, but booking feedback and
E-Shop product feedback should not be merged into one domain service.

## 13. Migration conventions and types

The repository uses both dated SQL migration pairs and idempotent standalone SQL
scripts. Existing POS schema work uses `INFORMATION_SCHEMA` checks and
`CREATE TABLE IF NOT EXISTS`. Tables use InnoDB and UTF-8; the normalized line table
uses `utf8mb4_unicode_ci`.

Phase B should follow the current dated forward/rollback convention and use explicit,
descriptive foreign-key and index names. Because the line table already exists,
appropriate files would be:

```text
20260728_alter_pos_transaction_items_for_eshop_feedback.sql
20260728_revert_pos_transaction_items_eshop_feedback.sql
20260728_create_eshop_item_feedback.sql
20260728_drop_eshop_item_feedback.sql
```

All transaction, customer, menu, and line foreign keys must use signed `INT`, not
unsigned `BIGINT`. New tables should use InnoDB and the repository's
`utf8mb4_unicode_ci` normalized-table convention.

## 14. Backfill plan and risks

Historical E-Shop orders can be structurally backfilled because all eight inspected
orders have valid, non-empty arrays with the required commercial snapshots.

Recommended backfill:

1. select only normalized type `e-shop`;
2. validate the top-level array and every item;
3. assign `line_number = array index + 1`;
4. insert exactly one line per array element;
5. copy name, quantity, price, subtotal, customization, and image snapshots;
6. use the JSON `menu_id` when valid;
7. otherwise match a menu item only when the name match is exact and unique;
8. leave `menu_id = NULL` when missing, deleted, or ambiguous;
9. log and exclude malformed rows instead of inventing names/prices;
10. make the operation idempotent with `(transaction_id, line_number)`.

Risks:

- most historical rows lack a product ID;
- current checkout can still emit `menu_id: null`;
- product names are mutable and may not be unique;
- duplicate identical lines require position-based identity;
- generic POS lines use slightly different price semantics and must not be
  reinterpreted as E-Shop lines;
- a broad backfill must not duplicate the 73 existing generic POS line rows;
- only eight E-Shop orders were available, so migration dry-run reporting remains
  required.

## 15. Final acceptance decisions

| Required decision | Result |
|---|---|
| Can historical orders be safely backfilled? | Yes for structurally valid E-Shop arrays; menu linkage may remain null |
| Can every E-Shop item receive stable line identity? | Yes, via transaction ID plus array-position `line_number` and `line_id` |
| Can item-level refund eligibility be enforced? | No, not with the current booking-only refund schema |
| Is a new `fulfilled_at` required? | No; terminal fulfillment history is authoritative |
| Which orders are reviewable? | Authenticated, customer-owned `E-Shop` orders reaching `delivered` or `picked_up`, not cancelled/voided |
| Which legacy orders are excluded? | Missing ownership, malformed/missing commercial fields, non-E-Shop types, nonterminal, cancelled, or voided orders |
| Catalog FK behavior | Existing `menu_items.menu_id` relationship with `ON DELETE SET NULL` |
| Normalization write point | `createEshopOrder`, inside the transaction |
| Customer UI point | Expanded item rows in `OrderHistory.vue` |
| Notification insertion point | Terminal transition in `eshopFulfillmentService`, before commit; emit after commit |

## Phase B readiness

Phase B may proceed if the MVP explicitly accepts the lack of E-Shop item-refund
enforcement. If it does not, POS refund normalization is the only material blocker
and must be designed first.

Phase B should begin by altering and backfilling the existing
`pos_transaction_items`, fixing the E-Shop checkout write path, and exposing stable
line IDs in `/api/pos/orders/me`. Creation of `eshop_item_feedback` should follow
only after those invariants are in place.
