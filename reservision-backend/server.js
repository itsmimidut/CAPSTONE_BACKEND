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
import { createServer } from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import dotenv from "dotenv";
import { morganStream } from "./utils/logger.js";
import { helmetMiddleware } from "./middleware/helmetConfig.js";
import { corsOptions, corsErrorHandler } from "./middleware/corsConfig.js";
import { ensureCsrfCookie, validateCsrf } from "./middleware/csrf.js";
import { fileURLToPath } from "url";
import path from "path";
import { spawn } from "child_process";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let printerDaemonProcess = null;

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
import * as posController from "./controllers/posController.js";
import bookingsRoutes from "./routes/bookings.js";
import availabilityRoutes from "./routes/availability.js";
import availabilityBlocksRoutes from "./routes/availabilityBlocks.js";
import pricingRoutes from "./routes/pricing.js";
import xenditRoutes from "./routes/xendit.js";
import paymentWebhookRoutes from "./routes/paymentWebhooks.js";
import chatbotRoutes from "./routes/chatbot.js";
import otpRoutes from "./routes/otp.js";
import customersRoutes from "./routes/customers.js";
import customerProfileRoutes from "./routes/customerProfileRoutes.js";
import userManagementRoutes from "./routes/userManagement.js";
import analyticsRoutes from "./routes/analytics.js";
import websiteConfigRoutes from "./routes/websiteConfig.js";
import adminRefundRoutes from "./routes/adminRefundRoutes.js";
import adminSalesReportRoutes from "./routes/adminSalesReportRoutes.js";
import adminSalesReportsQueryRoutes from "./routes/adminSalesReportsQueryRoutes.js";
import adminDashboardRoutes from "./routes/adminDashboardRoutes.js";
import adminNotificationRoutes from "./routes/adminNotificationRoutes.js";
import notificationsRoutes from "./routes/notifications.js";
import customerNotificationsRoutes from "./routes/customerNotifications.js";
import feedbackRoutes from "./routes/feedback.js";
import eshopFeedbackRoutes from "./routes/eshopFeedback.js";
import inventoryLegacyConversionRoutes from "./routes/inventoryLegacyConversionRoutes.js";
import db from "./config/db.js";
import {
  authenticateToken,
  requireAdminAuth,
  requireAnalyticsAuth,
  requireBookingAuth,
  requireCustomerAuth,
  requireCustomerRefundAuth,
  requireEntranceRatesAuth,
  requireNotificationAuth,
  requirePosAuth,
  requirePredictionAuth,
  requireProfileAuth,
  requirePromosAuth,
  requireRestaurantAuth,
  requireRestaurantMenuAuth,
  requireRoomsAuth,
  requireSeasonsAuth,
  requireSwimmingAuth,
  requireUsersAuth,
  requireWebsiteConfigAuth,
} from "./middleware/authenticateToken.js";
import { requireCustomer, requireStaff, requireAdmin } from "./middleware/authorize.js";
import customerRefundRoutes from "./routes/customerRefundRoutes.js";
import customerSwimmingEnrollmentRoutes from "./routes/customerSwimmingEnrollment.js";
import customerDashboardRoutes from "./routes/customerDashboardRoutes.js";
import authRoutes from "./routes/auth.js";
import customerDisplayRoutes from "./routes/customerDisplay.js";
import posStationRoutes from "./routes/posStations.js";
import posTerminalRoutes from "./routes/posTerminal.js";
import { ensureCustomerDisplaySchema } from "./services/customerDisplayService.js";
import { ensureStationRoutingSchema } from "./services/stationRoutingService.js";
import { ensureDisplaySessionSchema } from "./services/displaySessionService.js";
import { ensurePaymentTimelineSchema } from "./services/paymentTimelineService.js";
import { ensureEshopFulfillmentSchema } from "./services/eshopFulfillmentService.js";
import { ensurePosOrderSessionSchema } from "./services/posOrderSessionService.js";
import { initDisplayWebSocket } from "./services/displayWebSocketService.js";
import { ensureLegacyConversionSchema } from "./services/inventoryLegacyConversionService.js";
import { getOperationalReadiness } from "./services/operationalReadinessService.js";

