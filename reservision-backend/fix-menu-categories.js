// Fix menu categories - Delete old test data
// Run: node fix-menu-categories.js

import mysql from 'mysql2/promise';

async function fixMenuCategories() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',  // Update if you have a password
        database: 'eduardos'
    });

    try {
        console.log('🔧 Fixing menu categories...');
        
        // Delete old test items
        const [deleteResult] = await connection.execute(
            'DELETE FROM menu_items WHERE menu_id IN (1, 2, 3, 4, 5)'
        );
        console.log(`✅ Deleted ${deleteResult.affectedRows} old test items`);
        
        // Reset AUTO_INCREMENT
        await connection.execute('ALTER TABLE menu_items AUTO_INCREMENT = 1');
        console.log('✅ Reset AUTO_INCREMENT to 1');
        
        // Verify
        const [rows] = await connection.execute('SELECT COUNT(*) as count FROM menu_items');
        console.log(`✅ Remaining items: ${rows[0].count}`);
        
        console.log('\n✨ Menu categories fixed! You can now add items with the new categories.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await connection.end();
    }
}

fixMenuCategories();
