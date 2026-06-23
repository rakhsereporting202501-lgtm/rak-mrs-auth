import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, deleteDoc, doc, getFirestore, limit, onSnapshot, query, where } from 'firebase/firestore';
import { ClipboardList, Copy, Plus, Search, Trash2 } from 'lucide-react';
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

function planSearchText(plan: WpPlanDoc) {
  const groupText = (plan.groups || []).map((group) => [
    group.projectCode,
    group.projectName || '',
    ...(Array.isArray(group.engineerNames) ? group.engineerNames : []),
    ...(group.employeeSnapshots || []).flatMap((employee) => [
      employee.fullName,
      employee.memberCode,
      employee.position || '',
      employee.department || '',
    ]),
  ].join(' ')).join(' ');
  return [
    plan.id,
    plan.planCode || '',
    plan.workDate || '',
    plan.status || '',
    plan.coordinatorNameEn || '',
    plan.createdBy?.fullName || '',
    plan.createdBy?.email || '',
    groupText,
  ].join(' ').toLowerCase();
}

export default function WpPlans() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState<WpPlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const savedFilters = useMemo(() => {
    try {
      const raw = localStorage.getItem('rakWp.plans.filters');
      return raw ? JSON.parse(raw) || {} : {};
    } catch {
      return {};
    }
  }, []);
  const [qText, setQText] = useState(() => typeof savedFilters.qText === 'string' ? savedFilters.qText : '');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'SUBMITTED'>(() => (
    ['ALL', 'DRAFT', 'SUBMITTED'].includes(savedFilters.statusFilter) ? savedFilters.statusFilter : 'ALL'
  ));
  const [dateFilter, setDateFilter] = useState(() => typeof savedFilters.dateFilter === 'string' ? savedFilters.dateFilter : '');
  const [sortKey, setSortKey] = useState<'updatedAt' | 'workDate' | 'planCode' | 'coordinator' | 'status' | 'groups' | 'employees'>(() => (
    ['updatedAt', 'workDate', 'planCode', 'coordinator', 'status', 'groups', 'employees'].includes(savedFilters.sortKey) ? savedFilters.sortKey : 'updatedAt'
  ));
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => savedFilters.sortDir === 'asc' ? 'asc' : 'desc');
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const isAdmin = !!role?.roles?.admin;

  useEffect(() => {
    try {
      localStorage.setItem('rakWp.plans.filters', JSON.stringify({
        qText,
        statusFilter,
        dateFilter,
        sortKey,
        sortDir,
      }));
    } catch {}
  }, [qText, statusFilter, dateFilter, sortKey, sortDir]);

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
  const filteredPlans = useMemo(() => {
    const tokens = qText.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
    const out = plans.filter((plan) => {
      if (statusFilter !== 'ALL' && plan.status !== statusFilter) return false;
      if (dateFilter && plan.workDate !== dateFilter) return false;
      if (!tokens.length) return true;
      const hay = planSearchText(plan);
      return tokens.every((token) => hay.includes(token));
    });
    out.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'workDate') return (a.workDate || '').localeCompare(b.workDate || '') * dir;
      if (sortKey === 'planCode') return (a.planCode || a.id || '').localeCompare(b.planCode || b.id || '') * dir;
      if (sortKey === 'coordinator') return (a.coordinatorNameEn || a.createdBy?.fullName || '').localeCompare(b.coordinatorNameEn || b.createdBy?.fullName || '') * dir;
      if (sortKey === 'status') return (a.status || '').localeCompare(b.status || '') * dir;
      if (sortKey === 'groups') return (((a.groups || []).length) - ((b.groups || []).length)) * dir;
      if (sortKey === 'employees') return (countEmployees(a) - countEmployees(b)) * dir;
      return (timestampMs(a.updatedAt || a.createdAt) - timestampMs(b.updatedAt || b.createdAt)) * dir;
    });
    return out;
  }, [plans, qText, statusFilter, dateFilter, sortKey, sortDir]);

  const clearFilters = () => {
    setQText('');
    setStatusFilter('ALL');
    setDateFilter('');
    setSortKey('updatedAt');
    setSortDir('desc');
  };

  const deleteDraft = async (plan: WpPlanDoc) => {
    if (plan.status !== 'DRAFT') return;
    if (!window.confirm(`Delete draft ${plan.planCode || plan.id}?`)) return;
    setDeleteBusyId(plan.id);
    setError(null);
    try {
      const { app } = initFirebase();
      const db = getFirestore(app);
      await deleteDoc(doc(db, WP_WORK_PLANS_COLLECTION, plan.id));
    } catch (err: any) {
      setError(err?.code === 'permission-denied' ? 'Permission denied. Only drafts can be deleted.' : (err?.message || 'Failed to delete draft.'));
    } finally {
      setDeleteBusyId(null);
    }
  };

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

      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input w-full pl-9"
            value={qText}
            placeholder="Search plan ID, coordinator, project, engineer, employee, position, or department"
            onChange={(e) => setQText(e.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
          </select>
          <input className="input" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
            <option value="updatedAt">Sort by last update</option>
            <option value="workDate">Sort by work date</option>
            <option value="planCode">Sort by plan ID</option>
            <option value="coordinator">Sort by coordinator</option>
            <option value="status">Sort by status</option>
            <option value="groups">Sort by groups</option>
            <option value="employees">Sort by employees</option>
          </select>
          <select className="input" value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
          <button type="button" className="btn-ghost" onClick={clearFilters}>Clear</button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="card p-6 text-gray-500">Loading...</div>}

      {!loading && filteredPlans.length === 0 && (
        <div className="card p-8 text-center">
          <ClipboardList className="h-10 w-10 text-blue-600 mx-auto" />
          <div className="mt-3 text-base font-semibold">No work plans found.</div>
          <div className="mt-1 text-sm text-gray-500">Create a plan or adjust the filters.</div>
        </div>
      )}

      <div className="space-y-3">
        {filteredPlans.map((plan) => {
          const submitted = plan.status === 'SUBMITTED';
          return (
            <div
              key={plan.id}
              className="card p-4 w-full text-left hover:shadow-md cursor-pointer"
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
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  {plan.status === 'DRAFT' && (
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-2 text-red-600 disabled:opacity-50"
                      disabled={deleteBusyId === plan.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDraft(plan);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline">{deleteBusyId === plan.id ? 'Deleting...' : 'Delete'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      nav(`/wp/new?copy=${plan.id}`);
                    }}
                  >
                    <Copy className="h-4 w-4 icon-blue" />
                    <span className="hidden sm:inline">Copy</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
