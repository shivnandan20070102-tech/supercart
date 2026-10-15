// Complaints — backend rate-limited entry-point (5/hour/User).
//
// Frontend (ComplaintForm) pehle YAHAN POST karta hai taaki bot-spam
// rate-limit me ruke; photo Supabase Storage me client-side upload hoti hai
// (signed-in session se) aur sirf `photo_url` yahan aata hai — RLS/storage
// flow unchanged. Backend down ho to client direct-Supabase fallback rakhta hai
// (lekin 429 par fallback NAHI — block ka faisla final hai).
import { supabase } from '../config/supabase.js';

const COMPLAINT_TYPES = ['customer', 'delivery_partner', 'store_manager'];
const COMPLAINT_STATUSES = ['pending', 'in_progress', 'resolved'];

// @desc    Submit complaint (rate-limited)
// @route   POST /api/complaints
// @access  Private
export const submitComplaint = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in to raise a complaint.' });
    }

    const type = String(req.body?.type || req.body?.complainant_type || 'customer');
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    const description = String(req.body?.description || '').trim().slice(0, 5000);
    const photoUrl = String(req.body?.photo_url || req.body?.photoUrl || '').slice(0, 1000);
    const name = String(
      req.body?.name || req.body?.complainant_name || req.user?.name || req.user?.email || 'Customer'
    ).slice(0, 120);

    if (!COMPLAINT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid complainant type.' });
    }
    if (!subject) {
      return res.status(400).json({ success: false, message: 'Please write a subject.' });
    }
    if (!description) {
      return res.status(400).json({ success: false, message: 'Please describe the issue.' });
    }

    const { data, error } = await supabase
      .from('complaints')
      .insert({
        complainant_id: String(userId),
        complainant_type: type,
        complainant_name: name,
        subject,
        description,
        photo_url: photoUrl,
        status: 'pending',
        admin_response: '',
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Could not submit complaint. Please try again.',
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Complaint submitted. Admin will review it soon.',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting complaint',
      error: error.message,
    });
  }
};

// @desc    Apni complaints (nayi pehle)
// @route   GET /api/complaints/mine
// @access  Private
export const getMyComplaints = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Please log in first.' });
    }
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('complainant_id', String(userId))
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ success: false, message: 'Could not fetch complaints', error: error.message });
    }
    return res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error while fetching complaints', error: error.message });
  }
};

export const COMPLAINT_META = { COMPLAINT_TYPES, COMPLAINT_STATUSES };
