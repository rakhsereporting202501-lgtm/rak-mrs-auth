export const WP_UNSAVED_CHANGES_KEY = 'rakWp.editor.unsaved';
export const WP_UNSAVED_CHANGES_MESSAGE = 'لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟';

export function setWpUnsavedChangesFlag(value: boolean) {
  try {
    if (value) sessionStorage.setItem(WP_UNSAVED_CHANGES_KEY, '1');
    else sessionStorage.removeItem(WP_UNSAVED_CHANGES_KEY);
  } catch {}
}

export function hasWpUnsavedChangesFlag() {
  try {
    return sessionStorage.getItem(WP_UNSAVED_CHANGES_KEY) === '1';
  } catch {
    return false;
  }
}

export function confirmWpUnsavedChanges() {
  return !hasWpUnsavedChangesFlag() || window.confirm(WP_UNSAVED_CHANGES_MESSAGE);
}
