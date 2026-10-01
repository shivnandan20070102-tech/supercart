// ===================================================
// SuperCart — Pending Assignment Background Worker
// ---------------------------------------------------
// Har 30 second me dekho: koi delivery partner available
// hua ya nahi. Available hote hi sabse purane
// pending_assignment order ko turant assign kar do.
//
// + Supabase Realtime listener: partner ke available hote hi
//   (users.is_available false -> true) ya naya pending order
//   aate hi bina 30s wait kiye turant retry.
//
// server.js boot par startPendingAssignmentWorker() call hota hai.
// Overlap-safe: ek run chalte waqt dusra run skip hota hai.
// Supabase down ho to worker crash nahi karta — sirf warn log.
// ===================================================

import { supabase } from '../config/supabase.js';
import {
  tryAssignPendingOrders,
  ASSIGN_INTERVAL_MS,
} from '../utils/deliveryAssign.js';

let intervalHandle = null;
let realtimeChannel = null;
let running = false;
let started = false;

const runOnce = async (reason = 'interval') => {
  if (running) return; // overlap guard
  running = true;
  try {
    const result = await tryAssignPendingOrders(supabase);
    if (reason !== 'interval' && result.assigned > 0) {
      console.log(`⚡ [worker] realtime trigger (${reason}): ${result.assigned} assigned`);
    } else if (result.checked > 0 && result.assigned === 0 && reason === 'boot') {
      console.log(`⏳ [worker] boot check: ${result.pending} pending, koi partner available nahi`);
    }
  } catch (e) {
    console.warn(`⚠️ [worker] retry failed (${reason}): ${e.message}`);
  } finally {
    running = false;
  }
};

// Realtime events ko debounce karo — partner bulk update par
// 20 retry ek saath na dauden, 2s window me ek hi retry.
let debounceTimer = null;
const scheduleRealtimeRetry = (reason) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runOnce(reason), 2000);
};

const startRealtimeListener = () => {
  try {
    realtimeChannel = supabase
      .channel('pending-assignment-retry')
      // Partner available hua? (users row UPDATE)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        (payload) => {
          const before = payload?.old;
          const after = payload?.new;
          // Sirf tab retry jab koi delivery role available hua ho —
          // har chhote user update par DB hit mat karo.
          const role = String(after?.role || '').toLowerCase();
          const isDelivery = role === 'delivery' || role === 'delivery_partner';
          const becameAvailable =
            after?.is_available === true && before?.is_available !== true;
          // verified flag abhi column me na ho (undefined) to bhi retry —
          // deliveryAssign khud eligible check karega.
          const maybeRelevant =
            isDelivery && (becameAvailable || after?.is_available === undefined);
          if (maybeRelevant || (isDelivery && after?.is_available === true)) {
            scheduleRealtimeRetry('partner-available');
          }
        }
      )
      // Naya delivery-ready order aaya? turant assign attempt.
      // FINAL FLOW: sirf 'packed' (unassigned) delivery queue hai.
      // 'pending_assignment' / 'Placed' / 'pending' store queue hai — pack se
      // pehle in par assign attempt karna spec violation hai.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const row = payload?.new;
          const unassigned =
            !row?.delivery_boy_id || String(row.delivery_boy_id).trim() === '';
          const deliveryReady = String(row?.status || '').toLowerCase() === 'packed';
          if (unassigned && deliveryReady) {
            scheduleRealtimeRetry('new-packed-order');
          }
        }
      )
      // Store ne PACKED mark kiya (pending_assignment -> packed UPDATE)?
      // Turant assign attempt — 30s wait nahi. Direct-DB pack ka bhi cover.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const row = payload?.new;
          const unassigned =
            !row?.delivery_boy_id || String(row.delivery_boy_id).trim() === '';
          const deliveryReady = String(row?.status || '').toLowerCase() === 'packed';
          if (unassigned && deliveryReady) {
            scheduleRealtimeRetry('order-packed');
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📡 [worker] Realtime listener active (users UPDATE + orders INSERT)');
        }
      });
  } catch (e) {
    console.warn(`⚠️ [worker] Realtime listener start nahi hua: ${e.message} (30s polling phir bhi chalega)`);
  }
};

export const startPendingAssignmentWorker = ({
  intervalMs = ASSIGN_INTERVAL_MS,
} = {}) => {
  if (started) return { stop: stopPendingAssignmentWorker };
  started = true;

  const safeInterval =
    Number(intervalMs) > 0 ? Number(intervalMs) : ASSIGN_INTERVAL_MS;

  console.log(
    `🔄 [worker] Pending-assignment worker started — har ${Math.round(safeInterval / 1000)}s check`
  );

  // Boot par ek turant check (server restart ke baad phase hue orders turant assign)
  runOnce('boot');

  intervalHandle = setInterval(() => runOnce('interval'), safeInterval);
  // Nodemon/dev me interval process ko zinda na rakhe isliye unref (available ho to)
  if (intervalHandle && typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }

  startRealtimeListener();

  return { stop: stopPendingAssignmentWorker };
};

export const stopPendingAssignmentWorker = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (realtimeChannel) {
    try {
      supabase.removeChannel(realtimeChannel);
    } catch (e) { /* ignore */ }
    realtimeChannel = null;
  }
  started = false;
  console.log('🛑 [worker] Pending-assignment worker stopped');
};

export default { startPendingAssignmentWorker, stopPendingAssignmentWorker };
