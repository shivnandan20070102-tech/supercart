// TEMP anon negative test (read-only) — proves unauthenticated access is denied.
// Run BEFORE sql (baseline: public bucket) and AFTER sql (must fail).
// workdir = server/. Delete after verification.
import { supabase } from './config/supabase.js';

try {
  // 1. Bucket public flag (anon-readable metadata)
  const { data: buckets } = await supabase.storage.listBuckets();
  const docs = (buckets || []).find((b) => b.id === 'delivery-documents' || b.name === 'delivery-documents');
  console.log(`[1] bucket public = ${docs?.public} (expect true BEFORE sql, false AFTER)`);

  // 2. Anon enumeration
  const listed = await supabase.storage.from('delivery-documents').list('', { limit: 5 });
  console.log(`[2] anon list: ${listed.error ? `DENIED (${listed.error.message})` : `ALLOWED (${listed.data?.length} items)`}`);

  // 3. Anon signed-URL mint on a probe path
  const signed = await supabase.storage.from('delivery-documents').createSignedUrl('probe_no_such_file_xyz123.jpg', 60);
  console.log(`[3] anon createSignedUrl: ${signed?.error ? `DENIED (${signed.error.message})` : 'MINTED (anon can mint!)'}`);
} catch (e) {
  console.error(`TEST FAIL: ${e.message}`);
  process.exitCode = 1;
}
