import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, deleteDoc, doc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { ClipboardList, Copy, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { getWpDb } from '../lib/wpFirebase';
import { useWpAuth } from '../context/WpAuthContext';
import type { WpCoordinatorDoc, WpPlanDoc } from '../lib/wpTypes';
import { timestampMs, WP_COORDINATORS_COLLECTION, WP_WORK_PLANS_COLLECTION } from '../lib/wpTypes';

function countEmployees(plan: WpPlanDoc) {
  return (plan.groups || []).reduce((sum, group) => sum + (group.employeeIds || []).length, 0);
}

function countLabel(count: number, label: string) {
  return `${count} ${label}`;
}

function statusLabel(status?: string) {
  if (status === 'DRAFT') return 'مسودة';
  if (status === 'SUBMITTED') return 'مرسلة';
  return status || '-';
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
  const { wpUser, isAdmin, canManagePlans } = useWpAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState<WpPlanDoc[]>([]);
  const [coordinators, setCoordinators] = useState<WpCoordinatorDoc[]>([]);
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
    if (!wpUser?.id) return;
    const db = getWpDb();
    const base = collection(db, WP_WORK_PLANS_COLLECTION);
    const q = isAdmin
      ? query(base, limit(150))
      : canManagePlans
        ? query(base, where('createdByUid', '==', wpUser.id), limit(150))
        : query(base, where('status', '==', 'SUBMITTED'), limit(150));
    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpPlanDoc));
      next.sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
      setPlans(next);
      setError(null);
      setLoading(false);
    }, (err) => {
      console.error('WP plans listen failed', err);
      setError(err?.code === 'permission-denied'
        ? 'لا توجد صلاحية لقراءة خطط العمل. تأكد من نشر قواعد Firestore الخاصة بخطط العمل.'
        : 'تعذر تحميل خطط العمل.');
      setLoading(false);
    });
    return () => unsub();
  }, [wpUser?.id, isAdmin, canManagePlans]);

  useEffect(() => {
    if (!wpUser?.id || isAdmin || canManagePlans) return;
    const unsub = onSnapshot(collection(getWpDb(), WP_COORDINATORS_COLLECTION), (snap) => {
      setCoordinators(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpCoordinatorDoc)));
    });
    return () => unsub();
  }, [wpUser?.id, isAdmin, canManagePlans]);

  const filteredPlans = useMemo(() => {
    const tokens = qText.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
    const visiblePlans = plans.filter((plan) => {
      if (isAdmin || canManagePlans) return true;
      if (plan.status !== 'SUBMITTED') return false;
      const inPlan = (plan.groups || []).some((group) => (group.employeeIds || []).includes(wpUser?.id || ''));
      if (inPlan) return true;
      const owner = coordinators.find((coordinator) => coordinator.employeeId === plan.createdByUid);
      if (!owner || owner.active === false) return false;
      if ((owner.excludeEmployeeIds || []).includes(wpUser?.id || '')) return false;
      return (owner.includeEmployeeIds || []).includes(wpUser?.id || '')
        || (owner.departmentIds || []).includes(wpUser?.department || '');
    });
    const out = visiblePlans.filter((plan) => {
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
  }, [plans, qText, statusFilter, dateFilter, sortKey, sortDir, isAdmin, canManagePlans, wpUser?.id, wpUser?.department, coordinators]);

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
    if (!window.confirm(`هل تريد حذف المسودة ${plan.planCode || plan.id}؟`)) return;
    setDeleteBusyId(plan.id);
    setError(null);
    try {
      const db = getWpDb();
      await deleteDoc(doc(db, WP_WORK_PLANS_COLLECTION, plan.id));
    } catch (err: any) {
      setError(err?.code === 'permission-denied' ? 'لا توجد صلاحية. يمكن حذف المسودات فقط.' : 'تعذر حذف المسودة.');
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={`btn-ghost inline-flex items-center justify-center gap-2 ${hasFilters ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}`}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>بحث</span>
        </button>
        {canManagePlans && (
          <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => nav('/wp/new')}>
            <Plus className="h-4 w-4" />
            <span>خطة جديدة</span>
          </button>
        )}
      </div>

      {filtersOpen && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input w-full pr-9 pl-10 bg-white text-right"
              value={qText}
              placeholder="ابحث عن خطة، مشروع، مهندس، أو فريق العمل"
              onChange={(e) => setQText(e.target.value)}
            />
            {qText && (
              <button
                type="button"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-gray-100"
                onClick={() => setQText('')}
                aria-label="مسح البحث"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            <select className="input bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="ALL">كل الحالات</option>
              <option value="DRAFT">مسودة</option>
              <option value="SUBMITTED">مرسلة</option>
            </select>
            <input className="input bg-white" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            <select className="input bg-white" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
              <option value="updatedAt">آخر تحديث</option>
              <option value="workDate">تاريخ العمل</option>
              <option value="planCode">رقم الخطة</option>
              <option value="groups">المشاريع</option>
              <option value="employees">فريق العمل</option>
            </select>
            <select className="input bg-white" value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}>
              <option value="desc">الأحدث أولاً</option>
              <option value="asc">الأقدم أولاً</option>
            </select>
            <button type="button" className="btn-ghost bg-white" onClick={clearFilters}>مسح</button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="card p-6 text-gray-500">جاري التحميل...</div>}

      {!loading && filteredPlans.length === 0 && (
        <div className="card p-8 text-center">
          <ClipboardList className="h-10 w-10 text-blue-600 mx-auto" />
          <div className="mt-3 text-base font-semibold">لا توجد خطط عمل.</div>
          <div className="mt-1 text-sm text-gray-500">أنشئ خطة جديدة أو غيّر البحث.</div>
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
              className="card p-4 w-full text-right hover:shadow-md cursor-pointer min-h-[124px] flex flex-col"
              onClick={() => nav(`/wp/${plan.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-gray-900 break-words">{plan.planCode || plan.id}</div>
                  <div className="mt-2 text-sm text-gray-600">
                    {countLabel(groupCount, 'مشروع')} - {countLabel(employeeCount, 'فريق العمل')}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {canManagePlans && plan.status === 'DRAFT' && (isAdmin || plan.createdByUid === wpUser?.id) && (
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-2 text-red-600 disabled:opacity-50"
                      disabled={deleteBusyId === plan.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDraft(plan);
                      }}
                      aria-label="حذف المسودة"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  {canManagePlans && (
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        nav(`/wp/new?copy=${plan.id}`);
                      }}
                      aria-label="نسخ الخطة"
                    >
                      <Copy className="h-4 w-4 icon-blue" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-auto flex justify-end pt-3">
                <span className={`badge ${submitted ? 'status-ready' : 'status-partially_approved'}`}>{statusLabel(plan.status)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
