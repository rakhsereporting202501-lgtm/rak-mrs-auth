import { useEffect, useMemo, useState } from 'react';
import { collection, getFirestore, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initFirebase } from '../lib/firebase';

type RoleDoc = {
  fullName?: string;
  email?: string;
  departmentIds?: string[];
  roles?: Record<string, boolean>;
  createdAt?: any;
};

type UserRow = {
  uid: string;
  username?: string;
  fullName?: string;
  email?: string;
  departmentIds?: string[];
  roles?: Record<string, boolean>;
  createdAt?: any;
};

function formatDate(value: any) {
  if (!value) return '-';
  if (typeof value === 'number') return new Date(value).toLocaleString();
  if (typeof value === 'string') return new Date(value).toLocaleString();
  if (value?.toDate) return value.toDate().toLocaleString();
  return '-';
}

export default function UsersDepartments() {
  const { role } = useAuth();
  const nav = useNavigate();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [openDept, setOpenDept] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!role?.roles?.admin) return;
    const { app } = initFirebase();
    const db = getFirestore(app);
    const unsub = onSnapshot(collection(db, 'roles'), (snap) => {
      const next: UserRow[] = snap.docs.map((doc) => {
        const data = doc.data() as RoleDoc;
        return {
          uid: doc.id,
          fullName: data.fullName || '',
          email: data.email || '',
          departmentIds: Array.isArray(data.departmentIds) ? data.departmentIds : [],
          roles: data.roles || {},
          createdAt: data.createdAt,
        };
      });
      setUsers(next);
    });
    return () => unsub();
  }, [role?.roles?.admin]);

  useEffect(() => {
    if (!role?.roles?.admin) return;
    const { app } = initFirebase();
    const db = getFirestore(app);
    const unsub = onSnapshot(collection(db, 'usernames'), (snap) => {
      const map: Record<string, string> = {};
      snap.docs.forEach((doc) => {
        const data = doc.data() as any;
        if (data?.uid) map[data.uid] = doc.id;
      });
      setUsernames(map);
    });
    return () => unsub();
  }, [role?.roles?.admin]);

  const deptMap = useMemo(() => {
    const map = new Map<string, UserRow[]>();
    users.forEach((user) => {
      const depts = user.departmentIds || [];
      depts.forEach((dept) => {
        const key = (dept || '').trim();
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(user);
      });
    });
    return map;
  }, [users]);

  if (!role?.roles?.admin) {
    return <div className="card p-4">Admin only.</div>;
  }

  const orderedDepts = Array.from(deptMap.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xl font-semibold">Departments</div>
        <button type="button" className="btn-ghost text-sm" onClick={() => nav('/users')}>Back</button>
      </div>
      <div className="space-y-3">
        {orderedDepts.map((dept) => {
          const list = deptMap.get(dept) || [];
          const open = !!openDept[dept];
          return (
            <div key={dept} className="card p-0 overflow-hidden">
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between border-b border-gray-100"
                onClick={() => setOpenDept((prev) => ({ ...prev, [dept]: !open }))}
              >
                <div className="text-sm font-semibold">{dept}</div>
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <span>{list.length}</span>
                  <span className="text-blue-600">{open ? 'Hide' : 'Show'}</span>
                </div>
              </button>
              {open && (
                <div className="p-4 space-y-3">
                  {list.map((user) => {
                    const username = usernames[user.uid] || '-';
                    const roles = Object.entries(user.roles || {}).filter(([_, v]) => v).map(([k]) => k);
                    return (
                      <button
                        key={user.uid}
                        type="button"
                        className="card w-full p-3 text-left hover:shadow-md"
                        onClick={() => nav(`/users/${user.uid}`)}
                      >
                        <div className="text-sm font-semibold">{user.fullName || '-'}</div>
                        <div className="text-xs text-gray-600">{user.email || '-'}</div>
                        <div className="text-xs text-gray-500">Username: {username}</div>
                        <div className="text-xs text-gray-500">Created: {formatDate(user.createdAt)}</div>
                        {roles.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {roles.map((r) => (
                              <span key={r} className="badge-light">{r}</span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {list.length === 0 && <div className="text-sm text-gray-500">No users.</div>}
                </div>
              )}
            </div>
          );
        })}
        {orderedDepts.length === 0 && (
          <div className="card p-4 text-sm text-gray-500">No departments found.</div>
        )}
      </div>
    </div>
  );
}
