// Check existing categories in database
import mysql from 'mysql2/promise';

async function checkCategories() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'eduardos'
    });

    try {
        console.log('🔍 Checking menu item categories...\n');
        
        // Get all unique categories and count
        const [categories] = await connection.execute(
            'SELECT category, COUNT(*) as count FROM menu_items GROUP BY category ORDER BY count DESC'
        );
        
        console.log('Categories in database:');
        categories.forEach(cat => {
            console.log(`  - ${cat.category}: ${cat.count} items`);
        });
        
        console.log('\n✅ Total items:', categories.reduce((sum, cat) => sum + cat.count, 0));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await connection.end();
    }
}

checkCategories();