// ============================================================
// EXPRESS APP INITIALIZATION
// ============================================================
// Create Express application instance
const app = express();

app.get('/health/live', (req, res) => res.json({ status: 'alive', uptime_seconds: Math.floor(process.uptime()) }));
app.get('/health/ready', async (req, res) => {
  const readiness = await getOperationalReadiness();
  return res.status(readiness.ready ? 200 : 503).json({
    status: readiness.status,
    checked_at: readiness.checked_at,
    components: Object.fromEntries(Object.entries(readiness.components).map(([key, value]) => [key, { ready: value.ready }])),
  });
});

// ============================================================
// MIDDLEWARE CONFIGURATION
// ============================================================
// Security headers (Helmet) — applied before CORS and body parsers
app.use(helmetMiddleware);

// CORS: allow configured frontend origins only
app.use(cors(corsOptions));

// Parse HttpOnly auth cookies
app.use(cookieParser());

// HTTP request logging (Sprint 4 Task 06)
app.use(morgan('combined', { stream: morganStream }));

// CSRF double-submit cookie
app.use(ensureCsrfCookie);
app.use(validateCsrf);

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
app.use("/api/rooms", requireRoomsAuth);
app.use("/api/rooms", roomsRoutes);
app.use("/api/entrance-rates", requireEntranceRatesAuth);
app.use("/api/entrance-rates", entranceRatesRoutes);

// Promotional Pricing Management
app.use("/api/promos", requirePromosAuth);
app.use("/api/promos", promosRoutes);

// Seasonal Pricing Management
app.use("/api/seasons", ...requireSeasonsAuth);
app.use("/api/seasons", seasonalRoutes);

// Restaurant Management Routes
app.use("/api/restaurant/tables", ...requireRestaurantAuth);
app.use("/api/restaurant/tables", tablesRoutes);
app.use("/api/restaurant/orders", ...requireRestaurantAuth);
app.use("/api/restaurant/orders", ordersRoutes);
app.use("/api/restaurant/sales", ...requireRestaurantAuth);
app.use("/api/restaurant/sales", (await import('./routes/restaurant/salesReport.js')).default);
app.use("/api/restaurant/menu", requireRestaurantMenuAuth);
app.use("/api/restaurant/menu", menuRoutes);
app.use("/api/restaurant", ...requireRestaurantAuth);
app.use("/api/restaurant", menuIngredientsRoutes);
app.use("/api/restaurant/inventory", ...requireRestaurantAuth);
app.use("/api/restaurant/inventory", inventoryRoutes);
app.use("/api/rates", ratesRoutes);

// Swimming customer enrollment (authenticated customer + ownership checks)
app.use("/api/swimming/customer", authenticateToken, requireCustomer, customerSwimmingEnrollmentRoutes);
app.use("/api/customer/dashboard", authenticateToken, requireCustomer, customerDashboardRoutes);

// Swimming Enrollment Management
app.use("/api/swimming", requireSwimmingAuth);
app.use("/api/swimming", swimmingRoutes);

// Predictive Analytics
app.use("/api/prediction", ...requirePredictionAuth);
app.use("/api/prediction", predictionRoutes);

// POS (Point of Sale) Management
app.get("/api/pos/payment-status/:receiptNo", posController.getPosPaymentStatusByReceipt);
app.use("/api/pos", requirePosAuth);
app.use("/api/pos", posRoutes);

// Customer Display (pairing public; admin + device-token routes inside router)
app.use("/api/customer-display", customerDisplayRoutes);
app.use("/api/pos-stations", posStationRoutes);
app.use("/api/pos-terminal", posTerminalRoutes);

