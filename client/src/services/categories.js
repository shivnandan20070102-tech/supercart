import { supabase } from '../config/supabase';

export const fetchCategories = async () => {
  const { data, error } = await supabase
    .from('categories')
    .select('name')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map((category) => String(category.name || '').trim()).filter(Boolean);
};
