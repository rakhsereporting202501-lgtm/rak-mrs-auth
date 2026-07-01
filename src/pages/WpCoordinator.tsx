import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { CheckCircle2, Plus, Save, Search, Shield, X } from 'lucide-react';
import { useWpAuth } from '../context/WpAuthContext';
import { getWpDb } from '../lib/wpFirebase';
import { displayWpPersonName, normalizeWpEmployee, wpEmployeeSearchText } from '../lib/wpPeople';
import {
  WP_COORDINATORS_COLLECTION,
  WP_DEPARTMENTS_COLLECTION,
  WP_EMPLOYEES_COLLECTION,
  type WpCoordinatorDoc,
  type WpEmployee,
  type WpLookupDoc,
} from '../lib/wpTypes';

function lookup(docId: string, data: any): WpLookupDoc {
  return { id: docId, name: data?.name || docId, active: data?.active !== false };
}

export default function WpCoordinator() {
  const { wpUser, canManagePlans, locale } = useWpAuth();
  const [employees, setEmployees] = useState<WpEmployee[]>([]);
  const [departments, setDepartments] = useState<WpLookupDoc[]>([]);
  const [coordinators, setCoordinators] = useState<WpCoordinatorDoc[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [includeEmployeeIds, setIncludeEmployeeIds] = useState<string[]>([]);
  const [excludeEmployeeIds, setExcludeEmployeeIds] = useState<string[]>([]);
  const [includeSearch, setIncludeSearch] = useState('');
  const [excludeSearch, setExcludeSearch] = useState('');
  const [message, setMessage] = useState('');
  const isAr = locale === 'ar';

  useEffect(() => {
    const db = getWpDb();
    const unsubs = [
      onSnapshot(collection(db, WP_EMPLOYEES_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => normalizeWpEmployee({ id: docSnap.id, ...(docSnap.data() as any) }));
        next.sort((a, b) => displayWpPersonName(a, locale).localeCompare(displayWpPersonName(b, locale)));
        setEmployees(next);
      }),
      onSnapshot(collection(db, WP_DEPARTMENTS_COLLECTION), (snap) => {
        setDepartments(snap.docs.map((docSnap) => lookup(docSnap.id, docSnap.data())).sort((a, b) => a.name.localeCompare(b.name)));
      }),
      onSnapshot(collection(db, WP_COORDINATORS_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpCoordinatorDoc));
        setCoordinators(next);
        const own = next.find((coordinator) => coordinator.employeeId === wpUser?.id);
        if (own) {
          setDepartmentIds(own.departmentIds || []);
          setIncludeEmployeeIds(own.includeEmployeeIds || []);
          setExcludeEmployeeIds(own.excludeEmployeeIds || []);
        }
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [wpUser?.id, locale]);

  const overlaps = useMemo(() => {
    const dept = new Set(departmentIds);
    const people = new Set([...includeEmployeeIds, ...excludeEmployeeIds]);
    return coordinators
      .filter((coordinator) => coordinator.employeeId !== wpUser?.id)
      .filter((coordinator) => (
        (coordinator.departmentIds || []).some((entry) => dept.has(entry))
        || (coordinator.includeEmployeeIds || []).some((entry) => people.has(entry))
      ));
  }, [coordinators, departmentIds, includeEmployeeIds, excludeEmployeeIds, wpUser?.id]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active !== false && employee.accountType !== 'ADMIN'),
    [employees],
  );

  const toggleDepartment = (departmentName: string) => {
    setDepartmentIds((prev) => (
      prev.includes(departmentName)
        ? prev.filter((entry) => entry !== departmentName)
        : [...prev, departmentName]
    ));
  };

  const searchPeople = (searchText: string, selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const tokens = searchText.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
    return activeEmployees
      .filter((employee) => {
        if (selected.has(employee.id)) return false;
        if (!tokens.length) return true;
        const hay = wpEmployeeSearchText(employee);
        return tokens.every((token) => hay.includes(token));
      })
      .slice(0, 120);
  };

  const personName = (employeeId: string) => {
    const employee = employeeById.get(employeeId);
    return employee ? displayWpPersonName(employee, locale) : employeeId;
  };

  const renderPeoplePicker = ({
    title,
    description,
    search,
    onSearch,
    selectedIds,
    onChange,
    tone,
  }: {
    title: string;
    description: string;
    search: string;
    onSearch: (value: string) => void;
    selectedIds: string[];
    onChange: (next: string[]) => void;
    tone: 'include' | 'exclude';
  }) => {
    const results = searchPeople(search, selectedIds);
    const toneClass = tone === 'include'
      ? 'border-emerald-100 bg-emerald-50/60'
      : 'border-rose-100 bg-rose-50/60';
    const badgeClass = tone === 'include'
      ? 'border-emerald-200 bg-white text-emerald-800'
      : 'border-rose-200 bg-white text-rose-800';

    return (
      <section className={`rounded-2xl border p-3 sm:p-4 ${toneClass}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{title}</div>
            <div className="mt-1 text-xs leading-5 text-gray-600">{description}</div>
          </div>
          <span className="badge border-gray-200 bg-white text-gray-700">{selectedIds.length}</span>
        </div>

        <div className="relative mt-3">
          <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 ${isAr ? 'right-3' : 'left-3'}`} />
          <input
            className={`input ${isAr ? 'pr-9 text-right' : 'pl-9 text-left'}`}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={isAr ? 'بحث بالاسم أو القسم أو المنصب' : 'Search by name, department, or position'}
          />
        </div>

        <div className="mt-3 min-h-12 rounded-2xl border border-white/70 bg-white/70 p-2">
          {selectedIds.length ? (
            <div className="flex flex-wrap gap-2">
              {selectedIds.map((employeeId) => (
                <span key={employeeId} className={`inline-flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1 text-xs ${badgeClass}`}>
                  <span className="truncate">{personName(employeeId)}</span>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-gray-100"
                    onClick={() => onChange(selectedIds.filter((entry) => entry !== employeeId))}
                    aria-label={isAr ? 'إزالة' : 'Remove'}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="px-1 py-2 text-xs text-gray-500">{isAr ? 'لا يوجد اختيار حالياً.' : 'No selection yet.'}</div>
          )}
        </div>

        <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {results.map((employee) => (
            <button
              key={employee.id}
              type="button"
              className="flex items-center justify-between gap-3 rounded-2xl border border-white bg-white p-3 text-start shadow-sm hover:border-blue-200 hover:bg-blue-50"
              onClick={() => onChange([...selectedIds, employee.id])}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{displayWpPersonName(employee, locale)}</div>
                <div className="truncate text-xs text-gray-500">{employee.position || '-'} - {employee.department || '-'}</div>
              </div>
              <Plus className="h-4 w-4 shrink-0 text-blue-600" />
            </button>
          ))}
          {!results.length && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-3 text-sm text-gray-500 sm:col-span-2">
              {isAr ? 'لا توجد نتائج مطابقة.' : 'No matching people.'}
            </div>
          )}
        </div>
      </section>
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!wpUser) return;
    await setDoc(doc(getWpDb(), WP_COORDINATORS_COLLECTION, wpUser.id), {
      id: wpUser.id,
      employeeId: wpUser.id,
      employeeName: displayWpPersonName(wpUser, locale),
      active: true,
      departmentIds,
      includeEmployeeIds,
      excludeEmployeeIds,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setMessage(isAr ? 'تم حفظ صلاحيات التنسيق.' : 'Coordinator access saved.');
  };

  if (!canManagePlans) {
    return <div className="alert alert-error" dir={isAr ? 'rtl' : 'ltr'}>{isAr ? 'هذه الصفحة خاصة بالمنسقين.' : 'Coordinators only.'}</div>;
  }

  return (
    <form className="space-y-4 text-right" dir={isAr ? 'rtl' : 'ltr'} onSubmit={save}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 icon-blue" />
          <div>
            <div className="text-xl font-semibold">{isAr ? 'صلاحيات التنسيق' : 'Coordinator Access'}</div>
            <div className="mt-1 text-sm text-gray-500">
              {isAr ? 'حدد الأقسام، ثم أضف أو استثن أشخاصاً عند الحاجة.' : 'Choose departments, then add or exclude people when needed.'}
            </div>
          </div>
        </div>
        <button type="submit" className="btn-primary inline-flex items-center gap-2">
          <Save className="h-4 w-4" />
          <span>{isAr ? 'حفظ' : 'Save'}</span>
        </button>
      </div>
      {message && <div className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <div className="text-xs text-blue-700">{isAr ? 'الأقسام' : 'Departments'}</div>
          <div className="mt-1 text-2xl font-semibold text-blue-900">{departmentIds.length}</div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-xs text-emerald-700">{isAr ? 'أشخاص إضافيين' : 'Extra people'}</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-900">{includeEmployeeIds.length}</div>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
          <div className="text-xs text-rose-700">{isAr ? 'أشخاص مستثنين' : 'Excluded people'}</div>
          <div className="mt-1 text-2xl font-semibold text-rose-900">{excludeEmployeeIds.length}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs leading-6 text-blue-800 sm:p-4">
        {isAr
          ? 'طريقة العمل: الأقسام تعطي المنسق كل فريق العمل داخلها. الأشخاص الإضافيين يضيفون أسماء من خارج هذه الأقسام. الأشخاص المستثنين يحذفون أسماء محددة من الأقسام المختارة.'
          : 'How it works: departments give access to everyone in them. Extra people add names outside those departments. Excluded people remove specific names from selected departments.'}
      </div>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{isAr ? 'الأقسام المسموحة' : 'Allowed departments'}</div>
            <div className="mt-1 text-xs text-gray-500">
              {isAr ? 'اضغط على القسم لتفعيله أو إلغاءه.' : 'Tap a department to enable or disable it.'}
            </div>
          </div>
          <span className="badge border-gray-200 bg-gray-50 text-gray-700">{departmentIds.length}</span>
        </div>
        <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((department) => {
            const selected = departmentIds.includes(department.name);
            return (
              <button
                key={department.id}
                type="button"
                className={`flex items-center justify-between gap-2 rounded-2xl border p-3 text-sm ${selected ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white hover:bg-blue-50'}`}
                onClick={() => toggleDepartment(department.name)}
              >
                <span>{department.name}</span>
                {selected && <CheckCircle2 className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {renderPeoplePicker({
          title: isAr ? 'أشخاص إضافيين' : 'Extra people',
          description: isAr
            ? 'اختر أشخاصاً من خارج أقسامك ليظهروا لك في التنسيق.'
            : 'Choose people outside your departments to include in planning.',
          search: includeSearch,
          onSearch: setIncludeSearch,
          selectedIds: includeEmployeeIds,
          onChange: setIncludeEmployeeIds,
          tone: 'include',
        })}
        {renderPeoplePicker({
          title: isAr ? 'أشخاص مستثنين' : 'Excluded people',
          description: isAr
            ? 'اختر أشخاصاً لا تريد تنسيقهم حتى لو كانوا ضمن الأقسام المسموحة.'
            : 'Choose people to remove even if they belong to allowed departments.',
          search: excludeSearch,
          onSearch: setExcludeSearch,
          selectedIds: excludeEmployeeIds,
          onChange: setExcludeEmployeeIds,
          tone: 'exclude',
        })}
      </div>

      <section className="card p-4">
        <div className="font-semibold mb-2">{isAr ? 'التداخل مع منسقين آخرين' : 'Overlap with other coordinators'}</div>
        <div className="space-y-2 text-sm">
          {overlaps.map((coordinator) => (
            <div key={coordinator.id} className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-amber-800">
              {coordinator.employeeName || coordinator.employeeId}
            </div>
          ))}
          {!overlaps.length && <div className="text-gray-500">{isAr ? 'لا يوجد تداخل واضح.' : 'No visible overlap.'}</div>}
        </div>
      </section>

      <button type="submit" className="btn-primary inline-flex items-center gap-2">
        <Save className="h-4 w-4" />
        <span>{isAr ? 'حفظ الصلاحيات' : 'Save access'}</span>
      </button>
    </form>
  );
}
