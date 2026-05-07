import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const profileUploadDir = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
if (!fs.existsSync(profileUploadDir)) {
  fs.mkdirSync(profileUploadDir, { recursive: true });
}

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, profileUploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  }
});

export const profileImageUpload = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}`));
  }
});

/**
 * Returns the configured JWT secret.
 * Throws immediately if the env var is missing or still set to a known
 * insecure placeholder — this prevents accidentally signing tokens with a
 * public, guessable value in production.
 */
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  const INSECURE_PLACEHOLDERS = [
    'your-secret-key',
    'your-jwt-secret-here',
    'change-this',
    'changeme',
    'secret',
  ];
  if (!secret || INSECURE_PLACEHOLDERS.some(p => secret.toLowerCase().includes(p))) {
    throw new Error(
      'JWT_SECRET is not configured or is using an insecure placeholder. ' +
      'Set a strong random value in your .env file.'
    );
  }
  return secret;
};

const AUTH_MIGRATION_FILE = 'ADD_AUTH_IMPROVEMENTS.sql';

const isMissingAuthSchemaColumn = (error) => {
  if (error?.code !== 'ER_BAD_FIELD_ERROR' && error?.code !== 'ER_NO_SUCH_TABLE') {
    return false;
  }
  const sqlMessage = (error?.sqlMessage || '').toLowerCase();
  return (
    sqlMessage.includes('google_sub') ||
    sqlMessage.includes('auth_provider') ||
    sqlMessage.includes('last_login_at') ||
    sqlMessage.includes("table 'eduardos.user' doesn't exist")
  );
};

/**
 * Customer Signup
 * POST /api/customers/signup
 */
export const customerSignup = async (req, res) => {
  try {
    const { firstName, lastName, email, password, contactNumber } = req.body;
    // Normalize email: trim whitespace and force lowercase so lookups are consistent
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedPhone = (contactNumber || '').trim();

    // Validate required fields
    if (!firstName || !lastName || !normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: firstName, lastName, email, password'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Validate password strength (min 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Check if email already exists in user table
    const [existingUsers] = await db.query(
      'SELECT user_id FROM user WHERE email = ? LIMIT 1',
      [normalizedEmail]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Start transaction to create both user and customer records
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Insert into user table (authentication + basic info)
      const [userResult] = await connection.query(
        `INSERT INTO user (first_name, last_name, email, phone, password, role, auth_provider, created_at) 
         VALUES (?, ?, ?, ?, ?, 'customer', 'local', NOW())`,
        [firstName, lastName, normalizedEmail, normalizedPhone, hashedPassword]
      );

      const userId = userResult.insertId;

      // Insert into customers table (only link via user_id, profile data empty initially)
      await connection.query(
        `INSERT INTO customers (user_id, created_at) 
         VALUES (?, NOW())`,
        [userId]
      );

      await connection.commit();
      connection.release();

      // Generate JWT token — getJwtSecret() throws if JWT_SECRET is misconfigured
      const token = jwt.sign(
        {
          id: userId,
          email: normalizedEmail,
          role: 'customer',
          name: `${firstName} ${lastName}`
        },
        getJwtSecret(),
        { expiresIn: '7d' }
      );

      // Log signup success
      console.log(`✅ Customer signup successful: ${normalizedEmail} (User ID: ${userId})`);

      res.status(201).json({
        success: true,
        token,
        customer: {
          id: userId,
          firstName,
          lastName,
          email: normalizedEmail,
          phone: normalizedPhone,
          role: 'customer'
        },
        message: 'Account created successfully'
      });

    } catch (transactionError) {
      await connection.rollback();
      connection.release();
      throw transactionError;
    }

  } catch (error) {
    console.error('❌ Signup error:', error);
    if (isMissingAuthSchemaColumn(error)) {
      return res.status(503).json({
        success: false,
        error: `Database auth schema is outdated. Run ${AUTH_MIGRATION_FILE} and restart backend.`
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to register customer. Please try again later.'
    });
  }
};

/**
 * Customer Login
 * POST /api/customers/login
 */
export const customerLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    // Normalize email so it matches the stored (lowercase) value
    const normalizedEmail = (email || '').trim().toLowerCase();

    // Validate required fields
    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find user by email (all roles can login through this endpoint)
    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.password, u.role
         FROM user u
         WHERE u.email = ? AND u.role IN ('customer', 'admin', 'restaurantstaff', 'receptionist', 'swimming_instructor')
         LIMIT 1`,
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const customer = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, customer.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Generate JWT token — getJwtSecret() throws if JWT_SECRET is misconfigured
    const token = jwt.sign(
      {
        id: customer.user_id,
        email: customer.email,
        role: customer.role,
        name: `${customer.first_name} ${customer.last_name}`
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    // Update last_login_at — DO NOT update created_at (that would destroy the
    // account creation timestamp). The last_login_at column is added via
    // ADD_AUTH_IMPROVEMENTS.sql migration.
    await db.query(
      'UPDATE user SET last_login_at = NOW() WHERE user_id = ?',
      [customer.user_id]
    );

    // Log successful login
    console.log(`✅ Customer login successful: ${normalizedEmail} (ID: ${customer.user_id})`);

    res.json({
      success: true,
      token,
      customer: {
        id: customer.user_id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        role: customer.role,
        coach_id: customer.coach_id || null
      },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    if (isMissingAuthSchemaColumn(error)) {
      return res.status(503).json({
        success: false,
        error: `Database auth schema is outdated. Run ${AUTH_MIGRATION_FILE} and restart backend.`
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to login. Please try again later.'
    });
  }
};

/**
 * Customer Google Login
 * POST /api/customers/google-login
 */
export const customerGoogleLogin = async (req, res) => {
  try {
    const { credential } = req.body || {};

    if (!credential) {
      return res.status(400).json({
        success: false,
        error: 'Google credential is required'
      });
    }

    // Verify Google ID token via Google tokeninfo endpoint.
    // Verify token via Google's tokeninfo endpoint.
    // NOTE: tokeninfo is simple but makes a network round-trip to Google on every
    // login. For higher throughput, swap this for google-auth-library's
    // OAuth2Client.verifyIdToken() which validates the signature locally.
    const verifyResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );

    if (!verifyResponse.ok) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google credential'
      });
    }

    const googleUser = await verifyResponse.json();
    const {
      aud,
      sub: googleSub,   // Google's stable unique user ID — never changes even if email changes
      email,
      email_verified: emailVerified,
      given_name: givenName,
      family_name: familyName,
      name
    } = googleUser;

    // MANDATORY audience check — always enforce this.
    // Accepting tokens from any Google OAuth client (when GOOGLE_CLIENT_ID is
    // unset) allows an attacker to present a token from their own app.
    const EXPECTED_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    if (!EXPECTED_CLIENT_ID) {
      console.error('❌ GOOGLE_CLIENT_ID is not set in environment variables.');
      return res.status(500).json({
        success: false,
        error: 'Google Sign-In is not configured on this server.'
      });
    }
    if (aud !== EXPECTED_CLIENT_ID) {
      console.warn(`⚠️ Google token audience mismatch: got '${aud}', expected '${EXPECTED_CLIENT_ID}'`);
      return res.status(401).json({
        success: false,
        error: 'Google token audience mismatch. Please use the correct Sign-In method.'
      });
    }

    if (!email || emailVerified !== 'true') {
      return res.status(401).json({
        success: false,
        error: 'Google account email is not verified'
      });
    }

    // Normalize the email from Google to lowercase so DB lookups are consistent
    const normalizedEmail = email.trim().toLowerCase();

    // Step 1: Look up by Google's stable user ID (google_sub) first.
    // This is safer than email-only lookup because google_sub never changes,
    // even if the user changes their Gmail address.
    const [bySubResults] = await db.query(
      `SELECT user_id, first_name, last_name, email, phone, role
       FROM user
       WHERE google_sub = ?
       LIMIT 1`,
      [googleSub]
    );

    let userRecord;

    if (bySubResults.length > 0) {
      // Best case: found by Google sub — definitive match
      userRecord = bySubResults[0];
    } else {
      // Step 2: Fall back to email lookup (handles pre-migration accounts that
      // don't yet have google_sub stored).
      const [byEmailResults] = await db.query(
        `SELECT user_id, first_name, last_name, email, phone, role
         FROM user
         WHERE email = ?
         LIMIT 1`,
        [normalizedEmail]
      );

      if (byEmailResults.length > 0) {
        userRecord = byEmailResults[0];
        // Link the Google sub to this existing account so future logins use
        // the faster and safer sub-based lookup.
        await db.query(
          `UPDATE user SET google_sub = ?, last_login_at = NOW()
           WHERE user_id = ? AND (google_sub IS NULL OR google_sub = '')`,
          [googleSub, userRecord.user_id]
        );
      }
    }

    if (userRecord) {
      // Allow only the same roles as the password-login endpoint
      if (!['customer', 'admin', 'restaurantstaff', 'receptionist'].includes(userRecord.role)) {
        return res.status(403).json({
          success: false,
          error: 'This account role is not allowed to sign in from this page.'
        });
      }

      // Update last login timestamp for existing users found by sub
      if (bySubResults.length > 0) {
        await db.query(
          'UPDATE user SET last_login_at = NOW() WHERE user_id = ?',
          [userRecord.user_id]
        );
      }
    } else {
      // Step 3: No existing account — create a new one
      const firstName = (givenName || (name || '').split(' ')[0] || 'Google').trim();
      const lastName = (familyName || (name || '').split(' ').slice(1).join(' ') || 'User').trim();

      // Generate a random password that can never be used for normal login.
      // The account is Google-only; the placeholder is hashed so no one can use it.
      const placeholderPassword = await bcrypt.hash(
        `google_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        10
      );

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [userResult] = await connection.query(
          `INSERT INTO user (first_name, last_name, email, phone, password, role, auth_provider, google_sub, created_at)
           VALUES (?, ?, ?, ?, ?, 'customer', 'google', ?, NOW())`,
          [firstName, lastName, normalizedEmail, '', placeholderPassword, googleSub]
        );

        const userId = userResult.insertId;

        await connection.query(
          `INSERT INTO customers (user_id, created_at)
           VALUES (?, NOW())`,
          [userId]
        );

        await connection.commit();

        userRecord = {
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          email: normalizedEmail,
          phone: '',
          role: 'customer'
        };

        console.log(`✅ New Google account created: ${normalizedEmail} (sub: ${googleSub})`);
      } catch (transactionError) {
        await connection.rollback();
        console.error('❌ Transaction failed during Google account creation:', transactionError);
        throw transactionError;
      } finally {
        connection.release();
      }
    }

    // Sign the JWT — getJwtSecret() throws if JWT_SECRET is misconfigured
    const token = jwt.sign(
      {
        id: userRecord.user_id,
        email: userRecord.email,
        role: userRecord.role,
        name: `${userRecord.first_name} ${userRecord.last_name}`
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    console.log(`✅ Google login successful: ${userRecord.email} (ID: ${userRecord.user_id})`);

    res.json({
      success: true,
      token,
      customer: {
        id: userRecord.user_id,
        firstName: userRecord.first_name,
        lastName: userRecord.last_name,
        email: userRecord.email,
        phone: userRecord.phone,
        role: userRecord.role
      },
      message: 'Google login successful'
    });
  } catch (error) {
    console.error('❌ Google login error:', error);
    if (isMissingAuthSchemaColumn(error)) {
      return res.status(503).json({
        success: false,
        error: `Database auth schema is outdated. Run ${AUTH_MIGRATION_FILE} and restart backend.`
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to login with Google. Please try again later.'
    });
  }
};

/**
 * Check if email exists in user table (for customers)
 * GET /api/customers/check-email/:email
 */
export const checkEmailExists = async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Check if email exists (get from user table)
    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email
       FROM user u
       WHERE u.email = ?
       LIMIT 1`,
      [email]
    );

    res.json({
      success: true,
      exists: users.length > 0,
      customer: users.length > 0 ? {
        id: users[0].user_id,
        firstName: users[0].first_name,
        lastName: users[0].last_name,
        email: users[0].email
      } : null
    });

  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check email'
    });
  }
};

