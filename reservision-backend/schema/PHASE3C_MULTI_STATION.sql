-- Phase 3C: Multi-Station Customer Display Routing
-- Tables/columns are also auto-created on server startup via ensureStationRoutingSchema()

CREATE TABLE IF NOT EXISTS pos_stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    station_code VARCHAR(50) UNIQUE,
    station_name VARCHAR(100) NOT NULL,
    location VARCHAR(255) NULL,
    active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pos_stations_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_terminal_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    terminal_id VARCHAR(100) UNIQUE,
    station_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pts_station_id (station_id),
    CONSTRAINT fk_terminal_station
        FOREIGN KEY (station_id) REFERENCES pos_stations(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- station_id added via ensureStationRoutingSchema() for existing installs
-- ALTER TABLE customer_display_devices ADD COLUMN station_id INT NULL;
