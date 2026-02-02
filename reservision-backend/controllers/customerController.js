import db from '../config/db.js';

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
