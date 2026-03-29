/**
 * ============================================================
 * Reservision Backend - Express Server (FULL)
 * ============================================================
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

console.log("✅ USING THIS server.js FILE:", import.meta.url);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// ============================================================
// GLOBAL PROCESS ERROR HANDLERS (para makita kung bakit nag-eexit)
// ============================================================
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ============================================================
// ROUTE IMPORTS
// ============================================================
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

// ============================================================
// API ROUTES MOUNTING
// ============================================================

// Rooms, Cottages, Events
app.use("/api/rooms", roomsRoutes);

// Promo
app.use("/api/promos", promosRoutes);

// Seasons
app.use("/api/seasons", seasonalRoutes);

// Restaurant
app.use("/api/restaurant/tables", tablesRoutes);
app.use("/api/restaurant/orders", ordersRoutes);
app.use("/api/restaurant/menu", menuRoutes);
app.use("/api/restaurant", menuIngredientsRoutes);
app.use("/api/restaurant/inventory", inventoryRoutes);

// ✅ Sales report route (dynamic import safe)
app.use("/api/restaurant/sales", async (req, res, next) => {
  try {
    const mod = await import("./routes/restaurant/salesReport.js");
    return mod.default(req, res, next);
  } catch (err) {
    console.error("❌ Failed to load salesReport route:", err);
    return res.status(500).json({ message: "Sales report route load failed", error: err.message });
  }
});

// Rates
app.use("/api/rates", ratesRoutes);

// Swimming
app.use("/api/swimming", swimmingRoutes);

// ✅ Predictive Analytics
app.use("/api/prediction", predictionRoutes);

// POS
app.use("/api/pos", posRoutes);

// Bookings
app.use("/api/bookings", bookingsRoutes);

// Payments
app.use("/api/xendit", xenditRoutes);
app.use("/api/paymongo", paymongoRoutes);

// Chatbot
app.use("/api/resort", chatbotRoutes);

// OTP
app.use("/api/otp", otpRoutes);

// Customers
app.use("/api/customers", customersRoutes);

// Analytics
app.use("/api/analytics", analyticsRoutes);

// Users
app.use("/api/users", userManagementRoutes);

// ============================================================
// ROOT ROUTE
// ============================================================
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
        inventory: "/api/restaurant/inventory",
        sales: "/api/restaurant/sales",
      },
      rates: "/api/rates",
      swimming: "/api/swimming",
      prediction: {
        ping: "/api/prediction/ping",
        tomorrowBookings: "/api/prediction/tomorrow-bookings",
        forecastDaily: "/api/prediction/forecast/daily",
        forecastWeekly: "/api/prediction/forecast/weekly",
        forecastMonthly: "/api/prediction/forecast/monthly",
        forecastYearly: "/api/prediction/forecast/yearly",
      },
      pos: {
        items: "/api/pos/items",
        transactions: "/api/pos/transactions",
      },
      bookings: {
        all: "/api/bookings",
        create: "/api/bookings",
        byId: "/api/bookings/:id",
        byReference: "/api/bookings/reference/:reference",
        occupiedDates: "/api/bookings/occupied-dates",
      },
      resort: {
        chatGroq: "/api/resort/chat/groq",
        chat: "/api/resort/chat",
        stats: "/api/resort/stats",
      },
    },
    documentation: "Visit /api/{endpoint} to access resources",
  });
});

// ============================================================
// 404 HANDLER (para makita agad kapag mali endpoint)
// ============================================================
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

// ============================================================
// START SERVER
// ============================================================
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// ✅ Keep-alive log (optional, pero helpful)
setInterval(() => {
  console.log("✅ Server still running...");
}, 15000);

// ✅ Graceful shutdown
process.on("SIGINT", () => {
  console.log("🛑 SIGINT received. Shutting down server...");
  server.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
});