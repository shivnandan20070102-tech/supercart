import { supabase } from '../config/supabase.js';

// @desc    Get all products from Supabase Database
// @route   GET /products or GET /api/products
// @access  Public
export const getProducts = async (req, res) => {
  try {
    const { category, search, featured, store_id: storeId } = req.query;

    let query = supabase.from('products').select('*').order('id', { ascending: true });
    if (!storeId || !Number.isInteger(Number(storeId)) || Number(storeId) <= 0) {
      return res.status(200).json({ success: true, count: 0, data: [], source: 'store_required' });
    }
    query = query.eq('store_id', Number(storeId));

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
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve store products',
        error: error.message,
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
    const storeId = Number(req.query.store_id);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid store_id is required',
      });
    }

    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('store_id', storeId)
      .single();

    if (error || !product) {
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
