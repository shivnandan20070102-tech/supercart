const RESERVED_PANEL_TAGS = ['+sc-delivery', '+sc-store'];

export const normalizePanelEmail = (email) => String(email || '').trim().toLowerCase();

export const isReservedPanelEmail = (email) => {
  const localPart = normalizePanelEmail(email).split('@')[0] || '';
  return RESERVED_PANEL_TAGS.some((tag) => localPart.includes(tag));
};

export const getPanelAuthEmail = (email, panel) => {
  const normalized = normalizePanelEmail(email);
  if (!normalized.includes('@')) return normalized;
  if (panel === 'customer') return normalized;
  const tag = panel === 'delivery' ? '+sc-delivery' : panel === 'store_manager' ? '+sc-store' : '';
  if (!tag) return normalized;
  const at = normalized.lastIndexOf('@');
  return `${normalized.slice(0, at)}${tag}${normalized.slice(at)}`;
};