/**
 * Get customer profile by email
 * GET /api/customers/profile/:email
 */
export const getCustomerProfile = async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Get customer profile from user table (basic info)
    const [users] = await db.query(
      `SELECT user_id, first_name, last_name, email, phone
       FROM user
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const user = users[0];
    console.log('👤 User found:', user.user_id, user.first_name, user.last_name);

    // Try to get extended profile from customers table
    let extendedProfile = {};
    try {
      const [customers] = await db.query(
        `SELECT address, city, country, postal_code, profile_image
         FROM user
         WHERE user_id = ?
         LIMIT 1`,
        [user.user_id]
      );

      console.log('🔍 Customers query result:', customers.length, 'records found');
      if (customers.length > 0) {
        console.log('✅ Extended profile found:', customers[0]);
        extendedProfile = {
          address: customers[0].address,
          city: customers[0].city,
          country: customers[0].country,
          postalCode: customers[0].postal_code,
          profileImage: customers[0].profile_image
        };
      } else {
        console.log('⚠️  No customer record found for user_id:', user.user_id);
      }
    } catch (e) {
      console.warn('Could not fetch extended profile from customers table:', e.message);
    }

    res.json({
      success: true,
      customer: {
        id: user.user_id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        ...extendedProfile
      }
    });
  } catch (error) {
    console.error('Get customer profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer profile'
    });
  }
};

export const getCustomerProfileById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Customer ID is required'
      });
    }

    // Get customer profile by ID directly from user table
    const [users] = await db.query(
      `SELECT user_id, first_name, last_name, email, phone,
              address, city, country, postal_code, profile_image
       FROM user
       WHERE user_id = ?
       LIMIT 1`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const customer = users[0];

    res.json({
      success: true,
      customer: {
        id: customer.user_id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        country: customer.country,
        postalCode: customer.postal_code,
        profileImage: customer.profile_image
      }
    });
  } catch (error) {
    console.error('Get customer profile by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer profile by ID'
    });
  }
};

/**
 * Update customer profile by email
 * PUT /api/customers/profile/:email
 */
export const updateCustomerProfile = async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Get current user data from user table
    const [users] = await db.query(
      `SELECT user_id, first_name, last_name, email, phone, profile_image
       FROM user
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = users[0];

    const {
      firstName,
      lastName,
      phone,
      address,
      city,
      country,
      postalCode,
      profileImage
    } = req.body || {};

    const uploadedProfileImage = req.file
      ? `/uploads/profiles/${req.file.filename}`
      : null;

    const updated = {
      firstName: firstName ?? user.first_name,
      lastName: lastName ?? user.last_name,
      phone: phone ?? user.phone,
      address: address ?? null,
      city: city ?? null,
      country: country ?? 'Philippines',
      postalCode: postalCode ?? null,
      profileImage: uploadedProfileImage ?? profileImage ?? user.profile_image ?? null
    };

    // Update user table (authentication + basic profile fields)
    await db.query(
      `UPDATE user
       SET first_name = ?,
           last_name = ?,
           phone = ?,
           profile_image = ?
       WHERE user_id = ?`,
      [
        updated.firstName,
        updated.lastName,
        updated.phone,
        updated.profileImage,
        user.user_id
      ]
    );

    // Update or insert customer profile (address, city, country, postal_code)
    await db.query(
      `INSERT INTO customers (user_id, address, city, country, postal_code, profile_image)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         address = VALUES(address),
         city = VALUES(city),
         country = VALUES(country),
         postal_code = VALUES(postal_code),
         profile_image = VALUES(profile_image)`,
      [
        user.user_id,
        updated.address,
        updated.city,
        updated.country,
        updated.postalCode,
        updated.profileImage
      ]
    );

    console.log('✅ Profile updated for user:', user.user_id, updated.firstName, updated.lastName);

    res.json({
      success: true,
      customer: {
        id: user.user_id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email,
        phone: updated.phone,
        address: updated.address,
        city: updated.city,
        country: updated.country,
        postalCode: updated.postalCode,
        profileImage: updated.profileImage
      }
    });
  } catch (error) {
    console.error('Update customer profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer profile'
    });
  }
};

