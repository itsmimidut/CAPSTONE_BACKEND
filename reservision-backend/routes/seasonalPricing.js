import express from "express";
import { db } from "../config/db.js";

export const getSeasons = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM seasonal_pricing ORDER BY startDate DESC");
  res.json(rows);
};

export const createSeason = async (req, res) => {
  const { name, multiplier, startDate, endDate, applyTo } = req.body;
  const [result] = await db.query(
    `INSERT INTO seasonal_pricing (name, multiplier, startDate, endDate, applyTo)
     VALUES (?,?,?,?,?)`,
    [name, multiplier, startDate, endDate, applyTo]
  );
  res.json({ success: true, id: result.insertId });
};

export const updateSeason = async (req, res) => {
  const { name, multiplier, startDate, endDate, applyTo } = req.body;
  await db.query(
    `UPDATE seasonal_pricing SET name=?, multiplier=?, startDate=?, endDate=?, applyTo=? WHERE id=?`,
    [name, multiplier, startDate, endDate, applyTo, req.params.id]
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
