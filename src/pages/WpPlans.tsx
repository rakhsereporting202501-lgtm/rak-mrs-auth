import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getFirestore, limit, onSnapshot, query, where } from 'firebase/firestore';
import { ClipboardList, Copy, Plus } from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import type { WpPlanDoc } from '../lib/wpTypes';
import { timestampMs, WP_WORK_PLANS_COLLECTION } from '../lib/wpTypes';

function formatDate(value: any) {
  if (!value) return '-';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function countEmployees(plan: WpPlanDoc) {
  return (plan.groups || []).reduce((sum, group) => sum + (group.employeeIds || []).length, 0);
}

export default function WpPlans() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState<WpPlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = !!role?.roles?.admin;

  useEffect(() => {
    if (!user?.uid) return;
    const { app } = initFirebase();
    const db = getFirestore(app);
    const base = collection(db, WP_WORK_PLANS_COLLECTION);
    const q = isAdmin
      ? query(base, limit(150))
      : query(base, where('createdByUid', '==', user.uid), limit(150));
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpPlanDoc));
      next.sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
      setPlans(next);
      setError(null);
      setLoading(false);
    }, (err) => {
      console.error('WP plans listen failed', err);
      setError(err?.code === 'permission-denied'
        ? 'Permission denied. Publish the RAK WP Firestore rules before using this page.'
        : (err?.message || 'Failed to load work plans.'));
      setLoading(false);
    });
    return () => unsub();
  }, [user?.uid, isAdmin]);

  const draftCount = useMemo(() => plans.filter((p) => p.status === 'DRAFT').length, [plans]);
  const submittedCount = useMemo(() => plans.filter((p) => p.status === 'SUBMITTED').length, [plans]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">RAK WP</div>
          <div className="text-sm text-gray-500">Work plans</div>
        </div>
        <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => nav('/wp/new')}>
          <Plus className="h-4 w-4" />
          <span>New Work Plan</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total</div>
          <div className="text-2xl font-semibold text-gray-900">{plans.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Draft</div>
          <div className="text-2xl font-semibold text-amber-600">{draftCount}</div>
        </div>
        <div className="card p-4 col-span-2 sm:col-span-1">
          <div className="text-xs text-gray-500">Submitted</div>
          <div className="text-2xl font-semibold text-green-600">{submittedCount}</div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="card p-6 text-gray-500">Loading...</div>}

      {!loading && plans.length === 0 && (
        <div className="card p-8 text-center">
          <ClipboardList className="h-10 w-10 text-blue-600 mx-auto" />
          <div className="mt-3 text-base font-semibold">No work plans yet.</div>
          <div className="mt-1 text-sm text-gray-500">Create the first daily plan.</div>
        </div>
      )}

      <div className="space-y-3">
        {plans.map((plan) => {
          const submitted = plan.status === 'SUBMITTED';
          return (
            <button
              type="button"
              key={plan.id}
              className="card p-4 w-full text-left hover:shadow-md"
              onClick={() => nav(`/wp/${plan.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-base font-semibold text-gray-900">{plan.planCode || plan.workDate || '-'}</div>
                    <span className={`badge ${submitted ? 'status-ready' : 'status-partially_approved'}`}>{plan.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{plan.workDate || '-'} - {plan.coordinatorNameEn || plan.createdBy?.fullName || '-'}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    {(plan.groups || []).length} group{(plan.groups || []).length === 1 ? '' : 's'} - {countEmployees(plan)} employee{countEmployees(plan) === 1 ? '' : 's'}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">Updated: {formatDate(plan.updatedAt || plan.createdAt)}</div>
                </div>
                <button
                  type="button"
                  className="btn-ghost inline-flex items-center gap-2 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    nav(`/wp/new?copy=${plan.id}`);
                  }}
                >
                  <Copy className="h-4 w-4 icon-blue" />
                  <span className="hidden sm:inline">Copy</span>
                </button>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
