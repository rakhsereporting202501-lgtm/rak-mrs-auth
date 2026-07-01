import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ref, remove } from 'firebase/database';
import { Building2, CheckCircle2, Database, Hammer, MapPin, Monitor, Plus, Save, Search, Shield, Trash2, UserRound, Wrench, X } from 'lucide-react';
import { useWpAuth } from '../context/WpAuthContext';
import { WP_FIREBASE_API_KEY, getWpDb, getWpRealtimeDb } from '../lib/wpFirebase';
import { cleanWpText, displayWpPersonName, normalizeWpEmployee, splitWpName, wpEmployeeSearchText } from '../lib/wpPeople';
import {
  WP_CITIES_COLLECTION,
  WP_COORDINATORS_COLLECTION,
  WP_DEPARTMENTS_COLLECTION,
  WP_EMPLOYEES_COLLECTION,
  WP_ENGINEERS_COLLECTION,
  WP_POSITIONS_COLLECTION,
  WP_PROJECTS_COLLECTION,
  WP_SESSIONS_COLLECTION,
  WP_SESSION_RTDB_PATH,
  type WpAccountType,
  type WpCoordinatorDoc,
  type WpEmployee,
  type WpEngineer,
  type WpLookupDoc,
  type WpProject,
  type WpSessionDoc,
} from '../lib/wpTypes';
import { timestampMs } from '../lib/wpTypes';

type Tab = 'employees' | 'coordinators' | 'projects' | 'engineers' | 'positions' | 'departments' | 'cities' | 'sessions';

type EmployeeForm = {
  id: string;
  memberCode: string;
  fullName: string;
  nameAr: string;
  nameEn: string;
  position: string;
  department: string;
  city: string;
  accountType: WpAccountType;
  active: boolean;
  authEmail: string;
  authUid: string;
  password: string;
};

type CoordinatorForm = {
  employeeId: string;
  active: boolean;
  departmentIds: string[];
  includeEmployeeIds: string[];
  excludeEmployeeIds: string[];
};

const emptyEmployeeForm: EmployeeForm = {
  id: '',
  memberCode: '',
  fullName: '',
  nameAr: '',
  nameEn: '',
  position: '',
  department: '',
  city: '',
  accountType: 'VIEWER',
  active: true,
  authEmail: '',
  authUid: '',
  password: '',
};

const emptyCoordinatorForm: CoordinatorForm = {
  employeeId: '',
  active: true,
  departmentIds: [],
  includeEmployeeIds: [],
  excludeEmployeeIds: [],
};

const emptyProject: WpProject = { id: '', code: '', name: '', nameAr: '', nameEn: '', active: true };
const emptyEngineer: WpEngineer = { id: '', name: '', nameAr: '', nameEn: '', position: 'Engineer', department: '', active: true };
const emptyLookup: WpLookupDoc = { id: '', name: '', active: true };

function safeDocId(value: string) {
  return cleanWpText(value).replace(/[\/#?[\]]+/g, '-');
}

function optionName(item: WpLookupDoc | string) {
  return typeof item === 'string' ? item : item.name;
}

function asLookup(docId: string, data: any): WpLookupDoc {
  return {
    id: docId,
    name: cleanWpText(data?.name || docId),
    active: data?.active !== false,
    createdAt: data?.createdAt,
    updatedAt: data?.updatedAt,
  };
}

async function createPasswordAccount(email: string, password: string) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WP_FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    const message = body?.error?.message || 'Could not create Firebase Auth account.';
    throw new Error(message === 'EMAIL_EXISTS' ? 'هذا البريد موجود مسبقاً في Firebase Authentication.' : message);
  }
  return body.localId as string;
}

