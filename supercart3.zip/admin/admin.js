// Admin Panel JavaScript

// Admin authentication
const ADMIN_CREDENTIALS = {
    username: 'shiv',
    password: 'ankit'
};

let isAdminLoggedIn = localStorage.getItem('adminLoggedIn') === 'true';

// Check admin authentication
function checkAdminAuth() {
    const loginContainer = document.querySelector('.login-container');
    const adminLayout = document.querySelector('.admin-layout');

    if (isAdminLoggedIn) {
        loginContainer.style.display = 'none';
        adminLayout.style.display = 'flex';
        loadDashboardData();
    } else {
        loginContainer.style.display = 'flex';
        adminLayout.style.display = 'none';
    }
}

// Admin login
function handleAdminLogin(event) {
    event.preventDefault();
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        isAdminLoggedIn = true;
        localStorage.setItem('adminLoggedIn', 'true');
        showNotification('Login successful!', 'success');
        checkAdminAuth();
    } else {
        showNotification('Invalid credentials!', 'error');
    }
}

// Admin logout
function adminLogout() {
    isAdminLoggedIn = false;
    localStorage.removeItem('adminLoggedIn');
    showNotification('Logged out successfully!', 'success');
    checkAdminAuth();
}

// Navigation
function switchSection(sectionName) {
    // Hide all sections
    const sections = document.querySelectorAll('[id$="Section"]');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Show selected section
    const targetSection = document.getElementById(sectionName + 'Section');
    if (targetSection) {
        targetSection.style.display = 'block';
    }
    
    // Update active menu item
    const menuItems = document.querySelectorAll('.sidebar-menu li');
    menuItems.forEach(item => {
        item.classList.remove('active');
    });
    
    const activeItem = document.querySelector(`[data-section="${sectionName}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // Update page title
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.textContent = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
    }
    
    // Load section data
    loadSectionData(sectionName);
}

// Load section data
function loadSectionData(sectionName) {
    switch(sectionName) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'products':
            loadProductsData();
            break;
        case 'orders':
            loadOrdersData();
            // Add notification for new orders
            const orders = JSON.parse(localStorage.getItem('orders')) || [];
            const recentOrders = orders.filter(order => {
                const orderDate = new Date(order.date);
                const now = new Date();
                const diffHours = (now - orderDate) / (1000 * 60 * 60);
                return diffHours <= 24; // Orders from last 24 hours
            });
            if (recentOrders.length > 0) {
                addNotification(`${recentOrders.length} new orders in last 24 hours`, 'New Orders');
            }
            break;
        case 'users':
            loadUsersData();
            break;
        case 'categories':
            loadCategoriesData();
            break;
        case 'notifications':
            loadNotificationsData();
            break;
        case 'settings':
            loadFooterSettings();
            break;
    }
}

// Dashboard data
function loadDashboardData() {
    // Initialize products in localStorage if not exists
    if (!localStorage.getItem('products') && window.products) {
        localStorage.setItem('products', JSON.stringify(window.products));
    }
    
    const products = JSON.parse(localStorage.getItem('products')) || window.products || [];
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const users = JSON.parse(localStorage.getItem('users')) || [];
    
    // Update stats
    document.getElementById('totalProducts').textContent = products.length;
    document.getElementById('totalOrders').textContent = orders.length;
    document.getElementById('totalUsers').textContent = users.length;
    
    const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
    document.getElementById('totalRevenue').textContent = `₹${totalRevenue.toLocaleString()}`;
    
    // Load recent orders
    loadRecentOrders();
    
    // Load low stock products
    loadLowStockProducts();
    
    // Load pending actions
    loadPendingActions();
}

// Recent orders
function loadRecentOrders() {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const recentOrders = orders.slice(-5).reverse();
    
    const container = document.getElementById('recentOrders');
    if (container) {
        if (recentOrders.length === 0) {
            container.innerHTML = '<p>No recent orders!</p>';
        } else {
            container.innerHTML = recentOrders.map(order => `
                <div class="recent-order-item">
                    <div class="order-info">
                        <strong>Order #${order.id}</strong>
                        <span class="status-badge status-${order.status}">${order.status}</span>
                    </div>
                    <div class="order-details">
                        <span>${order.customerInfo.name}</span>
                        <span>₹${order.total.toLocaleString()}</span>
                    </div>
                </div>
            `).join('');
        }
    }
}

// Low stock products
function loadLowStockProducts() {
    const products = JSON.parse(localStorage.getItem('products')) || window.products || [];
    const lowStockProducts = products.filter(product => !product.inStock);
    
    const container = document.getElementById('lowStockProducts');
    if (container) {
        if (lowStockProducts.length === 0) {
            container.innerHTML = '<p>All products are in stock!</p>';
        } else {
            container.innerHTML = lowStockProducts.map(product => `
                <div class="low-stock-item">
                    <strong>${product.name}</strong>
                    <span class="status-badge status-out-of-stock">Out of Stock</span>
                </div>
            `).join('');
        }
    }
}

// Pending actions
function loadPendingActions() {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const pendingOrders = orders.filter(order => order.status === 'pending');
    
    const container = document.getElementById('pendingActions');
    if (container) {
        if (pendingOrders.length === 0) {
            container.innerHTML = '<p>No pending actions!</p>';
        } else {
            container.innerHTML = `
                <div class="pending-action">
                    <strong>${pendingOrders.length} orders pending</strong>
                    <button class="btn-primary" onclick="switchSection('orders')">View Orders</button>
                </div>
            `;
        }
    }
}

// Products management
function loadProductsData() {
    // Initialize products in localStorage if not exists
    if (!localStorage.getItem('products') && window.products) {
        localStorage.setItem('products', JSON.stringify(window.products));
    }
    
    const products = JSON.parse(localStorage.getItem('products')) || window.products || [];
    const tableBody = document.getElementById('productsTableBody');
    
    if (tableBody) {
        tableBody.innerHTML = products.map(product => `
            <tr>
                <td>${product.id}</td>
                <td>${product.name}</td>
                <td>${product.category}</td>
                <td>₹${product.price.toLocaleString()}</td>
                <td>${product.weight}</td>
                <td>
                    <span class="status-badge ${product.inStock ? 'status-in-stock' : 'status-out-of-stock'}">
                        ${product.inStock ? 'In Stock' : 'Out of Stock'}
                    </span>
                </td>
                <td>
                    <button class="btn-secondary" onclick="editProduct(${product.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-danger" onclick="deleteProduct(${product.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

// Orders management
function loadOrdersData() {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const tableBody = document.getElementById('ordersTableBody');

    if (tableBody) {
        if (orders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No orders found!</td></tr>';
        } else {
            tableBody.innerHTML = orders.reverse().map(order => { // .reverse() to show newest first
                let actionButtons = '';
                if (order.status === 'pending') {
                    actionButtons = `<button class="btn-primary" onclick="updateOrderStatus(${order.id}, 'confirmed')" title="Accept Order"><i class="fas fa-check"></i> Accept</button>`;
                } else {
                    actionButtons = `
                        <select onchange="updateOrderStatus(${order.id}, this.value)" style="margin-left: 5px;">
                            <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                            <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option>
                            <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    `;
                }

                return `
                    <tr>
                        <td>#${order.id}</td>
                        <td>${order.customerInfo.name}</td>
                        <td>${order.customerInfo.phone}</td>
                        <td>
                            <div style="display: flex; align-items: center;">
                                <img src="${order.items[0]?.image || 'https://via.placeholder.com/40'}" alt="${order.items[0]?.name}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 5px; margin-right: 10px;">
                                <div>
                                    ${order.items.map(item => `<div>${item.name} (x${item.quantity || 1})</div>`).join('')}
                                </div>
                            </div>
                        </td>
                        <td>₹${order.total.toLocaleString()}</td>
                        <td>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </td>
                        <td>${new Date(order.date).toLocaleDateString()}</td>
                        <td>
                            <button class="btn-secondary" onclick="viewOrderDetails(${order.id})" title="View Details"><i class="fas fa-eye"></i></button>
                            <a href="https://wa.me/91${order.customerInfo.phone.replace(/\D/g,'')}" target="_blank" class="btn-whatsapp" title="Chat on WhatsApp"><i class="fab fa-whatsapp"></i></a>
                            ${actionButtons}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }
}

// Users management
function loadUsersData() {
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const tableBody = document.getElementById('usersTableBody');
    
    if (tableBody) {
        if (users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No users found!</td></tr>';
        } else {
            tableBody.innerHTML = users.map(user => {
                const userOrders = orders.filter(order => order.userId === user.id);
                return `
                    <tr>
                        <td>${user.id}</td>
                        <td>${user.name}</td>
                        <td>${user.email}</td>
                        <td>${user.phone || 'N/A'}</td>
                        <td>${userOrders.length}</td>
                        <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                        <td>
                            <button class="btn-secondary" onclick="viewUserOrders(${user.id})">
                                <i class="fas fa-eye"></i>
                            </button>
                            <a href="https://wa.me/91${(user.phone || '').replace(/\D/g,'')}" target="_blank" class="btn-whatsapp" title="Chat on WhatsApp"><i class="fab fa-whatsapp"></i></a>
                            <button class="btn-danger" onclick="deleteUser(${user.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }
}

// Categories management
function loadCategoriesData() {
    if (!localStorage.getItem('categories')) {
        const defaultCategories = [
            { id: 'groceries', name: 'Groceries', icon: 'fas fa-apple-alt', image: 'https://images.unsplash.com/photo-1542838130-92c53300491e?w=300&h=200&fit=crop' },
            { id: 'electronics', name: 'Electronics', icon: 'fas fa-laptop', image: 'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=300&h=200&fit=crop' },
            { id: 'clothing', name: 'Clothing', icon: 'fas fa-tshirt', image: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=300&h=200&fit=crop' }
        ];
        localStorage.setItem('categories', JSON.stringify(defaultCategories));
    }
    const categories = JSON.parse(localStorage.getItem('categories')) || [];
    const tableBody = document.getElementById('categoriesTableBody');

    if (tableBody) {
        tableBody.innerHTML = categories.map(category => `
            <tr>
                <td>${category.id}</td>
                <td><img src="${category.image || 'https://via.placeholder.com/50'}" alt="${category.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 5px;"></td>
                <td>${category.name}</td>
                <td>
                    <button class="btn-secondary" onclick="editCategory('${category.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-danger" onclick="deleteCategory('${category.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

function showAddCategoryModal() {
    document.getElementById('addCategoryModal').classList.add('show');
}

function closeAddCategoryModal() {
    document.getElementById('addCategoryModal').classList.remove('show');
    document.getElementById('addCategoryForm').reset();
    const imagePreview = document.getElementById('categoryImagePreview');
    imagePreview.src = '#';
    imagePreview.style.display = 'none';
    document.getElementById('addCategoryForm').removeAttribute('data-edit-id');
}

function addCategory(event) {
    event.preventDefault();
    const form = event.target;
    const categoryName = form.name.value;
    const imageFile = document.getElementById('categoryImageFile').files[0];
    const editId = form.getAttribute('data-edit-id');
    let categories = JSON.parse(localStorage.getItem('categories')) || [];

    const processAndSave = (imageUrl) => {
        if (editId) {
            // Editing existing category
            const categoryIndex = categories.findIndex(c => c.id === editId);
            if (categoryIndex > -1) {
                categories[categoryIndex].name = categoryName;
                // Only update image if a new one was provided.
                if (imageUrl) {
                    categories[categoryIndex].image = imageUrl;
                }
                showNotification('Category updated successfully!', 'success');
            }
        } else {
            // Adding new category
            const newId = categoryName.toLowerCase().replace(/\s+/g, '-');
            const newCategory = {
                id: newId,
                name: categoryName,
                image: imageUrl || 'https://via.placeholder.com/50', // Use placeholder if no image
                icon: 'fas fa-tag'
            };
            categories.push(newCategory);
            showNotification('Category added successfully!', 'success');
        }

        localStorage.setItem('categories', JSON.stringify(categories));
        if (window.categories) {
            window.categories = categories;
        }
        loadCategoriesData();
        closeAddCategoryModal();
    };

    if (imageFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            processAndSave(e.target.result); // Pass the new image data URL
        };
        reader.readAsDataURL(imageFile);
    } else {
        // If no new image file, it's an edit without image change.
        // We pass undefined for imageUrl, so the existing image is preserved.
        processAndSave(undefined);
    }
}

function editCategory(categoryId) {
    const categories = JSON.parse(localStorage.getItem('categories')) || [];
    const category = categories.find(c => c.id === categoryId);
    if (category) {
        document.getElementById('categoryName').value = category.name;
        const imagePreview = document.getElementById('categoryImagePreview');
        if (category.image) {
            imagePreview.src = category.image;
            imagePreview.style.display = 'block';
        } else {
            imagePreview.style.display = 'none';
        }
        document.getElementById('addCategoryForm').setAttribute('data-edit-id', category.id);
        document.querySelector('#addCategoryModal .modal-header h3').textContent = 'Edit Category';
        document.querySelector('#addCategoryModal button[type="submit"]').textContent = 'Update Category';
        showAddCategoryModal();
    }
}

function deleteCategory(categoryId) {
    if (confirm('Are you sure you want to delete this category?')) {
        let categories = JSON.parse(localStorage.getItem('categories')) || [];
        categories = categories.filter(c => c.id !== categoryId);
        localStorage.setItem('categories', JSON.stringify(categories));
        if(window.categories) {
            window.categories = categories;
        }
        loadCategoriesData();
        showNotification('Category deleted successfully!', 'success');
    }
}


// Payment Methods
function loadPaymentMethodsData() {
    const container = document.querySelector('#settingsSection #paymentSettingsForm');
    if (container) {
        // Get saved methods or use defaults
        const savedMethods = JSON.parse(localStorage.getItem('enabledPaymentMethods'));

        const allMethods = [
            { id: 'cod', name: 'Cash on Delivery', enabled: true },
            { id: 'online', name: 'Online Payment (Razorpay)', enabled: true },
            { id: 'card', name: 'Credit/Debit Card', enabled: false },
            { id: 'upi', name: 'UPI', enabled: true },
            { id: 'wallet', name: 'Mobile Wallet', enabled: false }
        ];

        const paymentMethods = allMethods.map(method => {
            if (savedMethods) {
                return { ...method, enabled: savedMethods.includes(method.id) };
            }
            return method;
        });

        let paymentMethodsHTML = '<p>Select which payment methods are available for customers at checkout.</p>';
        paymentMethodsHTML += '<div class="payment-methods-list">';

        paymentMethods.forEach(method => {
            paymentMethodsHTML += `
                <div class="payment-method-item">
                    <label for="payment-${method.id}">${method.name}</label>
                    <label class="switch"><input type="checkbox" id="payment-${method.id}" data-method-id="${method.id}" ${method.enabled ? 'checked' : ''}><span class="slider round"></span></label>
                </div>
            `;
        });

        paymentMethodsHTML += '</div>';
        paymentMethodsHTML += '<button class="btn-primary" onclick="savePaymentMethods()">Save Settings</button>';

        container.innerHTML = paymentMethodsHTML;
    }
}

function savePaymentMethods() {
    const checkboxes = document.querySelectorAll('.payment-methods-list input[type="checkbox"]');
    const enabledMethodIds = [];
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            enabledMethodIds.push(checkbox.getAttribute('data-method-id'));
        }
    });
    localStorage.setItem('enabledPaymentMethods', JSON.stringify(enabledMethodIds));
    showNotification('Payment methods saved successfully!', 'success');
}

function handlePaymentSettingsSave(event) {
    event.preventDefault();
    savePaymentMethods();
}

// API Settings
function handleApiSettingsSave(event) {
    event.preventDefault();
    const apiData = {
        keyId: document.getElementById('razorpayKeyId').value,
        keySecret: document.getElementById('razorpayKeySecret').value
    };
    localStorage.setItem('razorpayApiKeys', JSON.stringify(apiData));
    showNotification('API settings saved successfully!', 'success');
}

function handleUpiSettingsSave(event) {
    event.preventDefault();
    const upiId = document.getElementById('upiId').value;
    localStorage.setItem('upiId', upiId); // Save UPI ID separately

    // Also, ensure the UPI payment method is enabled
    if (upiId) {
        let enabledMethods = JSON.parse(localStorage.getItem('enabledPaymentMethods')) || [];
        if (!enabledMethods.includes('upi')) {
            enabledMethods.push('upi');
            localStorage.setItem('enabledPaymentMethods', JSON.stringify(enabledMethods));
        }
    }
    loadPaymentMethodsData(); // Refresh the toggles to show the change
    showNotification('UPI settings saved successfully!', 'success');
}

function loadApiSettings() {
    const apiData = JSON.parse(localStorage.getItem('razorpayApiKeys'));
    if (apiData) {
        document.getElementById('razorpayKeyId').value = apiData.keyId || '';
        document.getElementById('razorpayKeySecret').value = apiData.keySecret || '';
    }
    // Load UPI ID separately
    const upiId = localStorage.getItem('upiId');
    if (upiId) {
        document.getElementById('upiId').value = upiId;
    }
}


// Notifications
function loadNotificationsData() {
    const notifications = JSON.parse(localStorage.getItem('adminNotifications')) || [];
    const container = document.getElementById('notificationsList');
    
    if (container) {
        if (notifications.length === 0) {
            container.innerHTML = '<p>No notifications!</p>';
        } else {
            container.innerHTML = notifications.map(notification => `
                <div class="notification-item ${notification.read ? '' : 'unread'}">
                    <h4>${notification.title}</h4>
                    <p>${notification.message}</p>
                    <small>${new Date(notification.date).toLocaleString()}</small>
                </div>
            `).join('');
        }
    }
}

// Product management functions
function showAddProductModal() {
    document.getElementById('addProductModal').classList.add('show');
}

function closeAddProductModal() {
    document.getElementById('addProductModal').classList.remove('show');
    document.getElementById('addProductForm').reset();
    
    // Reset modal title and button text
    document.querySelector('#addProductModal .modal-header h3').textContent = 'Add New Product';
    document.querySelector('#addProductModal .modal-footer button[type="submit"]').textContent = 'Add Product';
    
    // Remove edit ID attribute
    document.getElementById('addProductForm').removeAttribute('data-edit-id');
}

function addProduct(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const productData = Object.fromEntries(formData.entries());
    const imageFile = document.getElementById('productImageFile').files[0];
    const existingImageUrl = document.getElementById('productImage').value;
    
    const products = JSON.parse(localStorage.getItem('products')) || window.products || [];
    const editId = event.target.getAttribute('data-edit-id');
    
    if (editId) {
        // Editing existing product
        const productIndex = products.findIndex(p => p.id === parseInt(editId));
        if (productIndex === -1) return;

        const updateProduct = (imageUrl) => {
            products[productIndex] = {
                ...products[productIndex], ...productData,
                image: imageUrl,
                price: parseFloat(productData.price),
                originalPrice: parseFloat(productData.originalPrice),
                rating: parseFloat(productData.rating),
                inStock: productData.inStock === 'on',
                discount: calculateDiscount(productData.price, productData.originalPrice)
            };
            saveAndReload(products, `Product "${productData.name}" updated`);
        };

        if (imageFile) {
            const reader = new FileReader();
            reader.onload = (e) => updateProduct(e.target.result);
            reader.readAsDataURL(imageFile);
        } else {
            updateProduct(existingImageUrl);
        }
    } else {
        // Adding new product
        const createProduct = (imageUrl) => {
            const newId = Math.max(...products.map(p => p.id), 0) + 1;
            const newProduct = {
                id: newId, ...productData,
                image: imageUrl,
                price: parseFloat(productData.price),
                originalPrice: parseFloat(productData.originalPrice),
                rating: parseFloat(productData.rating),
                inStock: productData.inStock === 'on',
                discount: calculateDiscount(productData.price, productData.originalPrice)
            };
            products.push(newProduct);
            saveAndReload(products, `New product "${newProduct.name}" added`);
        };

        if (imageFile) {
            const reader = new FileReader();
            reader.onload = (e) => createProduct(e.target.result);
            reader.readAsDataURL(imageFile);
        } else {
            createProduct(existingImageUrl || 'https://via.placeholder.com/300x200.png?text=No+Image'); // Fallback image
        }
    }
}

function saveAndReload(products, notificationMessage) {
    localStorage.setItem('products', JSON.stringify(products));
    
    // Update window.products if it exists
    if (window.products) {
        const productIndex = window.products.findIndex(p => p.id === products[products.length - 1].id);
        if (productIndex !== -1) {
            window.products[productIndex] = products[productIndex];
        } else {
            window.products = products;
        }
    }
    
    showNotification(notificationMessage.includes('updated') ? 'Product updated successfully!' : 'Product added successfully!', 'success');
    addNotification(notificationMessage, 'Product Update');
    
    loadProductsData();
    loadDashboardData();
    closeAddProductModal();
}

function calculateDiscount(price, originalPrice) {
    const discount = Math.round(((originalPrice - price) / originalPrice) * 100);
    return `${discount}% OFF`;
}

function editProduct(productId) {
    const products = JSON.parse(localStorage.getItem('products')) || window.products || [];
    const product = products.find(p => p.id === productId);
    
    if (product) {
        // Fill form with product data
        document.getElementById('productName').value = product.name;
        document.getElementById('productCategory').value = product.category;
        document.getElementById('productPrice').value = product.price;
        document.getElementById('productOriginalPrice').value = product.originalPrice;
        document.getElementById('productDescription').value = product.description;
        document.getElementById('productShortDescription').value = product.shortDescription;
        document.getElementById('productWeight').value = product.weight;
        document.getElementById('productRating').value = product.rating;
        document.getElementById('productInStock').checked = product.inStock;

        // Handle image preview and hidden input
        const imagePreview = document.getElementById('imagePreview');
        const productImageInput = document.getElementById('productImage');
        
        productImageInput.value = product.image; // Store current image URL/Data URL
        imagePreview.src = product.image;
        imagePreview.style.display = 'block';

        document.getElementById('productImageFile').value = ''; // Clear file input
        
        // Change modal title and button text for editing
        document.querySelector('#addProductModal .modal-header h3').textContent = 'Edit Product';
        document.querySelector('#addProductModal .modal-footer button[type="submit"]').textContent = 'Update Product';
        
        // Store product ID for editing
        document.getElementById('addProductForm').setAttribute('data-edit-id', productId);
        
        showAddProductModal();
    }
}

function deleteProduct(productId) {
    if (confirm('Are you sure you want to delete this product?')) {
        const products = JSON.parse(localStorage.getItem('products')) || window.products || [];
        const updatedProducts = products.filter(p => p.id !== productId);
        
        localStorage.setItem('products', JSON.stringify(updatedProducts));
        
        // Update window.products if it exists
        if (window.products) {
            window.products = updatedProducts;
        }
        
        showNotification('Product deleted successfully!', 'success');
        loadProductsData();
        loadDashboardData();
        
        // Add notification for main app refresh
        addNotification(`Product deleted from store`, 'Product Deleted');
    }
}

// Order management functions
function viewOrderDetails(orderId) {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const order = orders.find(o => o.id === orderId);
    
    if (order) {
        const modal = document.getElementById('orderDetailsModal'); // Get the modal element
        const content = document.getElementById('orderDetailsContent'); // Get the content area within the modal
        
        content.innerHTML = `
            
                <div class="order-detail-section">
                    <h4>Order Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <strong>Order ID:</strong> #${order.id}
                        </div>
                        <div class="detail-item">
                            <strong>Order Date:</strong> ${new Date(order.date).toLocaleString()}
                        </div>
                        <div class="detail-item">
                            <strong>Status:</strong> 
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </div>
                        <div class="detail-item">
                            <strong>Total Amount:</strong> ₹${order.total.toLocaleString()}
                        </div>
                    </div>
                </div>
                
                <div class="order-detail-section">
                    <h4>Customer Information</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <strong>Name:</strong> ${order.customerInfo.name}
                        </div>
                        <div class="detail-item">
                            <strong>Phone:</strong> ${order.customerInfo.phone}
                        </div>
                        <div class="detail-item">
                            <strong>Address:</strong> ${order.customerInfo.address}
                        </div>
                        <div class="detail-item">
                            <strong>Landmark:</strong> ${order.customerInfo.landmark || 'N/A'}
                        </div>
                        <div class="detail-item">
                            <strong>City:</strong> ${order.customerInfo.city}
                        </div>
                        <div class="detail-item">
                            <strong>Pincode:</strong> ${order.customerInfo.pincode}
                        </div>
                        <div class="detail-item">
                            <strong>Instructions:</strong> ${order.customerInfo.instructions || 'None'}
                        </div>
                    </div>
                </div>
                
                <div class="order-detail-section">
                    <h4>Order Items</h4>
                    <div class="order-items-list">
                        ${order.items.map(item => `
                            <div class="order-item-detail" style="display: flex; align-items: center;">
                                <img src="${item.image}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 5px; margin-right: 1rem;">
                                <div class="item-info">
                                    <strong>${item.name}</strong>
                                    <div class="item-meta">
                                        <span>Price: ₹${item.price.toLocaleString()}</span>
                                        <span>Quantity: ${item.quantity || 1}</span>
                                        <span>Total: ₹${((item.price) * (item.quantity || 1)).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="order-detail-section">
                    <h4>Order Summary</h4>
                    <div class="order-summary">
                        <div class="summary-row">
                            <span>Items Total:</span>
                            <span>₹${order.total.toLocaleString()}</span>
                        </div>
                        <div class="summary-row">
                            <span>Delivery Charges:</span>
                            <span>₹0</span>
                        </div>
                        <div class="summary-row total">
                            <span>Grand Total:</span>
                            <span>₹${order.total.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
        `;
        
        modal.classList.add('show');
    }
}

function closeOrderDetailsModal() {
    document.getElementById('orderDetailsModal').classList.remove('show');
}

// User management functions
function viewUserOrders(userId) {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const userOrders = orders.filter(order => order.userId === userId);
    
    if (userOrders.length === 0) {
        showNotification('No orders found for this user!', 'error');
    } else {
        // Create modal to show user orders
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>User Orders</h3>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div style="padding: 1.5rem;">
                    ${userOrders.map(order => `
                        <div style="border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 5px;">
                            <strong>Order #${order.id}</strong>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                            <p>Total: ₹${order.total.toLocaleString()}</p>
                            <p>Date: ${new Date(order.date).toLocaleDateString()}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

function deleteUser(userId) {
    if (confirm('Are you sure you want to delete this user?')) {
        const users = JSON.parse(localStorage.getItem('users')) || [];
        const updatedUsers = users.filter(u => u.id !== userId);
        
        localStorage.setItem('users', JSON.stringify(updatedUsers));
        
        showNotification('User deleted successfully!', 'success');
        loadUsersData();
        loadDashboardData();
    }
}

// Notification functions
function addNotification(message, title = 'System Notification') {
    const notifications = JSON.parse(localStorage.getItem('adminNotifications')) || [];
    const newNotification = {
        id: Date.now(),
        title: title,
        message: message,
        date: new Date().toISOString(),
        read: false
    };
    
    notifications.unshift(newNotification);
    localStorage.setItem('adminNotifications', JSON.stringify(notifications));
}

function markAllAsRead() {
    const notifications = JSON.parse(localStorage.getItem('adminNotifications')) || [];
    notifications.forEach(notification => {
        notification.read = true;
    });
    
    localStorage.setItem('adminNotifications', JSON.stringify(notifications));
    loadNotificationsData();
    showNotification('All notifications marked as read!', 'success');
}

// Notification system
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#27ae60' : '#e74c3c'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 5px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        ${message}
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => notification.style.transform = 'translateX(0)', 100);
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => document.body.removeChild(notification), 300);
    }, 3000);
}

// Filter orders by status
function filterOrdersByStatus(status) {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const filteredOrders = status ? orders.filter(order => order.status === status) : orders;
    const tableBody = document.getElementById('ordersTableBody');
    
    if (tableBody) {
        if (filteredOrders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No orders found!</td></tr>';
        } else {
            tableBody.innerHTML = filteredOrders.map(order => `
                <tr>
                    <td>#${order.id}</td>
                    <td>${order.customerInfo.name}</td>
                    <td>${order.customerInfo.phone}</td>
                    <td>${order.items.length} items</td>
                    <td>₹${order.total.toLocaleString()}</td>
                    <td>
                        <span class="status-badge status-${order.status}">${order.status}</span>
                    </td>
                    <td>${new Date(order.date).toLocaleDateString()}</td>
                    <td>
                        <button class="btn-secondary" onclick="viewOrderDetails(${order.id})" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <select onchange="updateOrderStatus(${order.id}, this.value)" style="margin-left: 5px;">
                            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option>
                            <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </td>
                </tr>
            `).join('');
        }
    }
}


function updateOrderStatus(orderId, newStatus) {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const orderIndex = orders.findIndex(o => o.id === orderId);

    if (orderIndex !== -1) {
        orders[orderIndex].status = newStatus;
        localStorage.setItem('orders', JSON.stringify(orders));
        
        // Add a notification for the user
        addNotification(`Order #${orderId} status updated to ${newStatus}`, 'Order Update');
        
        // Reload orders to reflect the change
        loadOrdersData();
        
        // Also reload dashboard data to update stats
        loadDashboardData();
        
        showNotification(`Order status updated to ${newStatus}!`, 'success');
    } else {
        showNotification('Order not found!', 'error');
    }
}

// Search users
function searchUsers(searchTerm) {
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const filteredUsers = searchTerm ? 
        users.filter(user => 
            user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase())
        ) : users;
    
    const tableBody = document.getElementById('usersTableBody');
    
    if (tableBody) {
        if (filteredUsers.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No users found!</td></tr>';
        } else {
            tableBody.innerHTML = filteredUsers.map(user => {
                const userOrders = orders.filter(order => order.userId === user.id);
                return `
                    <tr>
                        <td>${user.id}</td>
                        <td>${user.name}</td>
                        <td>${user.email}</td>
                        <td>${user.phone || 'N/A'}</td>
                        <td>${userOrders.length}</td>
                        <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                        <td>
                            <button class="btn-secondary" onclick="viewUserOrders(${user.id})">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-danger" onclick="deleteUser(${user.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }
}


function handleFooterSettingsSave(event) {
    event.preventDefault();
    const footerData = {
        phone: document.getElementById('footerPhone').value,
        email: document.getElementById('footerEmail').value,
        address: document.getElementById('footerAddress').value,
        whatsapp: document.getElementById('footerWhatsapp').value
    };
    localStorage.setItem('footerData', JSON.stringify(footerData));
    showNotification('Footer settings saved successfully!', 'success');
}

function loadFooterSettings() {
    loadDeliverySettings();
    const footerData = JSON.parse(localStorage.getItem('footerData'));
    if (footerData) {
        loadApiSettings(); // Also load API settings on settings page
        document.getElementById('footerPhone').value = footerData.phone || '';
        document.getElementById('footerEmail').value = footerData.email || '';
        document.getElementById('footerAddress').value = footerData.address || '';
        document.getElementById('footerWhatsapp').value = footerData.whatsapp || '';
    }
}

function handleDeliverySettingsSave(event) {
    event.preventDefault();
    const deliveryData = {
        charge: document.getElementById('deliveryCharge').value,
        freeAbove: document.getElementById('freeDeliveryAbove').value,
        pincodes: document.getElementById('deliveryPincodes').value.split(',').map(p => p.trim()),
    };
    localStorage.setItem('deliverySettings', JSON.stringify(deliveryData));
    showNotification('Delivery settings saved successfully!', 'success');
}

function loadDeliverySettings() {
    const deliveryData = JSON.parse(localStorage.getItem('deliverySettings'));
    if (deliveryData) {
        document.getElementById('deliveryCharge').value = deliveryData.charge || '';
        document.getElementById('freeDeliveryAbove').value = deliveryData.freeAbove || '';
        document.getElementById('deliveryPincodes').value = (deliveryData.pincodes || []).join(', ');
    }
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function() {
    // Initialize products in localStorage if not exists
    if (!localStorage.getItem('products') && window.products) {
        localStorage.setItem('products', JSON.stringify(window.products));
    }
    
    checkAdminAuth();

    const loginForm = document.getElementById('adminLoginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleAdminLogin);
    }

    // Initialize sidebar navigation
    const menuItems = document.querySelectorAll('.sidebar-menu li');
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.getAttribute('data-section');
            if (section) {
                switchSection(section);
            }
        });
    });
    
    // Initialize sidebar toggle for mobile
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    const sidebar = document.querySelector('.admin-sidebar');
    
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show');
            document.body.classList.toggle('sidebar-open');
            
            let overlay = document.querySelector('.sidebar-overlay');
            if (sidebar.classList.contains('show') && !overlay) {
                overlay = document.createElement('div');
                overlay.className = 'sidebar-overlay';
                document.body.appendChild(overlay);
                overlay.addEventListener('click', () => {
                    sidebar.classList.remove('show');
                    document.body.classList.remove('sidebar-open');
                    overlay.remove();
                });
            } else if (!sidebar.classList.contains('show') && overlay) {
                overlay.remove();
            }
        });
    }
    
    // Initialize add product form
    const addProductForm = document.getElementById('addProductForm');
    if (addProductForm) {
        addProductForm.addEventListener('submit', addProduct);
    }

    // Initialize add category form
    const addCategoryForm = document.getElementById('addCategoryForm');
    if (addCategoryForm) {
        addCategoryForm.addEventListener('submit', addCategory);
    }

    const footerSettingsForm = document.getElementById('footerSettingsForm');
    if (footerSettingsForm) {
        footerSettingsForm.addEventListener('submit', handleFooterSettingsSave);
    }

    const deliverySettingsForm = document.getElementById('deliverySettingsForm');
    if (deliverySettingsForm) {
        deliverySettingsForm.addEventListener('submit', handleDeliverySettingsSave);
    }

    const apiSettingsForm = document.getElementById('apiSettingsForm');
    if (apiSettingsForm) {
        apiSettingsForm.addEventListener('submit', handleApiSettingsSave);
    }

    const upiSettingsForm = document.getElementById('upiSettingsForm');
    if (upiSettingsForm) {
        upiSettingsForm.addEventListener('submit', handleUpiSettingsSave);
    }


    const paymentSettingsForm = document.getElementById('paymentSettingsForm');
    if (paymentSettingsForm) {
        // This form is now handled by the generic savePaymentMethods function
        paymentSettingsForm.addEventListener('submit', handlePaymentSettingsSave);
    }

    // Add event listener for image preview
    const categoryImageFile = document.getElementById('categoryImageFile');
    if (categoryImageFile) {
        categoryImageFile.addEventListener('change', function(event) {
            const imagePreview = document.getElementById('categoryImagePreview');
            if (event.target.files && event.target.files[0]) {
                imagePreview.src = URL.createObjectURL(event.target.files[0]);
                imagePreview.style.display = 'block';
            }
        });
    }

    // Add event listener for image preview
    const productImageFile = document.getElementById('productImageFile');
    if (productImageFile) {
        productImageFile.addEventListener('change', function(event) {
            const imagePreview = document.getElementById('imagePreview');
            if (event.target.files && event.target.files[0]) {
                imagePreview.src = URL.createObjectURL(event.target.files[0]);
                imagePreview.style.display = 'block';
            }
        });
    }
    
    // Initialize order status filter
    const orderStatusFilter = document.getElementById('orderStatusFilter');
    if (orderStatusFilter) {
        orderStatusFilter.addEventListener('change', (e) => {
            filterOrdersByStatus(e.target.value);
        });
    }
    
    // Initialize user search
    const userSearch = document.getElementById('userSearch');
    if (userSearch) {
        userSearch.addEventListener('input', (e) => {
            searchUsers(e.target.value);
        });
    }
    
    // Add test order if no orders exist (for testing)
    const existingOrders = JSON.parse(localStorage.getItem('orders')) || [];
    if (existingOrders.length === 0) {
        const testOrder = {
            id: Date.now(),
            userId: 1,
            items: [
                {
                    id: 1,
                    name: "Fresh Red Apples",
                    price: 150,
                    quantity: 2
                }
            ],
            total: 300,
            customerInfo: {
                name: "Test Customer",
                phone: "9876543210",
                address: "Test Address, Test City",
                city: "Test City",
                pincode: "123456",
                instructions: "Test order"
            },
            date: new Date().toISOString(),
            status: 'pending'
        };
        
        localStorage.setItem('orders', JSON.stringify([testOrder]));
        addNotification('Test order added for demonstration', 'Test Order');
    }
    
    // Listen for storage changes (new orders)
    window.addEventListener('storage', function(e) {
        if (e.key === 'orders') {
            // Reload orders when new order is placed
            loadOrdersData();
            loadDashboardData();
        }
    });
    
    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('show');
        }
    });
    
    // Close order details modal when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.id === 'orderDetailsModal') {
            closeOrderDetailsModal();
        }
    });

    // Store Status Toggle
    const storeStatusToggle = document.getElementById('storeStatusToggle');
    const storeStatusText = document.getElementById('storeStatusText');

    // Set initial state
    let isStoreOnline = localStorage.getItem('storeOnline') !== 'false';
    storeStatusToggle.checked = isStoreOnline;
    updateStoreStatus(isStoreOnline);

    storeStatusToggle.addEventListener('change', () => {
        const newStatus = storeStatusToggle.checked;
        updateStoreStatus(newStatus);
        localStorage.setItem('storeOnline', newStatus);
        showNotification(`Store is now ${newStatus ? 'Online' : 'Offline'}`, 'success');
    });

    function updateStoreStatus(isOnline) {
        if (isOnline) {
            storeStatusText.textContent = 'Online';
            storeStatusText.style.color = '#27ae60'; // Green
        } else {
            storeStatusText.textContent = 'Offline';
            storeStatusText.style.color = '#e74c3c'; // Red
        }
    }
});
