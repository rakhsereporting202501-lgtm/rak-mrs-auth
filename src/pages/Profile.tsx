import { useState } from 'react';
import { EmailAuthProvider, getAuth, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { getDisplayName } from '../lib/displayName';

export default function Profile(){
  const { user, role } = useAuth();
  const name = getDisplayName(role, user);
  const departments = (role?.departmentIds || []) as string[];
  const roles = role?.roles || {};
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const onChangePassword = async () => {
    setPwError(null);
    setPwSuccess(null);
    if (!user) {
      setPwError('You must be signed in to change your password.');
      return;
    }
    const email = user.email || '';
    if (!email) {
      setPwError('This account has no email address. Password change is unavailable.');
      return;
    }
    if (!currentPw) {
      setPwError('Enter your current password.');
      return;
    }
    if (!nextPw || nextPw.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (nextPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }

    setPwBusy(true);
    try {
      const auth = getAuth();
      const credential = EmailAuthProvider.credential(email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, nextPw);
      setPwSuccess('Password updated successfully.');
      setCurrentPw('');
      setNextPw('');
      setConfirmPw('');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password') {
        setPwError('Current password is incorrect.');
      } else if (code === 'auth/weak-password') {
        setPwError('New password is too weak. Use at least 8 characters.');
      } else if (code === 'auth/requires-recent-login') {
        setPwError('Please sign in again and retry.');
      } else {
        setPwError(err?.message || 'Could not update password.');
      }
    } finally {
      setPwBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Profile</div>
      <div className="hero-card">
        <div className="hero-title">{name}</div>
        <div className="hero-meta">{user?.email || '-'}</div>
        <div className="hero-meta">{departments.length ? departments.join(' - ') : '-'}</div>
        {roles && (
          <div className="hero-badges">
            {Object.entries(roles).filter(([_, v]) => v).map(([k]) => (
              <span key={k} className="badge-light">{k}</span>
            ))}
          </div>
        )}
      </div>
      <div className="card p-0 overflow-hidden">
        <button
          type="button"
          className="w-full px-4 py-3 flex items-center justify-between border-b border-gray-100"
          onClick={() => setPwOpen(v => !v)}
        >
          <div className="text-base font-semibold text-gray-800">Change Password</div>
          <div className="text-sm text-blue-600">{pwOpen ? 'Hide' : 'Show'}</div>
        </button>
        {pwOpen && (
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Current password</label>
              <input
                type="password"
                className="input w-full"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">New password</label>
              <input
                type="password"
                className="input w-full"
                value={nextPw}
                onChange={e => setNextPw(e.target.value)}
                autoComplete="new-password"
              />
              <div className="text-[11px] text-gray-400 mt-1">Minimum 8 characters.</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Confirm new password</label>
              <input
                type="password"
                className="input w-full"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {pwError && <div className="text-sm text-red-600">{pwError}</div>}
            {pwSuccess && <div className="text-sm text-green-600">{pwSuccess}</div>}
            <button
              type="button"
              className="btn-primary w-full disabled:opacity-50"
              onClick={onChangePassword}
              disabled={pwBusy}
            >
              {pwBusy ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


