import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { ref, remove } from 'firebase/database';
import { LogOut, Monitor, User } from 'lucide-react';
import { useWpAuth } from '../context/WpAuthContext';
import { getWpDb, getWpRealtimeDb } from '../lib/wpFirebase';
import { displayWpPersonName } from '../lib/wpPeople';
import { WP_SESSIONS_COLLECTION, WP_SESSION_RTDB_PATH, type WpSessionDoc } from '../lib/wpTypes';
import { timestampMs } from '../lib/wpTypes';

export default function WpProfile() {
  const { wpUser, sessionId, logout, locale } = useWpAuth();
  const [sessions, setSessions] = useState<WpSessionDoc[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAr = locale === 'ar';

  useEffect(() => {
    if (!wpUser?.id) return;
    const q = query(collection(getWpDb(), WP_SESSIONS_COLLECTION), where('employeeId', '==', wpUser.id));
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpSessionDoc));
      next.sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
      setSessions(next);
    });
    return () => unsub();
  }, [wpUser?.id]);

  const activeSessions = useMemo(() => sessions.filter((session) => session.active), [sessions]);

  const revokeSession = async (session: WpSessionDoc) => {
    if (!wpUser?.id) return;
    setBusyId(session.id);
    try {
      await updateDoc(doc(getWpDb(), WP_SESSIONS_COLLECTION, session.id), {
        active: false,
        endedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await remove(ref(getWpRealtimeDb(), `${WP_SESSION_RTDB_PATH}/${wpUser.id}/${session.id}`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 text-right" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xl font-semibold">{isAr ? 'الملف الشخصي' : 'Profile'}</div>
        <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={logout}>
          <LogOut className="h-4 w-4 icon-blue" />
          <span>{isAr ? 'تسجيل الخروج' : 'Sign out'}</span>
        </button>
      </div>

      <div className="hero-card">
        <User className="h-7 w-7 mb-3" />
        <div className="hero-title">{wpUser ? displayWpPersonName(wpUser, locale) : '-'}</div>
        <div className="hero-meta">{wpUser?.memberCode || '-'}</div>
        <div className="hero-meta">{wpUser?.position || '-'} - {wpUser?.department || '-'}</div>
        <div className="hero-badges">
          <span className="badge-light">{wpUser?.accountType || 'VIEWER'}</span>
          {wpUser?.authEmail && <span className="badge-light">{wpUser.authEmail}</span>}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">{isAr ? 'الجلسات النشطة' : 'Active sessions'}</div>
          <span className="badge border-blue-200 bg-blue-50 text-blue-700">{activeSessions.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {activeSessions.map((session) => {
            const current = session.id === sessionId;
            return (
              <div key={session.id} className="rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Monitor className="h-4 w-4 icon-blue" />
                    <span>{current ? (isAr ? 'هذه الجلسة' : 'This session') : session.id}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 truncate">{session.userAgent || '-'}</div>
                </div>
                {!current && (
                  <button
                    type="button"
                    className="btn-ghost text-red-600 disabled:opacity-50"
                    disabled={busyId === session.id}
                    onClick={() => revokeSession(session)}
                  >
                    {isAr ? 'إخراج' : 'Revoke'}
                  </button>
                )}
              </div>
            );
          })}
          {!activeSessions.length && <div className="text-sm text-gray-500">{isAr ? 'لا توجد جلسات.' : 'No sessions.'}</div>}
        </div>
      </div>
    </div>
  );
}
