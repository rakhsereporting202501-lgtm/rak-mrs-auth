import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getFirestore, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Search } from 'lucide-react';
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

export default function Users() {
  const { role } = useAuth();
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [openDept, setOpenDept] = useState<Record<string, boolean>>({});
  const [authCreated, setAuthCreated] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (!role?.roles?.admin) return;
    const { app } = initFirebase();
    const fn = httpsCallable(getFunctions(app), 'adminListAuthUsers');
    fn({})
      .then((res: any) => {
        const list = res?.data?.users || [];
        const map: Record<string, string> = {};
        list.forEach((u: any) => {
          if (u?.uid && u?.creationTime) map[u.uid] = u.creationTime;
        });
        setAuthCreated(map);
      })
      .catch(() => {
        setAuthCreated({});
      });
  }, [role?.roles?.admin]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return users;
    return users.filter((user) => {
      const username = (usernames[user.uid] || '').toLowerCase();
      const name = (user.fullName || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const depts = (user.departmentIds || []).join(' ').toLowerCase();
      const roles = Object.entries(user.roles || {}).filter(([_, v]) => v).map(([k]) => k).join(' ').toLowerCase();
      const haystack = `${username} ${name} ${email} ${depts} ${roles}`;
      return tokens.every((t) => haystack.includes(t));
    });
  }, [query, users, usernames]);

  const deptMap = useMemo(() => {
    const map = new Map<string, UserRow[]>();
    filtered.forEach((user) => {
      const depts = user.departmentIds || [];
      depts.forEach((dept) => {
        const key = (dept || '').trim();
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(user);
      });
    });
    return map;
  }, [filtered]);

  if (!role?.roles?.admin) {
    return <div className="card p-4">Admin only.</div>;
  }

  const orderedDepts = Array.from(deptMap.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Users</div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          className="input w-full pl-9"
          placeholder="Search by name, username, department, or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
                    const createdValue = user.createdAt || authCreated[user.uid];
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
                        <div className="text-xs text-gray-500">Created: {formatDate(createdValue)}</div>
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
