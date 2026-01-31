-- Create inventory_items table (for rooms and cottages)
CREATE TABLE IF NOT EXISTS inventory_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  category_type VARCHAR(100),
  room_number VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  description LONGTEXT,
  max_guests INT,
  price DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'Available',
  promo VARCHAR(100),
  images LONGTEXT,
  primaryImageIndex INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create promos table
CREATE TABLE IF NOT EXISTS promos (
  promo_id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  type VARCHAR(20),
  value DECIMAL(10, 2),
  description LONGTEXT,
  startDate DATE,
  endDate DATE,
  usageLimit INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_endDate (endDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create seasonal_pricing table
CREATE TABLE IF NOT EXISTS seasonal_pricing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  multiplier DECIMAL(5, 2),
  startDate DATE,
  endDate DATE,
  applyTo VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dates (startDate, endDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create rate_entries table (for entrance, cottages, packages)
CREATE TABLE IF NOT EXISTS rate_entries (
  rate_id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  label VARCHAR(255) NOT NULL,
  value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create rate_cards table (for function hall and other single-card sections)
CREATE TABLE IF NOT EXISTS rate_cards (
  card_id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  price VARCHAR(255),
  capacity VARCHAR(255),
  features LONGTEXT,
  note LONGTEXT,
  icon VARCHAR(100),
  cta_text VARCHAR(100),
  cta_link VARCHAR(255),
  cta_icon VARCHAR(100),
  image LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample rooms
INSERT INTO inventory_items (category, category_type, room_number, name, description, max_guests, price, status, images, primaryImageIndex) VALUES
('Room', 'Deluxe', 'R101', 'Deluxe Ocean View', 'Luxurious room with stunning ocean views, king bed, AC, and mini bar', 2, 3500, 'Available', '["https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=500"]', 0),
('Cottage', 'Family', 'C201', 'Family Cottage', 'Spacious cottage perfect for families with 2 bedrooms, kitchen, living room, and private garden', 6, 5500, 'Available', '["https://images.unsplash.com/photo-1602343168117-bb8ffe3e2e9f?w=500"]', 0),
('Room', 'Standard', 'R102', 'Standard Room', 'Comfortable standard room with queen bed, AC, and WiFi', 2, 2000, 'Occupied', '["https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=500"]', 0),
('Cottage', 'Villa', 'C202', 'Beach Front Villa', 'Premium villa with direct beach access, private pool, BBQ area, and 2 bathrooms', 4, 7500, 'Available', '["https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=500"]', 0),
('Room', 'Suite', 'R103', 'Garden Suite', 'Suite with beautiful garden view, king bed, sofa bed, and balcony', 3, 4000, 'Available', '["https://images.unsplash.com/photo-1590490360182-c33d57733427?w=500"]', 0),
('Cottage', 'Mountain', 'C203', 'Mountain View Cottage', 'Cottage with panoramic mountain views, fireplace, 2 bedrooms, and kitchen', 5, 6000, 'Under Maintenance', '["https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?w=500"]', 0);

-- Insert sample promos
INSERT INTO promos (code, type, value, description, startDate, endDate, usageLimit) VALUES
('SUMMER20', 'percentage', 20, 'Summer special - 20% off all rooms', '2024-06-01', '2024-08-31', 100),
('EARLY15', 'percentage', 15, 'Early bird discount - 15% off', '2024-01-01', '2024-12-31', 50),
('FLAT500', 'fixed', 500, 'Get flat ₱500 discount on any booking', '2024-01-01', '2024-12-31', NULL);

-- Insert sample seasonal pricing
INSERT INTO seasonal_pricing (name, multiplier, startDate, endDate, applyTo) VALUES
('Peak Season', 1.5, '2024-06-01', '2024-08-31', 'all'),
('Off Season', 0.8, '2024-09-01', '2024-05-31', 'all'),
('Holiday Season', 1.8, '2024-12-15', '2024-12-31', 'all');

-- Insert sample rate entries
INSERT INTO rate_entries (category, label, value) VALUES
('entrance', 'Adult / Teen / Child', '₱200 per head'),
('entrance', 'Senior / PWD', '₱160 per head'),
('entrance', 'Infant (≤11 mos)', 'FREE'),
('cottages', 'Front / Fountain / Top View', '₱500'),
('cottages', 'Poolside', '₱1,000'),
('cottages', 'Videoke AC', '₱1,500'),
('packages', 'Day Tour', '₱350 / person'),
('packages', 'Overnight', '₱2,000 / room');

-- Insert sample function hall card
INSERT INTO rate_cards (category, title, price, capacity, features, note, icon, cta_text, cta_link, cta_icon) VALUES
('function', 'Function Hall', '₱25,000 / 6 hrs', 'Up to 70 pax',
 '["Air-conditioned + basic setup","Sound system + 2 mics","Pool access included","Extra hr: ₱1,000 | Extra pax: ₱200"]',
 NULL,
 'fas fa-building',
 'Inquire Now',
 '/contact',
 'fas fa-envelope');

-- ============================================================
-- SWIMMING ENROLLMENT SYSTEM TABLES
-- ============================================================

-- Create swimming_enrollments table
CREATE TABLE IF NOT EXISTS swimming_enrollments (
  enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Personal Information
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  
  -- Personal Details
  sex ENUM('Male', 'Female', 'Other') DEFAULT 'Male',
  weight VARCHAR(50),
  height VARCHAR(50),
  preferred_coach VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  home_phone VARCHAR(20),
  mobile_phone VARCHAR(20),
  email VARCHAR(255) NOT NULL,
  
  -- Parent/Guardian Information
  father_name VARCHAR(100),
  father_occupation VARCHAR(100),
  father_phone VARCHAR(20),
  mother_name VARCHAR(100),
  mother_occupation VARCHAR(100),
  mother_phone VARCHAR(20),
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  emergency_contact_relationship VARCHAR(50),
  
  -- Medical Information
  medical_conditions TEXT,
  allergies TEXT,
  medications TEXT,
  physician_name VARCHAR(100),
  physician_phone VARCHAR(20),
  
  -- Swimming Details
  lesson_type ENUM('Group Lessons', 'Private Lessons') NOT NULL,
  skill_level ENUM('Beginner', 'Intermediate', 'Advanced') DEFAULT 'Beginner',
  previous_experience TEXT,
  swimming_goals TEXT,
  
  -- Schedule Preferences
  preferred_days TEXT,
  preferred_time TEXT,
  start_date DATE,
  
  -- Additional Information
  how_did_you_hear VARCHAR(255),
  special_requests TEXT,
  
  -- Agreement & Status
  agreed_to_terms BOOLEAN DEFAULT FALSE,
  agreed_to_waiver BOOLEAN DEFAULT FALSE,
  enrollment_status ENUM('Pending', 'Approved', 'Rejected', 'Completed') DEFAULT 'Pending',
  payment_status ENUM('Pending', 'Paid', 'Partially Paid') DEFAULT 'Pending',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes for better performance
  INDEX idx_email (email),
  INDEX idx_status (enrollment_status),
  INDEX idx_lesson_type (lesson_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create swimming_coaches table
CREATE TABLE IF NOT EXISTS swimming_coaches (
  coach_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  specialization VARCHAR(255),
  experience_years INT,
  certification TEXT,
  bio TEXT,
  profile_image LONGTEXT,
  availability TEXT,
  max_students INT DEFAULT 10,
  current_students INT DEFAULT 0,
  status ENUM('Active', 'Inactive', 'On Leave') DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert sample coaches
INSERT INTO swimming_coaches (name, specialization, experience_years, certification, bio, availability, max_students) VALUES
('Coach Maria Santos', 'Beginner & Kids Training', 8, 'PSIA Level 3, First Aid & CPR Certified', 'Experienced swimming instructor specializing in teaching children and beginners. Patient and encouraging teaching style.', 'Monday-Friday: 8AM-5PM, Saturday: 8AM-12PM', 15),
('Coach Juan Dela Cruz', 'Advanced Training & Competitive Swimming', 12, 'PSIA Level 4, Olympic Training Certified', 'Former competitive swimmer with 12 years of coaching experience. Specializes in stroke refinement and competitive training.', 'Monday-Saturday: 6AM-2PM', 10),
('Coach Sarah Reyes', 'Private Lessons & Adult Swimming', 6, 'PSIA Level 3, Aqua Aerobics Certified', 'Specializes in one-on-one coaching and helping adults overcome their fear of water. Gentle and supportive approach.', 'Tuesday-Sunday: 10AM-6PM', 12);
