// Provider logo paths and brand colors.
// getProviderLogo(provider, category?) → path string or null (use <img>)
// getProviderBadge(provider, category) → { bg, fg, initials } (use colored badge)

import { discoFromText, electricityLogoUrl } from './electricityLogos';
import { billBrandFromText, billBrandForCategory, billLogoUrl } from './billLogos';

// Networks and electricity companies live here. Cable TV, betting, exam pins and internet providers have their real logos in
// public/logos/bills/ and are resolved by utils/billLogos.js (which also understands the codes the payment webhook stores).
const LOGO_PATHS = {
  // Networks
  MTN:          '/mtn.png',
  mtn:          '/mtn.png',
  Airtel:       '/Airtel.png',
  airtel:       '/Airtel.png',
  Glo:          '/glo.jpg',
  glo:          '/glo.jpg',
  '9mobile':    '/9mobile.png',
  '9Mobile':    '/9mobile.png',
  etisalat:     '/9mobile.png',
  // Electricity — the DISCO logos are the files in public/logos/electricity logos/ (see utils/electricityLogos.js).
  // APLE has no logo in that folder yet, so it keeps its old badge.
  EKEDC:        electricityLogoUrl('EKEDC'),
  IKEDC:        electricityLogoUrl('IKEDC'),
  AEDC:         electricityLogoUrl('AEDC'),
  KEDC:         electricityLogoUrl('KEDC'),
  PHEDC:        electricityLogoUrl('PHEDC'),
  JEDC:         electricityLogoUrl('JEDC'),
  IBEDC:        electricityLogoUrl('IBEDC'),
  KAEDC:        electricityLogoUrl('KAEDC'),
  EEDC:         electricityLogoUrl('EEDC'),
  BEDC:         electricityLogoUrl('BEDC'),
  YEDC:         electricityLogoUrl('YEDC'),
  APLE:         '/logos/aple.svg',
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

// Fuzzy-matches provider name against LOGO_PATHS keys, then falls back to category.
export function getProviderLogo(provider, category) {
  if (provider) {
    // A DISCO named anywhere in the text ("EKEDC (Eko) Prepaid", "Ikeja Electric") wins over the generic fuzzy match below,
    // which used to hand "KAEDC (Kaduna)" the AEDC logo because AEDC is a substring of KAEDC.
    const disco = discoFromText(provider, { allowNames: category === 'electricity' });
    if (disco && LOGO_PATHS[disco]) return LOGO_PATHS[disco];
    // Cable / betting / exam / internet providers — by name or by the code the payment webhook stores ("product-bang-bet").
    // A provider we know but have no logo for (MerryBet) answers null rather than falling through to a look-alike below.
    const brand = billBrandFromText(provider, category);
    if (brand) return billLogoUrl(brand);
    const exact = LOGO_PATHS[provider];
    if (exact) return exact;
    const key = Object.keys(LOGO_PATHS).sort((a, b) => b.length - a.length).find(k =>
      provider.toLowerCase().includes(k.toLowerCase()) ||
      k.toLowerCase().includes(provider.toLowerCase())
    );
    if (key) return LOGO_PATHS[key];
  }
  if (category) {
    const c = LOGO_PATHS[category];
    if (c) return c;
    // a category with a single provider (WAEC, JAMB, Spectranet, Smile) IS that provider
    const solo = billBrandForCategory(category);
    if (solo) return billLogoUrl(solo);
  }
  return null;
}

export function getProviderBadge(provider, category) {
  if (provider) {
    const disco = discoFromText(provider, { allowNames: category === 'electricity' });
    if (disco && BRAND_COLORS[disco]) return { ...BRAND_COLORS[disco], initials: provider.slice(0, 2).toUpperCase() };
    const exact = BRAND_COLORS[provider];
    if (exact) return { ...exact, initials: provider.slice(0, 2).toUpperCase() };
    const key = Object.keys(BRAND_COLORS).sort((a, b) => b.length - a.length).find(k =>
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
