import { FormEvent, useEffect, useState } from 'react';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function isEmail(s: string) {
  return /.+@.+\..+/.test(s);
}

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { user } = useAuth();
  const logoSrc = `${import.meta.env.BASE_URL}logo.svg`;

  useEffect(() => { if (user) nav('/'); }, [user]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const id = identifier.trim();
    const pw = password;
    if (!id) return setErr('Username not found');
    if (!pw) return setErr('Password is required');

    setBusy(true);
    try {
      let emailToUse = id;
      if (!isEmail(id)) {
        // resolve username to email
        const db = getFirestore();
        const uname = id.toLowerCase();
        const snap = await getDoc(doc(db, 'usernames', uname));
        if (!snap.exists()) { setErr('Username not found'); return; }
        const data = snap.data() as any;
        emailToUse = (data.email || '').toString();
        if (!emailToUse) { setErr('Username not found'); return; }
      }
      await signInWithEmailAndPassword(getAuth(), emailToUse, pw);
      nav('/');
    } catch (e: any) {
      const code = e?.code || e?.message;
      switch (code) {
        case 'auth/user-not-found': setErr('User not found'); break;
        case 'auth/wrong-password':
        case 'auth/invalid-credential': setErr('Wrong password'); break;
        case 'auth/invalid-email': setErr('Invalid email address'); break;
        case 'auth/too-many-requests': setErr('Too many attempts. Try again later.'); break;
        case 'permission-denied':
        case 'auth/permission-denied': setErr('Permission denied'); break;
        default: setErr('Could not sign in. Please check your credentials.');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <img src={logoSrc} alt="Logo" className="h-8 w-8"/>
          <h1 className="text-2xl font-semibold">RAK Inventory Management System</h1>
        </div>
        <p className="text-sm text-gray-600 mb-4">Sign-in only. Ask admin to provision your account.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <input className="input" autoFocus type="text" placeholder="Email or Username" value={identifier} onChange={e=>setIdentifier(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
      </div>
    </div>
  );
}

