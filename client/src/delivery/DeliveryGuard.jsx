import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../config/supabase';

const allowedRoles = new Set(['delivery', 'delivery_partner']);

export default function DeliveryGuard({ children }) {
  const [state, setState] = useState({ loading: true, allowed: false, redirect: null });

  useEffect(() => {
    let active = true;

    const checkAccess = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!active) return;

      if (error || !user) {
        setState({ loading: false, allowed: false, redirect: '/delivery/login' });
        return;
      }

      const { data: profileRow } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;

      const role = String(profileRow?.role || '').toLowerCase();
      if (!allowedRoles.has(role)) {
        setState({ loading: false, allowed: false, redirect: '/delivery/login' });
        return;
      }

      const { data: deliveryProfile } = await supabase
        .from('delivery_profiles')
        .select('user_id, approval_status, profile_completed')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!active) return;

      if (!deliveryProfile) {
        setState({ loading: false, allowed: false, redirect: '/delivery/profile' });
        return;
      }

      const approvalStatus = String(deliveryProfile.approval_status || 'pending').toLowerCase();
      if (approvalStatus === 'rejected') {
        setState({ loading: false, allowed: false, redirect: '/delivery/profile' });
        return;
      }
      if (approvalStatus !== 'approved') {
        setState({ loading: false, allowed: false, redirect: deliveryProfile.profile_completed ? '/delivery/approval-pending' : '/delivery/profile' });
        return;
      }

      setState({ loading: false, allowed: true, redirect: null });
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

  if (state.redirect) {
    return <Navigate to={state.redirect} replace />;
  }

  return children;
}
