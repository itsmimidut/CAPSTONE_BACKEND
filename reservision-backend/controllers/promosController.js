import { db } from "../config/db.js";

const PROMO_CATEGORY_VALUES = new Set(["all", "rooms", "cottages", "events", "food","swimming"]);
const PROMO_DISCOUNT_TYPES = new Set(["percent", "fixed"]);

const toNumberOrDefault = (value, defaultValue = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : defaultValue;
};

const toNullableNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const normalizeItemIds = (value) => {
    const rawValues = Array.isArray(value)
        ? value
        : typeof value === "string" && value.trim()
            ? (() => {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : value.split(",");
                } catch {
                    return value.split(",");
                }
            })()
            : [];

    const uniqueValues = new Set();
    rawValues.forEach((itemId) => {
        const normalized = String(itemId || "").trim();
        if (normalized) uniqueValues.add(normalized);
    });

    return Array.from(uniqueValues);
};

const normalizePromoPayload = (body = {}) => {
    const code = String(body.code || "").trim().toUpperCase();
    const discountType = String(body.discount_type || body.type || "percent").trim().toLowerCase() || "percent";
    const appliesToCategory = String(body.applies_to_category || body.category || "all").trim().toLowerCase() || "all";

    return {
        promo_id: body.promo_id || body.id || null,
        name: String(body.name || "").trim(),
        code,
        description: String(body.description || "").trim(),
        discount_type: PROMO_DISCOUNT_TYPES.has(discountType) ? discountType : "percent",
        discount_value: toNumberOrDefault(body.discount_value ?? body.value, 0),
        applies_to_category: PROMO_CATEGORY_VALUES.has(appliesToCategory) ? appliesToCategory : "all",
        item_ids: normalizeItemIds(body.item_ids),
        min_subtotal: toNumberOrDefault(body.min_subtotal, 0),
        start_date: body.start_date || body.startDate || null,
        end_date: body.end_date || body.endDate || null,
        usage_limit: toNullableNumber(body.usage_limit ?? body.usageLimit),
        times_used: toNumberOrDefault(body.times_used, 0),
        is_active: body.is_active === false || body.is_active === 0 || body.is_active === "0" ? 0 : 1,
    };
};

const mapPromoRow = (row) => {
    const discountType = String(row.discount_type || row.type || "percent").toLowerCase();
    const discountValue = Number(row.discount_value ?? row.value ?? 0);
    const startDate = row.start_date || row.startDate || null;
    const endDate = row.end_date || row.endDate || null;
    const usageLimit = row.usage_limit ?? row.usageLimit ?? null;
    const timesUsed = Number(row.times_used || 0);
    const itemIds = normalizeItemIds(row.promo_item_ids || row.item_ids);

    return {
        promo_id: row.promo_id || row.id,
        id: row.id || row.promo_id,
        name: row.name || row.code,
        code: row.code,
        description: row.description || "",
        discount_type: discountType,
        discount_value: discountValue,
        applies_to_category: row.applies_to_category || "all",
        item_ids: itemIds,
        min_subtotal: Number(row.min_subtotal || 0),
        start_date: startDate,
        end_date: endDate,
        usage_limit: usageLimit,
        times_used: timesUsed,
        is_active: Number(row.is_active ?? 1),
        created_at: row.created_at,
        updated_at: row.updated_at,
        type: discountType,
        value: discountValue,
        category: row.applies_to_category || "all",
        startDate,
        endDate,
        usageLimit,
    };
};

const validatePromoPayload = (promo) => {
    if (!promo.code) return "Promo code is required.";
    if (!(promo.discount_value > 0)) return "Discount value must be greater than 0.";
    if (promo.discount_type === "percent" && promo.discount_value > 100) {
        return "Percent discount cannot be greater than 100.";
    }
    if (promo.start_date && promo.end_date && new Date(promo.end_date) < new Date(promo.start_date)) {
        return "End date must not be before start date.";
    }
    return null;
};

