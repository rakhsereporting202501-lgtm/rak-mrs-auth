import { createContext, useContext, useEffect, useState } from 'react';
import { initFirebase } from '../lib/firebase';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

type RoleDoc = {
  roles?: Record<string, boolean>;
  departmentIds?: string[];
  fullName?: string;
  email?: string;
};

type AuthCtx = {
  user: User | null;
  role: RoleDoc | null;
  loading: boolean;
  hasConfig: boolean;
};

const Ctx = createContext<AuthCtx>({ user: null, role: null, loading: true, hasConfig: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ user, role, loading, hasConfig }, setState] = useState<AuthCtx>({ user: null, role: null, loading: true, hasConfig: false });

  const normalizeRole = (data: RoleDoc | null | undefined): RoleDoc | null => {
    if (!data) return null;
    const ids = Array.isArray(data.departmentIds)
      ? Array.from(new Set(data.departmentIds.map((d) => (d || '').trim()).filter(Boolean)))
      : [];
    const roles = data.roles || {};
    return { ...data, departmentIds: ids, roles };
  };

  useEffect(() => {
    const { app } = initFirebase();
    if (!app) { setState(s => ({ ...s, loading: false, hasConfig: false })); return; }
    const auth = getAuth(app);
    const db = getFirestore(app);
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const snap = await getDoc(doc(db, 'roles', u.uid));
        setState({ user: u, role: snap.exists()? normalizeRole(snap.data() as RoleDoc) : null, loading: false, hasConfig: true });
      } else {
        setState({ user: null, role: null, loading: false, hasConfig: true });
      }
    });
    return () => unsub();
  }, []);

  return <Ctx.Provider value={{ user, role, loading, hasConfig }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
