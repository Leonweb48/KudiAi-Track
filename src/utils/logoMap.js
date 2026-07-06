// Provider logo paths and brand colors.
// getProviderLogo(provider) → path string or null (use <img>)
// getProviderBadge(provider, category) → { bg, fg, initials } (use colored badge)

const LOGO_PATHS = {
  MTN:       '/mtn.png',
  mtn:       '/mtn.png',
  Airtel:    '/Airtel.png',
  airtel:    '/Airtel.png',
  Glo:       '/glo.jpg',
  glo:       '/glo.jpg',
  '9mobile': '/9mobile.png',
  '9Mobile': '/9mobile.png',
  etisalat:  '/9mobile.png',
};

const BRAND_COLORS = {
  MTN:       { bg: '#FFC300', fg: '#000' },
  Airtel:    { bg: '#EF3340', fg: '#fff' },
  Glo:       { bg: '#007838', fg: '#fff' },
  '9mobile': { bg: '#006B54', fg: '#fff' },
  DSTV:      { bg: '#004f9f', fg: '#fff' },
  GOtv:      { bg: '#e65c00', fg: '#fff' },
  StarTimes: { bg: '#c00000', fg: '#fff' },
  Showmax:   { bg: '#1a1a1a', fg: '#fff' },
  EKEDC:     { bg: '#008000', fg: '#fff' },
  IKEDC:     { bg: '#0066cc', fg: '#fff' },
  AEDC:      { bg: '#003366', fg: '#fff' },
  KEDC:      { bg: '#006699', fg: '#fff' },
  PHEDC:     { bg: '#336600', fg: '#fff' },
  JEDC:      { bg: '#003300', fg: '#fff' },
  IBEDC:     { bg: '#cc6600', fg: '#fff' },
  KAEDC:     { bg: '#990000', fg: '#fff' },
  EEDC:      { bg: '#006600', fg: '#fff' },
  BEDC:      { bg: '#660066', fg: '#fff' },
  YEDC:      { bg: '#663300', fg: '#fff' },
  APLE:      { bg: '#003366', fg: '#fff' },
  NairaBet:  { bg: '#006600', fg: '#fff' },
  Betway:    { bg: '#006633', fg: '#fff' },
  SportyBet: { bg: '#00a651', fg: '#fff' },
  BetKing:   { bg: '#ff6600', fg: '#fff' },
  '1xBet':   { bg: '#1a3a6b', fg: '#fff' },
  MerryBet:  { bg: '#c00000', fg: '#fff' },
  BangBet:   { bg: '#1a1a1a', fg: '#fff' },
  NaijaBet:  { bg: '#006600', fg: '#fff' },
  BetLand:   { bg: '#003366', fg: '#fff' },
};

const CATEGORY_COLORS = {
  airtime:     { bg: '#ef4444', fg: '#fff' },
  data:        { bg: '#3b82f6', fg: '#fff' },
  electricity: { bg: '#f59e0b', fg: '#000' },
  cable:       { bg: '#8b5cf6', fg: '#fff' },
  betting:     { bg: '#10b981', fg: '#fff' },
  waec:        { bg: '#06b6d4', fg: '#fff' },
  jamb:        { bg: '#f97316', fg: '#fff' },
  spectranet:  { bg: '#6366f1', fg: '#fff' },
  smile:       { bg: '#ec4899', fg: '#fff' },
};

export function getProviderLogo(provider) {
  if (!provider) return null;
  return LOGO_PATHS[provider] || null;
}

export function getProviderBadge(provider, category) {
  if (provider) {
    const exact = BRAND_COLORS[provider];
    if (exact) return { ...exact, initials: provider.slice(0, 2).toUpperCase() };
    const key = Object.keys(BRAND_COLORS).find(k =>
      provider.toLowerCase().includes(k.toLowerCase()) ||
      k.toLowerCase().includes(provider.toLowerCase())
    );
    if (key) return { ...BRAND_COLORS[key], initials: provider.slice(0, 2).toUpperCase() };
    return { bg: '#64748b', fg: '#fff', initials: provider.slice(0, 2).toUpperCase() };
  }
  if (category) {
    const c = CATEGORY_COLORS[category];
    if (c) return { ...c, initials: category.slice(0, 2).toUpperCase() };
  }
  return { bg: '#94a3b8', fg: '#fff', initials: '??' };
}
