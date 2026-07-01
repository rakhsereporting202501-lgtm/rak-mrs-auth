import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Shield } from 'lucide-react';
import { useWpAuth } from '../context/WpAuthContext';
import { getWpDb } from '../lib/wpFirebase';
import { displayWpPersonName, normalizeWpEmployee } from '../lib/wpPeople';
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
  const [message, setMessage] = useState('');
  const isAr = locale === 'ar';

  useEffect(() => {
    const db = getWpDb();
    const unsubs = [
      onSnapshot(collection(db, WP_EMPLOYEES_COLLECTION), (snap) => {
        setEmployees(snap.docs.map((docSnap) => normalizeWpEmployee({ id: docSnap.id, ...(docSnap.data() as any) })));
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
  }, [wpUser?.id]);

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
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 icon-blue" />
        <div className="text-xl font-semibold">{isAr ? 'صلاحيات التنسيق' : 'Coordinator Access'}</div>
      </div>
      {message && <div className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="font-semibold mb-2">{isAr ? 'الأقسام' : 'Departments'}</div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {departments.map((department) => (
              <label key={department.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={departmentIds.includes(department.name)}
                  onChange={() => setDepartmentIds((prev) => prev.includes(department.name) ? prev.filter((entry) => entry !== department.name) : [...prev, department.name])}
                />
                <span>{department.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <div className="font-semibold mb-2">{isAr ? 'التداخل' : 'Overlap'}</div>
          <div className="space-y-2 text-sm">
            {overlaps.map((coordinator) => <div key={coordinator.id} className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-amber-800">{coordinator.employeeName || coordinator.employeeId}</div>)}
            {!overlaps.length && <div className="text-gray-500">{isAr ? 'لا يوجد تداخل واضح.' : 'No visible overlap.'}</div>}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="card p-4 block">
          <span className="block font-semibold mb-2">{isAr ? 'أشخاص إضافيين' : 'Extra people'}</span>
          <select className="input h-64" multiple value={includeEmployeeIds} onChange={(e) => setIncludeEmployeeIds(Array.from(e.target.selectedOptions).map((option) => option.value))}>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{displayWpPersonName(employee, locale)} - {employee.department || '-'}</option>)}
          </select>
        </label>
        <label className="card p-4 block">
          <span className="block font-semibold mb-2">{isAr ? 'استثناء أشخاص' : 'Excluded people'}</span>
          <select className="input h-64" multiple value={excludeEmployeeIds} onChange={(e) => setExcludeEmployeeIds(Array.from(e.target.selectedOptions).map((option) => option.value))}>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{displayWpPersonName(employee, locale)} - {employee.department || '-'}</option>)}
          </select>
        </label>
      </div>
      <button type="submit" className="btn-primary">{isAr ? 'حفظ' : 'Save'}</button>
    </form>
  );
}
