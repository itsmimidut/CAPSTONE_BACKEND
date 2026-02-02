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
  createBooking,
  updateBooking,
  deleteBooking,
  getOccupiedDates,
  getAllOccupiedDates
} from "../controllers/bookingsController.js";
import {
  createBookingConfirmation,
  updatePaymentStatus,
  getBookingDetails
} from "../controllers/bookingConfirmationController.js";

const router = express.Router();

// Get all bookings
router.get("/", getBookings);

// Get all occupied dates
router.get("/occupied-dates", getAllOccupiedDates);

// Get occupied dates for specific item
router.get("/occupied-dates/:itemId", getOccupiedDates);

// Get booking by reference
router.get("/reference/:reference", getBookingByReference);

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

// Update booking
router.put("/:id", updateBooking);

// Cancel/delete booking
router.delete("/:id", deleteBooking);

export default router;
