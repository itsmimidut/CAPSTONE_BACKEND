import entranceRatesRoutes from "./routes/entranceRates.js";
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
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// ROUTE IMPORTS
// ============================================================
// Import all route handlers from their respective files
// Each route file contains CRUD endpoints for its resource
import roomsRoutes from "./routes/rooms.js";
import predictionRoutes from "./routes/prediction.js";
import promosRoutes from "./routes/promos.js";
import seasonalRoutes from "./routes/seasonalPricing.js";
import tablesRoutes from "./routes/restaurant/tables.js";
import ordersRoutes from "./routes/restaurant/orders.js";
import menuRoutes from "./routes/restaurant/menu.js";
import menuIngredientsRoutes from "./routes/restaurant/menuIngredients.js";
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
import userManagementRoutes from "./routes/userManagement.js";
import analyticsRoutes from "./routes/analytics.js";
import websiteConfigRoutes from "./routes/websiteConfig.js";
import webhooksRoutes from "./routes/webhooks.js";
import adminRefundRoutes from "./routes/adminRefundRoutes.js";
import adminSalesReportRoutes from "./routes/adminSalesReportRoutes.js";
import adminNotificationRoutes from "./routes/adminNotificationRoutes.js";
import notificationsRoutes from "./routes/notifications.js";
import db from "./config/db.js";

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
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

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
app.use("/api/entrance-rates", entranceRatesRoutes);

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
app.use("/api/restaurant/sales", (await import('./routes/restaurant/salesReport.js')).default);
app.use("/api/restaurant/menu", menuRoutes);
app.use("/api/restaurant", menuIngredientsRoutes);
app.use("/api/restaurant/inventory", inventoryRoutes);
app.use("/api/rates", ratesRoutes);

// Swimming Enrollment Management
app.use("/api/swimming", swimmingRoutes);

// Predictive Analytics
app.use("/api/prediction", predictionRoutes);

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

// Analytics Dashboard
app.use("/api/analytics", analyticsRoutes);

// User Management (Admin)
app.use("/api/users", userManagementRoutes);

// Admin Refund Management
app.use("/api/admin/refunds", adminRefundRoutes);

// Admin Sales Analytics Reports
app.use("/api/admin/reports", adminSalesReportRoutes);

// Admin Notifications
app.use('/api/admin', adminNotificationRoutes);

// Notification badge counts
app.use('/api/notifications', notificationsRoutes);

// Website Content Configuration
app.use('/api/website-config', websiteConfigRoutes);

