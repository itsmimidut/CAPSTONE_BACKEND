/**
 * ============================================================
 * INVENTORY API - FRONTEND IMPLEMENTATION GUIDE
 * ============================================================
 * 
 * This file provides ready-to-use Vue.js composables and utilities
 * for integrating the Inventory Management API into your frontend.
 * 
 * Copy these functions into your project and use them in components.
 */

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Base API URL - Update this to match your server
 */
const API_BASE_URL = 'http://localhost:8000/api/restaurant/inventory';

/**
 * Make API call with error handling
 * 
 * @param {string} endpoint - URL path relative to base
 * @param {object} options - fetch options
 * @returns {Promise<object>} Response data
 * 
 * Usage:
 * const data = await apiCall('/');
 * const item = await apiCall('/1');
 * const response = await apiCall('/', { method: 'POST', body: {...} });
 */
async function apiCall(endpoint, options = {}) {
    try {
        const url = `${API_BASE_URL}${endpoint}`;
        const headers = options.headers || {};

        if (!headers['Content-Type'] && options.body && typeof options.body === 'object') {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, {
            ...options,
            headers
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || data.error || `API Error: ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ============================================================
// INVENTORY SERVICE (Composable/Service Layer)
// ============================================================

/**
 * useInventory() - Vue 3 Composable
 * 
 * Provides reactive inventory state and methods for CRUD operations.
 * Use this in your Vue components.
 * 
 * Usage in Component:
 * <script setup>
 *   const { items, loading, error, fetchAll, add, restock } = useInventory();
 *   
 *   onMounted(() => fetchAll());
 * </script>
 */
export function useInventory() {
    const items = ref([]);
    const lowStockItems = ref([]);
    const stats = ref(null);
    const loading = ref(false);
    const error = ref(null);

    /**
     * Fetch all inventory items
     * 
     * @param {object} filters - Optional filters { status, search }
     */
    const fetchAll = async (filters = {}) => {
        loading.value = true;
        error.value = null;
        try {
            let endpoint = '/';
            const params = new URLSearchParams();

            if (filters.status) params.append('status', filters.status);
            if (filters.search) params.append('search', filters.search);

            if (params.toString()) endpoint += `?${params}`;

            const data = await apiCall(endpoint);
            items.value = data.data || [];
        } catch (err) {
            error.value = err.message;
            console.error('Failed to fetch inventory:', err);
        } finally {
            loading.value = false;
        }
    };

    /**
     * Fetch single item by ID
     */
    const fetchOne = async (id) => {
        try {
            const data = await apiCall(`/${id}`);
            return data.data;
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    /**
     * Fetch low stock items for alerts
     */
    const fetchLowStock = async (criticalOnly = false) => {
        try {
            let endpoint = '/status/low';
            if (criticalOnly) endpoint += '?critical=true';

            const data = await apiCall(endpoint);
            lowStockItems.value = data.data || [];
            return lowStockItems.value;
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    /**
     * Fetch inventory statistics
     */
    const fetchStats = async () => {
        try {
            const data = await apiCall('/stats');
            stats.value = data.stats;
            return stats.value;
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    /**
     * Add new inventory item
     */
    const add = async (itemData) => {
        error.value = null;
        try {
            const data = await apiCall('/', {
                method: 'POST',
                body: JSON.stringify(itemData)
            });

            // Refresh list after adding
            await fetchAll();
            return data.data;
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    /**
     * Update inventory item
     */
    const update = async (id, updates) => {
        error.value = null;
        try {
            const data = await apiCall(`/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });

            // Refresh list after updating
            await fetchAll();
            return data.data;
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    /**
     * Update quantity with operation
     * 
     * @param {number} id - Item ID
     * @param {number} quantity - Amount
     * @param {string} operation - 'add', 'remove', or 'set'
     */
    const updateQuantity = async (id, quantity, operation = 'set') => {
        error.value = null;
        try {
            const data = await apiCall(`/${id}/quantity`, {
                method: 'PATCH',
                body: JSON.stringify({ quantity, operation })
            });

            // Refresh data after update
            await Promise.all([fetchAll(), fetchLowStock()]);
            return data.data;
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    /**
     * Add to stock (restocking)
     */
    const restock = async (id, amount) => {
        return updateQuantity(id, amount, 'add');
    };

    /**
     * Remove from stock (usage)
     */
    const use = async (id, amount) => {
        return updateQuantity(id, amount, 'remove');
    };

    /**
     * Set exact quantity (inventory count)
     */
    const adjustStock = async (id, exactAmount) => {
        return updateQuantity(id, exactAmount, 'set');
    };

    /**
     * Delete inventory item
     */
    const remove = async (id) => {
        error.value = null;
        try {
            await apiCall(`/${id}`, { method: 'DELETE' });
            await fetchAll();
        } catch (err) {
            error.value = err.message;
            throw err;
        }
    };

    return {
        items: readonly(items),
        lowStockItems: readonly(lowStockItems),
        stats: readonly(stats),
        loading: readonly(loading),
        error: readonly(error),
        fetchAll,
        fetchOne,
        fetchLowStock,
        fetchStats,
        add,
        update,
        updateQuantity,
        restock,
        use,
        adjustStock,
        remove
    };
}

// ============================================================
// EXAMPLE COMPONENT: INVENTORY DASHBOARD
// ============================================================

/**
 * Complete inventory dashboard component
 * 
 * Features:
 * - Display all inventory items in table
 * - Show low stock alerts
 * - Quick actions (restock, use, edit, delete)
 * - Search and filter
 * - Add new items modal
 * - Edit modal
 */
export const InventoryDashboardComponent = {
    template: `
    <div class="inventory-dashboard">
      <!-- Header -->
      <div class="header">
        <h1>Inventory Management</h1>
        <button @click="showAddModal = true" class="btn btn-primary">
          ➕ Add Item
        </button>
      </div>

      <!-- Statistics -->
      <div v-if="stats" class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">{{ stats.total_items }}</div>
          <div class="stat-label">Total Items</div>
        </div>
        <div class="stat-card good">
          <div class="stat-number">{{ stats.good_status }}</div>
          <div class="stat-label">Good Stock</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-number">{{ stats.low_status }}</div>
          <div class="stat-label">Low Stock</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-number">{{ stats.critical_status }}</div>
          <div class="stat-label">Critical</div>
        </div>
      </div>

      <!-- Low Stock Alert -->
      <div v-if="lowStockItems.length > 0" class="alert alert-warning">
        <h3>⚠️ Items Need Restocking</h3>
        <ul class="alert-list">
          <li v-for="item in lowStockItems" :key="item.inventory_id">
            <strong>{{ item.item_name }}:</strong>
            {{ item.quantity }}{{ item.unit }}
            (Threshold: {{ item.threshold }})
            <button @click="quickRestock(item.inventory_id)" class="btn btn-sm">
              Restock
            </button>
          </li>
        </ul>
      </div>

      <!-- Search & Filter -->
      <div class="controls">
        <input 
          v-model="searchQuery"
          type="text"
          placeholder="Search items..."
          class="search-input"
        />
        <select v-model="filterStatus" class="filter-select">
          <option value="">All Status</option>
          <option value="good">Good</option>
          <option value="low">Low</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <!-- Inventory Table -->
      <table v-if="filteredItems.length > 0" class="inventory-table">
        <thead>
          <tr>
            <th>Item Name</th>
            <th>Quantity</th>
            <th>Unit</th>
            <th>Threshold</th>
            <th>Status</th>
            <th>Last Restocked</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredItems" :key="item.inventory_id" 
              :class="'status-' + item.status">
            <td>{{ item.item_name }}</td>
            <td>{{ item.quantity }}</td>
            <td>{{ item.unit }}</td>
            <td>{{ item.threshold }}</td>
            <td>
              <span :class="'badge status-' + item.status">
                {{ item.status }}
              </span>
            </td>
            <td>{{ formatDate(item.last_restocked) }}</td>
            <td class="actions">
              <button @click="quickRestock(item.inventory_id)" 
                      class="btn btn-sm btn-success" 
                      title="Add 10 units">
                +
              </button>
              <button @click="quickUse(item.inventory_id)" 
                      class="btn btn-sm btn-warning" 
                      title="Remove 1 unit">
                -
              </button>
              <button @click="editItem(item)" 
                      class="btn btn-sm btn-info">
                Edit
              </button>
              <button @click="deleteItem(item.inventory_id)" 
                      class="btn btn-sm btn-danger">
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <p>No inventory items found</p>
      </div>

      <!-- Add Item Modal -->
      <div v-if="showAddModal" class="modal">
        <div class="modal-content">
          <h2>Add New Item</h2>
          <form @submit.prevent="submitAdd">
            <div class="form-group">
              <label>Item Name *</label>
              <input v-model="newItem.item_name" type="text" required />
            </div>
            <div class="form-group">
              <label>Quantity *</label>
              <input v-model.number="newItem.quantity" type="number" required />
            </div>
            <div class="form-group">
              <label>Unit *</label>
              <input v-model="newItem.unit" type="text" placeholder="kg, pieces, liters, etc." required />
            </div>
            <div class="form-group">
              <label>Threshold *</label>
              <input v-model.number="newItem.threshold" type="number" required />
            </div>
            <div class="modal-actions">
              <button type="submit" class="btn btn-primary">Add Item</button>
              <button @click="showAddModal = false" class="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Edit Item Modal -->
      <div v-if="showEditModal" class="modal">
        <div class="modal-content">
          <h2>Edit Item</h2>
          <form @submit.prevent="submitEdit">
            <div class="form-group">
              <label>Item Name *</label>
              <input v-model="editingItem.item_name" type="text" required />
            </div>
            <div class="form-group">
              <label>Quantity *</label>
              <input v-model.number="editingItem.quantity" type="number" required />
            </div>
            <div class="form-group">
              <label>Unit *</label>
              <input v-model="editingItem.unit" type="text" required />
            </div>
            <div class="form-group">
              <label>Threshold *</label>
              <input v-model.number="editingItem.threshold" type="number" required />
            </div>
            <div class="modal-actions">
              <button type="submit" class="btn btn-primary">Save Changes</button>
              <button @click="showEditModal = false" class="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Error Message -->
      <div v-if="error" class="alert alert-danger">
        ❌ {{ error }}
      </div>

      <!-- Loading -->
      <div v-if="loading" class="loading">Loading...</div>
    </div>
  `,

    setup() {
        const {
            items,
            lowStockItems,
            stats,
            loading,
            error,
            fetchAll,
            fetchLowStock,
            fetchStats,
            add,
            update,
            restock,
            use,
            remove
        } = useInventory();

        const showAddModal = ref(false);
        const showEditModal = ref(false);
        const searchQuery = ref('');
        const filterStatus = ref('');

        const newItem = ref({
            item_name: '',
            quantity: 0,
            unit: '',
            threshold: 0
        });

        const editingItem = ref(null);

        const filteredItems = computed(() => {
            return items.value.filter(item => {
                const matchesSearch = item.item_name
                    .toLowerCase()
                    .includes(searchQuery.value.toLowerCase());
                const matchesStatus = !filterStatus.value || item.status === filterStatus.value;
                return matchesSearch && matchesStatus;
            });
        });

        const submitAdd = async () => {
            try {
                await add(newItem.value);
                showAddModal.value = false;
                newItem.value = { item_name: '', quantity: 0, unit: '', threshold: 0 };
            } catch (err) {
                console.error('Add failed:', err);
            }
        };

        const editItem = (item) => {
            editingItem.value = { ...item };
            showEditModal.value = true;
        };

        const submitEdit = async () => {
            try {
                await update(editingItem.value.inventory_id, editingItem.value);
                showEditModal.value = false;
            } catch (err) {
                console.error('Update failed:', err);
            }
        };

        const deleteItem = async (id) => {
            if (!confirm('Delete this item?')) return;
            try {
                await remove(id);
            } catch (err) {
                console.error('Delete failed:', err);
            }
        };

        const quickRestock = async (id) => {
            try {
                await restock(id, 10);
            } catch (err) {
                console.error('Restock failed:', err);
            }
        };

        const quickUse = async (id) => {
            try {
                await use(id, 1);
            } catch (err) {
                console.error('Use failed:', err);
            }
        };

        const formatDate = (dateStr) => {
            if (!dateStr) return '-';
            return new Date(dateStr).toLocaleDateString();
        };

        onMounted(async () => {
            await Promise.all([
                fetchAll(),
                fetchLowStock(),
                fetchStats()
            ]);
        });

        return {
            items,
            lowStockItems,
            stats,
            loading,
            error,
            showAddModal,
            showEditModal,
            searchQuery,
            filterStatus,
            newItem,
            editingItem,
            filteredItems,
            submitAdd,
            editItem,
            submitEdit,
            deleteItem,
            quickRestock,
            quickUse,
            formatDate
        };
    }
};

// ============================================================
// CSS STYLES (Add to your stylesheet)
// ============================================================

const styles = `
.inventory-dashboard {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  border-bottom: 2px solid #eee;
  padding-bottom: 15px;
}

.header h1 {
  margin: 0;
  font-size: 28px;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 30px;
}

.stat-card {
  background: #f5f5f5;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.stat-card.good {
  border-left: 4px solid #4caf50;
}

.stat-card.warning {
  border-left: 4px solid #ff9800;
}

.stat-card.danger {
  border-left: 4px solid #f44336;
}

.stat-number {
  font-size: 24px;
  font-weight: bold;
  color: #333;
}

.stat-label {
  font-size: 12px;
  color: #666;
  margin-top: 5px;
}

.alert {
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.alert-warning {
  background: #fff3cd;
  border: 1px solid #ffc107;
  color: #856404;
}

.alert-danger {
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
}

.alert h3 {
  margin: 0 0 10px 0;
}

.alert-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.alert-list li {
  padding: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0,0,0,0.1);
}

.alert-list li:last-child {
  border-bottom: none;
}

.controls {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.search-input,
.filter-select {
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.search-input {
  flex: 1;
}

.inventory-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.inventory-table thead {
  background: #f5f5f5;
}

.inventory-table th {
  padding: 12px;
  text-align: left;
  font-weight: 600;
  color: #333;
  border-bottom: 2px solid #eee;
}

.inventory-table td {
  padding: 12px;
  border-bottom: 1px solid #eee;
}

.inventory-table tr:hover {
  background: #f9f9f9;
}

.inventory-table tr.status-critical {
  background: #ffebee;
}

.inventory-table tr.status-low {
  background: #fff3e0;
}

.badge {
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 500;
}

.badge.status-good {
  background: #d4edda;
  color: #155724;
}

.badge.status-low {
  background: #fff3cd;
  color: #856404;
}

.badge.status-critical {
  background: #f8d7da;
  color: #721c24;
}

.actions {
  display: flex;
  gap: 5px;
}

.btn {
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

.btn-primary {
  background: #2196f3;
  color: white;
}

.btn-success {
  background: #4caf50;
  color: white;
}

.btn-warning {
  background: #ff9800;
  color: white;
}

.btn-info {
  background: #17a2b8;
  color: white;
}

.btn-danger {
  background: #f44336;
  color: white;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  padding: 30px;
  border-radius: 8px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 5px 20px rgba(0,0,0,0.3);
}

.modal-content h2 {
  margin: 0 0 20px 0;
  color: #333;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
  color: #333;
}

.form-group input {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #2196f3;
  box-shadow: 0 0 5px rgba(33,150,243,0.3);
}

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.modal-actions button {
  flex: 1;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #999;
}

.loading {
  text-align: center;
  padding: 20px;
  color: #666;
}
`;

export default {
    InventoryDashboardComponent,
    useInventory,
    apiCall,
    styles
};
