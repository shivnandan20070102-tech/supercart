import { supabase } from '../config/supabase.js';
import { initialProducts } from '../data/seedData.js';

// @desc    Get all products from Supabase Database
// @route   GET /products or GET /api/products
// @access  Public
export const getProducts = async (req, res) => {
  try {
    const { category, search, featured } = req.query;

    let query = supabase.from('products').select('*').order('id', { ascending: true });

    if (category && category !== 'all') {
      query = query.ilike('category', `%${category}%`);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (featured === 'true') {
      query = query.eq('is_featured', true);
    }

    const { data: products, error } = await query;

    if (error) {
      console.warn('⚠️ Supabase Products Query Warning:', error.message);
      // If table is not yet created in Supabase, return seed products with note
      return res.status(200).json({
        success: true,
        count: initialProducts.length,
        data: initialProducts,
        source: 'seed_fallback',
        note: 'Please run server/supabase_schema.sql in Supabase SQL editor to link live database tables.',
      });
    }

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve products from database',
      error: error.message,
    });
  }
};

// @desc    Get single product by Supabase ID
// @route   GET /products/:id or GET /api/products/:id
// @access  Public
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !product) {
      // Fallback check in initialProducts
      const fallback = initialProducts.find((p, index) => String(index + 1) === id || p.name === id);
      if (fallback) {
        return res.status(200).json({ success: true, data: fallback, source: 'seed_fallback' });
      }

      return res.status(404).json({
        success: false,
        message: 'Product not found in Supabase database',
      });
    }

    res.status(200).json({
      success: true,
      data: product,
      source: 'supabase_cloud_database',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message,
    });
  }
};
