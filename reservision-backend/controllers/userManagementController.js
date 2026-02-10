import db from '../config/db.js';
import bcrypt from 'bcryptjs';

/**
 * ============================================================
 * USER MANAGEMENT CONTROLLER
 * ============================================================
 * Handles user management operations for admin dashboard:
 * - Get all users (with pagination, filtering, search)
 * - Get single user details
 * - Create new user
 * - Update user information
 * - Delete user
 * - Change user role
 * - Toggle user status
 */

/**
 * Get all users with optional filtering and pagination
 * GET /api/users?page=1&limit=10&role=customer&search=john
 */
export const getAllUsers = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            role,
            search,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        let whereConditions = [];
        let queryParams = [];

        // Filter by role
        if (role) {
            whereConditions.push('u.role = ?');
            queryParams.push(role);
        }

        // Search by name or email
        if (search) {
            whereConditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
            const searchPattern = `%${search}%`;
            queryParams.push(searchPattern, searchPattern, searchPattern);
        }

        const whereClause = whereConditions.length > 0
            ? `WHERE ${whereConditions.join(' AND ')}`
            : '';

        // Get total count
        const [countResult] = await db.query(
            `SELECT COUNT(*) as total 
       FROM user u 
       ${whereClause}`,
            queryParams
        );
        const total = countResult[0].total;

        // Get users with customer data (if exists)
        const [users] = await db.query(
            `SELECT 
        u.user_id, u.first_name, u.last_name, u.email, u.phone, u.role, u.created_at,
        c.customer_id, c.address, c.city, c.country, c.postal_code, c.profile_image
       FROM user u
       LEFT JOIN customers c ON u.user_id = c.user_id
       ${whereClause}
       ORDER BY u.${sortBy} ${sortOrder}
       LIMIT ? OFFSET ?`,
            [...queryParams, parseInt(limit), offset]
        );

        res.json({
            success: true,
            data: {
                users: users.map(user => ({
                    id: user.user_id,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    createdAt: user.created_at,
                    customerId: user.customer_id,
                    address: user.address,
                    city: user.city,
                    country: user.country,
                    postalCode: user.postal_code,
                    profileImage: user.profile_image
                })),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('❌ Get all users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch users'
        });
    }
};

/**
 * Get user by ID with full details
 * GET /api/users/:id
 */
export const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        const [users] = await db.query(
            `SELECT 
        u.user_id, u.first_name, u.last_name, u.email, u.phone, u.role, u.created_at,
        c.customer_id, c.address, c.city, c.country, c.postal_code, c.profile_image
       FROM user u
       LEFT JOIN customers c ON u.user_id = c.user_id
       WHERE u.user_id = ?
       LIMIT 1`,
            [id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = users[0];

        res.json({
            success: true,
            user: {
                id: user.user_id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                createdAt: user.created_at,
                customerId: user.customer_id,
                address: user.address,
                city: user.city,
                country: user.country,
                postalCode: user.postal_code,
                profileImage: user.profile_image
            }
        });
    } catch (error) {
        console.error('❌ Get user by ID error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user'
        });
    }
};

/**
 * Create new user (admin function)
 * POST /api/users
 */
