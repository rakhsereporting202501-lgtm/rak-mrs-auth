import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getFirestore, onSnapshot } from 'firebase/firestore';
import { Building2, UserPlus, Users as UsersIcon } from 'lucide-react';
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

type CardProps = {
  title: string;
  Icon: any;
  onClick?: () => void;
};

function ActionCard({ title, Icon, onClick }: CardProps) {
  return (
    <button
      type="button"
      className="card flex flex-col items-center justify-center gap-2 p-4 text-center hover:shadow-md"
      onClick={onClick}
    >
      <Icon className="h-6 w-6 text-blue-600" />
      <div className="text-sm font-semibold">{title}</div>
    </button>
  );
}

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
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});

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

  if (!role?.roles?.admin) {
    return <div className="card p-4">Admin only.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-xl font-semibold">Users</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ActionCard title="Create New User" Icon={UserPlus} onClick={() => nav('/users/new')} />
        <ActionCard title="Department" Icon={Building2} onClick={() => nav('/users/departments')} />
        <ActionCard title="Users" Icon={UsersIcon} onClick={() => listRef.current?.scrollIntoView({ behavior: 'smooth' })} />
      </div>

      <div ref={listRef} className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="font-semibold">All Users</div>
          <input
            className="input w-full sm:w-72"
            placeholder="Search name, username, department, or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="space-y-3">
          {filtered.map((user) => {
            const username = usernames[user.uid] || '-';
            const departments = (user.departmentIds || []).join(' - ') || '-';
            const roles = Object.entries(user.roles || {}).filter(([_, v]) => v).map(([k]) => k);
            return (
              <button
                key={user.uid}
                type="button"
                className="card w-full p-4 text-left hover:shadow-md"
                onClick={() => nav(`/users/${user.uid}`)}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold">{username}</div>
                    <div className="text-sm text-gray-700">{user.fullName || '-'}</div>
                    <div className="text-xs text-gray-500">{departments}</div>
                  </div>
                  <div className="text-xs text-gray-500">Created: {formatDate(user.createdAt)}</div>
                </div>
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
          {filtered.length === 0 && (
            <div className="text-sm text-gray-500">No users found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
