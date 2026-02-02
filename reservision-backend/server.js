/**
 * ============================================================
 * Reservision Backend - Express Server
 * ============================================================
 * 
 * Purpose:
 * - Main entry point for the Reservision REST API
 * - Initializes Express server with middleware
 * - Mounts all API routes for rooms, restaurants, promos, etc.
 * - Handles CORS and large payload requests (base64 images)
 * 
 * Dependencies:
 * - express: Web framework for handling HTTP requests
 * - cors: Middleware to enable Cross-Origin Resource Sharing
 * 
 * Features:
 * - CORS enabled for frontend communication
 * - 50MB payload limit for base64-encoded image uploads
 * - RESTful API endpoints for:
 *   - Rooms/Cottages/Events (CRUD operations)
 *   - Promotional Pricing
 *   - Seasonal Pricing
 *   - Restaurant Management (tables, menu, orders, inventory)
 * 
 * Server Configuration:
 * - PORT: 8000
 * - Base URL: http://localhost:8000
 * 
 * Environment Setup:
 * - Ensure database is configured in config/db.js
 * - Node version: 14+ required
 * 
 * Usage:
 * npm start
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

// ============================================================
// ROUTE IMPORTS
// ============================================================
// Import all route handlers from their respective files
// Each route file contains CRUD endpoints for its resource
import roomsRoutes from "./routes/rooms.js";
import promosRoutes from "./routes/promos.js";
import seasonalRoutes from "./routes/seasonalPricing.js";
import tablesRoutes from "./routes/restaurant/tables.js";
import ordersRoutes from "./routes/restaurant/orders.js";
import menuRoutes from "./routes/restaurant/menu.js";
import inventoryRoutes from "./routes/restaurant/inventory.js";
import ratesRoutes from "./routes/rates.js";
import swimmingRoutes from "./routes/swimming.js";
import posRoutes from "./routes/pos.js";
import bookingsRoutes from "./routes/bookings.js";
import xenditRoutes from "./routes/xendit.js";
import paymongoRoutes from "./routes/paymongo.js";
import chatbotRoutes from "./routes/chatbot.js";
import otpRoutes from "./routes/otp.js";
import customersRoutes from "./routes/customers.js";

// ============================================================
// EXPRESS APP INITIALIZATION
// ============================================================
// Create Express application instance
const app = express();

// ============================================================
// MIDDLEWARE CONFIGURATION
// ============================================================
// CORS Middleware: Allows requests from frontend (different origin)
app.use(cors());

/**
 * Body Parser Middleware with Large Payload Support
 * 
 * Why 50MB limit?
 * - Base64-encoded images from frontend are very large
 * - Example: 1MB image → ~1.3MB when base64 encoded
 * - Default 100KB limit insufficient for image uploads
 * 
 * Parameters:
 * - limit: Maximum request body size
 * - Applies to both JSON and URL-encoded data
 */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// ============================================================
// API ROUTES MOUNTING
// ============================================================
/**
 * Route structure: /api/{resource}
 * 
 * Each route handles:
 * - GET /api/{resource} - Get all items
 * - GET /api/{resource}/:id - Get single item
 * - POST /api/{resource} - Create new item
 * - PUT /api/{resource}/:id - Update item
 * - DELETE /api/{resource}/:id - Delete item
 */

// Rooms, Cottages, Events Management
app.use("/api/rooms", roomsRoutes);

// Promotional Pricing Management
app.use("/api/promos", promosRoutes);

// Seasonal Pricing Management
app.use("/api/seasons", seasonalRoutes);

// Restaurant Management Routes
// - Tables: Manage restaurant tables/seats
// - Menu: Manage menu items and dishes
// - Orders: Handle customer orders
// - Inventory: Track food/supplies inventory
app.use("/api/restaurant/tables", tablesRoutes);
app.use("/api/restaurant/orders", ordersRoutes);
app.use("/api/restaurant/menu", menuRoutes);
app.use("/api/restaurant/inventory", inventoryRoutes);
app.use("/api/rates", ratesRoutes);

// Swimming Enrollment Management
app.use("/api/swimming", swimmingRoutes);

// POS (Point of Sale) Management
app.use("/api/pos", posRoutes);

// Bookings/Reservations Management
app.use("/api/bookings", bookingsRoutes);
// Xendit Payment Gateway
app.use("/api/xendit", xenditRoutes);

// PayMongo Payment Gateway
app.use("/api/paymongo", paymongoRoutes);

// Chatbot AI Assistant
app.use("/api/resort", chatbotRoutes);

// OTP Email Verification
app.use("/api/otp", otpRoutes);

// Customer Management
app.use("/api/customers", customersRoutes);

// ============================================================
// ROOT ROUTE - API INFO
// ============================================================
/**
 * Welcome/Info endpoint
 * Provides API documentation and available endpoints
 */
app.get("/", (req, res) => {
  res.json({
    message: "Reservision Backend API",
    version: "1.0.0",
    status: "Running",
    endpoints: {
      rooms: "/api/rooms",
      promos: "/api/promos",
      seasons: "/api/seasons",
      restaurant: {
        tables: "/api/restaurant/tables",
        menu: "/api/restaurant/menu",
        orders: "/api/restaurant/orders",
        inventory: "/api/restaurant/inventory"
      },
      rates: "/api/rates",
      swimming: "/api/swimming",
      pos: {
        items: "/api/pos/items",
        transactions: "/api/pos/transactions"
      },
      bookings: {
        all: "/api/bookings",
        create: "/api/bookings",
        byId: "/api/bookings/:id",
        byReference: "/api/bookings/reference/:reference",
        occupiedDates: "/api/bookings/occupied-dates"
      },
      resort: {
        chatGroq: "/api/resort/chat/groq",
        chat: "/api/resort/chat",
        stats: "/api/resort/stats"
      }
    },
    documentation: "Visit /api/{endpoint} to access resources"
  });
});

// ============================================================
// SERVER STARTUP
// ============================================================
/**
 * Start listening on port 8000
 * 
 * Access points:
 * - Local: http://localhost:8000
 * - Network: http://{your-ip}:8000 (if network exposed)
 * 
 * To test:
 * curl http://localhost:8000/api/rooms
 */
app.listen(8000, () => console.log("Server running at http://localhost:8000"));
