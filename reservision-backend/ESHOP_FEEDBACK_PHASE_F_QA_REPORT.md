# E-Shop Feedback Phase F QA Report

## 1. Environment

- Verification date: 2026-07-28
- Backend: Node.js service with MySQL integration verification
- Frontend: Vue 3 and Vite production build
- Admin presentation decision: Resort and Product reviews are intentionally combined into one moderation queue, per the latest product requirement. Each record retains an internal feedback type so mutations use the correct protected API.

## 2. Database integrity

`node scripts/verifyPosTransactionItems.js` passed:

- No duplicate transaction line identities
- No missing required normalized values
- No invalid normalized amounts
- No valid E-Shop transactions without normalized lines
- No JSON/normalized line-count mismatches

The Phase C and Phase E live verifiers also confirmed one review per purchased line, preserved creation timestamps, safe restoration, and valid public visibility.

## 3. Backend test results

- `npm test`: PASS, 77/77 tests
- `node scripts/verifyEshopFeedbackPhaseC.js`: PASS
- `node scripts/verifyEshopFeedbackPhaseE.js`: PASS
- `node scripts/verifyPosTransactionItems.js`: PASS

Covered behavior includes eligibility, ownership, protected-field validation, moderation transitions, reply idempotency, notification uniqueness, audit transaction usage, concurrent creation, and customer mutation windows.

## 4. Frontend verification and build

- `node scripts/verify-eshop-feedback-phase-d.mjs`: PASS
- `npm run build`: PASS
- Feedback UI unsafe-render scan (`v-html` and `innerHTML`): PASS, no matches
- Feedback-related `git diff --check`: PASS

Vite reports existing large-bundle and mixed static/dynamic import advisories. These are not feedback correctness or security defects.

## 5. Customer E2E results

Automated and live integration coverage confirms:

- Terminal fulfillment history is authoritative for eligibility
- Customer ownership is derived server-side
- Concurrent creation produces exactly one review
- Create, edit, soft delete, and restore preserve workflow invariants
- Booking feedback remains backward compatible

Full browser-driven checkout-to-review execution was not automated in this phase.

## 6. Admin E2E results

- Resort and Product reviews load into one combined queue
- Combined status counts and total are calculated across both sources
- Search, status, rating, date, and sorting filters are sent to both protected APIs
- Results are globally sorted and paginated after merging
- Product and Resort cards keep their distinct metadata
- Moderation, reply, and restore actions dispatch to the correct API based on record type
- Product details show product, receipt, fulfillment, and Verified Purchase information
- Stale action failures reload current server state

## 7. Public privacy inspection

The live Phase E verifier confirmed:

- Pending and deleted reviews are excluded
- Only approved feedback is public
- Private transaction, customer, and moderation fields are absent
- Anonymous reviews display `Anonymous Guest`
- Non-anonymous names are masked
- Product summary is independent of page and rating filter

## 8. Concurrency results

- Concurrent creation: one success and one conflict
- Database uniqueness prevents duplicate active rows per purchased line
- Transaction row locks protect feedback mutations
- Moderation transitions validate the locked current state
- Identical replies are idempotent and retain the reply version

## 9. Notification and Socket.IO results

- Reply notification event keys are versioned and idempotent
- Identical reply retries produce no duplicate notification
- Notification persistence occurs in the business transaction
- Socket.IO emission occurs after commit
- Fulfillment invitations use transaction-scoped idempotency keys

## 10. Accessibility results

Static and build verification confirms semantic buttons, status text, accessible rating labels, loading announcements, modal focus trapping, Escape handling, focus restoration, and body-scroll restoration. Complete assistive-technology and keyboard-only browser testing remains a manual release checklist item.

## 11. Responsive results

The feedback cards, filters, pagination, modal, and details drawer include responsive breakpoints and safe wrapping. The production build passes. Device-level browser inspection at all requested widths remains manual.

## 12. Regression results

- Booking feedback validator and workflow tests pass
- Booking feedback frontend compatibility verifier passes
- POS normalized-line verifier passes
- Payment and booking test suites pass
- Frontend production build passes

## 13. Known limitations

- Item-level refund exclusion cannot be enforced because refunds do not reference individual POS transaction lines. This is an accepted MVP limitation; cancelled and voided transactions remain ineligible.
- Full browser Network-tab privacy inspection and the complete manual role/device matrix were not automated.
- Existing Vite bundle-size advisories are unrelated to feedback correctness.

## 14. Defects fixed

- Removed the Resort Reviews/Product Reviews module switch.
- Combined both feedback types into one globally sorted, paginated moderation queue.
- Combined summary counts across both review sources.
- Preserved type-safe moderation, reply, restoration, cards, and details.
- Removed booking-specific details from the product-review drawer.

## 15. Release decision

**PASS WITH MINOR KNOWN ISSUES**

No automated or live integration check found an authorization, privacy, duplicate-row, moderation, notification consistency, audit rollback, unsafe-rendering, booking-feedback, checkout, or POS regression blocker. Remaining items are the documented refund limitation, existing bundle advisories, and manual browser/device certification.
