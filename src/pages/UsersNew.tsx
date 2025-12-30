import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { initFirebase } from '../lib/firebase';

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
  const { uid: routeUid } = useParams();
  const isEdit = !!routeUid;
  const { app } = initFirebase();
  const db = getFirestore(app);

  const [email, setEmail] = useState('');
  const [uid, setUid] = useState('');
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [deptInput, setDeptInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  useEffect(() => {
    if (!role?.roles?.admin) return;
    if (!isEdit || !routeUid) return;
    const load = async () => {
      setBusy(true);
      setError(null);
      try {
        const roleRef = doc(db, 'roles', routeUid);
        const roleSnap = await getDoc(roleRef);
        if (!roleSnap.exists()) {
          setError('User not found.');
          return;
        }
        const data = roleSnap.data() as any;
        setUid(routeUid);
        setEmail(data.email || '');
        setFullName(data.fullName || '');
        setDepartmentIds(Array.isArray(data.departmentIds) ? data.departmentIds : []);
        setRoleFlags({
          admin: !!data.roles?.admin,
          auditor: !!data.roles?.auditor,
          deptManager: !!data.roles?.deptManager,
          requester: !!data.roles?.requester,
          storeOfficer: !!data.roles?.storeOfficer,
        });

        const q = query(collection(db, 'usernames'), where('uid', '==', routeUid));
        const snaps = await getDocs(q);
        const uname = snaps.docs[0]?.id || '';
        setUsername(uname);
        setOriginalUsername(uname);
      } catch (err: any) {
        setError(err?.message || 'Failed to load user.');
      } finally {
        setBusy(false);
      }
    };
    load();
  }, [db, isEdit, routeUid, role?.roles?.admin]);

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

      if (!isEdit && roleSnap.exists()) {
        setError('This UID already exists in roles.');
        return;
      }
      if (!isEdit && userSnap.exists()) {
        setError('This username already exists.');
        return;
      }
      if (isEdit && originalUsername && cleanUsername !== originalUsername && userSnap.exists()) {
        setError('This username already exists.');
        return;
      }

      const batch = writeBatch(db);
      if (isEdit) {
        batch.set(roleRef, {
          fullName: cleanFullName,
          email: cleanEmail,
          departmentIds: cleanDepts,
          roles: roleFlags,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        batch.set(roleRef, {
          fullName: cleanFullName,
          email: cleanEmail,
          departmentIds: cleanDepts,
          roles: roleFlags,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (isEdit && originalUsername && cleanUsername !== originalUsername) {
        batch.delete(doc(db, 'usernames', originalUsername));
      }

      batch.set(usernameRef, {
        uid: cleanUid,
        email: cleanEmail,
        fullName: cleanFullName,
      }, { merge: true });

      await batch.commit();

      if (newPassword && newPassword.length < 8) {
        setError('New password must be at least 8 characters.');
        return;
      }

      setSuccess(
        newPassword
          ? 'User saved. Password changes must be handled in Firebase Authentication.'
          : (isEdit ? 'User updated successfully.' : 'User role record created successfully.')
      );
      if (!isEdit) {
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
      }
      setNewPassword('');
    } catch (err: any) {
      setError(err?.message || 'Failed to save user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">{isEdit ? 'Edit User' : 'Create New User'}</div>
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
            <input className="input w-full" value={uid} onChange={(e) => setUid(e.target.value)} disabled={isEdit} />
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
          <label className="block text-xs text-gray-500 mb-1">New password (optional)</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              className="input w-full pr-12"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep current password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-blue-600"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Minimum 8 characters.</div>
          <div className="text-[11px] text-gray-400">Password changes are applied in Firebase Authentication.</div>
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
          {busy ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create User')}
        </button>
      </div>
    </div>
  );
}
