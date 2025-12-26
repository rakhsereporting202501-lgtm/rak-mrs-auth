import type { User } from 'firebase/auth';

export function getDisplayName(role: any | null, user: User | null): string {
  const full = role?.fullName && String(role.fullName).trim();
  if (full) return full;
  if (user?.displayName) return user.displayName;
  const email = user?.email || '';
  if (email) return email.split('@')[0];
  return '';
}

