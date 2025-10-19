// Cart functionality
let cart = JSON.parse(localStorage.getItem('cart')) || [];

// Check store status
function checkStoreStatus() {
    const isStoreOnline = localStorage.getItem('storeOnline') !== 'false';
    if (!isStoreOnline) {
        // Display a notification bar
        const storeOfflineBar = document.createElement('div');
        storeOfflineBar.className = 'store-offline-bar';
        storeOfflineBar.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Sorry, the store is corrently closed due to some work going on.';
        document.body.insertBefore(storeOfflineBar, document.body.firstChild);

        // Disable all add to cart buttons
        const addButtons = document.querySelectorAll('.add-btn');
        addButtons.forEach(button => {
            button.classList.add('disabled');
            button.disabled = true;
        });
    }
}

// Load products with enhanced features
function loadProducts() {
    const featuredProducts = document.getElementById('featuredProducts');
    const productsList = document.getElementById('productsList');
    const isStoreOnline = localStorage.getItem('storeOnline') !== 'false';
    
    // Load products from localStorage if available (admin panel integration)
    let currentProducts = products;
    const storedProducts = JSON.parse(localStorage.getItem('products'));
    if (storedProducts && storedProducts.length > 0) {
        currentProducts = storedProducts;
        // Update global products array
        window.products = storedProducts;
    }
    
    const productHTML = currentProducts.map(product => `
        <div class="product-card">
            <div class="discount-badge">${product.discount}</div>
            <img src="${product.image}" alt="${product.name}" onclick="viewProduct(${product.id})">
            <div class="product-details">
                <h3 onclick="viewProduct(${product.id})">${product.name}</h3>
                <div class="product-rating">
                    <div class="stars">
                        ${generateStars(product.rating)}
                    </div>
                    <span class="rating-text">${product.rating}</span>
                </div>
                <div class="product-description">
                    <p class="description-text">${product.shortDescription}</p>
                    <button class="read-more-btn" onclick="toggleDescription(${product.id})">
                        <i class="fas fa-chevron-down"></i> Read More
                    </button>
                    <div class="full-description" id="desc-${product.id}" style="display: none;">
                        <p>${product.description}</p>
                        <p class="product-weight"><strong>Weight:</strong> ${product.weight}</p>
                    </div>
                </div>
                <div class="product-price">
                    <span class="current-price">₹${product.price.toLocaleString()}</span>
                    <span class="original-price">₹${product.originalPrice.toLocaleString()}</span>
                </div>
                <div class="stock-status ${product.inStock ? 'in-stock' : 'out-of-stock'}">
                    ${product.inStock ? 'In Stock' : 'Out of Stock'}
                </div>
                <button class="add-btn ${!product.inStock || !isStoreOnline ? 'disabled' : ''}" 
                        onclick="addToCart(${product.id})" 
                        ${!product.inStock || !isStoreOnline ? 'disabled' : ''}>
                    <i class="fas fa-shopping-cart"></i> ${isStoreOnline ? 'Add to Cart' : 'Store Closed'}
                </button>
            </div>
        </div>
    `).join('');

    if (featuredProducts) {
        featuredProducts.innerHTML = productHTML;
    }
    if (productsList) {
        productsList.innerHTML = productHTML;
    }
}

// Generate star rating
function generateStars(rating) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(rating)) {
            stars += '<i class="fas fa-star"></i>';
        } else if (i === Math.ceil(rating) && rating % 1 !== 0) {
            stars += '<i class="fas fa-star-half-alt"></i>';
        } else {
            stars += '<i class="far fa-star"></i>';
        }
    }
    return stars;
}

// Toggle product description
function toggleDescription(productId) {
    const desc = document.getElementById(`desc-${productId}`);
    const btn = document.querySelector(`[onclick="toggleDescription(${productId})"]`);
    const icon = btn.querySelector('i');
    
    if (desc.style.display === 'none') {
        desc.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
        btn.innerHTML = '<i class="fas fa-chevron-up"></i> Read Less';
    } else {
        desc.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
        btn.innerHTML = '<i class="fas fa-chevron-down"></i> Read More';
    }
}

// View product details
function viewProduct(productId) {
    // Use current products (either from localStorage or default)
    const currentProducts = JSON.parse(localStorage.getItem('products')) || products;
    const product = currentProducts.find(p => p.id === productId);
    if (product) {
        localStorage.setItem('selectedProduct', JSON.stringify(product));
        window.location.href = 'product-details.html';
    }
}

