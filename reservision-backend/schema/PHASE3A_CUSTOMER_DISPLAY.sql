-- Phase 3A: Customer Display System
-- Tables are also auto-created on server startup via ensureCustomerDisplaySchema()

CREATE TABLE IF NOT EXISTS customer_display_devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL UNIQUE,
    device_name VARCHAR(255) NOT NULL,
    station_name VARCHAR(100) NULL,
    pair_code VARCHAR(50) NULL,
    pair_code_expires DATETIME NULL,
    pair_token VARCHAR(255) NULL,
    status ENUM('ONLINE', 'OFFLINE', 'PAIRING') DEFAULT 'OFFLINE',
    last_seen DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cdd_pair_code (pair_code),
    INDEX idx_cdd_status (status),
    INDEX idx_cdd_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_display_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(100) NOT NULL,
    receipt_no VARCHAR(50) NULL,
    invoice_id VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cds_device_id (device_id),
    INDEX idx_cds_invoice_id (invoice_id),
    INDEX idx_cds_receipt_no (receipt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
