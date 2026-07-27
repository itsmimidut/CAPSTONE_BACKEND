import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import {
  clearAuthCookies,
  issueAuthSession,
  revokeAllUserRefreshTokens,
} from '../utils/tokenService.js';
import { assertEmailAccess, assertUserIdAccess } from '../middleware/ownership.js';
import { syncSwimmingCoachFromUser } from '../services/syncSwimmingCoachFromUser.js';
import fetch from 'node-fetch';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { verifySignupVerificationToken } from '../utils/signupVerification.js';

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
    const { firstName, lastName, email, password, contactNumber, emailVerificationToken, termsAccepted } = req.body;
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

    if (termsAccepted !== true) {
      return res.status(400).json({ success: false, error: 'Terms and Privacy consent is required' });
    }

    if (!verifySignupVerificationToken(emailVerificationToken, normalizedEmail)) {
      return res.status(403).json({ success: false, error: 'Email verification is missing or expired' });
    }

    // Keep server rules aligned with the signup UI.
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters and include uppercase, lowercase, and a number'
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

    if (normalizedPhone) {
      const [existingPhones] = await db.query(
        'SELECT user_id FROM user WHERE phone = ? LIMIT 1',
        [normalizedPhone]
      );
      if (existingPhones.length > 0) {
        return res.status(409).json({ success: false, error: 'Contact number already registered' });
      }
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

      await issueAuthSession(res, {
        id: userId,
        email: normalizedEmail,
        role: 'customer',
        name: `${firstName} ${lastName}`,
      }, req);

      // Log signup success
      console.log(`✅ Customer signup successful: ${normalizedEmail} (User ID: ${userId})`);

      res.status(201).json({
        success: true,
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
    const { email, password, rememberMe = false } = req.body;
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
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.password, u.role,
              u.created_at
         FROM user u
         WHERE LOWER(TRIM(u.email)) = ? AND u.role IN ('customer', 'admin', 'restaurantstaff', 'receptionist', 'swimming_instructor')
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

    if (!customer.password || customer.password === 'GUEST_NO_PASSWORD') {
      return res.status(401).json({
        success: false,
        error: 'This account was created during a guest booking without a password. Use Forgot Password to set one.',
        code: 'GUEST_ACCOUNT'
      });
    }

    if (!String(customer.password).startsWith('$2')) {
      return res.status(401).json({
        success: false,
        error: 'Your account needs a password reset. Use Forgot Password to continue.',
        code: 'PASSWORD_RESET_REQUIRED'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, customer.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last_login_at — DO NOT update created_at (that would destroy the
    // account creation timestamp). The last_login_at column is added via
    // ADD_AUTH_IMPROVEMENTS.sql migration.
    await db.query(
      'UPDATE user SET last_login_at = NOW() WHERE user_id = ?',
      [customer.user_id]
    );

    await issueAuthSession(res, {
      id: customer.user_id,
      email: customer.email,
      role: customer.role,
      name: `${customer.first_name} ${customer.last_name}`,
    }, req, { rememberMe: Boolean(rememberMe) });

    const [customerMapRows] = await db.query(
      'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
      [customer.user_id],
    );

    // Log successful login
    console.log(`✅ Customer login successful: ${normalizedEmail} (ID: ${customer.user_id})`);

    res.json({
      success: true,
      customer: {
        id: customer.user_id,
        user_id: customer.user_id,
        customerId: customerMapRows[0]?.customer_id ?? null,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        role: customer.role,
        createdAt: customer.created_at,
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

    await issueAuthSession(res, {
      id: userRecord.user_id,
      email: userRecord.email,
      role: userRecord.role,
      name: `${userRecord.first_name} ${userRecord.last_name}`,
    }, req);

    const [googleCustomerRows] = await db.query(
      'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
      [userRecord.user_id],
    );

    console.log(`✅ Google login successful: ${userRecord.email} (ID: ${userRecord.user_id})`);

    res.json({
      success: true,
      customer: {
        id: userRecord.user_id,
        user_id: userRecord.user_id,
        customerId: googleCustomerRows[0]?.customer_id ?? null,
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
export const checkContactExists = async (req, res) => {
  try {
    const contactNumber = decodeURIComponent(req.params.contactNumber || '').replace(/\D/g, '');
    if (!/^09\d{9}$/.test(contactNumber)) {
      return res.status(400).json({ success: false, error: 'Valid contact number is required' });
    }
    const [rows] = await db.query('SELECT user_id FROM user WHERE phone = ? LIMIT 1', [contactNumber]);
    return res.json({ success: true, exists: rows.length > 0 });
  } catch (error) {
    console.error('Check contact error:', error);
    return res.status(500).json({ success: false, error: 'Unable to check contact number' });
  }
};

export const checkEmailExists = async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email
       FROM user u
       WHERE LOWER(TRIM(u.email)) = ?
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

    if (!assertEmailAccess(req, res, email)) {
      return;
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Get customer profile from user table (basic + extended fields)
    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
              u.address, u.city, u.country, u.postal_code, u.profile_image,
              u.created_at AS user_created_at,
              c.created_at AS customer_created_at
       FROM user u
       LEFT JOIN customers c ON c.user_id = u.user_id
       WHERE u.email = ?
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
    const createdAt = user.customer_created_at || user.user_created_at || null;

    res.json({
      success: true,
      customer: {
        id: user.user_id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        city: user.city,
        country: user.country,
        postalCode: user.postal_code,
        profileImage: user.profile_image,
        createdAt,
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

    if (!assertUserIdAccess(req, res, id)) {
      return;
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Customer ID is required'
      });
    }

    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
              u.address, u.city, u.country, u.postal_code, u.profile_image,
              u.created_at AS user_created_at,
              c.created_at AS customer_created_at
       FROM user u
       LEFT JOIN customers c ON c.user_id = u.user_id
       WHERE u.user_id = ?
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
    const createdAt = customer.customer_created_at || customer.user_created_at || null;

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
        profileImage: customer.profile_image,
        createdAt,
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

    if (!assertEmailAccess(req, res, email)) {
      return;
    }

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

    const bodyProfileImage = profileImage;
    const uploadedProfileImage = req.file
      ? `/uploads/profiles/${req.file.filename}`
      : null;

    let resolvedProfileImage = user.profile_image ?? null;
    if (uploadedProfileImage) {
      resolvedProfileImage = uploadedProfileImage;
    } else if (bodyProfileImage === '' || bodyProfileImage === 'null') {
      resolvedProfileImage = null;
    } else if (bodyProfileImage) {
      resolvedProfileImage = bodyProfileImage;
    }

    const updated = {
      firstName: firstName ?? user.first_name,
      lastName: lastName ?? user.last_name,
      phone: phone ?? user.phone,
      address: address ?? null,
      city: city ?? null,
      country: country ?? 'Philippines',
      postalCode: postalCode ?? null,
      profileImage: resolvedProfileImage,
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

    await syncSwimmingCoachFromUser(user.user_id, null, {
      user_id: user.user_id,
      first_name: updated.firstName,
      last_name: updated.lastName,
      phone: updated.phone
    });

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

    if (!assertUserIdAccess(req, res, userId)) {
      return;
    }

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

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
    }

    // Check user exists
    const [users] = await db.query(
      'SELECT user_id, email FROM user WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'No account found with that email' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const userId = users[0].user_id;

    await db.query(
      'UPDATE user SET password = ? WHERE user_id = ?',
      [hashedPassword, userId]
    );

    await revokeAllUserRefreshTokens(userId);
    clearAuthCookies(res);

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

    if (!assertEmailAccess(req, res, normalizedEmail)) {
      return;
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

    await revokeAllUserRefreshTokens(user.user_id);
    clearAuthCookies(res);

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
