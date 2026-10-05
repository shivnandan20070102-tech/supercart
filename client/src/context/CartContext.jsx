import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext();

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState(() => {
    try {
      const savedCart = localStorage.getItem('grocery_cart');
      return savedCart ? JSON.parse(savedCart) : [];
    } catch (e) {
      console.error('Failed to load cart from localStorage', e);
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('grocery_cart', JSON.stringify(cartItems));
    } catch (e) {
      console.error('Failed to save cart to localStorage', e);
    }
  }, [cartItems]);

  const stockCapOf = (product) => {
    const s = Number(product?.stock ?? product?.stock_quantity);
    if (!Number.isFinite(s)) return null;
    return Math.max(0, Math.floor(s));
  };

  const addToCart = (product, quantity = 1) => {
    // Out-of-stock product cart me jaye hi nahi; stock pata ho to cap me raho.
    const cap = stockCapOf(product);
    if (cap != null && cap <= 0) return;
    const want = Math.max(1, Math.floor(Number(quantity) || 1));
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.id === product.id);
      if (existingItem) {
        const capNow = stockCapOf({ ...existingItem, stock: product?.stock ?? existingItem?.stock });
        const next = existingItem.quantity + want;
        return prevItems.map((item) =>
          item.id === product.id
            ? { ...item, quantity: capNow != null ? Math.min(next, Math.max(1, capNow)) : next }
            : item
        );
      }
      return [...prevItems, { ...product, quantity: cap != null ? Math.min(want, Math.max(1, cap)) : want }];
    });
  };

  const removeFromCart = (productId) => {
    setCartItems((prevItems) => prevItems.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId, newQuantity) => {
    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCartItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id !== productId) return item;
        const cap = stockCapOf(item);
        const next = Math.floor(Number(newQuantity) || 1);
        return { ...item, quantity: cap != null ? Math.min(Math.max(1, next), Math.max(1, cap)) : Math.max(1, next) };
      })
    );
  };

  const clearCart = () => {
    setCartItems([]);
  };

  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  const subtotal = cartItems.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  const originalSubtotal = cartItems.reduce(
    (total, item) => total + (item.originalPrice || item.price) * item.quantity,
    0
  );

  const savings = originalSubtotal - subtotal;
  const deliveryFee = subtotal > 499 || subtotal === 0 ? 0 : 40;
  const grandTotal = subtotal + deliveryFee;

  return (
    <CartContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        cartCount,
        subtotal,
        originalSubtotal,
        savings,
        deliveryFee,
        grandTotal,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