// Enhanced add to cart function
function addToCart(productId) {
    const isStoreOnline = localStorage.getItem('storeOnline') !== 'false';
    if (!isStoreOnline) {
        showNotification('The store is currently closed and not accepting orders.', 'error');
        return;
    }

    // Use current products (either from localStorage or default)
    const currentProducts = JSON.parse(localStorage.getItem('products')) || products;
    const product = currentProducts.find(p => p.id === productId);
    if (product && product.inStock) {
        const existingItem = cart.find(item => item.id === productId);
        if (existingItem) {
            existingItem.quantity = (existingItem.quantity || 1) + 1;
        } else {
            cart.push({...product, quantity: 1});
        }
        localStorage.setItem('cart', JSON.stringify(cart));
        updateCartCount();
        showNotification('Product added to cart!');
    } else if (!product.inStock) {
        showNotification('Product is out of stock!', 'error');
    }
}

// Update cart count
function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        const totalItems = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
        cartCount.textContent = totalItems;
        cartCount.style.display = totalItems > 0 ? 'flex' : 'none';
    }
}

// Enhanced notification system
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        ${message}
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => document.body.removeChild(notification), 300);
    }, 3000);
}

// Filter by category
function filterByCategory(category) {
    const productsList = document.getElementById('productsList');
    if (productsList) {
        // Use current products (either from localStorage or default)
        const currentProducts = JSON.parse(localStorage.getItem('products')) || products;
        const filteredProducts = category ? currentProducts.filter(p => p.category === category) : currentProducts;
        productsList.innerHTML = filteredProducts.map(product => `
            <div class="product-card">
                <div class="discount-badge">${product.discount}</div>
                <img src="${product.image}" alt="${product.name}" onclick="viewProduct(${product.id})">
                <div class="product-details">
                    <h3 onclick="viewProduct(${product.id})">${product.name}</h3>
                    <div class="product-rating">
                        <div class="stars">${generateStars(product.rating)}</div>
                        <span class="rating-text">${product.rating}</span>
                    </div>
                    <div class="product-description">
                        <p class="description-text">${product.shortDescription}</p>
                        <button class="read-more-btn" onclick="toggleDescription(${product.id})">
                            <i class="fas fa-chevron-down"></i> Read More
                        </button>
                        <div class="full-description" id="desc-${product.id}" style="display: none;">
                            <p>${product.description}</p>
                            <p class="product-weight"><strong>Weight:</strong> ${product.weight}</p>
                        </div>
                    </div>
                    <div class="product-price">
                        <span class="current-price">₹${product.price.toLocaleString()}</span>
                        <span class="original-price">₹${product.originalPrice.toLocaleString()}</span>
                    </div>
                    <div class="stock-status ${product.inStock ? 'in-stock' : 'out-of-stock'}">
                        ${product.inStock ? 'In Stock' : 'Out of Stock'}
                    </div>
                    <button class="add-btn ${!product.inStock ? 'disabled' : ''}" 
                            onclick="addToCart(${product.id})" 
                            ${!product.inStock ? 'disabled' : ''}>
                        <i class="fas fa-shopping-cart"></i> Add to Cart
                    </button>
                </div>
            </div>
        `).join('');
    }
}

// Search functionality
function searchProducts() {
    const searchInput = document.getElementById('searchInput') || document.getElementById('productSearch');
    const productsList = document.getElementById('featuredProducts') || document.getElementById('productsList');
    
    if (searchInput && productsList) {
        const searchTerm = searchInput.value.toLowerCase();
        // Use current products (either from localStorage or default)
        const currentProducts = JSON.parse(localStorage.getItem('products')) || products;
        const filteredProducts = currentProducts.filter(product => 
            product.name.toLowerCase().includes(searchTerm) ||
            product.description.toLowerCase().includes(searchTerm) ||
            product.category.toLowerCase().includes(searchTerm)
        );
        
        productsList.innerHTML = filteredProducts.map(product => `
            <div class="product-card">
                <div class="discount-badge">${product.discount}</div>
                <img src="${product.image}" alt="${product.name}" onclick="viewProduct(${product.id})">
                <div class="product-details">
                    <h3 onclick="viewProduct(${product.id})">${product.name}</h3>
                    <div class="product-rating">
                        <div class="stars">${generateStars(product.rating)}</div>
                        <span class="rating-text">${product.rating}</span>
                    </div>
                    <div class="product-description">
                        <p class="description-text">${product.shortDescription}</p>
                        <button class="read-more-btn" onclick="toggleDescription(${product.id})">
                            <i class="fas fa-chevron-down"></i> Read More
                        </button>
                        <div class="full-description" id="desc-${product.id}" style="display: none;">
                            <p>${product.description}</p>
                            <p class="product-weight"><strong>Weight:</strong> ${product.weight}</p>
                        </div>
                    </div>
                    <div class="product-price">
                        <span class="current-price">₹${product.price.toLocaleString()}</span>
                        <span class="original-price">₹${product.originalPrice.toLocaleString()}</span>
                    </div>
                    <div class="stock-status ${product.inStock ? 'in-stock' : 'out-of-stock'}">
                        ${product.inStock ? 'In Stock' : 'Out of Stock'}
                    </div>
                    <button class="add-btn ${!product.inStock ? 'disabled' : ''}" 
                            onclick="addToCart(${product.id})" 
                            ${!product.inStock ? 'disabled' : ''}>
                        <i class="fas fa-shopping-cart"></i> Add to Cart
                    </button>
                </div>
            </div>
        `).join('');
    }
}

