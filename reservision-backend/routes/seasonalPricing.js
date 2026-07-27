import express from "express";
import { db } from "../config/db.js";

const VALID_PRICING_TYPES = new Set([
  "fixed_price",
  "percentage_increase",
  "percentage_decrease",
  "amount_increase",
  "amount_decrease",
]);

const VALID_CATEGORY_TYPES = new Set(["room", "cottage", "event", null, ""]);

const normalizeSeasonPayload = (body = {}) => {
  const startDate = body.start_date || body.startDate || null;
  const endDate = body.end_date || body.endDate || null;
  const pricingType = String(body.pricing_type || body.pricingType || "").trim().toLowerCase();

  return {
    season_name: String(body.season_name || body.name || "").trim(),
    name: String(body.season_name || body.name || "").trim(),
    inventory_item_id: body.inventory_item_id ? Number(body.inventory_item_id) : null,
    category_type: body.category_type ? String(body.category_type).trim().toLowerCase() : null,
    start_date: startDate,
    end_date: endDate,
    startDate,
    endDate,
    pricing_type: pricingType || null,
    value: body.value != null ? Number(body.value) : (body.multiplier != null ? Number(body.multiplier) : null),
    multiplier: body.multiplier != null ? Number(body.multiplier) : null,
    applyTo: body.applyTo || body.category_type || null,
    status: body.status || "Active",
    priority: Number(body.priority || 0),
  };
};

const validateSeasonPayload = (season) => {
  if (!season.season_name) return "Season name is required.";
  if (!season.start_date || !season.end_date) return "Start and end dates are required.";
  if (new Date(season.end_date) < new Date(season.start_date)) {
    return "End date must be the same or after start date.";
  }
  if (season.pricing_type && !VALID_PRICING_TYPES.has(season.pricing_type)) {
    return "Invalid pricing type.";
  }
  if (season.pricing_type && !(Number(season.value) > 0)) {
    return "Value must be greater than 0.";
  }
  if (!season.pricing_type && !(Number(season.multiplier) > 0)) {
    return "Multiplier or pricing value is required.";
  }
  if (season.category_type && !VALID_CATEGORY_TYPES.has(season.category_type)) {
    return "Invalid category type.";
  }
  if (season.status && !["Active", "Inactive"].includes(season.status)) {
    return "Status must be Active or Inactive.";
  }
  return null;
};

export const getSeasons = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM seasonal_pricing ORDER BY COALESCE(start_date, startDate) DESC, id DESC");
  res.json(rows);
};

export const createSeason = async (req, res) => {
  const season = normalizeSeasonPayload(req.body);
  const validationError = validateSeasonPayload(season);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const [result] = await db.query(
    `INSERT INTO seasonal_pricing
      (name, season_name, multiplier, startDate, endDate, start_date, end_date, applyTo,
       inventory_item_id, category_type, pricing_type, value, status, priority)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      season.name,
      season.season_name,
      season.multiplier,
      season.startDate,
      season.endDate,
      season.start_date,
      season.end_date,
      season.applyTo,
      season.inventory_item_id,
      season.category_type,
      season.pricing_type,
      season.value,
      season.status,
      season.priority,
    ]
  );
  res.json({ success: true, id: result.insertId });
};

export const updateSeason = async (req, res) => {
  const season = normalizeSeasonPayload(req.body);
  const validationError = validateSeasonPayload(season);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  await db.query(
    `UPDATE seasonal_pricing
     SET name=?, season_name=?, multiplier=?, startDate=?, endDate=?, start_date=?, end_date=?, applyTo=?,
         inventory_item_id=?, category_type=?, pricing_type=?, value=?, status=?, priority=?
     WHERE id=?`,
    [
      season.name,
      season.season_name,
      season.multiplier,
      season.startDate,
      season.endDate,
      season.start_date,
      season.end_date,
      season.applyTo,
      season.inventory_item_id,
      season.category_type,
      season.pricing_type,
      season.value,
      season.status,
      season.priority,
      req.params.id,
    ]
  );
  res.json({ success: true });
};

export const deleteSeason = async (req, res) => {
  await db.query("DELETE FROM seasonal_pricing WHERE id=?", [req.params.id]);
  res.json({ success: true });
};

const router = express.Router();
router.get("/", getSeasons);
router.post("/", createSeason);
router.put("/:id", updateSeason);
router.delete("/:id", deleteSeason);

export default router;
