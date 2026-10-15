// Complaints service — pure validators + Supabase calls.
//
// Flow: validate -> (optional) photo upload to 'complaint-photos' bucket
// (path: complaints/{uid}/{random}-{name}) -> insert row (status pending).
// RLS: insert sirf apne complainant_id par; status/admin_response admin lagata hai.

export const COMPLAINT_TYPES = ['customer', 'delivery_partner', 'store_manager'];

export const COMPLAINT_STATUSES = ['pending', 'in_progress', 'resolved'];

export const MAX_PHOTO_MB = 5;

export const COMPLAINT_PHOTO_BUCKET = 'complaint-photos';

// Pure: form validate karo. Returns error string | null.
export const validateComplaint = ({ subject, description, file } = {}) => {
  if (!String(subject || '').trim()) return 'Please write a subject.';
  if (String(subject).trim().length > 200) return 'Subject must be under 200 characters.';
  if (!String(description || '').trim()) return 'Please describe the issue.';
  if (String(description).trim().length > 5000) return 'Description must be under 5000 characters.';
  if (file) {
    if (typeof file.type === 'string' && file.type && !file.type.startsWith('image/')) {
      return 'Photo must be an image file.';
    }
    if (Number.isFinite(file.size) && file.size > MAX_PHOTO_MB * 1024 * 1024) {
      return `Photo must be under ${MAX_PHOTO_MB} MB.`;
    }
  }
  return null;
};

// Pure: admin tabs ke liye type filter (testable).
export const filterComplaintsByType = (rows, type) =>
  (rows || []).filter((r) => String(r?.complainant_type) === String(type));

// RLS fix: storage path 'complaints/<uid>/<file>' hai, isliye SQL policy
// folder [2]=uid check karti hai. Yahan path unchanged rakha hai taaki
// policy se match kare. Session check zaroori hai — expired/anon session
// hi "new row violates row-level security policy" ka dusra bada kaaran tha.
const assertOwnSession = async (supabase, userId) => {
  if (!userId) throw new Error('Please log in to raise a complaint.');
  let authUser = null;
  try {
    const res = await supabase.auth.getUser();
    authUser = res?.data?.user || null;
  } catch {
    authUser = null;
  }
  if (!authUser) {
    throw new Error('Session expired. Please log out and log in again, then submit.');
  }
  if (String(authUser.id) !== String(userId)) {
    throw new Error('Session mismatch. Please log out and log in again, then submit.');
  }
  return String(authUser.id);
};

const toFriendlyComplaintError = (e) => {
  const msg = String(e?.message || '');
  if (e?.isRateLimited || /too many|rate.?limit|bahut zyada|ghante baad|kuch der baad/i.test(msg)) {
    const err = new Error(msg || 'Bahut zyada complaints ho gayi, 1 ghante baad try karein');
    err.isRateLimited = true;
    return err;
  }
  if (/row-level security|violates.*policy|not allowed|permission denied/i.test(msg)) {
    return new Error(
      'Could not submit (permission denied). Please log out, log in again, then retry. ' +
        `Actual error: ${msg}`,
    );
  }
  return e;
};

// Supabase: photo upload -> public URL (photo optional).
export const uploadComplaintPhoto = async (supabase, userId, file) => {
  if (!file) return '';
  const ownerId = await assertOwnSession(supabase, userId);
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'photo.jpg';
  // Owner folder: complaints/<uid>/... — SQL RLS isi ko allow karti hai.
  const path = `complaints/${ownerId}/${crypto.randomUUID()}-${safeName}`;
  try {
    const { error } = await supabase.storage
      .from(COMPLAINT_PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (error) throw error;
  } catch (e) {
    throw toFriendlyComplaintError(e);
  }
  return supabase.storage.from(COMPLAINT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl || '';
};

// Backend-first submit (rate-limited 5/hour/User -> friendly Hindi 429).
// Flow: validate -> photo upload (client session) -> POST /api/complaints.
// Backend 429 FINAL hai (fallback NAHI — warna spam-guard bypass).
// Backend down/network ho to direct-Supabase fallback (genuine complaint na ruke).
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');

const readJsonSafe = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const isNetworkFailure = (e) =>
  e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(e?.message || ''));

export const submitComplaintViaBackend = async ({ token, type, name, subject, description, photoUrl }) => {
  const res = await fetch(`${API_BASE_URL}/api/complaints`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ type, name, subject, description, photo_url: photoUrl || '' }),
  });
  const json = await readJsonSafe(res);
  if (res.status === 429 || json?.code === 'RATE_LIMITED') {
    const err = new Error(String(json?.message || '').trim() || 'Bahut zyada complaints ho gayi, 1 ghante baad try karein');
    err.isRateLimited = true;
    err.status = 429;
    throw err;
  }
  if (!res.ok || json?.success === false) {
    const err = new Error(json?.message || 'Could not submit complaint.');
    err.status = res.status;
    throw err;
  }
  return json?.data || json;
};

// Supabase: poori submit (validate + upload + insert). Returns inserted row.
export const submitComplaint = async (supabase, { userId, type, name, subject, description, file }) => {
  if (!COMPLAINT_TYPES.includes(type)) throw new Error('Invalid complainant type.');
  const ownerId = await assertOwnSession(supabase, userId);
  const validationError = validateComplaint({ subject, description, file });
  if (validationError) throw new Error(validationError);
  let photoUrl = '';
  try {
    photoUrl = await uploadComplaintPhoto(supabase, ownerId, file || null);
  } catch (e) {
    throw toFriendlyComplaintError(e);
  }
  // 1) Backend rate-limited entry (spam-guard). Token: fresh session preferred.
  try {
    let token = '';
    try {
      token = (await supabase.auth.getSession()).data.session?.access_token || '';
    } catch { /* ignore */ }
    if (!token) {
      try {
        token = localStorage.getItem('supercart_token') || '';
      } catch { /* ignore */ }
    }
    const saved = await submitComplaintViaBackend({
      token,
      type,
      name,
      subject: String(subject).trim().slice(0, 200),
      description: String(description).trim().slice(0, 5000),
      photoUrl,
    });
    if (saved) return saved;
  } catch (e) {
    // 429 / validation / auth-final: seedha UI tak (fallback se bypass NAHI).
    if (e?.isRateLimited || (e?.status && e.status !== 0 && !isNetworkFailure(e))) throw e;
    // Network/backend-down: neeche direct-Supabase fallback.
  }
  // 2) Fallback: direct Supabase insert (backend unreachable case only).
  try {
    const { data, error } = await supabase
      .from('complaints')
      .insert({
        complainant_id: String(ownerId),
        complainant_type: type,
        complainant_name: String(name || '').slice(0, 120),
        subject: String(subject).trim().slice(0, 200),
        description: String(description).trim().slice(0, 5000),
        photo_url: photoUrl,
        status: 'pending',
        admin_response: '',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    throw toFriendlyComplaintError(e);
  }
};

// Supabase: apni complaints (nayi pehle).
export const fetchMyComplaints = async (supabase, userId) => {
  const { data, error } = await supabase
    .from('complaints')
    .select('*')
    .eq('complainant_id', String(userId))
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};
