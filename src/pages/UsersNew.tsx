import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, getFirestore, writeBatch } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

const DEFAULT_DEPTS = [
  'HSE',
  'TRP',
  'VRP',
  'Store',
  'CPS',
  'Leak',
  'Maintenace',
  'EI',
  'Pipline Project',
  'Pipline Ops',
];

const ROLE_KEYS = ['admin', 'auditor', 'deptManager', 'requester', 'storeOfficer'] as const;

type RoleKey = typeof ROLE_KEYS[number];

export default function UsersNew() {
  const { role } = useAuth();
  const nav = useNavigate();
  const db = getFirestore();

  const [email, setEmail] = useState('');
  const [uid, setUid] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [deptInput, setDeptInput] = useState('');
  const [roleFlags, setRoleFlags] = useState<Record<RoleKey, boolean>>({
    admin: false,
    auditor: false,
    deptManager: false,
    requester: false,
    storeOfficer: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const deptOptions = useMemo(() => {
    const merged = [...DEFAULT_DEPTS, ...departmentIds];
    return Array.from(new Set(merged.map((d) => d.trim()).filter(Boolean)));
  }, [departmentIds]);

  if (!role?.roles?.admin) {
    return <div className="card p-4">Admin only.</div>;
  }

  const toggleDept = (dept: string) => {
    setDepartmentIds((prev) => (prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]));
  };

  const addDept = () => {
    const next = deptInput.trim();
    if (!next) return;
    if (!departmentIds.includes(next)) {
      setDepartmentIds((prev) => [...prev, next]);
    }
    setDeptInput('');
  };

  const updateRole = (key: RoleKey) => {
    setRoleFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const onSubmit = async () => {
    setError(null);
    setSuccess(null);
    const cleanEmail = email.trim().toLowerCase();
    const cleanUid = uid.trim();
    const cleanUsername = username.trim().toLowerCase();
    const cleanFullName = fullName.trim();
    const cleanDepts = Array.from(new Set(departmentIds.map((d) => d.trim()).filter(Boolean)));

    if (!cleanEmail) return setError('Email is required.');
    if (!cleanUid) return setError('User UID is required.');
    if (!cleanUsername) return setError('Username is required.');
    if (!cleanFullName) return setError('Full name is required.');

    setBusy(true);
    try {
      const roleRef = doc(db, 'roles', cleanUid);
      const usernameRef = doc(db, 'usernames', cleanUsername);
      const [roleSnap, userSnap] = await Promise.all([getDoc(roleRef), getDoc(usernameRef)]);
      if (roleSnap.exists()) {
        setError('This UID already exists in roles.');
        return;
      }
      if (userSnap.exists()) {
        setError('This username already exists.');
        return;
      }

      const batch = writeBatch(db);
      batch.set(roleRef, {
        fullName: cleanFullName,
        email: cleanEmail,
        departmentIds: cleanDepts,
        roles: roleFlags,
      });
      batch.set(usernameRef, {
        uid: cleanUid,
        email: cleanEmail,
        fullName: cleanFullName,
      });
      await batch.commit();
      setSuccess('User role record created successfully.');
      setEmail('');
      setUid('');
      setUsername('');
      setFullName('');
      setDepartmentIds([]);
      setRoleFlags({
        admin: false,
        auditor: false,
        deptManager: false,
        requester: false,
        storeOfficer: false,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to create user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">Create New User</div>
        <button type="button" className="btn-ghost text-sm" onClick={() => nav('/users')}>Back</button>
      </div>
      <div className="card p-4 space-y-4">
        <div className="text-sm text-gray-600">
          Create the Auth user in Firebase Authentication first. This page only creates the
          role record and username mapping.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">User UID</label>
            <input className="input w-full" value={uid} onChange={(e) => setUid(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Username</label>
            <input className="input w-full" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Full name</label>
            <input className="input w-full" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-500 mb-2">Department IDs (multi-select)</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {deptOptions.map((dept) => (
              <label key={dept} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={departmentIds.includes(dept)}
                  onChange={() => toggleDept(dept)}
                />
                <span>{dept}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input w-full"
              placeholder="Add department ID"
              value={deptInput}
              onChange={(e) => setDeptInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDept(); } }}
            />
            <button type="button" className="btn-primary" onClick={addDept}>Add</button>
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-500 mb-2">Roles</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ROLE_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={roleFlags[key]}
                  onChange={() => updateRole(key)}
                />
                <span>{key}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {success && <div className="text-sm text-green-600">{success}</div>}

        <button type="button" className="btn-primary w-full disabled:opacity-50" disabled={busy} onClick={onSubmit}>
          {busy ? 'Creating...' : 'Create User'}
        </button>
      </div>
    </div>
  );
}