// Load cart items
function loadCartItems() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const deliveryChargeEl = document.getElementById('deliveryCharge');
    const grandTotalEl = document.getElementById('grandTotal');
    
    if (cartItems) {
        if (cart.length === 0) {
            cartItems.innerHTML = `
                <div class="empty-cart">
                    <i class="fas fa-shopping-cart" style="font-size: 48px; color: #ccc; margin-bottom: 20px;"></i>
                    <h3>Your cart is empty</h3>
                    <p>Add some products to get started!</p>
                    <a href="index.html" class="checkout-btn" style="display: inline-block; margin-top: 20px;">Continue Shopping</a>
                </div>
            `;
        } else {
            cartItems.innerHTML = cart.map(item => `
                <div class="cart-item">
                    <img src="${item.image}" alt="${item.name}">
                    <div class="cart-item-details">
                        <h3>${item.name}</h3>
                        <div class="cart-item-price">₹${item.price.toLocaleString()} each</div>
                        <div class="quantity-controls">
                            <button onclick="updateQuantity(${item.id}, -1)">-</button>
                            <span>${item.quantity || 1}</span>
                            <button onclick="updateQuantity(${item.id}, 1)">+</button>
                        </div>
                    </div>
                    <div class="cart-item-total">₹${((item.price) * (item.quantity || 1)).toLocaleString()}</div>
                    <button class="remove-btn" onclick="removeFromCart(${item.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `).join('');
        }
    }
    
    if (cartTotal) {
        const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
        cartTotal.textContent = `₹${subtotal.toLocaleString()}`;

        const deliverySettings = JSON.parse(localStorage.getItem('deliverySettings')) || {};
        const deliveryCharge = parseFloat(deliverySettings.charge) || 0;
        const freeDeliveryAbove = parseFloat(deliverySettings.freeAbove) || 0;

        let finalDeliveryCharge = 0;
        if (subtotal > 0 && subtotal < freeDeliveryAbove) {
            finalDeliveryCharge = deliveryCharge;
        }

        if (deliveryChargeEl) {
            deliveryChargeEl.textContent = `₹${finalDeliveryCharge.toLocaleString()}`;
        }

        if (grandTotalEl) {
            const grandTotal = subtotal + finalDeliveryCharge;
            grandTotalEl.textContent = `₹${grandTotal.toLocaleString()}`;
        }
    }
}

// Update quantity
function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (item) {
        item.quantity = Math.max(1, (item.quantity || 1) + change);
        localStorage.setItem('cart', JSON.stringify(cart));
        loadCartItems();
        updateCartCount();
    }
}

// Remove from cart
function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    localStorage.setItem('cart', JSON.stringify(cart));
    loadCartItems();
    updateCartCount();
    showNotification('Item removed from cart!');
}

// Proceed to checkout
function proceedToCheckout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }
    if (!checkAuthentication(true)) {
        // Redirect to login, saving the checkout page as the destination
        localStorage.setItem('redirectUrl', 'checkout.html');
        window.location.href = 'login.html';
        return;
    }
    window.location.href = 'checkout.html';
}

// Authentication state management
let isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;

// Enhanced authentication functions
function toggleAuth() {
    const loginSection = document.getElementById('loginSection');
    const signupSection = document.getElementById('signupSection');
    
    if (loginSection && signupSection) {
        if (loginSection.style.display === 'none') {
            loginSection.style.display = 'block';
            signupSection.style.display = 'none';
        } else {
            loginSection.style.display = 'none';
            signupSection.style.display = 'block';
        }
    }
}