export default function WpAdmin() {
  const { isAdmin, locale } = useWpAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<WpEmployee[]>([]);
  const [projects, setProjects] = useState<WpProject[]>([]);
  const [engineers, setEngineers] = useState<WpEngineer[]>([]);
  const [positions, setPositions] = useState<WpLookupDoc[]>([]);
  const [departments, setDepartments] = useState<WpLookupDoc[]>([]);
  const [cities, setCities] = useState<WpLookupDoc[]>([]);
  const [coordinators, setCoordinators] = useState<WpCoordinatorDoc[]>([]);
  const [sessions, setSessions] = useState<WpSessionDoc[]>([]);
  const [qText, setQText] = useState('');
  const [coordinatorIncludeSearch, setCoordinatorIncludeSearch] = useState('');
  const [coordinatorExcludeSearch, setCoordinatorExcludeSearch] = useState('');
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployeeForm);
  const [coordinatorForm, setCoordinatorForm] = useState<CoordinatorForm>(emptyCoordinatorForm);
  const [projectForm, setProjectForm] = useState<WpProject>(emptyProject);
  const [engineerForm, setEngineerForm] = useState<WpEngineer>(emptyEngineer);
  const [lookupForm, setLookupForm] = useState<WpLookupDoc>(emptyLookup);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAr = locale === 'ar';

  useEffect(() => {
    const db = getWpDb();
    const unsubs = [
      onSnapshot(collection(db, WP_EMPLOYEES_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => normalizeWpEmployee({ id: docSnap.id, ...(docSnap.data() as any) }));
        next.sort((a, b) => displayWpPersonName(a, locale).localeCompare(displayWpPersonName(b, locale)));
        setEmployees(next);
      }),
      onSnapshot(collection(db, WP_PROJECTS_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpProject));
        next.sort((a, b) => (a.nameEn || a.name || a.code || a.id).localeCompare(b.nameEn || b.name || b.code || b.id));
        setProjects(next);
      }),
      onSnapshot(collection(db, WP_ENGINEERS_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpEngineer));
        next.sort((a, b) => (a.nameAr || a.nameEn || a.name || a.id).localeCompare(b.nameAr || b.nameEn || b.name || b.id));
        setEngineers(next);
      }),
      onSnapshot(collection(db, WP_POSITIONS_COLLECTION), (snap) => setPositions(snap.docs.map((docSnap) => asLookup(docSnap.id, docSnap.data())).sort((a, b) => a.name.localeCompare(b.name)))),
      onSnapshot(collection(db, WP_DEPARTMENTS_COLLECTION), (snap) => setDepartments(snap.docs.map((docSnap) => asLookup(docSnap.id, docSnap.data())).sort((a, b) => a.name.localeCompare(b.name)))),
      onSnapshot(collection(db, WP_CITIES_COLLECTION), (snap) => setCities(snap.docs.map((docSnap) => asLookup(docSnap.id, docSnap.data())).sort((a, b) => a.name.localeCompare(b.name)))),
      onSnapshot(collection(db, WP_COORDINATORS_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpCoordinatorDoc));
        next.sort((a, b) => (a.employeeName || a.employeeId).localeCompare(b.employeeName || b.employeeId));
        setCoordinators(next);
      }),
      onSnapshot(collection(db, WP_SESSIONS_COLLECTION), (snap) => {
        const next = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as WpSessionDoc));
        next.sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt));
        setSessions(next);
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [locale]);

  const filteredEmployees = useMemo(() => {
    const tokens = qText.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
    return employees.filter((employee) => {
      if (!tokens.length) return true;
      const hay = wpEmployeeSearchText(employee);
      return tokens.every((token) => hay.includes(token));
    });
  }, [employees, qText]);

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  const coordinatorEmployeeOptions = useMemo(
    () => employees.filter((employee) => employee.accountType !== 'ADMIN' && employee.active !== false),
    [employees],
  );

  const coordinatorSearchResults = (searchText: string, selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const tokens = searchText.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
    return coordinatorEmployeeOptions
      .filter((employee) => {
        if (selected.has(employee.id)) return false;
        if (!tokens.length) return true;
        const hay = wpEmployeeSearchText(employee);
        return tokens.every((token) => hay.includes(token));
      })
      .slice(0, 120);
  };

  const employeeLabel = (employeeId: string) => {
    const employee = employeeById.get(employeeId);
    if (!employee) return employeeId;
    return displayWpPersonName(employee, locale);
  };

  const editEmployee = (employee: WpEmployee) => {
    const split = splitWpName(employee.fullName);
    setEmployeeForm({
      id: employee.id,
      memberCode: employee.memberCode || employee.id,
      fullName: employee.fullName,
      nameAr: employee.nameAr || split.nameAr,
      nameEn: employee.nameEn || split.nameEn,
      position: employee.position || '',
      department: employee.department || '',
      city: employee.city || '',
      accountType: employee.accountType || 'VIEWER',
      active: employee.active !== false,
      authEmail: employee.authEmail || '',
      authUid: employee.authUid || '',
      password: '',
    });
    setTab('employees');
  };

  const saveEmployee = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const id = safeDocId(employeeForm.id || employeeForm.memberCode || employeeForm.fullName);
      const fullName = cleanWpText(employeeForm.fullName || [employeeForm.nameEn, employeeForm.nameAr].filter(Boolean).join(' '));
      if (!employeeForm.position || !employeeForm.department || !employeeForm.city) {
        throw new Error(isAr ? 'اختر المنصب والقسم والمدينة.' : 'Choose position, department, and city.');
      }
      let authUid = employeeForm.authUid;
      if ((employeeForm.accountType === 'COORDINATOR' || employeeForm.accountType === 'ADMIN') && employeeForm.password) {
        if (!employeeForm.authEmail) throw new Error(isAr ? 'اكتب بريد تسجيل الدخول.' : 'Enter login email.');
        authUid = await createPasswordAccount(employeeForm.authEmail, employeeForm.password);
      }
      const employee = normalizeWpEmployee({
        ...employeeForm,
        id,
        memberCode: employeeForm.memberCode || id,
        fullName,
        authUid,
      });
      await setDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, id), {
        ...employee,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setEmployeeForm(emptyEmployeeForm);
      setMessage(isAr ? 'تم حفظ الموظف.' : 'Employee saved.');
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر حفظ الموظف.' : 'Could not save employee.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteEmployee = async (employee: WpEmployee) => {
    if (employee.accountType === 'ADMIN') return;
    if (!window.confirm(isAr ? 'هل تريد حذف هذا الموظف؟' : 'Delete this employee?')) return;
    await deleteDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, employee.id));
  };

  const editCoordinator = (coordinator: WpCoordinatorDoc) => {
    setCoordinatorForm({
      employeeId: coordinator.employeeId,
      active: coordinator.active !== false,
      departmentIds: coordinator.departmentIds || [],
      includeEmployeeIds: coordinator.includeEmployeeIds || [],
      excludeEmployeeIds: coordinator.excludeEmployeeIds || [],
    });
    setTab('coordinators');
  };

  const saveCoordinator = async (event: FormEvent) => {
    event.preventDefault();
    const employee = employeeById.get(coordinatorForm.employeeId);
    if (!employee) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await setDoc(doc(getWpDb(), WP_COORDINATORS_COLLECTION, employee.id), {
        id: employee.id,
        employeeId: employee.id,
        employeeName: displayWpPersonName(employee, locale),
        active: coordinatorForm.active,
        departmentIds: coordinatorForm.departmentIds,
        includeEmployeeIds: coordinatorForm.includeEmployeeIds,
        excludeEmployeeIds: coordinatorForm.excludeEmployeeIds,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await setDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, employee.id), {
        accountType: employee.accountType === 'ADMIN' ? 'ADMIN' : 'COORDINATOR',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setCoordinatorForm(emptyCoordinatorForm);
      setCoordinatorIncludeSearch('');
      setCoordinatorExcludeSearch('');
      setMessage(isAr ? 'تم حفظ المنسق.' : 'Coordinator saved.');
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر حفظ المنسق.' : 'Could not save coordinator.'));
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    const id = safeDocId(projectForm.id || projectForm.code || projectForm.nameEn || projectForm.name || projectForm.nameAr || '');
    if (!id) return;
    await setDoc(doc(getWpDb(), WP_PROJECTS_COLLECTION, id), {
      ...projectForm,
      id,
      active: projectForm.active !== false,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setProjectForm(emptyProject);
  };

  const saveEngineer = async (event: FormEvent) => {
    event.preventDefault();
    const id = safeDocId(engineerForm.id || engineerForm.nameEn || engineerForm.name || engineerForm.nameAr || '');
    if (!id) return;
    await setDoc(doc(getWpDb(), WP_ENGINEERS_COLLECTION, id), {
      ...engineerForm,
      id,
      active: engineerForm.active !== false,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setEngineerForm(emptyEngineer);
  };

  const saveLookup = async (event: FormEvent, collectionName: string) => {
    event.preventDefault();
    const id = safeDocId(lookupForm.id || lookupForm.name);
    if (!id || !lookupForm.name) return;
    await setDoc(doc(getWpDb(), collectionName, id), {
      id,
      name: cleanWpText(lookupForm.name),
      active: lookupForm.active !== false,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setLookupForm(emptyLookup);
  };

  const revokeSession = async (session: WpSessionDoc) => {
    await updateDoc(doc(getWpDb(), WP_SESSIONS_COLLECTION, session.id), {
      active: false,
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await remove(ref(getWpRealtimeDb(), `${WP_SESSION_RTDB_PATH}/${session.employeeId}/${session.id}`));
  };

  const toggleArrayValue = (value: string, selected: string[], setter: (next: string[]) => void) => {
    setter(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value]);
  };

  const selectedCoordinatorOverlaps = useMemo(() => {
    const selectedDepartments = new Set(coordinatorForm.departmentIds);
    const selectedPeople = new Set([...coordinatorForm.includeEmployeeIds, ...coordinatorForm.excludeEmployeeIds]);
    return coordinators
      .filter((coordinator) => coordinator.employeeId !== coordinatorForm.employeeId)
      .filter((coordinator) => (
        (coordinator.departmentIds || []).some((dept) => selectedDepartments.has(dept))
        || (coordinator.includeEmployeeIds || []).some((personId) => selectedPeople.has(personId))
      ));
  }, [coordinators, coordinatorForm]);

  if (!isAdmin) {
    return <div className="alert alert-error" dir={isAr ? 'rtl' : 'ltr'}>{isAr ? 'هذه الصفحة خاصة بالأدمن فقط.' : 'Admin only.'}</div>;
  }

  const tabButton = (key: Tab, labelAr: string, labelEn: string, Icon: any) => (
    <button
      type="button"
      className={`btn-ghost inline-flex items-center gap-2 ${tab === key ? 'border-blue-300 bg-blue-50 text-blue-700' : ''}`}
      onClick={() => {
        setTab(key);
        setLookupForm(emptyLookup);
      }}
    >
      <Icon className="h-4 w-4" />
      <span>{isAr ? labelAr : labelEn}</span>
    </button>
  );

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );

  const renderCoordinatorPeoplePicker = ({
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
    const selectedSet = new Set(selectedIds);
    const results = coordinatorSearchResults(search, selectedIds);
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
                  <span className="truncate">{employeeLabel(employeeId)}</span>
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
              onClick={() => !selectedSet.has(employee.id) && onChange([...selectedIds, employee.id])}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{displayWpPersonName(employee, locale)}</div>
                <div className="truncate text-xs text-gray-500">{employee.position || '-'} - {employee.department || '-'} - {employee.city || '-'}</div>
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

  const lookupOptions = (items: WpLookupDoc[]) => items.filter((item) => item.active !== false).map((item) => (
    <option key={item.id} value={item.name}>{item.name}</option>
  ));

  const renderLookupTab = (items: WpLookupDoc[], collectionName: string, labelAr: string, labelEn: string) => (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="card p-4">
        <div className="font-semibold mb-3">{isAr ? labelAr : labelEn}</div>
        <div className="max-h-[620px] overflow-y-auto space-y-2">
          {items.map((item) => (
            <button key={item.id} type="button" className="w-full rounded-2xl border border-gray-200 p-3 text-start hover:bg-blue-50" onClick={() => setLookupForm(item)}>
              <div className="font-semibold">{item.name}</div>
              <div className="text-xs text-gray-500">{item.active === false ? 'inactive' : 'active'}</div>
            </button>
          ))}
        </div>
      </div>
      <form className="card p-4 space-y-3" onSubmit={(event) => saveLookup(event, collectionName)}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold">{isAr ? 'إضافة / تعديل' : 'Add / Edit'}</div>
            <div className="mt-1 text-xs text-gray-500">{isAr ? 'اكتب قيمة جديدة أو اختر عنصراً من القائمة للتعديل.' : 'Enter a new value or choose an item to edit.'}</div>
          </div>
          <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => setLookupForm(emptyLookup)}>
            <Plus className="h-4 w-4" />
            <span>{isAr ? 'جديد' : 'New'}</span>
          </button>
        </div>
        <Field label="ID">
          <input className="input" value={lookupForm.id} onChange={(e) => setLookupForm((p) => ({ ...p, id: e.target.value }))} />
        </Field>
        <Field label={isAr ? 'الاسم' : 'Name'}>
          <input className="input" value={lookupForm.name} onChange={(e) => setLookupForm((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lookupForm.active !== false} onChange={(e) => setLookupForm((p) => ({ ...p, active: e.target.checked }))} />
          <span>{isAr ? 'فعال' : 'Active'}</span>
        </label>
        <button className="btn-primary inline-flex items-center gap-2" type="submit">
          <Save className="h-4 w-4" />
          <span>{isAr ? 'حفظ' : 'Save'}</span>
        </button>
      </form>
    </div>
  );

  return (
    <div className="space-y-4 text-right" dir={isAr ? 'rtl' : 'ltr'}>
      <div>
        <div className="text-xl font-semibold">{isAr ? 'إدارة خطط العمل' : 'Work Plans Admin'}</div>
        <div className="text-sm text-gray-500 mt-1">
          {isAr ? 'إدارة الموظفين والمنسقين والمشاريع والقوائم.' : 'Manage employees, coordinators, projects, and lists.'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabButton('employees', 'الموظفين', 'Employees', UserRound)}
        {tabButton('coordinators', 'المنسقين', 'Coordinators', Shield)}
        {tabButton('projects', 'المشاريع', 'Projects', Database)}
        {tabButton('engineers', 'المهندسين', 'Engineers', Hammer)}
        {tabButton('positions', 'المناصب', 'Positions', Wrench)}
        {tabButton('departments', 'الأقسام', 'Departments', Building2)}
        {tabButton('cities', 'المدن', 'Cities', MapPin)}
        {tabButton('sessions', 'الجلسات', 'Sessions', Monitor)}
      </div>

      {message && <div className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {tab === 'employees' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="card p-4">
            <div className="relative">
              <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 ${isAr ? 'right-3' : 'left-3'}`} />
              <input className={`input ${isAr ? 'pr-9 text-right' : 'pl-9 text-left'}`} value={qText} onChange={(e) => setQText(e.target.value)} placeholder={isAr ? 'بحث' : 'Search'} />
            </div>
            <div className="mt-3 max-h-[620px] overflow-y-auto space-y-2">
              {filteredEmployees.map((employee) => (
                <div key={employee.id} className="rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-3">
                  <button type="button" className="min-w-0 text-start" onClick={() => editEmployee(employee)}>
                    <div className="font-semibold text-sm">{displayWpPersonName(employee, locale)}</div>
                    <div className="text-xs text-gray-500">{employee.memberCode} - {employee.position || '-'} - {employee.department || '-'} - {employee.city || '-'}</div>
                    <div className="mt-1">
                      <span className="badge border-blue-200 bg-blue-50 text-blue-700">{employee.accountType || 'VIEWER'}</span>
                    </div>
                  </button>
                  {employee.accountType !== 'ADMIN' && (
                    <button type="button" className="btn-ghost text-red-600" onClick={() => deleteEmployee(employee)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <form className="card p-4 space-y-3" onSubmit={saveEmployee}>
            <div className="font-semibold">{isAr ? 'تفاصيل الموظف' : 'Employee details'}</div>
            <Field label="ID"><input className="input" value={employeeForm.id} onChange={(e) => setEmployeeForm((p) => ({ ...p, id: e.target.value }))} /></Field>
            <Field label={isAr ? 'كود الموظف' : 'Member code'}><input className="input" value={employeeForm.memberCode} onChange={(e) => setEmployeeForm((p) => ({ ...p, memberCode: e.target.value }))} /></Field>
            <Field label={isAr ? 'الاسم الكامل' : 'Full name'}><input className="input" value={employeeForm.fullName} onChange={(e) => setEmployeeForm((p) => ({ ...p, fullName: e.target.value }))} /></Field>
            <Field label={isAr ? 'الاسم العربي' : 'Arabic name'}><input className="input" value={employeeForm.nameAr} onChange={(e) => setEmployeeForm((p) => ({ ...p, nameAr: e.target.value }))} /></Field>
            <Field label={isAr ? 'الاسم الإنجليزي' : 'English name'}><input className="input" value={employeeForm.nameEn} onChange={(e) => setEmployeeForm((p) => ({ ...p, nameEn: e.target.value }))} /></Field>
            <Field label={isAr ? 'المنصب' : 'Position'}>
              <select className="input" value={employeeForm.position} onChange={(e) => setEmployeeForm((p) => ({ ...p, position: e.target.value }))}>
                <option value="">{isAr ? 'اختر المنصب' : 'Choose position'}</option>
                {lookupOptions(positions)}
              </select>
            </Field>
            <Field label={isAr ? 'القسم' : 'Department'}>
              <select className="input" value={employeeForm.department} onChange={(e) => setEmployeeForm((p) => ({ ...p, department: e.target.value }))}>
                <option value="">{isAr ? 'اختر القسم' : 'Choose department'}</option>
                {lookupOptions(departments)}
              </select>
            </Field>
            <Field label={isAr ? 'المدينة' : 'City'}>
              <select className="input" value={employeeForm.city} onChange={(e) => setEmployeeForm((p) => ({ ...p, city: e.target.value }))}>
                <option value="">{isAr ? 'اختر المدينة' : 'Choose city'}</option>
                {lookupOptions(cities)}
              </select>
            </Field>
            <Field label={isAr ? 'نوع الحساب' : 'Account type'}>
              <select className="input" value={employeeForm.accountType} onChange={(e) => setEmployeeForm((p) => ({ ...p, accountType: e.target.value as WpAccountType }))}>
                <option value="VIEWER">VIEWER</option>
                <option value="COORDINATOR">COORDINATOR</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </Field>
            <Field label={isAr ? 'بريد تسجيل الدخول' : 'Login email'}><input className="input" value={employeeForm.authEmail} onChange={(e) => setEmployeeForm((p) => ({ ...p, authEmail: e.target.value }))} /></Field>
            <Field label={isAr ? 'كلمة مرور جديدة' : 'New password'}><input className="input" type="password" value={employeeForm.password} onChange={(e) => setEmployeeForm((p) => ({ ...p, password: e.target.value }))} /></Field>
            <Field label="Firebase Auth UID"><input className="input bg-gray-50" value={employeeForm.authUid} onChange={(e) => setEmployeeForm((p) => ({ ...p, authUid: e.target.value }))} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={employeeForm.active} onChange={(e) => setEmployeeForm((p) => ({ ...p, active: e.target.checked }))} />
              <span>{isAr ? 'فعال' : 'Active'}</span>
            </label>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
              {isAr
                ? 'لجعل الموظف يطلب كلمة مرور عند الدخول: اختر COORDINATOR أو ADMIN، اكتب بريد الدخول وكلمة المرور، ثم احفظ.'
                : 'To require a password: choose COORDINATOR or ADMIN, enter login email and password, then save.'}
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" disabled={busy}>
                <Save className="h-4 w-4" />
                <span>{isAr ? 'حفظ' : 'Save'}</span>
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEmployeeForm(emptyEmployeeForm)}>{isAr ? 'جديد' : 'New'}</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'coordinators' && (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{isAr ? 'المنسقين' : 'Coordinators'}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {isAr ? 'اختر منسقاً للتعديل أو أنشئ منسقاً جديداً.' : 'Choose a coordinator to edit or create a new one.'}
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-2"
                onClick={() => {
                  setCoordinatorForm(emptyCoordinatorForm);
                  setCoordinatorIncludeSearch('');
                  setCoordinatorExcludeSearch('');
                }}
              >
                <Plus className="h-4 w-4" />
                <span>{isAr ? 'جديد' : 'New'}</span>
              </button>
            </div>
            <div className="max-h-[620px] overflow-y-auto space-y-2">
              {coordinators.map((coordinator) => (
                <button key={coordinator.id} type="button" className="w-full rounded-2xl border border-gray-200 p-3 text-start hover:bg-blue-50" onClick={() => editCoordinator(coordinator)}>
                  <div className="font-semibold">{employeeLabel(coordinator.employeeId)}</div>
                  <div className="text-xs text-gray-500">{(coordinator.departmentIds || []).join(' - ') || '-'}</div>
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    <span className="badge border-emerald-200 bg-emerald-50 text-emerald-700">
                      {isAr ? 'إضافي' : 'Extra'} {(coordinator.includeEmployeeIds || []).length}
                    </span>
                    <span className="badge border-rose-200 bg-rose-50 text-rose-700">
                      {isAr ? 'مستثنى' : 'Excluded'} {(coordinator.excludeEmployeeIds || []).length}
                    </span>
                  </div>
                </button>
              ))}
              {!coordinators.length && (
                <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                  {isAr ? 'لا يوجد منسقين بعد.' : 'No coordinators yet.'}
                </div>
              )}
            </div>
          </div>
          <form className="card p-4 space-y-4" onSubmit={saveCoordinator}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{isAr ? 'صلاحيات المنسق' : 'Coordinator access'}</div>
                <div className="mt-1 text-sm text-gray-500">
                  {isAr ? 'الأقسام تحدد الفريق الأساسي، والإضافات والاستثناءات تعدل القائمة بدقة.' : 'Departments define the base team; extra and excluded people fine tune access.'}
                </div>
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
                <input type="checkbox" checked={coordinatorForm.active} onChange={(e) => setCoordinatorForm((p) => ({ ...p, active: e.target.checked }))} />
                <span>{isAr ? 'فعال' : 'Active'}</span>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)]">
              <Field label={isAr ? 'اسم المنسق' : 'Coordinator name'}>
                <select className="input" value={coordinatorForm.employeeId} onChange={(e) => setCoordinatorForm((p) => ({ ...p, employeeId: e.target.value }))}>
                  <option value="">{isAr ? 'اختر موظفاً ليصبح منسقاً' : 'Choose employee to become coordinator'}</option>
                  {coordinatorEmployeeOptions.map((employee) => (
                    <option key={employee.id} value={employee.id}>{displayWpPersonName(employee, locale)} - {employee.department || '-'}</option>
                  ))}
                </select>
              </Field>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                {isAr
                  ? 'عند الحفظ يتحول نوع حساب الموظف إلى COORDINATOR، ويستطيع إنشاء خطط عمل حسب هذه الصلاحيات.'
                  : 'Saving changes the employee account type to COORDINATOR and allows plan creation based on this access.'}
              </div>
            </div>

            <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{isAr ? 'الأقسام المسموحة' : 'Allowed departments'}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {isAr ? 'كل موظف داخل هذه الأقسام يظهر للمنسق تلقائياً.' : 'Every employee in these departments is automatically available to the coordinator.'}
                  </div>
                </div>
                <span className="badge border-gray-200 bg-white text-gray-700">{coordinatorForm.departmentIds.length}</span>
              </div>
              <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                {departments.map((department) => {
                  const selected = coordinatorForm.departmentIds.includes(department.name);
                  return (
                    <button
                      key={department.id}
                      type="button"
                      className={`flex items-center justify-between gap-2 rounded-2xl border p-3 text-sm ${selected ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white hover:bg-blue-50'}`}
                      onClick={() => toggleArrayValue(department.name, coordinatorForm.departmentIds, (departmentIds) => setCoordinatorForm((p) => ({ ...p, departmentIds })))}
                    >
                      <span>{department.name}</span>
                      {selected && <CheckCircle2 className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              {renderCoordinatorPeoplePicker({
                title: isAr ? 'أشخاص إضافيين' : 'Extra allowed people',
                description: isAr
                  ? 'استخدمها لإضافة أشخاص من خارج الأقسام المختارة إلى صلاحية هذا المنسق.'
                  : 'Use this to add people outside the selected departments to this coordinator.',
                search: coordinatorIncludeSearch,
                onSearch: setCoordinatorIncludeSearch,
                selectedIds: coordinatorForm.includeEmployeeIds,
                onChange: (includeEmployeeIds) => setCoordinatorForm((p) => ({ ...p, includeEmployeeIds })),
                tone: 'include',
              })}
              {renderCoordinatorPeoplePicker({
                title: isAr ? 'أشخاص مستثنين' : 'Excluded people',
                description: isAr
                  ? 'استخدمها لإخفاء أشخاص من الأقسام المختارة حتى لا يستطيع هذا المنسق تنسيقهم.'
                  : 'Use this to hide people from selected departments from this coordinator.',
                search: coordinatorExcludeSearch,
                onSearch: setCoordinatorExcludeSearch,
                selectedIds: coordinatorForm.excludeEmployeeIds,
                onChange: (excludeEmployeeIds) => setCoordinatorForm((p) => ({ ...p, excludeEmployeeIds })),
                tone: 'exclude',
              })}
            </div>

            {selectedCoordinatorOverlaps.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <div className="font-semibold mb-1">{isAr ? 'تداخل مع منسقين آخرين' : 'Overlap with other coordinators'}</div>
                <div className="flex flex-wrap gap-2">
                  {selectedCoordinatorOverlaps.map((coordinator) => (
                    <span key={coordinator.id} className="rounded-xl border border-amber-200 bg-white px-2 py-1">
                      {employeeLabel(coordinator.employeeId)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" disabled={busy || !coordinatorForm.employeeId}>
                <Save className="h-4 w-4" />
                <span>{isAr ? 'حفظ المنسق' : 'Save coordinator'}</span>
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setCoordinatorForm(emptyCoordinatorForm);
                  setCoordinatorIncludeSearch('');
                  setCoordinatorExcludeSearch('');
                }}
              >
                {isAr ? 'تفريغ' : 'Clear'}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === 'projects' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{isAr ? 'المشاريع' : 'Projects'}</div>
                <div className="mt-1 text-xs text-gray-500">{isAr ? 'يمكنك إضافة مشروع جديد أو تعديل مشروع موجود.' : 'Add a new project or edit an existing one.'}</div>
              </div>
              <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => setProjectForm(emptyProject)}>
                <Plus className="h-4 w-4" />
                <span>{isAr ? 'جديد' : 'New'}</span>
              </button>
            </div>
            <div className="max-h-[620px] overflow-y-auto space-y-2">
              {projects.map((project) => (
                <button key={project.id} type="button" className="w-full rounded-2xl border border-gray-200 p-3 text-start hover:bg-blue-50" onClick={() => setProjectForm(project)}>
                  <div className="font-semibold">{project.nameEn || project.name || project.code || project.id}</div>
                  <div className="text-xs text-gray-500">{project.code || project.id}</div>
                </button>
              ))}
            </div>
          </div>
          <form className="card p-4 space-y-3" onSubmit={saveProject}>
            <div className="font-semibold">{isAr ? 'تفاصيل المشروع' : 'Project details'}</div>
            <Field label="ID"><input className="input" value={projectForm.id || ''} onChange={(e) => setProjectForm((p) => ({ ...p, id: e.target.value }))} /></Field>
            <Field label="Code"><input className="input" value={projectForm.code || ''} onChange={(e) => setProjectForm((p) => ({ ...p, code: e.target.value }))} /></Field>
            <Field label="English name"><input className="input" value={projectForm.nameEn || ''} onChange={(e) => setProjectForm((p) => ({ ...p, nameEn: e.target.value }))} /></Field>
            <Field label="Arabic name"><input className="input" value={projectForm.nameAr || ''} onChange={(e) => setProjectForm((p) => ({ ...p, nameAr: e.target.value }))} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={projectForm.active !== false} onChange={(e) => setProjectForm((p) => ({ ...p, active: e.target.checked }))} />
              <span>{isAr ? 'فعال' : 'Active'}</span>
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" type="submit">{isAr ? 'حفظ' : 'Save'}</button>
              <button type="button" className="btn-ghost" onClick={() => setProjectForm(emptyProject)}>{isAr ? 'جديد' : 'New'}</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'engineers' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{isAr ? 'المهندسين' : 'Engineers'}</div>
                <div className="mt-1 text-xs text-gray-500">{isAr ? 'يمكنك إضافة مهندس جديد أو تعديل مهندس موجود.' : 'Add a new engineer or edit an existing one.'}</div>
              </div>
              <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => setEngineerForm(emptyEngineer)}>
                <Plus className="h-4 w-4" />
                <span>{isAr ? 'جديد' : 'New'}</span>
              </button>
            </div>
            <div className="max-h-[620px] overflow-y-auto space-y-2">
              {engineers.map((engineer) => (
                <button key={engineer.id} type="button" className="w-full rounded-2xl border border-gray-200 p-3 text-start hover:bg-blue-50" onClick={() => setEngineerForm(engineer)}>
                  <div className="font-semibold">{engineer.nameAr || engineer.nameEn || engineer.name || engineer.id}</div>
                  <div className="text-xs text-gray-500">{engineer.position || '-'} - {engineer.department || '-'}</div>
                </button>
              ))}
            </div>
          </div>
          <form className="card p-4 space-y-3" onSubmit={saveEngineer}>
            <div className="font-semibold">{isAr ? 'تفاصيل المهندس' : 'Engineer details'}</div>
            <Field label="ID"><input className="input" value={engineerForm.id || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, id: e.target.value }))} /></Field>
            <Field label="English name"><input className="input" value={engineerForm.nameEn || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, nameEn: e.target.value, name: e.target.value }))} /></Field>
            <Field label="Arabic name"><input className="input" value={engineerForm.nameAr || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, nameAr: e.target.value }))} /></Field>
            <Field label="Position"><select className="input" value={engineerForm.position || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, position: e.target.value }))}><option value="">Choose</option>{lookupOptions(positions)}</select></Field>
            <Field label="Department"><select className="input" value={engineerForm.department || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, department: e.target.value }))}><option value="">Choose</option>{lookupOptions(departments)}</select></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={engineerForm.active !== false} onChange={(e) => setEngineerForm((p) => ({ ...p, active: e.target.checked }))} />
              <span>{isAr ? 'فعال' : 'Active'}</span>
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" type="submit">{isAr ? 'حفظ' : 'Save'}</button>
              <button type="button" className="btn-ghost" onClick={() => setEngineerForm(emptyEngineer)}>{isAr ? 'جديد' : 'New'}</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'positions' && renderLookupTab(positions, WP_POSITIONS_COLLECTION, 'المناصب', 'Positions')}
      {tab === 'departments' && renderLookupTab(departments, WP_DEPARTMENTS_COLLECTION, 'الأقسام', 'Departments')}
      {tab === 'cities' && renderLookupTab(cities, WP_CITIES_COLLECTION, 'المدن', 'Cities')}

      {tab === 'sessions' && (
        <div className="card p-4 space-y-2">
          <div className="font-semibold mb-3">{isAr ? 'الجلسات' : 'Sessions'}</div>
          <div className="max-h-[620px] overflow-y-auto space-y-2">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{session.employeeName}</div>
                  <div className="text-xs text-gray-500 truncate">{session.id} - {session.accountType} - {session.active ? 'active' : 'closed'}</div>
                </div>
                {session.active && (
                  <button type="button" className="btn-ghost text-red-600" onClick={() => revokeSession(session)}>
                    {isAr ? 'إخراج' : 'Revoke'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