export const createUser = async (req, res) => {
    try {
        const { firstName, lastName, email, phone, password, role = 'customer' } = req.body;

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

        // Validate role
        const validRoles = ['customer', 'admin', 'restaurantstaff', 'receptionist'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid role. Must be: customer, admin, restaurantstaff, or receptionist'
            });
        }

        // Check if email already exists
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

        // Start transaction
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Insert user
            const [userResult] = await connection.query(
                `INSERT INTO user (first_name, last_name, email, phone, password, role, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [firstName, lastName, email, phone || null, hashedPassword, role]
            );

            const userId = userResult.insertId;

            // Create customer record if role is customer
            if (role === 'customer') {
                await connection.query(
                    `INSERT INTO customers (user_id, created_at) 
           VALUES (?, NOW())`,
                    [userId]
                );
            }

            await connection.commit();
            connection.release();

            console.log(`✅ User created: ${email} (ID: ${userId}, Role: ${role})`);

            res.status(201).json({
                success: true,
                user: {
                    id: userId,
                    firstName,
                    lastName,
                    email,
                    phone,
                    role
                },
                message: 'User created successfully'
            });

        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }

    } catch (error) {
        console.error('❌ Create user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create user'
        });
    }
};

/**
 * Update user information
 * PUT /api/users/:id
 */
export const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            firstName,
            lastName,
            email,
            phone,
            address,
            city,
            country,
            postalCode,
            profileImage
        } = req.body;

        // Check if user exists
        const [users] = await db.query(
            'SELECT user_id, email, role FROM user WHERE user_id = ? LIMIT 1',
            [id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = users[0];

        // If email is being changed, check if new email already exists
        if (email && email !== user.email) {
            const [existingEmail] = await db.query(
                'SELECT user_id FROM user WHERE email = ? AND user_id != ? LIMIT 1',
                [email, id]
            );

            if (existingEmail.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already in use'
                });
            }
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Build update query for user table
            let updateFields = [];
            let updateParams = [];

            if (firstName) {
                updateFields.push('first_name = ?');
                updateParams.push(firstName);
            }
            if (lastName) {
                updateFields.push('last_name = ?');
                updateParams.push(lastName);
            }
            if (email) {
                updateFields.push('email = ?');
                updateParams.push(email);
            }
            if (phone !== undefined) {
                updateFields.push('phone = ?');
                updateParams.push(phone);
            }

            // Update user table if there are fields to update
            if (updateFields.length > 0) {
                await connection.query(
                    `UPDATE user SET ${updateFields.join(', ')} WHERE user_id = ?`,
                    [...updateParams, id]
                );
            }

            // Update customer table if user is a customer and has customer data
            if (user.role === 'customer' && (address || city || country || postalCode || profileImage)) {
                // Check if customer record exists
                const [customers] = await connection.query(
                    'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
                    [id]
                );

                let customerUpdateFields = [];
                let customerUpdateParams = [];

                if (address !== undefined) {
                    customerUpdateFields.push('address = ?');
                    customerUpdateParams.push(address);
                }
                if (city !== undefined) {
                    customerUpdateFields.push('city = ?');
                    customerUpdateParams.push(city);
                }
                if (country !== undefined) {
                    customerUpdateFields.push('country = ?');
                    customerUpdateParams.push(country);
                }
                if (postalCode !== undefined) {
                    customerUpdateFields.push('postal_code = ?');
                    customerUpdateParams.push(postalCode);
                }
                if (profileImage !== undefined) {
                    customerUpdateFields.push('profile_image = ?');
                    customerUpdateParams.push(profileImage);
                }

                if (customerUpdateFields.length > 0) {
                    if (customers.length > 0) {
                        // Update existing customer record
                        await connection.query(
                            `UPDATE customers SET ${customerUpdateFields.join(', ')} WHERE user_id = ?`,
                            [...customerUpdateParams, id]
                        );
                    } else {
                        // Create customer record if it doesn't exist
                        await connection.query(
                            `INSERT INTO customers (user_id, address, city, country, postal_code, profile_image, created_at)
               VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                            [id, address || null, city || null, country || null, postalCode || null, profileImage || null]
                        );
                    }
                }
            }

            await connection.commit();
            connection.release();

            console.log(`✅ User updated: ID ${id}`);

            // Fetch updated user
            const [updatedUsers] = await db.query(
                `SELECT 
          u.user_id, u.first_name, u.last_name, u.email, u.phone, u.role,
          c.address, c.city, c.country, c.postal_code, c.profile_image
         FROM user u
         LEFT JOIN customers c ON u.user_id = c.user_id
         WHERE u.user_id = ?
         LIMIT 1`,
                [id]
            );

            const updatedUser = updatedUsers[0];

            res.json({
                success: true,
                user: {
                    id: updatedUser.user_id,
                    firstName: updatedUser.first_name,
                    lastName: updatedUser.last_name,
                    email: updatedUser.email,
                    phone: updatedUser.phone,
                    role: updatedUser.role,
                    address: updatedUser.address,
                    city: updatedUser.city,
                    country: updatedUser.country,
                    postalCode: updatedUser.postal_code,
                    profileImage: updatedUser.profile_image
                },
                message: 'User updated successfully'
            });

        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }

    } catch (error) {
        console.error('❌ Update user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update user'
        });
    }
};

/**
 * Delete user
 * DELETE /api/users/:id
 */
export const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if user exists
        const [users] = await db.query(
            'SELECT user_id, email FROM user WHERE user_id = ? LIMIT 1',
            [id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Delete user (CASCADE will delete related customer record)
        await db.query('DELETE FROM user WHERE user_id = ?', [id]);

        console.log(`✅ User deleted: ${users[0].email} (ID: ${id})`);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('❌ Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete user'
        });
    }
};

/**
 * Change user role
 * PATCH /api/users/:id/role
 */
export const changeUserRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role) {
            return res.status(400).json({
                success: false,
                error: 'Role is required'
            });
        }

        // Validate role
        const validRoles = ['customer', 'admin', 'restaurantstaff', 'receptionist'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid role. Must be: customer, admin, restaurantstaff, or receptionist'
            });
        }

        // Check if user exists
        const [users] = await db.query(
            'SELECT user_id, role FROM user WHERE user_id = ? LIMIT 1',
            [id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const oldRole = users[0].role;

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Update user role
            await connection.query(
                'UPDATE user SET role = ? WHERE user_id = ?',
                [role, id]
            );

            // If changing TO customer role, create customer record if it doesn't exist
            if (role === 'customer') {
                const [customers] = await connection.query(
                    'SELECT customer_id FROM customers WHERE user_id = ? LIMIT 1',
                    [id]
                );

                if (customers.length === 0) {
                    await connection.query(
                        'INSERT INTO customers (user_id, created_at) VALUES (?, NOW())',
                        [id]
                    );
                    console.log(`✅ Created customer record for user_id: ${id}`);
                }
            }

            await connection.commit();
            connection.release();

            console.log(`✅ User role changed: ID ${id} from ${oldRole} to ${role}`);

            res.json({
                success: true,
                message: 'User role updated successfully',
                data: {
                    userId: id,
                    oldRole,
                    newRole: role
                }
            });

        } catch (transactionError) {
            await connection.rollback();
            connection.release();
            throw transactionError;
        }

    } catch (error) {
        console.error('❌ Change user role error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to change user role'
        });
    }
};

/**
 * Get user statistics
 * GET /api/users/stats
 */
export const getUserStats = async (req, res) => {
    try {
        // Get total users by role
        const [roleCounts] = await db.query(
            `SELECT role, COUNT(*) as count 
       FROM user 
       GROUP BY role`
        );

        // Get total users count
        const [totalCount] = await db.query(
            'SELECT COUNT(*) as total FROM user'
        );

        // Get new users this month
        const [newUsersThisMonth] = await db.query(
            `SELECT COUNT(*) as count 
       FROM user 
       WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
       AND YEAR(created_at) = YEAR(CURRENT_DATE())`
        );

        res.json({
            success: true,
            stats: {
                total: totalCount[0].total,
                byRole: roleCounts.reduce((acc, row) => {
                    acc[row.role] = row.count;
                    return acc;
                }, {}),
                newThisMonth: newUsersThisMonth[0].count
            }
        });

    } catch (error) {
        console.error('❌ Get user stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user statistics'
        });
    }
};