/**
 * Get customer_id by user_id
 * GET /api/customers/id/by-user/:userId
 * Helper endpoint to map user_id to customer_id
 */
export const getCustomerIdByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    // Get customer_id from customers table
    const [customers] = await db.query(
      'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
      [userId]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer mapping not found',
        customerId: null
      });
    }

    res.json({
      success: true,
      customerId: customers[0].customer_id
    });
  } catch (error) {
    console.error('Get customer ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get customer ID'
    });
  }
};

/**
 * Reset Password (after OTP verified)
 * POST /api/customers/reset-password
 *
 * Body: { email, newPassword }
 */
export const resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
    }

    // Check user exists
    const [users] = await db.query(
      'SELECT user_id FROM user WHERE email = ? LIMIT 1',
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'No account found with that email' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      'UPDATE user SET password = ? WHERE email = ?',
      [hashedPassword, normalizedEmail]
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
};

/**
 * Change Password (while logged in)
 * POST /api/customers/change-password
 *
 * Body: { email, currentPassword, newPassword }
 */
export const changeCustomerPassword = async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Email, current password, and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 8 characters long'
      });
    }

    const hasLower = /[a-z]/.test(newPassword);
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasDigit = /\d/.test(newPassword);
    const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);

    if (!hasLower || !hasUpper || !hasDigit || !hasSymbol) {
      return res.status(400).json({
        success: false,
        error: 'New password must include uppercase, lowercase, number, and symbol'
      });
    }

    const [users] = await db.query(
      `SELECT user_id, password
       FROM user
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer account not found'
      });
    }

    const user = users[0];

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password || '');
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    const isSameAsOld = await bcrypt.compare(newPassword, user.password || '');
    if (isSameAsOld) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      'UPDATE user SET password = ? WHERE user_id = ?',
      [hashedPassword, user.user_id]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change customer password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
};
