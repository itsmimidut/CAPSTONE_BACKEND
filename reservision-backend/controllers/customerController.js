import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
/**
 * Customer Signup
 * POST /api/customers/signup
 */
export const customerSignup = async (req, res) => {
  try {
    const { firstName, lastName, email, password, contactNumber } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: firstName, lastName, email, password'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
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
      [email]
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
        `INSERT INTO user (first_name, last_name, email, phone, password, role, created_at) 
         VALUES (?, ?, ?, ?, ?, 'customer', NOW())`,
        [firstName, lastName, email, contactNumber || null, hashedPassword]
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

      // Generate JWT token
      const token = jwt.sign(
        {
          id: userId,
          email: email,
          role: 'customer',
          name: `${firstName} ${lastName}`
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      // Log signup success
      console.log(`✅ Customer signup successful: ${email} (User ID: ${userId})`);

      res.status(201).json({
        success: true,
        token,
        customer: {
          id: userId,
          firstName,
          lastName,
          email,
          phone: contactNumber,
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

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find user by email (all roles can login through this endpoint)
    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.password, u.role
         FROM user u
         WHERE u.email = ? AND u.role IN ('customer', 'admin', 'restaurantstaff', 'receptionist')
         LIMIT 1`,
      [email]
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

    // Generate JWT token
    const token = jwt.sign(
      {
        id: customer.user_id,
        email: customer.email,
        role: customer.role,
        name: `${customer.first_name} ${customer.last_name}`
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Update last login timestamp
    await db.query(
      'UPDATE user SET created_at = NOW() WHERE user_id = ?',
      [customer.user_id]
    );

    // Log successful login
    console.log(`✅ Customer login successful: ${email} (ID: ${customer.user_id})`);

    res.json({
      success: true,
      token,
      customer: {
        id: customer.user_id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        role: customer.role
      },
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login. Please try again later.'
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
       WHERE u.email = ? AND u.role = 'customer'
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

    // Get customer profile (LEFT JOIN to handle missing customer records)
    const [users] = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, 
              c.address, c.city, c.country, c.postal_code, c.profile_image
       FROM user u
       LEFT JOIN customers c ON u.user_id = c.user_id
       WHERE u.email = ? AND u.role = 'customer'
       LIMIT 1`,
      [email]
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
    console.error('Get customer profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer profile'
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

    // Get current user data
    const [users] = await db.query(
      `SELECT user_id, first_name, last_name, email, phone
       FROM user
       WHERE email = ? AND role = 'customer'
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

    // Check if customer record exists
    const [customers] = await db.query(
      `SELECT customer_id, address, city, country, postal_code, profile_image
       FROM customers
       WHERE user_id = ?
       LIMIT 1`,
      [user.user_id]
    );

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

    const updated = {
      firstName: firstName ?? user.first_name,
      lastName: lastName ?? user.last_name,
      phone: phone ?? user.phone,
      address: address ?? (customers.length > 0 ? customers[0].address : null),
      city: city ?? (customers.length > 0 ? customers[0].city : null),
      country: country ?? (customers.length > 0 ? customers[0].country : 'Philippines'),
      postalCode: postalCode ?? (customers.length > 0 ? customers[0].postal_code : null),
      profileImage: profileImage ?? (customers.length > 0 ? customers[0].profile_image : null)
    };

    // Update user table (first_name, last_name, phone)
    await db.query(
      `UPDATE user
       SET first_name = ?, last_name = ?, phone = ?
       WHERE user_id = ?`,
      [
        updated.firstName,
        updated.lastName,
        updated.phone,
        user.user_id
      ]
    );

    // Insert or update customers table
    if (customers.length === 0) {
      // Create customer record if it doesn't exist
      await db.query(
        `INSERT INTO customers (user_id, address, city, country, postal_code, profile_image, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          user.user_id,
          updated.address,
          updated.city,
          updated.country,
          updated.postalCode,
          updated.profileImage
        ]
      );
      console.log(`✅ Created customer record for user_id: ${user.user_id}`);
    } else {
      // Update existing customer record
      await db.query(
        `UPDATE customers
         SET address = ?, city = ?, country = ?, postal_code = ?, profile_image = ?
         WHERE customer_id = ?`,
        [
          updated.address,
          updated.city,
          updated.country,
          updated.postalCode,
          updated.profileImage,
          customers[0].customer_id
        ]
      );
      console.log(`✅ Updated customer record for customer_id: ${customers[0].customer_id}`);
    }

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