function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    // Simple validation
    if (!email || !password) {
        showNotification('Please fill all fields!', 'error');
        return;
    }
    
    // Check if user exists in localStorage
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
        // Login successful
        isAuthenticated = true;
        currentUser = user;
        localStorage.setItem('isAuthenticated', 'true');
        localStorage.setItem('currentUser', JSON.stringify(user));
        
        showNotification('Login successful!');
        
        // Redirect to intended page or profile
        const redirectUrl = localStorage.getItem('redirectUrl');
        if (redirectUrl) {
            localStorage.removeItem('redirectUrl');
            window.location.href = redirectUrl;
        } else {
            window.location.href = 'profile.html';
        }
    } else {
        showNotification('Invalid email or password!', 'error');
    }
}

function handleSignup(event) {
    event.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // Validation
    if (!name || !email || !password || !confirmPassword) {
        showNotification('Please fill all fields!', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showNotification('Passwords do not match!', 'error');
        return;
    }
    
    if (password.length < 6) {
        showNotification('Password must be at least 6 characters long!', 'error');
        return;
    }
    
    // Check if user already exists
    const users = JSON.parse(localStorage.getItem('users')) || [];
    const existingUser = users.find(u => u.email === email);
    
    if (existingUser) {
        showNotification('User with this email already exists!', 'error');
        return;
    }
    
    // Create new user
    const newUser = {
        id: Date.now(),
        name: name,
        email: email,
        password: password,
        createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    localStorage.setItem('users', JSON.stringify(users));
    
    // Auto-login after signup
    isAuthenticated = true;
    currentUser = newUser;
    localStorage.setItem('isAuthenticated', 'true');
    localStorage.setItem('currentUser', JSON.stringify(newUser));
    
    showNotification('Account created successfully!');
    
    // Redirect to intended page or profile
    const redirectUrl = localStorage.getItem('redirectUrl');
    if (redirectUrl) {
        localStorage.removeItem('redirectUrl');
        window.location.href = redirectUrl;
    } else {
        window.location.href = 'profile.html';
    }
}

function logout() {
    isAuthenticated = false;
    currentUser = null;
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('currentUser');
    showNotification('Logged out successfully!');
    setTimeout(() => {
        window.location.href = 'login.html';
    }, 1000);
}

function checkAuthentication(redirect = false) {
    if (!isAuthenticated) {
        if (redirect) {
            localStorage.setItem('redirectUrl', window.location.pathname);
            window.location.href = 'login.html';
        }
        return false;
    }
    return true;
}

// Enhanced profile management with authentication
function loadProfile() {
    if (!checkAuthentication(true)) return;
    
    const profileForm = document.getElementById('profileForm');
    if (profileForm && currentUser) {
        profileForm.name.value = currentUser.name || '';
        profileForm.email.value = currentUser.email || '';
        profileForm.phone.value = currentUser.phone || '';
        profileForm.address.value = currentUser.address || '';
        profileForm.city.value = currentUser.city || '';
        profileForm.pincode.value = currentUser.pincode || '';
    }
    
    // Update profile display
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    if (profileName && currentUser) profileName.textContent = currentUser.name;
    if (profileEmail && currentUser) profileEmail.textContent = currentUser.email;
    
    // Load delivery details if they exist
    const deliveryDetails = JSON.parse(localStorage.getItem('deliveryDetails')) || {};
    const deliveryForm = document.getElementById('deliveryForm');
    if (deliveryForm && deliveryDetails) {
        deliveryForm.deliveryAddress.value = deliveryDetails.address || '';
        deliveryForm.deliveryCity.value = deliveryDetails.city || '';
        deliveryForm.deliveryPincode.value = deliveryDetails.pincode || '';
        deliveryForm.deliveryTime.value = deliveryDetails.time || 'anytime';
        deliveryForm.deliveryType.value = deliveryDetails.type || 'standard';
        deliveryForm.deliveryInstructions.value = deliveryDetails.instructions || '';
    }
    
    // Load order history
    loadOrderHistory();
}

function saveProfile() {
    if (!checkAuthentication(true)) return;

    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        // Get the selected image file
        const profileImageInput = document.getElementById('profileImage');
        const profileImageFile = profileImageInput.files[0];

        // Update current user data
        currentUser.name = profileForm.name.value;
        currentUser.email = profileForm.email.value;
        currentUser.phone = profileForm.phone.value;
        currentUser.address = profileForm.address.value;
        currentUser.city = profileForm.city.value;
        currentUser.pincode = profileForm.pincode.value;

        // Handle image upload
        if (profileImageFile) {
            const reader = new FileReader();
            reader.onload = function(e) {
                currentUser.profileImage = e.target.result; // Store base64 encoded image
                updateUserAndProfile(currentUser);
            }
            reader.readAsDataURL(profileImageFile);
        } else {
            updateUserAndProfile(currentUser);
        }

        console.log('Saving profile with image:', currentUser.profileImage);

        function updateUserAndProfile(user) {
            // Update users array
            const users = JSON.parse(localStorage.getItem('users')) || [];
            const userIndex = users.findIndex(u => u.id === user.id);
            if (userIndex !== -1) {
                users[userIndex] = user;
                localStorage.setItem('users', JSON.stringify(users));
            }

            localStorage.setItem('currentUser', JSON.stringify(user));
            showNotification('Profile saved successfully!');
    
            // Update profile display
            const profileName = document.getElementById('profileName');
            const profileEmail = document.getElementById('profileEmail');
            if (profileName) profileName.textContent = user.name;
            if (profileEmail) profileEmail.textContent = user.email;
    
            // Update profile image
            updateProfileImage(user.profileImage);
    
            // Reload profile to display the updated image
            loadProfile();
        }
    }
}

// Enhanced delivery details management
function saveDeliveryDetails(event) {
    if (!checkAuthentication(true)) return;
    
    event.preventDefault();
    const form = event.target;
    const deliveryData = {
        address: form.deliveryAddress.value,
        city: form.deliveryCity.value,
        pincode: form.deliveryPincode.value,
        time: form.deliveryTime.value,
        type: form.deliveryType.value,
        instructions: form.deliveryInstructions.value
    };
    
    localStorage.setItem('deliveryDetails', JSON.stringify(deliveryData));
    showNotification('Delivery details saved successfully!');
}

// Order History Functions
function loadOrderHistory() {
    if (!checkAuthentication(true)) return;
    
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const userOrders = orders.filter(order => order.userId === currentUser.id);
    
    // Update order stats
    const totalOrdersCount = document.getElementById('totalOrdersCount');
    const totalSpent = document.getElementById('totalSpent');
    
    if (totalOrdersCount) {
        totalOrdersCount.textContent = userOrders.length;
    }
    
    if (totalSpent) {
        const totalAmount = userOrders.reduce((sum, order) => sum + order.total, 0);
        totalSpent.textContent = `₹${totalAmount.toLocaleString()}`;
    }
    
    // Load orders list
    const ordersList = document.getElementById('ordersList');
    const noOrdersMessage = document.getElementById('noOrdersMessage');
    
    if (userOrders.length === 0) {
        if (ordersList) ordersList.style.display = 'none';
        if (noOrdersMessage) noOrdersMessage.style.display = 'block';
    } else {
        if (ordersList) ordersList.style.display = 'block';
        if (noOrdersMessage) noOrdersMessage.style.display = 'none';
        
        if (ordersList) {
            ordersList.innerHTML = userOrders.map(order => `
                <div class="order-card">
                    <div class="order-header">
                        <div>
                            <div class="order-id">Order #${order.id}</div>
                            <div class="order-date">${new Date(order.date).toLocaleDateString()}</div>
                        </div>
                        <div class="order-status ${order.status}">${order.status}</div>
                    </div>
                    
                    <div class="order-items">
                        ${order.items.map(item => `
                            <div class="order-item">
                                <div>
                                    <div class="item-name">${item.name}</div>
                                    <div class="item-quantity">Qty: ${item.quantity || 1}</div>
                                </div>
                                <div class="item-price">₹${((item.price) * (item.quantity || 1)).toLocaleString()}</div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="order-total">
                        <span>Total Amount:</span>
                        <span>₹${order.total.toLocaleString()}</span>
                    </div>
                    
                    <div class="order-actions">
                        <button class="order-action-btn primary" onclick="viewOrderDetails(${order.id})">
                            <i class="fas fa-eye"></i> View Details
                        </button>
                        ${order.status === 'delivered' ? `
                            <button class="order-action-btn secondary" onclick="reorderItems(${order.id})">
                                <i class="fas fa-redo"></i> Reorder
                            </button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        }
    }
}

function filterUserOrders(status) {
    if (!checkAuthentication(true)) return;
    
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const userOrders = orders.filter(order => order.userId === currentUser.id);
    const filteredOrders = status ? userOrders.filter(order => order.status === status) : userOrders;
    
    const ordersList = document.getElementById('ordersList');
    const noOrdersMessage = document.getElementById('noOrdersMessage');
    
    if (filteredOrders.length === 0) {
        if (ordersList) ordersList.style.display = 'none';
        if (noOrdersMessage) {
            noOrdersMessage.style.display = 'block';
            noOrdersMessage.innerHTML = `
                <i class="fas fa-search"></i>
                <h4>No Orders Found</h4>
                <p>No orders found with status "${status}".</p>
                <button class="shop-btn" onclick="filterUserOrders('')">
                    <i class="fas fa-list"></i> Show All Orders
                </button>
            `;
        }
    } else {
        if (ordersList) ordersList.style.display = 'block';
        if (noOrdersMessage) noOrdersMessage.style.display = 'none';
        
        if (ordersList) {
            ordersList.innerHTML = filteredOrders.map(order => `
                <div class="order-card">
                    <div class="order-header">
                        <div>
                            <div class="order-id">Order #${order.id}</div>
                            <div class="order-date">${new Date(order.date).toLocaleDateString()}</div>
                        </div>
                        <div class="order-status ${order.status}">${order.status}</div>
                    </div>
                    
                    <div class="order-items">
                        ${order.items.map(item => `
                            <div class="order-item">
                                <div>
                                    <div class="item-name">${item.name}</div>
                                    <div class="item-quantity">Qty: ${item.quantity || 1}</div>
                                </div>
                                <div class="item-price">₹${((item.price) * (item.quantity || 1)).toLocaleString()}</div>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="order-total">
                        <span>Total Amount:</span>
                        <span>₹${order.total.toLocaleString()}</span>
                    </div>
                    
                    <div class="order-actions">
                        <button class="order-action-btn primary" onclick="viewOrderDetails(${order.id})">
                            <i class="fas fa-eye"></i> View Details
                        </button>
                        ${order.status === 'delivered' ? `
                            <button class="order-action-btn secondary" onclick="reorderItems(${order.id})">
                                <i class="fas fa-redo"></i> Reorder
                            </button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        }
    }
}

function viewOrderDetails(orderId) {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const order = orders.find(o => o.id === orderId);
    
    if (order) {
        // Create modal to show order details
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Order Details - #${order.id}</h3>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div style="padding: 1.5rem;">
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
                        <h4>Delivery Information</h4>
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
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

function reorderItems(orderId) {
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    const order = orders.find(o => o.id === orderId);
    
    if (order) {
        // Add items to cart
        order.items.forEach(item => {
            addToCart(item.id);
        });
        
        showNotification('Items added to cart for reorder!', 'success');
        
        // Redirect to cart
        setTimeout(() => {
            window.location.href = 'cart.html';
        }, 1500);
    }
}

// Enhanced checkout with authentication check
function proceedToCheckout() {
    if (!checkAuthentication(true)) return;
    
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }
    window.location.href = 'checkout.html';
}

// Enhanced order placement with authentication
function placeOrder() {
    if (!checkAuthentication(true)) return;
    
    const form = document.getElementById('checkoutForm');
    const formData = new FormData(form);
    
    // Simple validation
    if (!formData.get('fullName') || !formData.get('phone') || !formData.get('address')) {
        showNotification('Please fill all required fields!', 'error');
        return;
    }
    
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
    const deliverySettings = JSON.parse(localStorage.getItem('deliverySettings')) || {};
    const deliveryCharge = parseFloat(deliverySettings.charge) || 0;
    const freeDeliveryAbove = parseFloat(deliverySettings.freeAbove) || 0;

    let finalDeliveryCharge = 0;
    if (subtotal > 0 && subtotal < freeDeliveryAbove) {
        finalDeliveryCharge = deliveryCharge;
    }

    const grandTotal = subtotal + finalDeliveryCharge;
    
    // Save order details
    const orderDetails = {
        id: Date.now(),
        userId: currentUser.id,
        items: [...cart],
        subtotal: subtotal,
        deliveryCharge: finalDeliveryCharge,
        total: grandTotal,
        customerInfo: {
            name: formData.get('fullName'),
            phone: formData.get('phone'),
            address: formData.get('address'),
            city: formData.get('city'),
            pincode: formData.get('pincode'),
            instructions: formData.get('instructions')
        },
        date: new Date().toISOString(),
        status: 'pending'
    };
    
    // Save to orders history
    const orders = JSON.parse(localStorage.getItem('orders')) || [];
    orders.push(orderDetails);
    localStorage.setItem('orders', JSON.stringify(orders));
    
    // --- नया कोड: एडमिन के लिए नोटिफिकेशन बनाएं ---
    const adminNotifications = JSON.parse(localStorage.getItem('adminNotifications')) || [];
    const newNotification = {
        id: Date.now(),
        title: 'New Order Received',
        message: `New order #${orderDetails.id} from ${orderDetails.customerInfo.name} for ₹${orderDetails.total.toLocaleString()}.`,
        date: new Date().toISOString(),
        read: false
    };
    adminNotifications.unshift(newNotification); // सबसे नया नोटिफिकेशन सबसे ऊपर दिखाएं
    localStorage.setItem('adminNotifications', JSON.stringify(adminNotifications));
    // ---------------------------------------------

    // Clear cart and show success message
    localStorage.removeItem('cart');
    cart = [];
    updateCartCount();
    
    showNotification('Order placed successfully! Thank you for shopping with us.');
    
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 2000);
}

// Load footer
function loadFooter() {
    const footer = document.createElement('footer');
    footer.id = 'footer';
    // Use footerData from data.js as a default
    let currentFooterData = typeof footerData !== 'undefined' ? footerData : {};
    const storedFooterData = JSON.parse(localStorage.getItem('footerData'));
    if (storedFooterData) {
        currentFooterData = storedFooterData;
    }

    footer.innerHTML = `
        <div class="footer-container">
            <div class="footer-section">
                <h4>Contact Us</h4>
                <p><i class="fas fa-phone"></i> <span>${currentFooterData.phone || ''}</span></p>
                <p><i class="fas fa-envelope"></i> <span>${currentFooterData.email || ''}</span></p>
            </div>
            <div class="footer-section">
                <h4>Our Address</h4>
                <p><i class="fas fa-map-marker-alt"></i> <span>${currentFooterData.address || ''}</span></p>
            </div>
            <div class="footer-section">
                <h4>Follow Us</h4>
                <div class="social-icons">
                    <a href="#" class="social-icon"><i class="fab fa-facebook-f"></i></a>
                    <a href="#" class="social-icon"><i class="fab fa-twitter"></i></a>
                    <a href="#" class="social-icon"><i class="fab fa-instagram"></i></a>
                </div>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; ${new Date().getFullYear()} SuperCart. All rights reserved.</p>
        </div>
    `;
    document.body.appendChild(footer);
}

function loadHeaderActions() {
    const headerActions = document.querySelector('.header-actions');
    if (headerActions) {
        const footerData = JSON.parse(localStorage.getItem('footerData'));
        const whatsappNumber = footerData?.whatsapp;

        if (whatsappNumber) {
            // Remove any existing whatsapp icon to prevent duplicates
            const existingIcon = headerActions.querySelector('.fa-whatsapp');
            if (existingIcon) existingIcon.parentElement.remove();

            const whatsappLink = document.createElement('a');
            whatsappLink.href = `https://wa.me/${whatsappNumber.replace(/\D/g, '')}`;
            whatsappLink.target = '_blank';
            whatsappLink.innerHTML = `<i class="fab fa-whatsapp"></i>`;
            headerActions.appendChild(whatsappLink);
        }
    }
}

// Initialize app with authentication check
// Load categories
function loadCategories() {
    const categoriesGrid = document.querySelector('.categories-grid');
    if (categoriesGrid) {
        let categories = JSON.parse(localStorage.getItem('categories'));

        if (!categories || categories.length === 0) {
            // If no categories in localStorage, use default and save them
            categories = [
                { id: 'groceries', name: 'Groceries', icon: 'fas fa-apple-alt', image: 'https://images.unsplash.com/photo-1542838130-92c53300491e?w=300&h=200&fit=crop' },
                { id: 'electronics', name: 'Electronics', icon: 'fas fa-laptop', image: 'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=300&h=200&fit=crop' },
                { id: 'clothing', name: 'Clothing', icon: 'fas fa-tshirt', image: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=300&h=200&fit=crop' }
            ];
            localStorage.setItem('categories', JSON.stringify(categories));
        }

        categoriesGrid.innerHTML = categories.map(category => `
            <div class="category-card" onclick="filterByCategory('${category.id}')">
                <i class="${category.icon}"></i>
                <span>${category.name}</span>
            </div>
        `).join('');
    }
}

function loadCheckoutSummary() {
    const orderItems = document.getElementById('orderItems');
    const orderSubtotal = document.getElementById('orderSubtotal');
    const orderDeliveryCharge = document.getElementById('orderDeliveryCharge');
    const orderTotal = document.getElementById('orderTotal');

    if (cart.length === 0) {
        if(orderItems) orderItems.innerHTML = '<p>No items in cart</p>';
        if(orderSubtotal) orderSubtotal.textContent = '₹0';
        if(orderDeliveryCharge) orderDeliveryCharge.textContent = '₹0';
        if(orderTotal) orderTotal.textContent = '₹0';
        return;
    }

    if(orderItems) {
        orderItems.innerHTML = cart.map(item => `
            <div class="order-item">
                <div class="order-item-details">
                    <div class="order-item-name">${item.name}</div>
                    <div class="order-item-meta">Qty: ${item.quantity || 1}</div>
                </div>
                <div class="order-item-price">₹${((item.price) * (item.quantity || 1)).toLocaleString()}</div>
            </div>
        `).join('');
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
    const deliverySettings = JSON.parse(localStorage.getItem('deliverySettings')) || {};
    const deliveryCharge = parseFloat(deliverySettings.charge) || 0;
    const freeDeliveryAbove = parseFloat(deliverySettings.freeAbove) || 0;

    let finalDeliveryCharge = 0;
    if (subtotal > 0 && subtotal < freeDeliveryAbove) {
        finalDeliveryCharge = deliveryCharge;
    }

    const grandTotal = subtotal + finalDeliveryCharge;

    if(orderSubtotal) orderSubtotal.textContent = `₹${subtotal.toLocaleString()}`;
    if(orderDeliveryCharge) orderDeliveryCharge.textContent = `₹${finalDeliveryCharge.toLocaleString()}`;
    if(orderTotal) orderTotal.textContent = `₹${grandTotal.toLocaleString()}`;
}

// Initialize app with authentication check
document.addEventListener('DOMContentLoaded', function() {
    checkStoreStatus(); // Check if the store is online or offline

    // Initialize products from localStorage if available
    const storedProducts = JSON.parse(localStorage.getItem('products'));
    if (storedProducts && storedProducts.length > 0) {
        window.products = storedProducts;
    }
    
    // Check if we're on login page
    const path = window.location.pathname;
    const isLoginPage = path.includes('login.html');
    const isAdminPage = path.includes('/admin/');
    
    if (!isAuthenticated && !isLoginPage && !isAdminPage) {
        window.location.href = 'login.html';
        return; // Stop further execution on the page
    }
    
    // Initialize page-specific functionality
    if (window.location.pathname.includes('login.html')) {
        if (isAuthenticated) {
            window.location.href = 'profile.html';
            return;
        }
        // Login page specific initialization
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', handleLogin);
        }
        
        const signupForm = document.getElementById('signupForm');
        if (signupForm) {
            signupForm.addEventListener('submit', handleSignup);
        }
        
        const showSignup = document.getElementById('showSignup');
        const showLogin = document.getElementById('showLogin');
        if (showSignup) showSignup.addEventListener('click', toggleAuth);
        if (showLogin) showLogin.addEventListener('click', toggleAuth);
        
        // Hide signup section by default
        const signupSection = document.getElementById('signupSection');
        if (signupSection) {
            signupSection.style.display = 'none';
        }


    } else {
        // Other pages initialization
        loadProducts();
        loadCategories();
        updateCartCount();
        loadCartItems();
        if (window.location.pathname.includes('checkout.html')) {
            loadCheckoutSummary();
        }
        loadHeaderActions();
        loadProfile();
        loadFooter();
        
        // Add event listeners
        const searchInput = document.getElementById('searchInput') || document.getElementById('productSearch');
        if (searchInput) {
            searchInput.addEventListener('input', searchProducts);
        }
        
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => filterByCategory(e.target.value));
        }
        
        const priceFilter = document.getElementById('priceFilter');
        if (priceFilter) {
            priceFilter.addEventListener('change', (e) => filterByPrice(e.target.value));
        }
        
        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => {
                e.preventDefault();
                saveProfile();
            });
        }
        
        const deliveryForm = document.getElementById('deliveryForm');
        if (deliveryForm) {
            deliveryForm.addEventListener('submit', saveDeliveryDetails);
        }


        
        // Listen for storage changes (admin panel updates)
        window.addEventListener('storage', function(e) {
            if (e.key === 'products' || e.key === 'storeOnline') {
                // Reload products when admin panel updates them or store status changes
                loadProducts();
                checkStoreStatus();
            }
        });
        
        function updateProfileImage(imageData) {
            console.log('Updating profile image with data:', imageData);
            const profileAvatar = document.querySelector('.profile-avatar');
            if (profileAvatar) {
                profileAvatar.innerHTML = imageData ? `<img src="${imageData}" alt="Profile Image">` : `<i class="fas fa-user"></i>`;
            }
        }
    }
});