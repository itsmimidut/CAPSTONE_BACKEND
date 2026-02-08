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
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    // Check if email already exists
    const [existing] = await db.query('SELECT user_id FROM user WHERE email = ? LIMIT 1', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Insert new customer
    const [result] = await db.query(
      'INSERT INTO user (first_name, last_name, email, password, phone) VALUES (?, ?, ?, ?, ?)',
      [firstName, lastName, email, hashedPassword, contactNumber || null]
    );
    res.json({ success: true, customerId: result.insertId });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, error: 'Failed to register customer' });
  }
};

/**
 * Customer Login
 * POST /api/customers/login
 */
export const customerLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Missing email or password' });
    }
    const [customers] = await db.query('SELECT user_id, first_name, last_name, email, password FROM user WHERE email = ? LIMIT 1', [email]);
    if (customers.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid email or password' });
    }
    const customer = customers[0];
    const match = await bcrypt.compare(password, customer.password);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Invalid email or password' });
    }
    // Generate JWT token
    const token = jwt.sign({ id: customer.user_id, email: customer.email }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
    res.json({
      success: true, token, customer: {
        id: customer.user_id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Failed to login' });
  }
};

/**
 * Check if email exists in customers table
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

    // Check if email exists in customers table
    const [customers] = await db.query(
      'SELECT customer_id, first_name, last_name, email FROM customers WHERE email = ? LIMIT 1',
      [email]
    );

    res.json({
      success: true,
      exists: customers.length > 0,
      customer: customers.length > 0 ? {
        id: customers[0].customer_id,
        firstName: customers[0].first_name,
        lastName: customers[0].last_name,
        email: customers[0].email
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

    const [customers] = await db.query(
      `SELECT customer_id, first_name, last_name, email, phone, address, city, country, postal_code, profile_image
       FROM customers
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const customer = customers[0];

    res.json({
      success: true,
      customer: {
        id: customer.customer_id,
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

    const [customers] = await db.query(
      `SELECT customer_id, first_name, last_name, email, phone, address, city, country, postal_code, profile_image
       FROM customers
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    if (customers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const current = customers[0];
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
      firstName: firstName ?? current.first_name,
      lastName: lastName ?? current.last_name,
      phone: phone ?? current.phone,
      address: address ?? current.address,
      city: city ?? current.city,
      country: country ?? current.country,
      postalCode: postalCode ?? current.postal_code,
      profileImage: profileImage ?? current.profile_image
    };

    await db.query(
      `UPDATE customers
       SET first_name = ?, last_name = ?, phone = ?, address = ?, city = ?, country = ?, postal_code = ?, profile_image = ?
       WHERE email = ?`,
      [
        updated.firstName,
        updated.lastName,
        updated.phone,
        updated.address,
        updated.city,
        updated.country,
        updated.postalCode,
        updated.profileImage,
        email
      ]
    );

    res.json({
      success: true,
      customer: {
        id: current.customer_id,
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
