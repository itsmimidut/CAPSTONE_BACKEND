-- ============================================================
-- Reservision Feedback System
-- Defensive rollback migration
-- Target: MariaDB 10.4.32 / eduardos
-- ============================================================

USE `eduardos`;

DROP TABLE IF EXISTS `booking_feedback`;

SET @feedback_event_index_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'customer_notifications'
      AND index_name = 'uq_customer_notifications_event_key'
);

SET @drop_feedback_event_index_sql = IF(
    @feedback_event_index_exists > 0,
    'DROP INDEX `uq_customer_notifications_event_key` ON `customer_notifications`',
    'SELECT 1'
);

PREPARE drop_feedback_event_index_statement
    FROM @drop_feedback_event_index_sql;
EXECUTE drop_feedback_event_index_statement;
DEALLOCATE PREPARE drop_feedback_event_index_statement;

SET @feedback_event_column_exists = (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'customer_notifications'
      AND column_name = 'event_key'
);

SET @drop_feedback_event_column_sql = IF(
    @feedback_event_column_exists > 0,
    'ALTER TABLE `customer_notifications` DROP COLUMN `event_key`',
    'SELECT 1'
);

PREPARE drop_feedback_event_column_statement
    FROM @drop_feedback_event_column_sql;
EXECUTE drop_feedback_event_column_statement;
DEALLOCATE PREPARE drop_feedback_event_column_statement;