const promoSelectSql = `
  SELECT
    p.promo_id,
    p.promo_id AS id,
    p.name,
    p.code,
    p.description,
    p.discount_type,
    p.discount_value,
    p.applies_to_category,
    p.min_subtotal,
    p.start_date,
    p.end_date,
    p.usage_limit,
    p.times_used,
    p.is_active,
    p.created_at,
    p.updated_at,
    GROUP_CONCAT(DISTINCT pi.inventory_item_id ORDER BY pi.inventory_item_id SEPARATOR ',') AS promo_item_ids
  FROM promos p
  LEFT JOIN promo_items pi ON pi.promo_id = p.promo_id
`;

const loadPromos = async (whereClause = "", params = [], orderClause = "ORDER BY p.created_at DESC") => {
    const [rows] = await db.query(
        `${promoSelectSql} ${whereClause} GROUP BY p.promo_id ${orderClause}`,
        params
    );
    return rows;
};

const savePromoItems = async (connection, promoId, itemIds) => {
    await connection.query("DELETE FROM promo_items WHERE promo_id = ?", [promoId]);

    if (!itemIds.length) return;

    const values = itemIds
        .map((itemId) => Number(itemId))
        .filter((itemId) => Number.isInteger(itemId) && itemId > 0)
        .map((itemId) => [promoId, itemId]);

    if (!values.length) return;

    await connection.query("INSERT INTO promo_items (promo_id, inventory_item_id) VALUES ?", [values]);
};

const buildPromoValidationFailure = (message) => ({
    success: false,
    valid: false,
    message,
});

export const getPromos = async (req, res) => {
    const rows = await loadPromos();
    res.json(rows.map(mapPromoRow));
};

