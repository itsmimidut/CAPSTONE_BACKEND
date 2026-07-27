-- Swimming batch session scheduling upgrade
-- Run once against the reservision database.

-- 1) Extend swimming_batches with schedule configuration
ALTER TABLE swimming_batches
  ADD COLUMN IF NOT EXISTS schedule_type ENUM('DAILY', 'SELECTED_DAYS', 'FLEXIBLE') NOT NULL DEFAULT 'DAILY' AFTER lesson_type,
  ADD COLUMN IF NOT EXISTS max_sessions INT NULL AFTER schedule_type,
  ADD COLUMN IF NOT EXISTS generated_sessions INT NOT NULL DEFAULT 0 AFTER max_sessions;

-- MySQL < 8.0 does not support IF NOT EXISTS on ADD COLUMN.
-- If the statement above fails, run these individually and ignore duplicate-column errors:
-- ALTER TABLE swimming_batches ADD COLUMN schedule_type ENUM('DAILY','SELECTED_DAYS','FLEXIBLE') NOT NULL DEFAULT 'DAILY' AFTER lesson_type;
-- ALTER TABLE swimming_batches ADD COLUMN max_sessions INT NULL AFTER schedule_type;
-- ALTER TABLE swimming_batches ADD COLUMN generated_sessions INT NOT NULL DEFAULT 0 AFTER max_sessions;

-- 2) Generated batch session calendar (available class dates)
CREATE TABLE IF NOT EXISTS swimming_batch_sessions (
  batch_session_id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  coach_id INT NULL,
  max_slots INT NOT NULL DEFAULT 10,
  booked_slots INT NOT NULL DEFAULT 0,
  status ENUM('Open', 'Full', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_batch_session_date (batch_id, session_date),
  KEY idx_batch_session_batch (batch_id),
  KEY idx_batch_session_date (session_date),
  CONSTRAINT fk_batch_sessions_batch
    FOREIGN KEY (batch_id) REFERENCES swimming_batches(batch_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
