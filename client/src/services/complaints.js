export const COMPLAINT_TYPES = ['customer', 'delivery_partner', 'store_manager'];
export const COMPLAINT_STATUSES = ['pending', 'in_progress', 'resolved'];
export const MAX_PHOTO_MB = 3;
export const COMPLAINT_PHOTO_BUCKET = 'complaint-photos';

export const validateComplaint = ({ subject, description, file, files } = {}) => {
  if (!String(subject || '').trim()) return 'Please write a subject.';
  if (String(subject).trim().length > 200) return 'Subject must be under 200 characters.';
  if (!String(description || '').trim()) return 'Please describe the issue.';
  if (String(description).trim().length > 5000) return 'Description must be under 5000 characters.';
  const selectedFiles = Array.isArray(files) ? files : file ? [file] : [];
  if (selectedFiles.length > 3) return 'You can attach up to 3 photos.';
  for (const selectedFile of selectedFiles) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(selectedFile?.type || '').toLowerCase())) return 'Only JPG, PNG or WebP photos are allowed.';
    if (Number.isFinite(selectedFile.size) && selectedFile.size > MAX_PHOTO_MB * 1024 * 1024) return `Each photo must be under ${MAX_PHOTO_MB} MB.`;
  }
  return null;
};

export const filterComplaintsByType = (rows, type) =>
  (rows || []).filter((row) => String(row?.complainant_type) === String(type));

const assertOwnSession = async (supabase, userId) => {
  if (!userId) throw new Error('Please log in to raise a complaint.');
  const { data } = await supabase.auth.getUser();
  if (!data?.user) throw new Error('Session expired. Please log out and log in again, then submit.');
  if (String(data.user.id) !== String(userId)) throw new Error('Session mismatch. Please log out and log in again, then submit.');
  return String(data.user.id);
};

const friendlyError = (error) => {
  const message = String(error?.message || '');
  if (/row-level security|violates.*policy|permission denied/i.test(message)) {
    return new Error(`Could not submit (permission denied). Please log out, log in again, then retry. Actual error: ${message}`);
  }
  return error;
};

export const uploadComplaintPhoto = async (supabase, userId, file) => {
  if (!file) return '';
  const ownerId = await assertOwnSession(supabase, userId);
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'photo.jpg';
  const path = `complaints/${ownerId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(COMPLAINT_PHOTO_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw friendlyError(error);
  return path;
};

export const complaintPhotoPaths = (complaint) => {
  const many = Array.isArray(complaint?.photo_urls) ? complaint.photo_urls : [];
  const legacy = complaint?.photo_url ? [complaint.photo_url] : [];
  return [...new Set([...many, ...legacy].filter(Boolean).map(String))];
};

const storagePathFromValue = (value) => {
  const raw = String(value || '');
  const marker = '/storage/v1/object/';
  const index = raw.indexOf(marker);
  if (index < 0) return raw;
  const tail = raw.slice(index + marker.length).replace(/^sign\/|^public\//, '');
  const prefix = `${COMPLAINT_PHOTO_BUCKET}/`;
  return tail.startsWith(prefix) ? tail.slice(prefix.length) : tail;
};

export const resolveComplaintPhotoUrls = async (supabase, complaint) => {
  const paths = complaintPhotoPaths(complaint).map(storagePathFromValue);
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from(COMPLAINT_PHOTO_BUCKET).createSignedUrls(paths, 3600);
  if (error) {
    console.error('[complaints] signed photo URL failed:', error);
    return paths.map(() => null);
  }
  return paths.map((_, index) => data?.[index]?.signedUrl || null);
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://supercart-kloc.onrender.com').replace(/\/+$/, '');
const readJsonSafe = async (response) => { try { return await response.json(); } catch { return null; } };
const isNetworkFailure = (error) => error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(error?.message || ''));

export const submitComplaintViaBackend = async ({ token, type, name, subject, description, photoUrls }) => {
  const response = await fetch(`${API_BASE_URL}/api/complaints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ type, name, subject, description, photo_url: photoUrls?.[0] || '', photo_urls: photoUrls || [] }),
  });
  const json = await readJsonSafe(response);
  if (response.status === 429 || json?.code === 'RATE_LIMITED') {
    const error = new Error(json?.message || 'Bahut zyada complaints ho gayi, 1 ghante baad try karein');
    error.isRateLimited = true;
    throw error;
  }
  if (!response.ok || json?.success === false) throw new Error(json?.message || 'Could not submit complaint.');
  return json?.data || json;
};

export const submitComplaint = async (supabase, { userId, type, name, subject, description, files = [] }) => {
  if (!COMPLAINT_TYPES.includes(type)) throw new Error('Invalid complainant type.');
  const ownerId = await assertOwnSession(supabase, userId);
  const validationError = validateComplaint({ subject, description, files });
  if (validationError) throw new Error(validationError);
  const photoUrls = [];
  try {
    for (const file of files) photoUrls.push(await uploadComplaintPhoto(supabase, ownerId, file));
  } catch (error) {
    throw friendlyError(error);
  }
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token || localStorage.getItem('supercart_token') || '';
    const saved = await submitComplaintViaBackend({ token, type, name, subject: String(subject).trim().slice(0, 200), description: String(description).trim().slice(0, 5000), photoUrls });
    if (saved) return saved;
  } catch (error) {
    if (error?.isRateLimited || (!isNetworkFailure(error) && error?.status)) throw error;
  }
  const { data, error } = await supabase.from('complaints').insert({
    complainant_id: ownerId,
    complainant_type: type,
    complainant_name: String(name || '').slice(0, 120),
    subject: String(subject).trim().slice(0, 200),
    description: String(description).trim().slice(0, 5000),
    photo_url: photoUrls[0] || '',
    photo_urls: photoUrls,
    status: 'pending',
    admin_response: '',
  }).select().single();
  if (error) throw friendlyError(error);
  return data;
};

export const fetchMyComplaints = async (supabase, userId) => {
  const { data, error } = await supabase.from('complaints').select('*').eq('complainant_id', String(userId)).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};
