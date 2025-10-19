function showTab(tabName) {
    // Hide all content
    document.querySelectorAll('.profile-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected content
    document.getElementById(tabName + 'Content').classList.add('active');
    
    // Add active class to selected tab
    event.target.classList.add('active');
    
    // Load orders if orders tab is selected
    if (tabName === 'orders') {
        loadOrderHistory();
    }
}

function loadOrders() {
    const ordersList = document.getElementById('ordersList');
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const userOrders = orders.filter(order => order.userId === currentUser.id);
    
    if (userOrders.length === 0) {
        ordersList.innerHTML = `
            <div class="empty-cart">
                <i class="fas fa-shopping-bag"></i>
                <h3>No Orders Yet</h3>
                <p>Your order history will appear here once you make your first purchase.</p>
                <a href="index.html" class="checkout-btn" style="display: inline-block; margin-top: 20px;">Start Shopping</a>
            </div>
        `;
    } else {
        ordersList.innerHTML = userOrders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <div class="order-id">Order #${order.id}</div>
                    <div class="order-date">${new Date(order.date).toLocaleDateString()}</div>
                    <div class="order-status">${order.status}</div>
                </div>
                <div class="order-items">
                    ${order.items.map(item => `
                        <div class="order-item">
                            <img src="${item.image}" alt="${item.name}">
                            <div class="order-item-details">
                                <div class="order-item-name">${item.name}</div>
                                <div class="order-item-meta">Qty: ${item.quantity || 1}</div>
                            </div>
                            <div class="order-item-price">₹${((item.price) * (item.quantity || 1)).toLocaleString()}</div>
                        </div>
                    `).join('')}
                </div>
                <div class="order-total">
                    <span>Total: ₹${order.total.toLocaleString()}</span>
                </div>
            </div>
        `).join('');
    }
}

// Initialize profile page
document.addEventListener('DOMContentLoaded', function() {
    loadProfile();
    updateCartCount();
    
    const deliveryForm = document.getElementById('deliveryForm');
    if (deliveryForm) {
        deliveryForm.addEventListener('submit', saveDeliveryDetails);
    }
});