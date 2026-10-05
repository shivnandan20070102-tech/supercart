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

// Supabase: photo upload -> public URL (photo optional).
export const uploadComplaintPhoto = async (supabase, userId, file) => {
  if (!file) return '';
  const safeName = String(file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'photo.jpg';
  const path = `complaints/${userId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(COMPLAINT_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from(COMPLAINT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl || '';
};

// Supabase: poori submit (validate + upload + insert). Returns inserted row.
export const submitComplaint = async (supabase, { userId, type, name, subject, description, file }) => {
  if (!COMPLAINT_TYPES.includes(type)) throw new Error('Invalid complainant type.');
  if (!userId) throw new Error('Please log in to raise a complaint.');
  const validationError = validateComplaint({ subject, description, file });
  if (validationError) throw new Error(validationError);
  const photoUrl = await uploadComplaintPhoto(supabase, userId, file || null);
  const { data, error } = await supabase
    .from('complaints')
    .insert({
      complainant_id: String(userId),
      complainant_type: type,
      complainant_name: String(name || '').slice(0, 120),
      subject: String(subject).trim().slice(0, 200),
      description: String(description).trim().slice(0, 5000),
      photo_url: photoUrl,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
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