// Event area availability (public — used by customer booking flow)
app.use("/api/availability", availabilityRoutes);
app.use("/api/availability/blocks", availabilityBlocksRoutes);
app.use("/api/pricing", pricingRoutes);

// Bookings/Reservations Management (guest checkout routes remain public)
app.use("/api/bookings", requireBookingAuth);
app.use("/api/bookings", bookingsRoutes);
// Xendit Payment Gateway
app.use("/api/xendit", xenditRoutes);
app.use("/api/payments", paymentWebhookRoutes);

// Chatbot AI Assistant
app.use("/api/resort", chatbotRoutes);

// OTP Email Verification
app.use("/api/otp", otpRoutes);

// Auth (refresh token rotation — public)
app.use("/api/auth", authRoutes);

// Customer Management (signup/login/reset-password remain public)
app.use("/api/customers", requireCustomerAuth);
app.use("/api/customers/profile", customerProfileRoutes);
app.use("/api/customers", customersRoutes);

// Profile routes (reserved prefix; profile handlers currently live under /api/customers/profile)
app.use("/api/profile", requireProfileAuth);

// Analytics Dashboard
app.use("/api/analytics", ...requireAnalyticsAuth);
app.use("/api/analytics", analyticsRoutes);

// User Management (Admin)
app.use("/api/users", ...requireUsersAuth);
app.use("/api/users", userManagementRoutes);

// Customer refund requests
app.use("/api/customer/refunds", ...requireCustomerRefundAuth);
app.use("/api/customer/refunds", customerRefundRoutes);

// Front-desk + admin refund queue (list/export/create). Approve/reject stay admin-only in the router.
app.use("/api/admin/refunds", authenticateToken, requireStaff, adminRefundRoutes);

// Admin routes (reports, notifications, etc.)
app.use("/api/admin", ...requireAdminAuth);
app.get('/api/admin/operational-readiness', async (req, res) => {
  const readiness = await getOperationalReadiness();
  return res.status(readiness.ready ? 200 : 503).json({ success: readiness.ready, data: readiness });
});
app.use("/api/admin/reports", adminSalesReportRoutes);
app.use("/api/admin/sales-reports", adminSalesReportsQueryRoutes);
app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use('/api/admin', adminNotificationRoutes);
app.use('/api/admin/inventory/legacy-conversions', inventoryLegacyConversionRoutes);

// Notification badge counts
app.use('/api/notifications', ...requireNotificationAuth);
app.use('/api/notifications', notificationsRoutes);

// Customer notifications feed
app.use('/api/customer-notifications', requireProfileAuth);
app.use('/api/customer-notifications', customerNotificationsRoutes);

// Authenticated customer feedback
app.use('/api/feedback', feedbackRoutes);
app.use('/api/eshop-feedback', eshopFeedbackRoutes);

// Website Content Configuration
app.use('/api/website-config', requireWebsiteConfigAuth);
app.use('/api/website-config', websiteConfigRoutes);

// CORS rejection handler (403 for disallowed origins)
app.use(corsErrorHandler);

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

async function ensureBookingPricingColumns() {
  try {
    const [itemCols] = await db.query(`SHOW COLUMNS FROM booking_items LIKE 'base_price'`);
    if (!itemCols.length) {
      await db.query(`ALTER TABLE booking_items
        ADD COLUMN base_price DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN seasonal_price DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN seasonal_adjustment DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN promo_discount DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN final_subtotal DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN pricing_notes JSON NULL`);
    }

    const [bookingCols] = await db.query(`SHOW COLUMNS FROM bookings LIKE 'pricing_total'`);
    if (!bookingCols.length) {
      await db.query(`ALTER TABLE bookings ADD COLUMN pricing_total DECIMAL(10,2) DEFAULT 0`);
    }
  } catch (error) {
    console.warn('[DB] Could not auto-add booking pricing columns:', error.message);
  }
}

