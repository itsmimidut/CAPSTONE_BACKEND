-- ============================================================
-- Reservision Feedback System
-- Forward migration
-- Target: MariaDB 10.4.32 / eduardos
-- ============================================================

USE `eduardos`;

CREATE TABLE IF NOT EXISTS `booking_feedback` (
    `feedback_id` INT(11) NOT NULL AUTO_INCREMENT,
    `booking_id` INT(11) NOT NULL,
    `customer_id` INT(11) NOT NULL,

    `overall_rating` TINYINT NOT NULL,
    `title` VARCHAR(150) NULL,
    `comment` TEXT NOT NULL,
    `is_anonymous` TINYINT(1) NOT NULL DEFAULT 0,

    `moderation_status` ENUM(
        'pending',
        'approved',
        'rejected',
        'hidden'
    ) NOT NULL DEFAULT 'pending',
    `rejection_reason` VARCHAR(500) NULL,
    `moderated_by` INT(11) NULL,
    `moderated_at` DATETIME NULL,

    `admin_reply` TEXT NULL,
    `reply_version` INT UNSIGNED NOT NULL DEFAULT 0,
    `replied_by` INT(11) NULL,
    `replied_at` DATETIME NULL,

    `deleted_at` DATETIME NULL,
    `deleted_by` INT(11) NULL,

    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`feedback_id`),
    UNIQUE KEY `uq_booking_feedback_booking` (`booking_id`),

    CONSTRAINT `chk_booking_feedback_rating`
        CHECK (`overall_rating` BETWEEN 1 AND 5),
    CONSTRAINT `chk_booking_feedback_anonymous`
        CHECK (`is_anonymous` IN (0, 1)),
    CONSTRAINT `chk_booking_feedback_reply_version`
        CHECK (`reply_version` >= 0),

    CONSTRAINT `fk_booking_feedback_booking`
        FOREIGN KEY (`booking_id`)
        REFERENCES `bookings` (`booking_id`)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT `fk_booking_feedback_customer`
        FOREIGN KEY (`customer_id`)
        REFERENCES `customers` (`customer_id`)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT `fk_booking_feedback_moderated_by`
        FOREIGN KEY (`moderated_by`)
        REFERENCES `user` (`user_id`)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT `fk_booking_feedback_replied_by`
        FOREIGN KEY (`replied_by`)
        REFERENCES `user` (`user_id`)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT `fk_booking_feedback_deleted_by`
        FOREIGN KEY (`deleted_by`)
        REFERENCES `user` (`user_id`)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

    INDEX `idx_booking_feedback_customer_history`
        (`customer_id`, `created_at`),
    INDEX `idx_booking_feedback_moderation_queue`
        (`moderation_status`, `deleted_at`, `created_at`),
    INDEX `idx_booking_feedback_public`
        (`moderation_status`, `deleted_at`, `overall_rating`, `created_at`),
    INDEX `idx_booking_feedback_moderator` (`moderated_by`),
    INDEX `idx_booking_feedback_replier` (`replied_by`),
    INDEX `idx_booking_feedback_deleter` (`deleted_by`)
)
ENGINE = InnoDB
DEFAULT CHARACTER SET = utf8mb4
COLLATE = utf8mb4_unicode_ci;

-- Nullable unique keys allow multiple NULL values while preventing duplicate
-- non-null event keys.
ALTER TABLE `customer_notifications`
    ADD COLUMN IF NOT EXISTS `event_key` VARCHAR(190) NULL
    AFTER `type`;

CREATE UNIQUE INDEX IF NOT EXISTS `uq_customer_notifications_event_key`
    ON `customer_notifications` (`event_key`);
