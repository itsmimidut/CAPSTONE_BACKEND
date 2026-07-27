ALTER TABLE pos_transactions
    ADD COLUMN service_order_number INT NULL,
    ADD COLUMN service_order_date DATE NULL,
    ADD COLUMN order_type VARCHAR(30) NULL,
    ADD COLUMN station_id INT NULL,
    ADD COLUMN terminal_id VARCHAR(100) NULL,
    ADD COLUMN pickup_name VARCHAR(80) NULL,
    ADD COLUMN recipient_name VARCHAR(100) NULL,
    ADD UNIQUE INDEX uq_pos_service_order_per_station_day (
        service_order_date,
        station_id,
        service_order_number
    );

CREATE TABLE pos_order_number_counters (
    counter_date DATE NOT NULL,
    station_id INT NOT NULL,
    last_number INT NOT NULL DEFAULT 99,
    PRIMARY KEY (counter_date, station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pos_order_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    station_id INT NOT NULL,
    terminal_id VARCHAR(100) NOT NULL,
    order_type VARCHAR(30) NOT NULL,
    service_order_number INT NOT NULL,
    service_order_date DATE NOT NULL,
    location_type VARCHAR(50) NULL,
    location_number VARCHAR(50) NULL,
    pickup_name VARCHAR(80) NULL,
    recipient_name VARCHAR(100) NULL,
    delivery_notes VARCHAR(150) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    transaction_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    UNIQUE KEY uq_pos_order_session_number (
        service_order_date,
        station_id,
        service_order_number
    ),
    INDEX idx_pos_order_session_terminal (terminal_id, status),
    INDEX idx_pos_order_session_user (user_id, status),
    INDEX idx_pos_order_session_transaction (transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