export const createPromo = async (req, res) => {
    const promo = normalizePromoPayload(req.body);
    const validationError = validatePromoPayload(promo);

    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO promos
        (name, code, description, discount_type, discount_value, applies_to_category, min_subtotal, start_date, end_date, usage_limit, times_used, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                promo.name || promo.code,
                promo.code,
                promo.description,
                promo.discount_type,
                promo.discount_value,
                promo.applies_to_category,
                promo.min_subtotal,
                promo.start_date,
                promo.end_date,
                promo.usage_limit,
                promo.times_used,
                promo.is_active,
            ]
        );

        await savePromoItems(connection, result.insertId, promo.item_ids);
        await connection.commit();

        return res.json({ success: true, id: result.insertId, promo_id: result.insertId });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const updatePromo = async (req, res) => {
    const promo = normalizePromoPayload(req.body);
    const validationError = validatePromoPayload(promo);

    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    const promoId = Number(req.params.id || promo.promo_id);
    if (!Number.isFinite(promoId) || promoId <= 0) {
        return res.status(400).json({ error: "A valid promo id is required." });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        await connection.query(
            `UPDATE promos
          SET name = ?, code = ?, description = ?, discount_type = ?, discount_value = ?, applies_to_category = ?, min_subtotal = ?, start_date = ?, end_date = ?, usage_limit = ?, is_active = ?
        WHERE promo_id = ?`,
            [
                promo.name || promo.code,
                promo.code,
                promo.description,
                promo.discount_type,
                promo.discount_value,
                promo.applies_to_category,
                promo.min_subtotal,
                promo.start_date,
                promo.end_date,
                promo.usage_limit,
                promo.is_active,
                promoId,
            ]
        );

        await savePromoItems(connection, promoId, promo.item_ids);
        await connection.commit();

        return res.json({ success: true });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const deletePromo = async (req, res) => {
    await db.query("DELETE FROM promos WHERE promo_id = ?", [req.params.id]);
    res.json({ success: true });
};

export const validatePromo = async (req, res) => {
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!code) {
      return res.status(400).json(buildPromoValidationFailure("Promo code is required."));
    }

    if (!items.length) {
      return res.status(400).json(buildPromoValidationFailure("Please select an item before applying promo."));
    }

    const rows = await loadPromos("WHERE UPPER(p.code) = ?", [code], "LIMIT 1");

    if (!rows.length) {
      return res.json(buildPromoValidationFailure("Promo code not found."));
    }

    const promo = mapPromoRow(rows[0]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!promo.is_active) {
      return res.json(buildPromoValidationFailure("This promo code is inactive."));
    }

    if (promo.start_date) {
      const start = new Date(`${promo.start_date}T00:00:00`);
      if (today < start) {
        return res.json(buildPromoValidationFailure("This promo code is not yet valid."));
      }
    }

    if (promo.end_date) {
      const end = new Date(`${promo.end_date}T23:59:59`);
      if (today > end) {
        return res.json(buildPromoValidationFailure("This promo code has expired."));
      }
    }

    if (
      promo.usage_limit !== null &&
      Number(promo.times_used || 0) >= Number(promo.usage_limit)
    ) {
      return res.json(buildPromoValidationFailure("This promo code has reached its usage limit."));
    }

    const scope = String(promo.applies_to_category || promo.category || "all").toLowerCase();

    const promoItemIds = Array.isArray(promo.item_ids)
      ? promo.item_ids.map(String)
      : normalizeItemIds(promo.item_ids);

    const eligibleSubtotal = items.reduce((sum, item) => {
      const itemId = String(item.item_id || item.id || "").trim();
      const category = String(item.category || "").trim().toLowerCase();
      const lineTotal = Number(item.line_total || 0);

      let eligible = false;

      if (scope === "all") eligible = true;
      if (scope === "rooms" && category === "rooms") eligible = true;
      if (scope === "cottages" && category === "cottages") eligible = true;
      if (scope === "events" && category === "events") eligible = true;
      if (scope === "food" && category === "food") eligible = true;
      if (scope === "swimming" && category === "swimming") eligible = true;

      if (promoItemIds.length && promoItemIds.includes(itemId)) {
        eligible = true;
      }

      return eligible ? sum + lineTotal : sum;
    }, 0);

    if (eligibleSubtotal <= 0) {
      return res.json(buildPromoValidationFailure(
        "This promo code does not apply to the selected item."
      ));
    }

    const minSubtotal = Number(promo.min_subtotal || 0);

    if (minSubtotal > 0 && eligibleSubtotal < minSubtotal) {
      return res.json(buildPromoValidationFailure(
        `A minimum eligible subtotal of ₱${minSubtotal.toLocaleString()} is required for this promo.`
      ));
    }

    const discountType = String(promo.discount_type || promo.type || "percent").toLowerCase();
    const discountValue = Number(promo.discount_value ?? promo.value ?? 0);

    let discount = 0;

    if (discountType === "percent") {
      discount = eligibleSubtotal * (discountValue / 100);
    } else {
      discount = discountValue;
    }

    discount = Math.min(discount, eligibleSubtotal);

    return res.json({
      success: true,
      valid: true,
      eligibleSubtotal,
      discount,
      promo: {
        promo_id: promo.promo_id,
        id: promo.id,
        name: promo.name,
        code: promo.code,
        description: promo.description,
        discount_type: discountType,
        discount_value: discountValue,
        type: discountType,
        value: discountValue,
        applies_to_category: scope,
        category: scope,
        item_ids: promo.item_ids,
        min_subtotal: promo.min_subtotal,
        usage_limit: promo.usage_limit,
        times_used: promo.times_used,
        is_active: promo.is_active,
        start_date: promo.start_date,
        end_date: promo.end_date
      }
    });
  } catch (error) {
    console.error("Validate promo error:", error);
    return res.status(500).json({
      success: false,
      valid: false,
      message: "Failed to validate promo.",
      error: error.message
    });
  }
};