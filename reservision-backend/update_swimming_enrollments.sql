-- Update swimming_enrollments table to make preferred_coach and lesson_type nullable since they're now derived from booking
ALTER TABLE swimming_enrollments MODIFY COLUMN preferred_coach varchar(100) DEFAULT NULL;
ALTER TABLE swimming_enrollments MODIFY COLUMN lesson_type enum('Group Lessons','Private Lessons') DEFAULT NULL;