async function ensureSeasonalPricingPhase6Schema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS seasonal_pricing (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NULL,
        multiplier DECIMAL(10,4) NULL,
        startDate DATE NULL,
        endDate DATE NULL,
        applyTo VARCHAR(100) NULL,
        inventory_item_id INT NULL,
        category_type VARCHAR(32) NULL,
        season_name VARCHAR(100) NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        pricing_type VARCHAR(32) NULL,
        value DECIMAL(10,2) NULL,
        status VARCHAR(32) DEFAULT 'Active',
        priority INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const columnsToAdd = [
      { name: 'inventory_item_id', definition: 'INT NULL' },
      { name: 'category_type', definition: 'VARCHAR(32) NULL' },
      { name: 'season_name', definition: 'VARCHAR(100) NULL' },
      { name: 'start_date', definition: 'DATE NULL' },
      { name: 'end_date', definition: 'DATE NULL' },
      { name: 'pricing_type', definition: 'VARCHAR(32) NULL' },
      { name: 'value', definition: 'DECIMAL(10,2) NULL' },
      { name: 'status', definition: "VARCHAR(32) DEFAULT 'Active'" },
      { name: 'priority', definition: 'INT DEFAULT 0' },
      { name: 'created_at', definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
      { name: 'updated_at', definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
    ];

    const [existing] = await db.query('SHOW COLUMNS FROM seasonal_pricing');
    const existingNames = new Set(existing.map((row) => row.Field));
    const missing = columnsToAdd.filter((col) => !existingNames.has(col.name));

    if (missing.length) {
      const clauses = missing.map((col) => `ADD COLUMN ${col.name} ${col.definition}`);
      await db.query(`ALTER TABLE seasonal_pricing ${clauses.join(', ')}`);
    }
  } catch (error) {
    console.warn('[DB] Could not auto-upgrade seasonal_pricing schema:', error.message);
  }
}

async function ensureAvailabilityBlocksSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS availability_blocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inventory_item_id INT NOT NULL,
        category_type VARCHAR(32) NOT NULL,
        block_type VARCHAR(50) DEFAULT 'admin_block',
        reason VARCHAR(255) NULL,
        notes TEXT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        start_time TIME NULL,
        end_time TIME NULL,
        status VARCHAR(32) DEFAULT 'Active',
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_availability_blocks_item (inventory_item_id),
        INDEX idx_availability_blocks_category (category_type),
        INDEX idx_availability_blocks_dates (start_date, end_date),
        INDEX idx_availability_blocks_status (status)
      )
    `);
  } catch (error) {
    console.warn('[DB] Could not auto-create availability_blocks table:', error.message);
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

async function ensureSwimmingBatchSessionSchema() {
  try {
    const batchColumns = [
      { name: 'schedule_type', definition: "ENUM('DAILY','SELECTED_DAYS','FLEXIBLE') NOT NULL DEFAULT 'DAILY'" },
      { name: 'max_sessions', definition: 'INT NULL' },
      { name: 'generated_sessions', definition: 'INT NOT NULL DEFAULT 0' },
    ];

    const [existingBatchColumns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'swimming_batches'
         AND COLUMN_NAME IN (?, ?, ?)`,
      batchColumns.map((column) => column.name)
    );

    const existingBatchColumnSet = new Set(existingBatchColumns.map((row) => row.COLUMN_NAME));
    const missingBatchColumns = batchColumns.filter((column) => !existingBatchColumnSet.has(column.name));

    if (missingBatchColumns.length > 0) {
      const alterClauses = missingBatchColumns.map((column) => `ADD COLUMN ${column.name} ${column.definition}`);
      await db.query(`ALTER TABLE swimming_batches ${alterClauses.join(', ')}`);
      console.log('[DB] Added missing swimming_batches schedule columns:', missingBatchColumns.map((c) => c.name).join(', '));
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS swimming_batch_sessions (
        batch_session_id INT AUTO_INCREMENT PRIMARY KEY,
        batch_id INT NOT NULL,
        session_date DATE NOT NULL,
        start_time TIME NULL,
        end_time TIME NULL,
        coach_id INT NULL,
        max_slots INT NOT NULL DEFAULT 10,
        booked_slots INT NOT NULL DEFAULT 0,
        status ENUM('Open','Full','Completed','Cancelled') NOT NULL DEFAULT 'Open',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_batch_session_date (batch_id, session_date),
        KEY idx_batch_session_batch (batch_id),
        KEY idx_batch_session_date (session_date),
        CONSTRAINT fk_batch_sessions_batch
          FOREIGN KEY (batch_id) REFERENCES swimming_batches(batch_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('[DB] Ensured swimming_batch_sessions table.');
  } catch (error) {
    console.warn('[DB] Could not ensure swimming batch session schema:', error.message);
  }
}

async function ensureSwimmingAttendanceSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS swimming_attendance (
        attendance_id INT AUTO_INCREMENT PRIMARY KEY,
        coach_id INT NOT NULL,
        schedule_id INT NOT NULL,
        batch_id INT NULL,
        enrollment_id INT NULL,
        attendance_date DATE NOT NULL,
        status ENUM('Present','Absent','Late','Excused') NOT NULL DEFAULT 'Present',
        remarks TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_coach_date (coach_id, attendance_date),
        INDEX idx_schedule_date (schedule_id, attendance_date),
        INDEX idx_enrollment (enrollment_id),
        UNIQUE KEY unique_attendance_record (schedule_id, enrollment_id, attendance_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [existingColumns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'swimming_attendance'
         AND COLUMN_NAME = 'batch_id'`
    );

    if (existingColumns.length === 0) {
      await db.query(
        `ALTER TABLE swimming_attendance
         ADD COLUMN batch_id INT NULL AFTER schedule_id`
      );
      console.log('[DB] Added missing swimming_attendance.batch_id column');
    }

    console.log('[DB] Ensured swimming_attendance table.');
  } catch (error) {
    console.warn('[DB] Could not ensure swimming_attendance schema:', error.message);
  }
}

async function ensureWebhookEventsSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(255) NULL,
        processing_status VARCHAR(20) DEFAULT 'PENDING',
        processed_at DATETIME NULL,
        error_message TEXT NULL,
        UNIQUE KEY uk_webhook_events_event_id (event_id),
        INDEX idx_webhook_events_event_type (event_type),
        INDEX idx_webhook_events_processing_status (processing_status),
        INDEX idx_webhook_events_processed_at (processed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const webhookColumns = [
      { name: 'processing_status', definition: "VARCHAR(20) DEFAULT 'PENDING'" },
      { name: 'error_message', definition: 'TEXT NULL' },
    ];

    const [existingColumns] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webhook_events'
         AND COLUMN_NAME IN (?, ?)`,
      webhookColumns.map((c) => c.name),
    );
    const existingSet = new Set(existingColumns.map((row) => row.COLUMN_NAME));
    const missing = webhookColumns.filter((c) => !existingSet.has(c.name));

    if (missing.length > 0) {
      const alterClauses = missing.map((c) => `ADD COLUMN ${c.name} ${c.definition}`);
      await db.query(`ALTER TABLE webhook_events ${alterClauses.join(', ')}`);
    }

    console.log('[DB] Ensured webhook_events table.');
  } catch (error) {
    console.warn('[DB] Could not ensure webhook_events table:', error.message);
  }
}

async function ensureCustomerProfileSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_addresses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        label VARCHAR(100) NOT NULL,
        street VARCHAR(255) NOT NULL,
        city VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100) DEFAULT 'Philippines',
        is_default TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_customer_addresses_customer_id (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_notification_preferences (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL UNIQUE,
        booking_updates TINYINT(1) DEFAULT 1,
        restaurant_orders TINYINT(1) DEFAULT 1,
        shop_orders TINYINT(1) DEFAULT 1,
        activity_updates TINYINT(1) DEFAULT 1,
        promotions TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_customer_notif_customer_id (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_viewed_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        order_reference VARCHAR(100) NOT NULL,
        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_customer_order_view (customer_id, order_reference),
        INDEX idx_customer_viewed_orders_customer_id (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('[DB] Ensured customer profile tables.');
  } catch (error) {
    console.warn('[DB] Could not ensure customer profile tables:', error.message);
  }
}

async function ensureCustomerNotificationsSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        customer_id INT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'general',
        link VARCHAR(500) NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_customer_notifications_user_id (user_id),
        INDEX idx_customer_notifications_is_read (is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Ensured customer_notifications table.');
  } catch (error) {
    console.warn('[DB] Could not ensure customer_notifications table:', error.message);
  }
}

async function ensurePosPhase2Schema() {
  try {
    const { ensurePosPhase2Schema: ensureColumns } = await import('./services/paymentStatusService.js');
    await ensureColumns();
  } catch (error) {
    console.warn('[DB] Could not ensure POS Phase 2 schema:', error.message);
  }
}

async function ensurePosReceiptSchema() {
  try {
    const { ensureReceiptSequenceSchema, ensureReceiptNoUniqueIndex } = await import('./services/receiptService.js');
    await ensureReceiptSequenceSchema();
    await ensureReceiptNoUniqueIndex();
  } catch (error) {
    console.warn('[DB] Could not ensure POS receipt schema:', error.message);
  }
}

async function ensurePrintJobsSchema() {
  try {
    const { ensurePrintJobsSchema: ensureTable } = await import('./services/printJobService.js');
    await ensureTable();
    console.log('[DB] Ensured print_jobs table.');
  } catch (error) {
    console.warn('[DB] Could not ensure print_jobs table:', error.message);
  }
}

async function ensureStaffNotificationReadsSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS staff_notification_reads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        notification_key VARCHAR(120) NOT NULL,
        read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_staff_notification_read (user_id, notification_key),
        INDEX idx_staff_notification_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Ensured staff_notification_reads table.');
  } catch (error) {
    console.warn('[DB] Could not ensure staff_notification_reads table:', error.message);
  }
}