// PayMongo Webhooks
app.use('/api/webhooks', webhooksRoutes);

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
      adminReports: {
        salesAnalytics: "/api/admin/reports/sales-analytics",
        export: "/api/admin/reports/sales-analytics/export"
      },
      adminNotifications: {
        list: "/api/admin/notifications",
        pendingCounts: "/api/notifications/pending-counts"
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
// DATABASE MIGRATION HELPERS
// ============================================================
async function ensureSwimmingScheduleColumns() {
  try {
    const requiredColumns = [
      { name: 'admin_lesson_dates', definition: "JSON NULL COMMENT 'Admin-assigned lesson dates (JSON array)'" },
      { name: 'admin_lesson_time', definition: "VARCHAR(50) NULL COMMENT 'Admin-assigned time slot'" },
      { name: 'admin_assigned_coach', definition: "VARCHAR(255) NULL COMMENT 'Admin-assigned coach name'" }
    ];

    const [existingColumns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'swimming_enrollments'
         AND COLUMN_NAME IN (?, ?, ?)`,
      requiredColumns.map(column => column.name)
    );

    const existingColumnSet = new Set(existingColumns.map(row => row.COLUMN_NAME));
    const missingColumns = requiredColumns.filter(column => !existingColumnSet.has(column.name));

    if (missingColumns.length === 0) {
      return;
    }

    const alterClauses = missingColumns.map(column => `ADD COLUMN ${column.name} ${column.definition}`);
    await db.query(`ALTER TABLE swimming_enrollments ${alterClauses.join(', ')}`);
    console.log('[DB] Added missing swimming_enrollments schedule columns:', missingColumns.map(c => c.name).join(', '));
  } catch (error) {
    console.warn('[DB] Could not auto-add swimming_enrollments schedule columns:', error.message);
  }
}

async function ensureRefundsSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        refund_id INT AUTO_INCREMENT PRIMARY KEY,
        booking_id INT NOT NULL,
        payment_id INT NULL,
        customer_id INT NULL,
        refund_reference VARCHAR(50) UNIQUE,
        refund_type ENUM('Full', 'Partial', 'No Refund') DEFAULT NULL,
        refund_reason VARCHAR(255) DEFAULT 'Waiting for admin review',
        refund_note TEXT,
        original_amount DECIMAL(10,2) DEFAULT 0,
        refund_amount DECIMAL(10,2) DEFAULT 0,
        refund_method VARCHAR(50),
        refund_status ENUM('Pending', 'Approved', 'Rejected', 'Refunded') DEFAULT 'Pending',
        gateway_reference VARCHAR(100) NULL,
        gateway_status VARCHAR(50) NULL,
        requested_by VARCHAR(100) NULL,
        approved_by VARCHAR(100) NULL,
        rejected_by VARCHAR(100) NULL,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP NULL,
        refunded_at TIMESTAMP NULL,
        rejected_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_booking_id (booking_id),
        INDEX idx_refund_status (refund_status),
        INDEX idx_requested_at (requested_at),
        FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
      )
    `);

    const bookingColumns = [
      { name: 'refund_status', definition: "VARCHAR(50) DEFAULT 'No Refund'" },
      { name: 'refund_amount', definition: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'last_refunded_at', definition: 'TIMESTAMP NULL' }
    ];

    const [existingColumns] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME IN (?, ?, ?)`,
      bookingColumns.map((column) => column.name)
    );
    const existingColumnSet = new Set(existingColumns.map((row) => row.COLUMN_NAME));
    const missingColumns = bookingColumns.filter((column) => !existingColumnSet.has(column.name));

    if (missingColumns.length > 0) {
      const alterClauses = missingColumns.map((column) => `ADD COLUMN ${column.name} ${column.definition}`);
      await db.query(`ALTER TABLE bookings ${alterClauses.join(', ')}`);
    }

    console.log('[DB] Ensured refunds table and booking refund columns.');
  } catch (error) {
    console.warn('[DB] Could not ensure refunds schema:', error.message);
  }
}

async function ensureSwimmingBatchColumns() {
  try {
    const requiredColumns = [
      { name: 'batch_id', definition: 'int(11) NOT NULL' },
      { name: 'coach_id', definition: 'int(11) DEFAULT NULL' },
      { name: 'class_period', definition: "enum('AM','PM') NOT NULL DEFAULT 'AM'" },
      { name: 'start_time', definition: 'time NOT NULL' },
      { name: 'end_time', definition: 'time NOT NULL' },
      { name: 'max_slots', definition: 'int(11) NOT NULL DEFAULT 10' },
      { name: 'status', definition: "enum('Open','Full','Closed') NOT NULL DEFAULT 'Open'" }
    ];

    const [existingColumns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'swimming_batch_schedules'
         AND COLUMN_NAME IN (?, ?, ?, ?, ?, ?, ?)`,
      requiredColumns.map(column => column.name)
    );

    const existingColumnSet = new Set(existingColumns.map(row => row.COLUMN_NAME));
    const missingColumns = requiredColumns.filter(column => !existingColumnSet.has(column.name));

    if (missingColumns.length === 0) {
      return;
    }

    const alterClauses = missingColumns.map(column => `ADD COLUMN ${column.name} ${column.definition}`);
    await db.query(`ALTER TABLE swimming_batch_schedules ${alterClauses.join(', ')}`);
    console.log('[DB] Added missing swimming_batch_schedules columns:', missingColumns.map(c => c.name).join(', '));
  } catch (error) {
    console.warn('[DB] Could not auto-add swimming_batch_schedules columns:', error.message);
  }
}

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
await ensureRefundsSchema();
await ensureSwimmingScheduleColumns();
await ensureSwimmingBatchColumns();
app.listen(8000, () => console.log("Server running at http://localhost:8000"));

// npm run dev:all to run all backend and frontend servers concurrently