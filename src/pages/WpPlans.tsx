import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, deleteDoc, doc, getFirestore, limit, onSnapshot, query, where } from 'firebase/firestore';
import { ClipboardList, Copy, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import type { WpPlanDoc } from '../lib/wpTypes';
import { timestampMs, WP_WORK_PLANS_COLLECTION } from '../lib/wpTypes';

function countEmployees(plan: WpPlanDoc) {
  return (plan.groups || []).reduce((sum, group) => sum + (group.employeeIds || []).length, 0);
}

function plural(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function planSearchText(plan: WpPlanDoc) {
  const groupText = (plan.groups || []).map((group) => [
    group.projectCode,
    group.projectName || '',
    ...(Array.isArray(group.engineerNames) ? group.engineerNames : []),
    ...(group.engineerSnapshots || []).flatMap((engineer) => [
      engineer.fullName,
      engineer.position || '',
      engineer.department || '',
    ]),
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
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [sortKey, setSortKey] = useState<'updatedAt' | 'workDate' | 'planCode' | 'groups' | 'employees'>(() => (
    ['updatedAt', 'workDate', 'planCode', 'groups', 'employees'].includes(savedFilters.sortKey) ? savedFilters.sortKey : 'updatedAt'
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
      if (sortKey === 'groups') return (((a.groups || []).length) - ((b.groups || []).length)) * dir;
      if (sortKey === 'employees') return (countEmployees(a) - countEmployees(b)) * dir;
      return (timestampMs(a.updatedAt || a.createdAt) - timestampMs(b.updatedAt || b.createdAt)) * dir;
    });
    return out;
  }, [plans, qText, statusFilter, dateFilter, sortKey, sortDir]);

  const hasFilters = !!qText || statusFilter !== 'ALL' || !!dateFilter || sortKey !== 'updatedAt' || sortDir !== 'desc';

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
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={`btn-ghost inline-flex items-center justify-center gap-2 ${hasFilters ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}`}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Search</span>
        </button>
        <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => nav('/wp/new')}>
          <Plus className="h-4 w-4" />
          <span>New Work Plan</span>
        </button>
      </div>

      {filtersOpen && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input w-full pl-9 pr-10 bg-white"
              value={qText}
              placeholder="Search plan, project, engineer, employee"
              onChange={(e) => setQText(e.target.value)}
            />
            {qText && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-gray-100"
                onClick={() => setQText('')}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            <select className="input bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SUBMITTED">Submitted</option>
            </select>
            <input className="input bg-white" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            <select className="input bg-white" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
              <option value="updatedAt">Last update</option>
              <option value="workDate">Work date</option>
              <option value="planCode">Plan ID</option>
              <option value="groups">Groups</option>
              <option value="employees">Employees</option>
            </select>
            <select className="input bg-white" value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
            <button type="button" className="btn-ghost bg-white" onClick={clearFilters}>Clear</button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="card p-6 text-gray-500">Loading...</div>}

      {!loading && filteredPlans.length === 0 && (
        <div className="card p-8 text-center">
          <ClipboardList className="h-10 w-10 text-blue-600 mx-auto" />
          <div className="mt-3 text-base font-semibold">No work plans found.</div>
          <div className="mt-1 text-sm text-gray-500">Create a plan or adjust the search.</div>
        </div>
      )}

      <div className="space-y-3">
        {filteredPlans.map((plan) => {
          const submitted = plan.status === 'SUBMITTED';
          const employeeCount = countEmployees(plan);
          const groupCount = (plan.groups || []).length;
          return (
            <div
              key={plan.id}
              className="card p-4 w-full text-left hover:shadow-md cursor-pointer min-h-[124px] flex flex-col"
              onClick={() => nav(`/wp/${plan.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-gray-900 break-words">{plan.planCode || plan.id}</div>
                  <div className="mt-2 text-sm text-gray-600">
                    {plural(groupCount, 'group')} - {plural(employeeCount, 'employee')}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {plan.status === 'DRAFT' && (
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-2 text-red-600 disabled:opacity-50"
                      disabled={deleteBusyId === plan.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDraft(plan);
                      }}
                      aria-label="Delete draft"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      nav(`/wp/new?copy=${plan.id}`);
                    }}
                    aria-label="Copy plan"
                  >
                    <Copy className="h-4 w-4 icon-blue" />
                  </button>
                </div>
              </div>
              <div className="mt-auto flex justify-end pt-3">
                <span className={`badge ${submitted ? 'status-ready' : 'status-partially_approved'}`}>{plan.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