async function migrateRefundStatusSchema() {
  try {
    const [columns] = await db.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refunds' AND COLUMN_NAME = 'refund_status'`,
    );

    if (columns.length && String(columns[0].COLUMN_TYPE).toLowerCase().includes('enum')) {
      await db.query(`
        UPDATE refunds SET refund_status = 'Completed' WHERE refund_status = 'Refunded'
      `);
      await db.query(`
        UPDATE refunds SET refund_status = 'Processing' WHERE refund_status = 'Approved'
      `);
      await db.query(`
        ALTER TABLE refunds MODIFY refund_status VARCHAR(50) DEFAULT 'Pending'
      `);
      console.log('[DB] Migrated refunds.refund_status to VARCHAR with Sprint 4.5 values.');
    }
  } catch (error) {
    console.warn('[DB] Could not migrate refund_status schema:', error.message);
  }
}

async function ensureAuditLogsSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL DEFAULT 0,
        action VARCHAR(255) NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        entity_id INT NOT NULL DEFAULT 0,
        old_value JSON NULL,
        new_value JSON NULL,
        ip_address VARCHAR(45) NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_logs_user_id (user_id),
        INDEX idx_audit_logs_action (action),
        INDEX idx_audit_logs_entity (entity_type, entity_id),
        INDEX idx_audit_logs_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Ensured audit_logs table.');
  } catch (error) {
    console.warn('[DB] Could not ensure audit_logs table:', error.message);
  }
}

