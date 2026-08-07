import 'dotenv/config';
import db from '../config/db.js';
import { getPublicFeedback } from '../services/eshopFeedbackService.js';

async function main() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [lines] = await connection.query(`
      SELECT pti.line_id, pti.product_name_snapshot, pti.menu_id
      FROM pos_transaction_items pti
      WHERE pti.menu_id IS NULL
        AND pti.product_name_snapshot IS NOT NULL
        AND TRIM(pti.product_name_snapshot) <> ''
    `);

    let lineUpdated = 0;
    for (const line of lines) {
      const [matches] = await connection.query(
        'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 2',
        [line.product_name_snapshot],
      );
      if (matches.length !== 1) continue;
      const menuId = matches[0].menu_id;
      await connection.query(
        'UPDATE pos_transaction_items SET menu_id = ? WHERE line_id = ? AND menu_id IS NULL',
        [menuId, line.line_id],
      );
      lineUpdated += 1;
    }

    const [feedbackRows] = await connection.query(`
      SELECT feedback_id, product_name_snapshot
      FROM eshop_item_feedback
      WHERE menu_id IS NULL
        AND product_name_snapshot IS NOT NULL
        AND TRIM(product_name_snapshot) <> ''
    `);

    let feedbackUpdated = 0;
    for (const row of feedbackRows) {
      const [matches] = await connection.query(
        'SELECT menu_id FROM menu_items WHERE name = ? LIMIT 2',
        [row.product_name_snapshot],
      );
      if (matches.length !== 1) continue;
      await connection.query(
        'UPDATE eshop_item_feedback SET menu_id = ? WHERE feedback_id = ? AND menu_id IS NULL',
        [matches[0].menu_id, row.feedback_id],
      );
      feedbackUpdated += 1;
    }

    await connection.commit();
    console.log({ lineUpdated, feedbackUpdated });

    const publicResult = await getPublicFeedback({
      menuItemId: 41,
      page: 1,
      limit: 5,
      rating: '',
      sort: 'newest',
    });
    console.log('Americano public summary:', publicResult.summary);
    console.log('Americano reviews:', publicResult.reviews.map((r) => ({
      feedbackId: r.feedbackId,
      rating: r.overallRating,
      comment: r.comment?.slice(0, 40),
    })));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
