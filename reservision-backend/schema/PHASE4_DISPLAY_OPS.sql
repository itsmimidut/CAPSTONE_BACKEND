-- Phase 4A-4C: Display Recovery, Active Sessions, Payment Timeline
-- Auto-created on server startup via ensureDisplaySessionSchema() / ensurePaymentTimelineSchema()

CREATE TABLE IF NOT EXISTS display_payment_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    receipt_no VARCHAR(50) NOT NULL,
    invoice_id VARCHAR(255) NULL,
    device_id VARCHAR(100) NOT NULL,
    station_id INT NULL,
    amount DECIMAL(10,2) NOT NULL,
    qr_code MEDIUMTEXT NULL,
    payment_url TEXT NULL,
    items_json TEXT NULL,
    status ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED') DEFAULT 'PENDING',
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME NULL,
    cleared_at DATETIME NULL,
    INDEX idx_dps_device (device_id),
    INDEX idx_dps_status (status),
    INDEX idx_dps_receipt (receipt_no),
    INDEX idx_dps_invoice (invoice_id),
    INDEX idx_dps_active (device_id, is_active, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_timelines (
    timeline_id INT AUTO_INCREMENT PRIMARY KEY,
    receipt_no VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pt_receipt (receipt_no),
    INDEX idx_pt_event (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
