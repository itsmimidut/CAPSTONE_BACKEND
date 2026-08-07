-- Phase C: verified-purchase E-Shop item feedback.
-- Safe to rerun; does not modify booking_feedback.

CREATE TABLE IF NOT EXISTS eshop_item_feedback (
    feedback_id INT(11) NOT NULL AUTO_INCREMENT,
    transaction_id INT(11) NOT NULL,
    transaction_item_id INT(11) NOT NULL,
    menu_id INT(11) NULL,
    customer_id INT(11) NOT NULL,
    product_name_snapshot VARCHAR(255) NOT NULL,

    overall_rating TINYINT NOT NULL,
    title VARCHAR(150) NULL,
    comment TEXT NOT NULL,
    is_anonymous TINYINT(1) NOT NULL DEFAULT 0,

    moderation_status ENUM('pending', 'approved', 'rejected', 'hidden')
        NOT NULL DEFAULT 'pending',
    rejection_reason VARCHAR(500) NULL,
    moderated_by INT(11) NULL,
    moderated_at DATETIME NULL,

    admin_reply TEXT NULL,
    reply_version INT UNSIGNED NOT NULL DEFAULT 0,
    replied_by INT(11) NULL,
    replied_at DATETIME NULL,

    deleted_at DATETIME NULL,
    deleted_by INT(11) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (feedback_id),
    UNIQUE KEY uq_eshop_item_feedback_line (transaction_item_id),
    INDEX idx_eshop_feedback_customer_history (customer_id, created_at),
    INDEX idx_eshop_feedback_transaction (transaction_id),
    INDEX idx_eshop_feedback_menu (menu_id),
    INDEX idx_eshop_feedback_moderation (moderation_status, deleted_at, created_at),

    CONSTRAINT chk_eshop_feedback_rating CHECK (overall_rating BETWEEN 1 AND 5),
    CONSTRAINT chk_eshop_feedback_anonymous CHECK (is_anonymous IN (0, 1)),
    CONSTRAINT chk_eshop_feedback_reply_version CHECK (reply_version >= 0),

    CONSTRAINT fk_eshop_feedback_transaction
        FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_eshop_feedback_transaction_item
        FOREIGN KEY (transaction_item_id) REFERENCES pos_transaction_items(line_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_eshop_feedback_menu
        FOREIGN KEY (menu_id) REFERENCES menu_items(menu_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_eshop_feedback_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_eshop_feedback_moderated_by
        FOREIGN KEY (moderated_by) REFERENCES user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_eshop_feedback_replied_by
        FOREIGN KEY (replied_by) REFERENCES user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_eshop_feedback_deleted_by
        FOREIGN KEY (deleted_by) REFERENCES user(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
