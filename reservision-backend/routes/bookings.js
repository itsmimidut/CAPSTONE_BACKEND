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
  updatePaymentStatus,
  getBookingDetails
} from "../controllers/bookingConfirmationController.js";

const router = express.Router();

// Admin reservations endpoint (must be before /:id routes)
router.get("/admin/reservations", getAdminReservations);

// Customer booking history by customer ID
router.get("/customer/:customerId/history", getCustomerBookingHistory);

// Customer booking history by user_id (most reliable — uses logged-in user's ID)
router.get("/user/:userId/history", getBookingHistoryByUserId);

// Customer booking history by email (fallback)
router.get("/email/:email/history", getBookingHistoryByEmail);

// Get all bookings
router.get("/", getBookings);

// Get all occupied dates
router.get("/occupied-dates", getAllOccupiedDates);

// Get occupied dates for specific item
router.get("/occupied-dates/:itemId", getOccupiedDates);

// Get booking by reference
router.get("/reference/:reference", getBookingByReference);

// Get QR code for booking (must be before /:id route)
router.get("/qr/:bookingReference", getBookingQRCode);

// Get booking details with customer and payment info
router.get("/:id/details", getBookingDetails);

// Get single booking by ID
router.get("/:id", getBooking);

// Create complete booking with customer and payment (Booking Confirmation Page)
router.post("/confirm", createBookingConfirmation);

// Update payment status (Called by PayMongo webhook or frontend after payment)
router.post("/update-payment", updatePaymentStatus);

// Create new booking
router.post("/", createBooking);

// Create booking with auto-assigned room (grouped room selection)
router.post("/with-auto-assign", createBookingWithAutoAssign);

// Update booking
router.put("/:id", updateBooking);

// Cancel/delete booking
router.delete("/:id", deleteBooking);

// Validate booking for check-in/check-out
router.get("/validate/:bookingReference", validateBookingForCheckIn);

// Process guest check-in
router.post("/:bookingId/check-in", processCheckIn);

// Process guest check-out
router.post("/:bookingId/check-out", processCheckOut);

export default router;
