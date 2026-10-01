import { supabase } from '../config/supabase';

/**
 * Admin action ko admin_activity_log me save karo.
 * Best-effort: kabhi throw nahi karta — logging fail ho to admin ka
 * asli kaam (approve/delete/assign) NAHI rukna chahiye.
 * admin_id khud auth session se nikalta hai (koi prop drilling nahi).
 */
export const logAdminActivity = async ({ actionType, targetId = '', description = '' }) => {
  try {
    if (!actionType) return;
    let adminId = null;
    try {
      const { data } = await supabase.auth.getUser();
      adminId = data?.user?.id || null;
    } catch {
      /* ignore — admin_id null rahega */
    }
    const { error } = await supabase.from('admin_activity_log').insert({
      admin_id: adminId,
      action_type: String(actionType),
      target_id: String(targetId ?? ''),
      description: String(description ?? '').slice(0, 500),
    });
    if (error) {
      try {
        console.warn('[activityLog] insert failed:', error.message);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    try {
      console.warn('[activityLog] failed:', e?.message || e);
    } catch {
      /* ignore */
    }
  }
};

export default logAdminActivity;
