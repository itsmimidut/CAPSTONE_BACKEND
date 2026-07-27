/**
 * Shared inventory-item bookability checks used by every booking creation path.
 *
 * Only the exact available state is bookable. Comparison is case-insensitive and
 * trimmed so `Available`, `available`, `AVAILABLE`, and trailing whitespace
 * cannot diverge in behavior.
 */

export const BOOKABLE_INVENTORY_STATUS = 'available'

export const UNAVAILABLE_BOOKING_MESSAGE =
  'This accommodation is currently unavailable for booking.'

export function normalizeInventoryStatus(status) {
  return String(status ?? '').trim().toLowerCase()
}

export function isBookableInventoryStatus(status) {
  return normalizeInventoryStatus(status) === BOOKABLE_INVENTORY_STATUS
}

/**
 * Lock and validate every referenced inventory row on the same transaction
 * connection used for booking inserts.
 *
 * @returns {{ ok: true } | { ok: false, message: string, itemId: number|null }}
 */
export async function assertInventoryItemsBookable(connection, inventoryItemIds = []) {
  const uniqueIds = [...new Set(
    (Array.isArray(inventoryItemIds) ? inventoryItemIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )]

  for (const itemId of uniqueIds) {
    const [rows] = await connection.query(
      `SELECT item_id, name, status
       FROM inventory_items
       WHERE item_id = ?
       FOR UPDATE`,
      [itemId]
    )
    const inventoryItem = rows[0]

    if (!inventoryItem || !isBookableInventoryStatus(inventoryItem.status)) {
      return {
        ok: false,
        message: UNAVAILABLE_BOOKING_MESSAGE,
        itemId,
      }
    }
  }

  return { ok: true }
}
