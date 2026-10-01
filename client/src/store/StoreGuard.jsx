import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

// Sirf store_manager role — Admin account banata hai, khud signup nahi hota.
export default function StoreGuard({ children }) {
  const [state, setState] = useState({ loading: true, allowed: false });

  useEffect(() => {
    let active = true;

    const checkAccess = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!active) return;

      if (error || !user) {
        setState({ loading: false, allowed: false });
        return;
      }

      const { data: profileRow } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;

      const isManager = String(profileRow?.role || '').toLowerCase() === 'store_manager';
      setState({ loading: false, allowed: isManager });
    };

    checkAccess();

    return () => {
      active = false;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-emerald-300">
        <div className="text-sm font-semibold tracking-[0.2em] uppercase">Checking access...</div>
      </div>
    );
  }

  if (!state.allowed) {
    return <Navigate to="/store/login" replace />;
  }

  return children;
}
