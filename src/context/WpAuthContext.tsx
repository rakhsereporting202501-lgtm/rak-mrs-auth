import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { onValue, ref, remove, serverTimestamp as rtdbServerTimestamp, set } from 'firebase/database';
import { getWpAuth, getWpDb, getWpRealtimeDb } from '../lib/wpFirebase';
import { getStoredWpLocale, storeWpLocale, type WpLocale } from '../lib/wpLocale';
import { displayWpPersonName, normalizeWpEmployee } from '../lib/wpPeople';
import {
  WP_EMPLOYEES_COLLECTION,
  WP_SESSIONS_COLLECTION,
  WP_SESSION_RTDB_PATH,
  type WpAccountType,
  type WpEmployee,
} from '../lib/wpTypes';

type StoredWpSession = {
  employeeId: string;
  sessionId: string;
};

type WpLoginResult = {
  requiresPassword: boolean;
  message?: string;
};

type WpAuthCtx = {
  firebaseUser: User | null;
  wpUser: WpEmployee | null;
  sessionId: string | null;
  loading: boolean;
  locale: WpLocale;
  isAdmin: boolean;
  canManagePlans: boolean;
  setLocale: (locale: WpLocale) => void;
  login: (employee: WpEmployee, password?: string) => Promise<WpLoginResult>;
  logout: () => Promise<void>;
};

const STORAGE_KEY = 'rakWp.session';

const Ctx = createContext<WpAuthCtx>({
  firebaseUser: null,
  wpUser: null,
  sessionId: null,
  loading: true,
  locale: 'ar',
  isAdmin: false,
  canManagePlans: false,
  setLocale: () => {},
  login: async () => ({ requiresPassword: false }),
  logout: async () => {},
});

function readStoredSession(): StoredWpSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.employeeId || !parsed?.sessionId) return null;
    return { employeeId: String(parsed.employeeId), sessionId: String(parsed.sessionId) };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredWpSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function makeSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `wp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function loadEmployee(employeeId: string): Promise<WpEmployee | null> {
  const snap = await getDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, employeeId));
  return snap.exists() ? normalizeWpEmployee({ id: snap.id, ...(snap.data() as any) }) : null;
}

export function WpAuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [wpUser, setWpUser] = useState<WpEmployee | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocaleState] = useState<WpLocale>(() => getStoredWpLocale());

  const auth = getWpAuth();
  const db = getWpDb();
  const rtdb = getWpRealtimeDb();

  const applyLocale = (next: WpLocale) => {
    storeWpLocale(next);
    setLocaleState(next);
  };

  const clearSession = async (signOutFirebase = true) => {
    const stored = readStoredSession();
    writeStoredSession(null);
    setWpUser(null);
    setSessionId(null);
    if (stored?.sessionId) {
      try {
        await updateDoc(doc(db, WP_SESSIONS_COLLECTION, stored.sessionId), {
          active: false,
          endedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {}
    }
    if (stored?.employeeId && stored?.sessionId) {
      try {
        await remove(ref(rtdb, `${WP_SESSION_RTDB_PATH}/${stored.employeeId}/${stored.sessionId}`));
      } catch {}
    }
    if (signOutFirebase) {
      try {
        await signOut(auth);
      } catch {}
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      const stored = readStoredSession();
      if (!user || !stored) {
        setWpUser(null);
        setSessionId(null);
        setLoading(false);
        return;
      }
      try {
        const employee = await loadEmployee(stored.employeeId);
        if (!employee || employee.active === false) {
          await clearSession(true);
          setLoading(false);
          return;
        }
        setWpUser(employee);
        setSessionId(stored.sessionId);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!wpUser?.id || !sessionId) return;
    const sessionRef = ref(rtdb, `${WP_SESSION_RTDB_PATH}/${wpUser.id}/${sessionId}`);
    const unsub = onValue(sessionRef, async (snap) => {
      if (!snap.exists()) {
        await clearSession(true);
        return;
      }
      const data = snap.val();
      if (data?.active === false) await clearSession(true);
    });
    return () => unsub();
  }, [wpUser?.id, sessionId]);

  const login = async (selected: WpEmployee, password?: string): Promise<WpLoginResult> => {
    const latest = await loadEmployee(selected.id);
    const employee = normalizeWpEmployee(latest || selected);
    if (employee.active === false) throw new Error(locale === 'en' ? 'This account is inactive.' : 'هذا الحساب غير فعال.');
    const accountType = (employee.accountType || 'VIEWER') as WpAccountType;
    const requiresPassword = accountType === 'COORDINATOR' || accountType === 'ADMIN';
    if (requiresPassword && !password) return { requiresPassword: true };

    let authUser: User;
    if (requiresPassword) {
      if (!employee.authEmail) {
        throw new Error(locale === 'en'
          ? 'This account has no Firebase Auth email.'
          : 'هذا الحساب لا يحتوي على بريد Firebase Auth.');
      }
      const cred = await signInWithEmailAndPassword(auth, employee.authEmail, password || '');
      authUser = cred.user;
      if (employee.authUid && employee.authUid !== authUser.uid) {
        await signOut(auth);
        throw new Error(locale === 'en' ? 'This Firebase account is not linked to this employee.' : 'حساب Firebase غير مربوط بهذا الموظف.');
      }
    } else {
      const cred = auth.currentUser?.isAnonymous ? { user: auth.currentUser } : await signInAnonymously(auth);
      authUser = cred.user;
    }

    const nextSessionId = makeSessionId();
    const session = { employeeId: employee.id, sessionId: nextSessionId };
    writeStoredSession(session);
    const employeeName = displayWpPersonName(employee, locale);
    await set(ref(rtdb, `${WP_SESSION_RTDB_PATH}/${employee.id}/${nextSessionId}`), {
      active: true,
      accountType,
      authUid: authUser.uid,
      employeeName,
      userAgent: navigator.userAgent,
      startedAt: rtdbServerTimestamp(),
      lastSeenAt: rtdbServerTimestamp(),
    });
    await setDoc(doc(db, WP_SESSIONS_COLLECTION, nextSessionId), {
      employeeId: employee.id,
      employeeName,
      accountType,
      authUid: authUser.uid,
      active: true,
      userAgent: navigator.userAgent,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setFirebaseUser(authUser);
    setWpUser(employee);
    setSessionId(nextSessionId);
    return { requiresPassword: false };
  };

  const value = useMemo<WpAuthCtx>(() => {
    const accountType = wpUser?.accountType || 'VIEWER';
    return {
      firebaseUser,
      wpUser,
      sessionId,
      loading,
      locale,
      isAdmin: accountType === 'ADMIN',
      canManagePlans: accountType === 'COORDINATOR' || accountType === 'ADMIN',
      setLocale: applyLocale,
      login,
      logout: () => clearSession(true),
    };
  }, [firebaseUser, wpUser, sessionId, loading, locale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWpAuth = () => useContext(Ctx);
