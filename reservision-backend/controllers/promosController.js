import { db } from "../config/db.js";

export const getPromos = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM promos ORDER BY created_at DESC");
  res.json(rows);
};

export const createPromo = async (req, res) => {
  const { code, type, value, description, startDate, endDate, usageLimit } = req.body;
  const [result] = await db.query(
    `INSERT INTO promos
      (code, type, value, description, startDate, endDate, usageLimit)
     VALUES (?,?,?,?,?,?,?)`,
    [code, type, value, description, startDate, endDate, usageLimit || null]
  );
  res.json({ success: true, id: result.insertId });
};

export const updatePromo = async (req, res) => {
  const { code, type, value, description, startDate, endDate, usageLimit } = req.body;
  await db.query(
    `UPDATE promos SET code=?, type=?, value=?, description=?, startDate=?, endDate=?, usageLimit=? WHERE promo_id=?`,
    [code, type, value, description, startDate, endDate, usageLimit || null, req.params.id]
  );
  res.json({ success: true });
};

export const deletePromo = async (req, res) => {
  await db.query("DELETE FROM promos WHERE promo_id=?", [req.params.id]);
  res.json({ success: true });
};
