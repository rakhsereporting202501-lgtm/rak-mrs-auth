import type { WpAccountType, WpEmployee } from './wpTypes';

export function cleanWpText(value?: string) {
  return (value || '').trim().replace(/\s+/g, ' ');
}

export function splitWpName(fullName: string) {
  const clean = cleanWpText(fullName);
  const arParts = clean.match(/[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g) || [];
  const nameAr = cleanWpText(arParts.join(' '));
  const nameEn = cleanWpText(clean.replace(/[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g, ' '));
  return { nameAr, nameEn };
}

export function displayWpPersonName(person: Pick<WpEmployee, 'fullName' | 'nameAr' | 'nameEn'>, lang: 'ar' | 'en' = 'ar') {
  if (lang === 'en') return cleanWpText(person.nameEn || splitWpName(person.fullName || '').nameEn || person.fullName);
  return cleanWpText(person.nameAr || splitWpName(person.fullName || '').nameAr || person.nameEn || person.fullName);
}

export function normalizeWpEmployee(raw: Partial<WpEmployee>): WpEmployee {
  const fullName = cleanWpText(raw.fullName || [raw.nameEn, raw.nameAr].filter(Boolean).join(' '));
  const split = splitWpName(fullName);
  const id = cleanWpText(raw.id || raw.memberCode || fullName).replace(/[\/#?[\]]+/g, '-');
  const accountType = (raw.accountType || 'VIEWER') as WpAccountType;
  return {
    id,
    memberCode: cleanWpText(raw.memberCode || id),
    fullName,
    nameAr: cleanWpText(raw.nameAr || split.nameAr),
    nameEn: cleanWpText(raw.nameEn || split.nameEn),
    position: cleanWpText(raw.position || ''),
    department: cleanWpText(raw.department || ''),
    city: cleanWpText(raw.city || 'Unassigned'),
    accountType,
    active: raw.active !== false,
    authEmail: cleanWpText(raw.authEmail || ''),
    authUid: cleanWpText(raw.authUid || ''),
    departmentIds: Array.isArray(raw.departmentIds) ? raw.departmentIds.map(cleanWpText).filter(Boolean) : [],
    permissions: raw.permissions || {},
  };
}

export function wpEmployeeSearchText(person: WpEmployee) {
  return [
    person.fullName,
    person.nameAr || '',
    person.nameEn || '',
    person.memberCode,
    person.position || '',
    person.department || '',
    person.city || '',
    person.accountType || '',
  ].join(' ').toLowerCase();
}
