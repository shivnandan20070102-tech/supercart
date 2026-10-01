import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthContext';

const WishlistContext = createContext();

const getStorageKey = (userId) => `supercart_wishlist_${userId || 'guest'}`;

export const WishlistProvider = ({ children }) => {
  const { user } = useAuth();
  const [wishlistItems, setWishlistItems] = useState([]);

  useEffect(() => {
    try {
      const savedWishlist = localStorage.getItem(getStorageKey(user?.id));
      setWishlistItems(savedWishlist ? JSON.parse(savedWishlist) : []);
    } catch {
      setWishlistItems([]);
    }
  }, [user?.id]);

  const persistWishlist = async (items) => {
    localStorage.setItem(getStorageKey(user?.id), JSON.stringify(items));
    if (user) {
      await supabase.auth.updateUser({
        data: { wishlist: items.map((item) => String(item.id)) },
      });
    }
  };

  const toggleWishlist = (product) => {
    setWishlistItems((currentItems) => {
      const exists = currentItems.some((item) => item.id === product.id);
      const nextItems = exists
        ? currentItems.filter((item) => item.id !== product.id)
        : [...currentItems, product];
      persistWishlist(nextItems);
      return nextItems;
    });
  };

  const isInWishlist = (productId) => wishlistItems.some((item) => item.id === productId);

  return (
    <WishlistContext.Provider value={{ wishlistItems, toggleWishlist, isInWishlist }}>
      {children}
    </WishlistContext.Provider>
  );
};

export const useWishlist = () => {
  const context = useContext(WishlistContext);
  if (!context) throw new Error('useWishlist must be used within a WishlistProvider');
  return context;
};