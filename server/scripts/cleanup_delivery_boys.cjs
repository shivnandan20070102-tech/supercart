// One-time cleanup: list (dry-run) or delete ALL delivery-boy accounts.
// Usage:
//   node scripts/cleanup_delivery_boys.cjs          -> dry-run, only lists
//   node scripts/cleanup_delivery_boys.cjs --commit  -> actually deletes
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || 'https://eagwchutdhtgioujetag.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!serviceKey) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not found in server/.env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const DELIVERY_ROLES = ['delivery', 'delivery_partner'];
const commit = process.argv.includes('--commit');

(async () => {
  // 1. Find delivery accounts
  const { data: boys, error } = await supabase
    .from('users')
    .select('id, email, role, name')
    .in('role', DELIVERY_ROLES);

  if (error) {
    console.error('Failed to list delivery users:', error.message);
    process.exit(1);
  }

  console.log(`\nFound ${boys.length} delivery account(s):\n`);
  boys.forEach((b, i) =>
    console.log(`  ${i + 1}. ${b.email}  (role=${b.role}, name=${b.name || '-'})`),
  );

  if (!commit) {
    console.log('\n[DRY-RUN] Nothing deleted. Re-run with --commit to actually delete.\n');
    return;
  }

  if (boys.length === 0) {
    console.log('\nNo delivery accounts to delete.\n');
    return;
  }

  const ids = boys.map((b) => b.id);

  // 2. Unassign orders first (delivery_boy_id is TEXT, no FK cascade)
  const { error: orderErr } = await supabase
    .from('orders')
    .update({ delivery_boy_id: null })
    .in('delivery_boy_id', ids.map(String));
  if (orderErr) console.warn('⚠ orders unassign warning:', orderErr.message);
  else console.log(`\nUnassigned orders for ${ids.length} delivery account(s).`);

  // 3. Delete the auth users (cascades to public.users, delivery_profiles, user_roles, delivery_gigs)
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(id);
    if (delErr) {
      failed++;
      console.warn(`  FAILED to delete ${id}: ${delErr.message}`);
    } else {
      deleted++;
    }
  }

  console.log(`\nDeleted ${deleted} delivery account(s), failed ${failed}.\n`);
})().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
