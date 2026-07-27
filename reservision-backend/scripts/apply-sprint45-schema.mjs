import db from '../config/db.js';

const columns = [
  { name: 'processing_status', definition: "VARCHAR(20) DEFAULT 'PENDING'" },
  { name: 'error_message', definition: 'TEXT NULL' },
];

for (const column of columns) {
  try {
    await db.query(`ALTER TABLE webhook_events ADD COLUMN ${column.name} ${column.definition}`);
    console.log(`Added ${column.name}`);
  } catch (error) {
    if (String(error.message).includes('Duplicate column')) {
      console.log(`Column ${column.name} already exists`);
    } else {
      throw error;
    }
  }
}

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

try {
  await db.query(`UPDATE refunds SET refund_status = 'Completed' WHERE refund_status = 'Refunded'`);
  await db.query(`UPDATE refunds SET refund_status = 'Processing' WHERE refund_status = 'Approved'`);
  await db.query(`ALTER TABLE refunds MODIFY refund_status VARCHAR(50) DEFAULT 'Pending'`);
  console.log('Migrated refunds.refund_status');
} catch (error) {
  console.log('Refund migration:', error.message);
}

console.log('Sprint 4.5 schema applied.');
process.exit(0);
