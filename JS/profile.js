async function saveProfileDataToServer(userData) {
    try {
        const response = await fetch('http://localhost:3000/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Profile saved to server:', result.message);
        // You can show a more subtle notification here if you want
    } catch (error) {
        console.error('Failed to save profile to server:', error);
        alert('Failed to sync profile with the server. Please try again later.');
    }
}

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
    event.currentTarget.classList.add('active');
    
    // Load orders if orders tab is selected
    if (tabName === 'orders') {
        loadOrderHistory();
    }
}

function loadProfile() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser) {
        document.getElementById('name').value = currentUser.name || '';
        document.getElementById('email').value = currentUser.email || '';
        document.getElementById('phone').value = currentUser.phone || '';
        document.getElementById('city').value = currentUser.city || '';
        document.getElementById('address').value = currentUser.address || '';
        document.getElementById('pincode').value = currentUser.pincode || '';

        document.getElementById('profileName').textContent = currentUser.name || 'User Name';
        document.getElementById('profileEmail').textContent = currentUser.email || 'user@example.com';
        
        // Use profileImage from the user object
        if (currentUser.profileImage) {
            document.getElementById('profileImg').src = currentUser.profileImage;
        }
    }

    // Legacy check for profileImage for backward compatibility
    const profileImage = localStorage.getItem('profileImage');
    if (profileImage && (!currentUser || !currentUser.profileImage)) {
        document.getElementById('profileImg').src = profileImage;
    }
}

function saveProfile(event) {
    event.preventDefault();
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const city = document.getElementById('city').value;
    const address = document.getElementById('address').value;
    const pincode = document.getElementById('pincode').value;

    let currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser) {
        currentUser.name = name;
        currentUser.email = email;
        currentUser.phone = phone;
        currentUser.city = city;
        currentUser.address = address;
        currentUser.pincode = pincode;
        // Ensure profile image is included
        currentUser.profileImage = localStorage.getItem('profileImage') || currentUser.profileImage;

        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        // Save to server
        saveProfileDataToServer(currentUser);

        alert('Profile saved successfully!');
        loadProfile(); // Reload profile to show updated data
    } else {
        alert('No user logged in.');
    }
}

function saveDeliveryDetails(event) {
    event.preventDefault();
    alert('Delivery details saved!');
}

function loadOrderHistory() {
    // Placeholder for loading order history
    console.log('Loading order history...');
}

function updateCartCount() {
    // Placeholder for updating cart count
    console.log('Updating cart count...');
}


function loadOrders() {
    const ordersList = document.getElementById('ordersList');
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
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

function isProfileComplete() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return false;

    const requiredFields = ['name', 'email', 'phone', 'city', 'address', 'pincode'];
    for (const field of requiredFields) {
        if (!currentUser[field]) {
            return false;
        }
    }
    return true;
}

// Initialize profile page
document.addEventListener('DOMContentLoaded', function() {
    loadProfile();
    updateCartCount();
    
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', saveProfile);
    }

    const deliveryForm = document.getElementById('deliveryForm');
    if (deliveryForm) {
        deliveryForm.addEventListener('submit', saveDeliveryDetails);
    }

    const homeButton = document.querySelector('a[href="index.html"]');
    if (homeButton) {
        homeButton.addEventListener('click', function(e) {
            if (!isProfileComplete()) {
                e.preventDefault();
                alert('Please fill and save your profile before proceeding.');
            }
        });
    }

    const profileImgInput = document.getElementById('profileImgInput');
    if (profileImgInput) {
        profileImgInput.addEventListener('change', handleImageUpload);
    }
});

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imageUrl = e.target.result;
            // Save to a separate item for immediate feedback and legacy support
            localStorage.setItem('profileImage', imageUrl); 
            document.getElementById('profileImg').src = imageUrl;

            // Also update the currentUser object and save to server
            let currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (currentUser) {
                currentUser.profileImage = imageUrl;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                saveProfileDataToServer(currentUser);
            }
        }
        reader.readAsDataURL(file);
    }
}