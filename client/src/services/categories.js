import { supabase } from '../config/supabase';

export const fetchCategoryRows = async () => {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,image_url')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).filter((category) => String(category.name || '').trim());
};

export const fetchCategories = async () => (await fetchCategoryRows()).map((category) => String(category.name).trim());
