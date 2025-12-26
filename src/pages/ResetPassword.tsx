import { useState, FormEvent } from 'react';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';

export default function ResetPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string| null>(null);
  const [err, setErr] = useState<string| null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null);
    try { await sendPasswordResetEmail(getAuth(), email.trim()); setMsg('Email sent'); }
    catch (e: any) { setErr(e?.message || 'Error'); }
  };
  return (
    <div className="max-w-md mx-auto mt-16 p-6 card">
      <h2 className="text-xl font-semibold mb-3">Reset password</h2>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        <button className="btn-primary w-full" type="submit">Send reset link</button>
      </form>
      {msg && <p className="text-green-600 text-sm mt-3">{msg}</p>}
      {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
    </div>
  );
}
