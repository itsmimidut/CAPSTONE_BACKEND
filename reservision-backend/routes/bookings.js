/**
 * ============================================================
 * Bookings Routes
 * ============================================================
 * 
 * Purpose:
 * - Define all booking-related API endpoints
 * - Map HTTP methods to controller functions
 * 
 * Routes:
 * - GET    /api/bookings                      - Get all bookings
 * - GET    /api/bookings/:id                  - Get single booking
 * - GET    /api/bookings/reference/:reference - Get booking by reference
 * - POST   /api/bookings                      - Create new booking
 * - PUT    /api/bookings/:id                  - Update booking
 * - DELETE /api/bookings/:id                  - Cancel booking
 * - GET    /api/bookings/occupied-dates       - Get all occupied dates
 * - GET    /api/bookings/occupied-dates/:itemId - Get occupied dates for item
 */

import express from "express";
import {
  getBookings,
  getBooking,
  getBookingByReference,
  getCustomerBookingHistory,
  getBookingHistoryByEmail,
  getBookingHistoryByUserId,
  getCustomerActiveStay,
  getCustomerCurrentRoom,
  getBookingQRCode,
  createBooking,
  updateBooking,
  deleteBooking,
  getOccupiedDates,
  getAllOccupiedDates,
  getAdminReservations,
  validateBookingForCheckIn,
  processCheckIn,
  processCheckOut,
  createBookingWithAutoAssign
} from "../controllers/bookingsController.js";
import {
  createBookingConfirmation,
  getBookingDetails
} from "../controllers/bookingConfirmationController.js";
import { bookingConfirmLimiter, bookingLookupLimiter } from "../middleware/rateLimiters.js";
import { handleValidationErrors } from "../middleware/validate.js";
import {
  bookingConfirmValidators,
  bookingUpdateValidators,
} from "../middleware/validators/bookingValidators.js";

const router = express.Router();

// Admin reservations endpoint (must be before /:id routes)
// ⚠️  Staff/Admin only (auth applied globally, admin check in middleware)
router.get("/admin/reservations", getAdminReservations);

// Customer booking history by customer ID
// ⚠️ Customer only (authenticated users)
router.get("/customer/:customerId/history", getCustomerBookingHistory);

// Customer booking history by user_id (most reliable — uses logged-in user's ID)
// ⚠️ Customer only (authenticated users)
router.get("/user/:userId/history", getBookingHistoryByUserId);

// Customer booking history by email (fallback)
// ⚠️ Customer only (authenticated users)
router.get("/email/:email/history", getBookingHistoryByEmail);

// Get active checked-in stay for customer (for E-Shop delivery location)
router.get("/customer/:userId/active-stay", getCustomerActiveStay);

// Get current checked-in room number for customer (simplified E-Shop endpoint)
router.get("/customer/:userId/current-room", getCustomerCurrentRoom);

// Get all bookings
// ⚠️ Staff/Admin only (auth applied globally, staff check in middleware)
router.get("/", getBookings);

// Get all occupied dates
router.get("/occupied-dates", getAllOccupiedDates);

// Get occupied dates for specific item
router.get("/occupied-dates/:itemId", getOccupiedDates);

// Get booking by reference
router.get("/reference/:reference", getBookingByReference);

// Staff check-in validation (staff auth enforced by middleware)
router.get("/validate/:bookingReference", bookingLookupLimiter, validateBookingForCheckIn);

// Get QR code for booking — authenticated owner or staff only
router.get("/qr/:bookingReference", bookingLookupLimiter, getBookingQRCode);

// Get booking details with customer and payment info
router.get("/:id/details", getBookingDetails);

// Get single booking by ID
router.get("/:id", getBooking);

// Create complete booking with customer and payment (Booking Confirmation Page)
// ✅ Public route (allowed by middleware) — unauthenticated customers can confirm
router.post("/confirm", bookingConfirmLimiter, bookingConfirmValidators, handleValidationErrors, createBookingConfirmation);

// Create new booking
// ✅ Public route (allowed by middleware) — unauthenticated customers can create
router.post("/", createBooking);

// Create booking with auto-assigned room (grouped room selection)
// ✅ Public route (allowed by middleware) — unauthenticated customers can create
router.post("/with-auto-assign", createBookingWithAutoAssign);

// Update booking
// ⚠️ Staff/Admin only (auth applied globally, staff check in middleware)
router.put("/:id", bookingUpdateValidators, handleValidationErrors, updateBooking);

// Cancel/delete booking
// ⚠️ Staff/Admin only (auth applied globally, staff check in middleware)
router.delete("/:id", deleteBooking);

// Process guest check-in
// ⚠️ Staff/Admin only (auth applied globally, staff check in middleware)
router.post("/:bookingId/check-in", processCheckIn);

// Process guest check-out
// ⚠️ Staff/Admin only (auth applied globally, staff check in middleware)
router.post("/:bookingId/check-out", processCheckOut);

export default router;
