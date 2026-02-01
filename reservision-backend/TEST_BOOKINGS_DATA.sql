-- ============================================================
-- QUICK TEST DATA FOR BOOKINGS SYSTEM
-- ============================================================
-- Run this after setting up the main tables
-- This adds sample data for testing
-- ============================================================

USE eduardos;

-- Insert sample booking 1
INSERT INTO bookings (
  booking_reference,
  first_name,
  last_name,
  email,
  phone,
  address,
  city,
  postal_code,
  check_in_date,
  check_out_date,
  nights,
  adults,
  children,
  special_requests,
  subtotal,
  total,
  booking_status,
  payment_status
) VALUES (
  'BK20260201001',
  'Juan',
  'Dela Cruz',
  'juan.delacruz@email.com',
  '+639171234567',
  '123 Main Street, Barangay 1',
  'Manila',
  '1000',
  '2026-02-15',
  '2026-02-17',
  2,
  2,
  1,
  'Late check-in requested',
  7000.00,
  7000.00,
  'Confirmed',
  'Paid'
);

-- Insert sample booking 2
INSERT INTO bookings (
  booking_reference,
  first_name,
  last_name,
  email,
  phone,
  address,
  city,
  postal_code,
  check_in_date,
  check_out_date,
  nights,
  adults,
  children,
  subtotal,
  total,
  booking_status,
  payment_status
) VALUES (
  'BK20260201002',
  'Maria',
  'Santos',
  'maria.santos@email.com',
  '+639187654321',
  '456 Beach Road',
  'Cebu',
  '6000',
  '2026-03-01',
  '2026-03-05',
  4,
  4,
  2,
  22000.00,
  22000.00,
  'Pending',
  'Unpaid'
);

-- Get the booking IDs for the sample bookings
SET @booking1_id = (SELECT booking_id FROM bookings WHERE booking_reference = 'BK20260201001');
SET @booking2_id = (SELECT booking_id FROM bookings WHERE booking_reference = 'BK20260201002');

-- Insert booking items for booking 1
INSERT INTO booking_items (
  booking_id,
  item_type,
  item_name,
  item_description,
  inventory_item_id,
  unit_price,
  quantity,
  nights,
  total_price,
  guests,
  per_night
) VALUES (
  @booking1_id,
  'Room',
  'Deluxe Ocean View',
  'Luxurious room with stunning ocean views',
  1,
  3500.00,
  1,
  2,
  7000.00,
  2,
  TRUE
);

-- Insert booking items for booking 2
INSERT INTO booking_items (
  booking_id,
  item_type,
  item_name,
  item_description,
  inventory_item_id,
  unit_price,
  quantity,
  nights,
  total_price,
  guests,
  per_night
) VALUES (
  @booking2_id,
  'Cottage',
  'Beach Front Villa',
  'Premium villa with direct beach access',
  4,
  5500.00,
  1,
  4,
  22000.00,
  4,
  TRUE
);

-- Insert occupied dates for booking 1
INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES
(1, @booking1_id, '2026-02-15'),
(1, @booking1_id, '2026-02-16'),
(1, @booking1_id, '2026-02-17');

-- Insert occupied dates for booking 2
INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES
(4, @booking2_id, '2026-03-01'),
(4, @booking2_id, '2026-03-02'),
(4, @booking2_id, '2026-03-03'),
(4, @booking2_id, '2026-03-04'),
(4, @booking2_id, '2026-03-05');

-- Insert booking logs
INSERT INTO booking_logs (booking_id, action, new_status, description, performed_by) VALUES
(@booking1_id, 'Created', 'Pending', 'Booking created by customer', 'System'),
(@booking1_id, 'Status Updated', 'Confirmed', 'Payment received and booking confirmed', 'Admin'),
(@booking2_id, 'Created', 'Pending', 'Booking created by customer', 'System');

-- Display results
SELECT 'Sample bookings created successfully!' AS Status;
SELECT * FROM bookings;
SELECT * FROM booking_items;
SELECT * FROM occupied_dates;