async function ensureRefreshTokensSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_agent VARCHAR(512) NULL,
        ip_address VARCHAR(45) NULL,
        last_used_at DATETIME NULL DEFAULT NULL,
        INDEX idx_refresh_tokens_user_id (user_id),
        INDEX idx_refresh_tokens_token_hash (token_hash),
        INDEX idx_refresh_tokens_expires_at (expires_at),
        CONSTRAINT fk_refresh_tokens_user
          FOREIGN KEY (user_id) REFERENCES user(user_id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const [columns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'refresh_tokens'
         AND COLUMN_NAME = 'last_used_at'`,
    );

    if (columns.length === 0) {
      await db.query(
        'ALTER TABLE refresh_tokens ADD COLUMN last_used_at DATETIME NULL DEFAULT NULL',
      );
    }

    console.log('[DB] Ensured refresh_tokens table.');
  } catch (error) {
    console.warn('[DB] Could not ensure refresh_tokens table:', error.message);
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
await ensureAvailabilityBlocksSchema();
await ensureSeasonalPricingPhase6Schema();
await ensureBookingPricingColumns();
await migrateRefundStatusSchema();
await ensureRefreshTokensSchema();
await ensureWebhookEventsSchema();
await ensureCustomerNotificationsSchema();
await ensureCustomerProfileSchema();
await ensureStaffNotificationReadsSchema();
await ensureAuditLogsSchema();
await ensureSwimmingScheduleColumns();
await ensureSwimmingBatchColumns();
await ensureSwimmingBatchSessionSchema();
await ensureSwimmingAttendanceSchema();
await ensurePosReceiptSchema();
await ensurePosPhase2Schema();
await ensureEshopFulfillmentSchema();
await ensurePrintJobsSchema();
const { ensurePosPrinterSchema } = await import('./services/posPrinterSettingsService.js');
const { ensureReceiptSettingsSchema } = await import('./services/receiptSettingsService.js');
await ensurePosPrinterSchema();
await ensureReceiptSettingsSchema();
const { ensurePrintBridgeSchema } = await import('./services/printBridgeService.js');
await ensurePrintBridgeSchema();
await ensureCustomerDisplaySchema();
await ensureStationRoutingSchema();
await ensurePosOrderSessionSchema();
await ensureDisplaySessionSchema();
await ensurePaymentTimelineSchema();
await ensureLegacyConversionSchema();

function startPrinterDaemon() {
  const disabled = String(process.env.DISABLE_PRINTER_DAEMON || '').toLowerCase() === 'true';
  if (disabled) {
    console.log('[Printer] Daemon disabled via DISABLE_PRINTER_DAEMON=true');
    return;
  }

  const printerServicePath = path.join(__dirname, 'printer-service.js');
  printerDaemonProcess = spawn(process.execPath, [printerServicePath], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env,
  });

  printerDaemonProcess.on('error', (error) => {
    console.error('[Printer] Failed to start daemon:', error.message);
  });

  printerDaemonProcess.on('exit', (code, signal) => {
    printerDaemonProcess = null;
    if (signal) {
      console.warn(`[Printer] Daemon exited with signal ${signal}`);
      return;
    }
    if (code !== 0) {
      console.warn(`[Printer] Daemon exited with code ${code}`);
    }
  });

  console.log('[Printer] Daemon started with server process');
}

const httpServer = createServer(app);
initDisplayWebSocket(httpServer);
startPrinterDaemon();

const port = Number(process.env.PORT || 8000);
httpServer.listen(port, () => console.log(`Server running on port ${port}`));

function stopPrinterDaemon() {
  if (!printerDaemonProcess || printerDaemonProcess.killed) return;
  printerDaemonProcess.kill('SIGTERM');
}

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; draining HTTP and database connections.`);
  stopPrinterDaemon();
  httpServer.close(async () => {
    try { await db.end(); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// npm run dev:all to run all backend and frontend servers concurrently
