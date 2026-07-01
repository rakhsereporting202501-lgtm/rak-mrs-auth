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
import {
  Building2,
  CheckCircle2,
  Database,
  Hammer,
  LayoutDashboard,
  MapPin,
  Monitor,
  Pencil,
  Plus,
  Save,
  Search,
  Shield,
  Trash2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
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
type EditableTab = Exclude<Tab, 'sessions'>;

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

type SearchState = Record<Tab, string>;

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

const emptySearch: SearchState = {
  employees: '',
  coordinators: '',
  projects: '',
  engineers: '',
  positions: '',
  departments: '',
  cities: '',
  sessions: '',
};

function safeDocId(value: string) {
  return cleanWpText(value).replace(/[\/#?[\]]+/g, '-');
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

function searchTokens(value: string) {
  return value.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
}

function matchesSearch(text: string, query: string) {
  const hay = text.toLowerCase();
  const tokens = searchTokens(query);
  return !tokens.length || tokens.every((token) => hay.includes(token));
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

function AdminField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function WpAdmin() {
  const { isAdmin, locale } = useWpAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const [dialogTab, setDialogTab] = useState<EditableTab | null>(null);
  const [employees, setEmployees] = useState<WpEmployee[]>([]);
  const [projects, setProjects] = useState<WpProject[]>([]);
  const [engineers, setEngineers] = useState<WpEngineer[]>([]);
  const [positions, setPositions] = useState<WpLookupDoc[]>([]);
  const [departments, setDepartments] = useState<WpLookupDoc[]>([]);
  const [cities, setCities] = useState<WpLookupDoc[]>([]);
  const [coordinators, setCoordinators] = useState<WpCoordinatorDoc[]>([]);
  const [sessions, setSessions] = useState<WpSessionDoc[]>([]);
  const [searchByTab, setSearchByTab] = useState<SearchState>(emptySearch);
  const [coordinatorIncludeSearch, setCoordinatorIncludeSearch] = useState('');
  const [coordinatorExcludeSearch, setCoordinatorExcludeSearch] = useState('');
  const [overlapDetailsOpen, setOverlapDetailsOpen] = useState(false);
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

  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);

  const coordinatorEmployeeOptions = useMemo(
    () => employees.filter((employee) => employee.accountType !== 'ADMIN' && employee.active !== false),
    [employees],
  );

  const coordinatorSearchResults = (searchText: string, selectedIds: string[]) => {
    const selected = new Set(selectedIds);
    const tokens = searchTokens(searchText);
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

  const currentSearch = searchByTab[tab] || '';
  const setCurrentSearch = (value: string) => setSearchByTab((prev) => ({ ...prev, [tab]: value }));

  const filteredEmployees = useMemo(() => employees.filter((employee) => matchesSearch(wpEmployeeSearchText(employee), searchByTab.employees)), [employees, searchByTab.employees]);
  const filteredProjects = useMemo(() => projects.filter((project) => matchesSearch([
    project.id,
    project.code || '',
    project.name || '',
    project.nameAr || '',
    project.nameEn || '',
  ].join(' '), searchByTab.projects)), [projects, searchByTab.projects]);
  const filteredEngineers = useMemo(() => engineers.filter((engineer) => matchesSearch([
    engineer.id,
    engineer.name || '',
    engineer.nameAr || '',
    engineer.nameEn || '',
    engineer.position || '',
    engineer.department || '',
  ].join(' '), searchByTab.engineers)), [engineers, searchByTab.engineers]);
  const filteredPositions = useMemo(() => positions.filter((item) => matchesSearch(`${item.id} ${item.name}`, searchByTab.positions)), [positions, searchByTab.positions]);
  const filteredDepartments = useMemo(() => departments.filter((item) => matchesSearch(`${item.id} ${item.name}`, searchByTab.departments)), [departments, searchByTab.departments]);
  const filteredCities = useMemo(() => cities.filter((item) => matchesSearch(`${item.id} ${item.name}`, searchByTab.cities)), [cities, searchByTab.cities]);
  const filteredCoordinators = useMemo(() => coordinators.filter((coordinator) => matchesSearch([
    coordinator.employeeId,
    employeeLabel(coordinator.employeeId),
    ...(coordinator.departmentIds || []),
    ...(coordinator.includeEmployeeIds || []).map(employeeLabel),
    ...(coordinator.excludeEmployeeIds || []).map(employeeLabel),
  ].join(' '), searchByTab.coordinators)), [coordinators, employeeById, locale, searchByTab.coordinators]);
  const filteredSessions = useMemo(() => sessions.filter((session) => matchesSearch([
    session.id,
    session.employeeId,
    session.employeeName,
    session.accountType,
    session.authUid || '',
    session.active ? 'active' : 'closed',
    session.userAgent || '',
  ].join(' '), searchByTab.sessions)), [sessions, searchByTab.sessions]);

  const resetMessages = () => {
    setMessage(null);
    setError(null);
  };

  const openNew = (target: EditableTab = tab as EditableTab) => {
    resetMessages();
    setTab(target);
    if (target === 'employees') setEmployeeForm(emptyEmployeeForm);
    if (target === 'coordinators') {
      setCoordinatorForm(emptyCoordinatorForm);
      setCoordinatorIncludeSearch('');
      setCoordinatorExcludeSearch('');
    }
    if (target === 'projects') setProjectForm(emptyProject);
    if (target === 'engineers') setEngineerForm(emptyEngineer);
    if (target === 'positions' || target === 'departments' || target === 'cities') setLookupForm(emptyLookup);
    setDialogTab(target);
  };

  const openEmployee = (employee: WpEmployee) => {
    const split = splitWpName(employee.fullName);
    resetMessages();
    setTab('employees');
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
      authEmail: '',
      authUid: '',
      password: '',
    });
    setDialogTab('employees');
  };

  const openCoordinator = (coordinator: WpCoordinatorDoc) => {
    resetMessages();
    setTab('coordinators');
    setCoordinatorForm({
      employeeId: coordinator.employeeId,
      active: coordinator.active !== false,
      departmentIds: coordinator.departmentIds || [],
      includeEmployeeIds: coordinator.includeEmployeeIds || [],
      excludeEmployeeIds: coordinator.excludeEmployeeIds || [],
    });
    setCoordinatorIncludeSearch('');
    setCoordinatorExcludeSearch('');
    setDialogTab('coordinators');
  };

  const lookupOptions = (items: WpLookupDoc[]) => items.filter((item) => item.active !== false).map((item) => (
    <option key={item.id} value={item.name}>{item.name}</option>
  ));

  const saveEmployee = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    resetMessages();
    try {
      const id = safeDocId(employeeForm.id || employeeForm.memberCode || employeeForm.fullName);
      const fullName = cleanWpText(employeeForm.fullName || [employeeForm.nameEn, employeeForm.nameAr].filter(Boolean).join(' '));
      if (!fullName) throw new Error(isAr ? 'اكتب اسم الموظف.' : 'Enter employee name.');
      if (!employeeForm.position || !employeeForm.department || !employeeForm.city) {
        throw new Error(isAr ? 'اختر المنصب والقسم والمدينة.' : 'Choose position, department, and city.');
      }
      const previousEmployee = employeeById.get(id);
      const authEmail = cleanWpText(employeeForm.authEmail) || previousEmployee?.authEmail || '';
      let authUid = cleanWpText(employeeForm.authUid) || previousEmployee?.authUid || '';
      if ((employeeForm.accountType === 'COORDINATOR' || employeeForm.accountType === 'ADMIN') && employeeForm.password) {
        if (!authEmail) throw new Error(isAr ? 'اكتب بريد تسجيل الدخول.' : 'Enter login email.');
        authUid = await createPasswordAccount(authEmail, employeeForm.password);
      }
      const employee = normalizeWpEmployee({
        ...employeeForm,
        id,
        memberCode: employeeForm.memberCode || id,
        fullName,
        authEmail,
        authUid,
      });
      await setDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, id), {
        ...employee,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setEmployeeForm(emptyEmployeeForm);
      setDialogTab(null);
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
    setDialogTab(null);
    setEmployeeForm(emptyEmployeeForm);
    setMessage(isAr ? 'تم حذف الموظف.' : 'Employee deleted.');
  };

  const saveCoordinator = async (event: FormEvent) => {
    event.preventDefault();
    const employee = employeeById.get(coordinatorForm.employeeId);
    if (!employee) return;
    setBusy(true);
    resetMessages();
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
      setDialogTab(null);
      setMessage(isAr ? 'تم حفظ المنسق.' : 'Coordinator saved.');
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر حفظ المنسق.' : 'Could not save coordinator.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteCoordinator = async () => {
    const employee = employeeById.get(coordinatorForm.employeeId);
    if (!employee) return;
    if (!window.confirm(isAr ? 'هل تريد حذف صلاحية هذا المنسق؟' : 'Delete this coordinator access?')) return;
    await deleteDoc(doc(getWpDb(), WP_COORDINATORS_COLLECTION, employee.id));
    if (employee.accountType === 'COORDINATOR') {
      await setDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, employee.id), {
        accountType: 'VIEWER',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    setCoordinatorForm(emptyCoordinatorForm);
    setDialogTab(null);
    setMessage(isAr ? 'تم حذف المنسق.' : 'Coordinator deleted.');
  };

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    resetMessages();
    try {
      const id = safeDocId(projectForm.id || projectForm.code || projectForm.nameEn || projectForm.name || projectForm.nameAr || '');
      if (!id) throw new Error(isAr ? 'اكتب اسم المشروع أو الكود.' : 'Enter project name or code.');
      await setDoc(doc(getWpDb(), WP_PROJECTS_COLLECTION, id), {
        ...projectForm,
        id,
        active: projectForm.active !== false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProjectForm(emptyProject);
      setDialogTab(null);
      setMessage(isAr ? 'تم حفظ المشروع.' : 'Project saved.');
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر حفظ المشروع.' : 'Could not save project.'));
    } finally {
      setBusy(false);
    }
  };

  const saveEngineer = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    resetMessages();
    try {
      const id = safeDocId(engineerForm.id || engineerForm.nameEn || engineerForm.name || engineerForm.nameAr || '');
      if (!id) throw new Error(isAr ? 'اكتب اسم المهندس.' : 'Enter engineer name.');
      await setDoc(doc(getWpDb(), WP_ENGINEERS_COLLECTION, id), {
        ...engineerForm,
        id,
        active: engineerForm.active !== false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setEngineerForm(emptyEngineer);
      setDialogTab(null);
      setMessage(isAr ? 'تم حفظ المهندس.' : 'Engineer saved.');
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر حفظ المهندس.' : 'Could not save engineer.'));
    } finally {
      setBusy(false);
    }
  };

  const saveLookup = async (event: FormEvent, collectionName: string, successText: string) => {
    event.preventDefault();
    setBusy(true);
    resetMessages();
    try {
      const id = safeDocId(lookupForm.id || lookupForm.name);
      if (!id || !lookupForm.name) throw new Error(isAr ? 'اكتب الاسم.' : 'Enter name.');
      await setDoc(doc(getWpDb(), collectionName, id), {
        id,
        name: cleanWpText(lookupForm.name),
        active: lookupForm.active !== false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setLookupForm(emptyLookup);
      setDialogTab(null);
      setMessage(successText);
    } catch (err: any) {
      setError(err?.message || (isAr ? 'تعذر الحفظ.' : 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteCollectionDoc = async (collectionName: string, id: string, label: string) => {
    if (!id) return;
    if (!window.confirm(isAr ? `هل تريد حذف ${label}؟` : `Delete ${label}?`)) return;
    await deleteDoc(doc(getWpDb(), collectionName, id));
    setDialogTab(null);
    setMessage(isAr ? 'تم الحذف.' : 'Deleted.');
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

  if (!isAdmin) {
    return <div className="alert alert-error" dir={isAr ? 'rtl' : 'ltr'}>{isAr ? 'هذه الصفحة خاصة بالأدمن فقط.' : 'Admin only.'}</div>;
  }

  const sections: Array<{
    key: Tab;
    labelAr: string;
    labelEn: string;
    helperAr: string;
    helperEn: string;
    count: number;
    Icon: any;
    canAdd: boolean;
  }> = [
    { key: 'employees', labelAr: 'الموظفين', labelEn: 'Employees', helperAr: 'الأسماء والصلاحيات وكلمات المرور', helperEn: 'People, roles, and login data', count: employees.length, Icon: UserRound, canAdd: true },
    { key: 'coordinators', labelAr: 'المنسقين', labelEn: 'Coordinators', helperAr: 'الأقسام والأشخاص المسموحين', helperEn: 'Departments and allowed people', count: coordinators.length, Icon: Shield, canAdd: true },
    { key: 'projects', labelAr: 'المشاريع', labelEn: 'Projects', helperAr: 'مشاريع خطة العمل', helperEn: 'Work plan projects', count: projects.length, Icon: Database, canAdd: true },
    { key: 'engineers', labelAr: 'المهندسين', labelEn: 'Engineers', helperAr: 'أسماء المهندسين', helperEn: 'Engineer names', count: engineers.length, Icon: Hammer, canAdd: true },
    { key: 'positions', labelAr: 'المناصب', labelEn: 'Positions', helperAr: 'قائمة المناصب المتاحة', helperEn: 'Available positions', count: positions.length, Icon: Wrench, canAdd: true },
    { key: 'departments', labelAr: 'الأقسام', labelEn: 'Departments', helperAr: 'قائمة الأقسام المتاحة', helperEn: 'Available departments', count: departments.length, Icon: Building2, canAdd: true },
    { key: 'cities', labelAr: 'المدن', labelEn: 'Cities', helperAr: 'قائمة المدن المتاحة', helperEn: 'Available cities', count: cities.length, Icon: MapPin, canAdd: true },
    { key: 'sessions', labelAr: 'الجلسات', labelEn: 'Sessions', helperAr: 'الجلسات النشطة والقديمة', helperEn: 'Active and old sessions', count: sessions.length, Icon: Monitor, canAdd: false },
  ];
  const activeSection = sections.find((section) => section.key === tab) || sections[0];

  const StatusBadge = ({ active }: { active?: boolean }) => (
    <span className={`badge ${active === false ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-green-200 bg-green-50 text-green-700'}`}>
      {active === false ? (isAr ? 'غير فعال' : 'Inactive') : (isAr ? 'فعال' : 'Active')}
    </span>
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
          <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 ${isAr ? 'right-3' : 'left-3'}`} />
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

        <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
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

  const renderEmployees = () => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filteredEmployees.map((employee) => (
        <button key={employee.id} type="button" className="rounded-2xl border border-gray-200 bg-white p-4 text-start shadow-sm hover:border-blue-200 hover:bg-blue-50" onClick={() => openEmployee(employee)}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{displayWpPersonName(employee, locale)}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{employee.memberCode || employee.id}</div>
            </div>
            <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="badge border-blue-200 bg-blue-50 text-blue-700">{employee.accountType || 'VIEWER'}</span>
            <StatusBadge active={employee.active} />
          </div>
          <div className="mt-3 text-xs leading-5 text-gray-600">
            <div>{employee.position || '-'}</div>
            <div>{employee.department || '-'} - {employee.city || '-'}</div>
          </div>
        </button>
      ))}
      {!filteredEmployees.length && <EmptyList />}
    </div>
  );

  const renderCoordinators = () => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filteredCoordinators.map((coordinator) => (
        <button key={coordinator.id} type="button" className="rounded-2xl border border-gray-200 bg-white p-4 text-start shadow-sm hover:border-blue-200 hover:bg-blue-50" onClick={() => openCoordinator(coordinator)}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{employeeLabel(coordinator.employeeId)}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{(coordinator.departmentIds || []).join(' - ') || '-'}</div>
            </div>
            <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusBadge active={coordinator.active} />
            <span className="badge border-emerald-200 bg-emerald-50 text-emerald-700">
              {isAr ? 'إضافي' : 'Extra'} {(coordinator.includeEmployeeIds || []).length}
            </span>
            <span className="badge border-rose-200 bg-rose-50 text-rose-700">
              {isAr ? 'مستثنى' : 'Excluded'} {(coordinator.excludeEmployeeIds || []).length}
            </span>
          </div>
        </button>
      ))}
      {!filteredCoordinators.length && <EmptyList />}
    </div>
  );

  const renderProjects = () => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filteredProjects.map((project) => (
        <button key={project.id} type="button" className="rounded-2xl border border-gray-200 bg-white p-4 text-start shadow-sm hover:border-blue-200 hover:bg-blue-50" onClick={() => {
          resetMessages();
          setTab('projects');
          setProjectForm(project);
          setDialogTab('projects');
        }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{project.nameEn || project.name || project.nameAr || project.code || project.id}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{project.code || project.id}</div>
            </div>
            <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
          <div className="mt-3"><StatusBadge active={project.active} /></div>
        </button>
      ))}
      {!filteredProjects.length && <EmptyList />}
    </div>
  );

  const renderEngineers = () => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filteredEngineers.map((engineer) => (
        <button key={engineer.id} type="button" className="rounded-2xl border border-gray-200 bg-white p-4 text-start shadow-sm hover:border-blue-200 hover:bg-blue-50" onClick={() => {
          resetMessages();
          setTab('engineers');
          setEngineerForm(engineer);
          setDialogTab('engineers');
        }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{engineer.nameAr || engineer.nameEn || engineer.name || engineer.id}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{engineer.position || '-'} - {engineer.department || '-'}</div>
            </div>
            <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
          <div className="mt-3"><StatusBadge active={engineer.active} /></div>
        </button>
      ))}
      {!filteredEngineers.length && <EmptyList />}
    </div>
  );

  const renderLookupCards = (items: WpLookupDoc[], target: EditableTab) => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <button key={item.id} type="button" className="rounded-2xl border border-gray-200 bg-white p-4 text-start shadow-sm hover:border-blue-200 hover:bg-blue-50" onClick={() => {
          resetMessages();
          setTab(target);
          setLookupForm(item);
          setDialogTab(target);
        }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold">{item.name}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{item.id}</div>
            </div>
            <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
          </div>
          <div className="mt-3"><StatusBadge active={item.active} /></div>
        </button>
      ))}
      {!items.length && <EmptyList />}
    </div>
  );

  const renderSessions = () => (
    <div className="space-y-2">
      {filteredSessions.map((session) => (
        <div key={session.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{session.employeeName}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{session.id} - {session.accountType}</div>
              <div className="mt-1 truncate text-xs text-gray-400">{session.userAgent || '-'}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge ${session.active ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                {session.active ? (isAr ? 'نشطة' : 'Active') : (isAr ? 'مغلقة' : 'Closed')}
              </span>
              {session.active && (
                <button type="button" className="btn-ghost text-red-600" onClick={() => revokeSession(session)}>
                  {isAr ? 'إخراج' : 'Revoke'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {!filteredSessions.length && <EmptyList />}
    </div>
  );

  function EmptyList() {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500 md:col-span-2 xl:col-span-3">
        {isAr ? 'لا توجد نتائج مطابقة.' : 'No matching results.'}
      </div>
    );
  }

  const renderList = () => {
    if (tab === 'employees') return renderEmployees();
    if (tab === 'coordinators') return renderCoordinators();
    if (tab === 'projects') return renderProjects();
    if (tab === 'engineers') return renderEngineers();
    if (tab === 'positions') return renderLookupCards(filteredPositions, 'positions');
    if (tab === 'departments') return renderLookupCards(filteredDepartments, 'departments');
    if (tab === 'cities') return renderLookupCards(filteredCities, 'cities');
    return renderSessions();
  };

  const coordinatorOverlapDetails = (coordinator: WpCoordinatorDoc) => {
    const selectedDepartments = new Set(coordinatorForm.departmentIds || []);
    const selectedPeople = new Set([...(coordinatorForm.includeEmployeeIds || []), ...(coordinatorForm.excludeEmployeeIds || [])]);
    const sharedDepartments = (coordinator.departmentIds || []).filter((department) => selectedDepartments.has(department));
    const sharedPeople = Array.from(new Set([
      ...(coordinator.includeEmployeeIds || []),
      ...(coordinator.excludeEmployeeIds || []),
    ])).filter((employeeId) => selectedPeople.has(employeeId));
    return { sharedDepartments, sharedPeople };
  };

  const renderEmployeeForm = () => (
    <form className="space-y-3" onSubmit={saveEmployee}>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="ID"><input className="input" value={employeeForm.id} onChange={(e) => setEmployeeForm((p) => ({ ...p, id: e.target.value }))} /></AdminField>
        <AdminField label={isAr ? 'كود الموظف' : 'Member code'}><input className="input" value={employeeForm.memberCode} onChange={(e) => setEmployeeForm((p) => ({ ...p, memberCode: e.target.value }))} /></AdminField>
      </div>
      <AdminField label={isAr ? 'الاسم الكامل' : 'Full name'}><input className="input" value={employeeForm.fullName} onChange={(e) => setEmployeeForm((p) => ({ ...p, fullName: e.target.value }))} /></AdminField>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label={isAr ? 'الاسم العربي' : 'Arabic name'}><input className="input" value={employeeForm.nameAr} onChange={(e) => setEmployeeForm((p) => ({ ...p, nameAr: e.target.value }))} /></AdminField>
        <AdminField label={isAr ? 'الاسم الإنجليزي' : 'English name'}><input className="input" value={employeeForm.nameEn} onChange={(e) => setEmployeeForm((p) => ({ ...p, nameEn: e.target.value }))} /></AdminField>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <AdminField label={isAr ? 'المنصب' : 'Position'}>
          <select className="input" value={employeeForm.position} onChange={(e) => setEmployeeForm((p) => ({ ...p, position: e.target.value }))}>
            <option value="">{isAr ? 'اختر المنصب' : 'Choose position'}</option>
            {lookupOptions(positions)}
          </select>
        </AdminField>
        <AdminField label={isAr ? 'القسم' : 'Department'}>
          <select className="input" value={employeeForm.department} onChange={(e) => setEmployeeForm((p) => ({ ...p, department: e.target.value }))}>
            <option value="">{isAr ? 'اختر القسم' : 'Choose department'}</option>
            {lookupOptions(departments)}
          </select>
        </AdminField>
        <AdminField label={isAr ? 'المدينة' : 'City'}>
          <select className="input" value={employeeForm.city} onChange={(e) => setEmployeeForm((p) => ({ ...p, city: e.target.value }))}>
            <option value="">{isAr ? 'اختر المدينة' : 'Choose city'}</option>
            {lookupOptions(cities)}
          </select>
        </AdminField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label={isAr ? 'نوع الحساب' : 'Account type'}>
          <select className="input" value={employeeForm.accountType} onChange={(e) => setEmployeeForm((p) => ({ ...p, accountType: e.target.value as WpAccountType }))}>
            <option value="VIEWER">VIEWER</option>
            <option value="COORDINATOR">COORDINATOR</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </AdminField>
        <AdminField label={isAr ? 'بريد تسجيل الدخول' : 'Login email'}><input className="input" autoComplete="off" value={employeeForm.authEmail} onChange={(e) => setEmployeeForm((p) => ({ ...p, authEmail: e.target.value }))} /></AdminField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label={isAr ? 'كلمة مرور جديدة' : 'New password'}><input className="input" type="password" autoComplete="new-password" value={employeeForm.password} onChange={(e) => setEmployeeForm((p) => ({ ...p, password: e.target.value }))} /></AdminField>
        <AdminField label="Firebase Auth UID"><input className="input bg-gray-50" autoComplete="off" value={employeeForm.authUid} onChange={(e) => setEmployeeForm((p) => ({ ...p, authUid: e.target.value }))} /></AdminField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={employeeForm.active} onChange={(e) => setEmployeeForm((p) => ({ ...p, active: e.target.checked }))} />
        <span>{isAr ? 'فعال' : 'Active'}</span>
      </label>
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
        {isAr
          ? 'حقول بريد الدخول وكلمة المرور وFirebase UID تفتح فارغة دائماً. اتركها فارغة للحفاظ على بيانات الدخول الحالية، أو اكتب قيماً جديدة للتحديث.'
          : 'Login email, password, and Firebase UID open blank. Leave them blank to keep current login data, or enter new values to update.'}
      </div>
      <DialogActions
        onDelete={employeeForm.id && employeeForm.accountType !== 'ADMIN' ? () => deleteEmployee(normalizeWpEmployee(employeeForm)) : undefined}
        deleteLabel={isAr ? 'حذف الموظف' : 'Delete employee'}
      />
    </form>
  );

  const renderCoordinatorForm = () => (
    <form className="space-y-4" onSubmit={saveCoordinator}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)]">
        <AdminField label={isAr ? 'اسم المنسق' : 'Coordinator name'}>
          <select className="input" value={coordinatorForm.employeeId} onChange={(e) => setCoordinatorForm((p) => ({ ...p, employeeId: e.target.value }))}>
            <option value="">{isAr ? 'اختر موظفاً ليصبح منسقاً' : 'Choose employee to become coordinator'}</option>
            {coordinatorEmployeeOptions.map((employee) => (
              <option key={employee.id} value={employee.id}>{displayWpPersonName(employee, locale)} - {employee.department || '-'}</option>
            ))}
          </select>
        </AdminField>
        <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={coordinatorForm.active} onChange={(e) => setCoordinatorForm((p) => ({ ...p, active: e.target.checked }))} />
          <span>{isAr ? 'فعال' : 'Active'}</span>
        </label>
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
            ? 'أشخاص من خارج الأقسام المختارة يمكن لهذا المنسق تنسيقهم.'
            : 'People outside selected departments this coordinator can manage.',
          search: coordinatorIncludeSearch,
          onSearch: setCoordinatorIncludeSearch,
          selectedIds: coordinatorForm.includeEmployeeIds,
          onChange: (includeEmployeeIds) => setCoordinatorForm((p) => ({ ...p, includeEmployeeIds })),
          tone: 'include',
        })}
        {renderCoordinatorPeoplePicker({
          title: isAr ? 'أشخاص مستثنين' : 'Excluded people',
          description: isAr
            ? 'أشخاص داخل الأقسام المختارة لا يستطيع هذا المنسق تنسيقهم.'
            : 'People inside selected departments this coordinator cannot manage.',
          search: coordinatorExcludeSearch,
          onSearch: setCoordinatorExcludeSearch,
          selectedIds: coordinatorForm.excludeEmployeeIds,
          onChange: (excludeEmployeeIds) => setCoordinatorForm((p) => ({ ...p, excludeEmployeeIds })),
          tone: 'exclude',
        })}
      </div>

      {selectedCoordinatorOverlaps.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{isAr ? 'تداخل مع منسقين آخرين' : 'Overlap with other coordinators'}</div>
              <div className="mt-1">{isAr ? 'اضغط لعرض الأقسام أو الأشخاص المتداخلين.' : 'Open to see shared departments or people.'}</div>
            </div>
            <button type="button" className="btn-ghost bg-white text-amber-800" onClick={() => setOverlapDetailsOpen(true)}>
              {isAr ? 'عرض التفاصيل' : 'View details'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedCoordinatorOverlaps.map((coordinator) => (
              <button
                key={coordinator.id}
                type="button"
                className="rounded-xl border border-amber-200 bg-white px-2 py-1 hover:bg-amber-100"
                onClick={() => setOverlapDetailsOpen(true)}
              >
                {employeeLabel(coordinator.employeeId)}
              </button>
            ))}
          </div>
        </div>
      )}

      <DialogActions
        disabled={!coordinatorForm.employeeId}
        onDelete={coordinatorForm.employeeId ? deleteCoordinator : undefined}
        deleteLabel={isAr ? 'حذف المنسق' : 'Delete coordinator'}
      />
    </form>
  );

  const renderProjectForm = () => (
    <form className="space-y-3" onSubmit={saveProject}>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="ID"><input className="input" value={projectForm.id || ''} onChange={(e) => setProjectForm((p) => ({ ...p, id: e.target.value }))} /></AdminField>
        <AdminField label="Code"><input className="input" value={projectForm.code || ''} onChange={(e) => setProjectForm((p) => ({ ...p, code: e.target.value }))} /></AdminField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="English name"><input className="input" value={projectForm.nameEn || ''} onChange={(e) => setProjectForm((p) => ({ ...p, nameEn: e.target.value, name: e.target.value }))} /></AdminField>
        <AdminField label="Arabic name"><input className="input" value={projectForm.nameAr || ''} onChange={(e) => setProjectForm((p) => ({ ...p, nameAr: e.target.value }))} /></AdminField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={projectForm.active !== false} onChange={(e) => setProjectForm((p) => ({ ...p, active: e.target.checked }))} />
        <span>{isAr ? 'فعال' : 'Active'}</span>
      </label>
      <DialogActions
        onDelete={projectForm.id ? () => deleteCollectionDoc(WP_PROJECTS_COLLECTION, projectForm.id, isAr ? 'المشروع' : 'project') : undefined}
        deleteLabel={isAr ? 'حذف المشروع' : 'Delete project'}
      />
    </form>
  );

  const renderEngineerForm = () => (
    <form className="space-y-3" onSubmit={saveEngineer}>
      <AdminField label="ID"><input className="input" value={engineerForm.id || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, id: e.target.value }))} /></AdminField>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="English name"><input className="input" value={engineerForm.nameEn || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, nameEn: e.target.value, name: e.target.value }))} /></AdminField>
        <AdminField label="Arabic name"><input className="input" value={engineerForm.nameAr || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, nameAr: e.target.value }))} /></AdminField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="Position">
          <select className="input" value={engineerForm.position || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, position: e.target.value }))}>
            <option value="">Choose</option>
            {lookupOptions(positions)}
          </select>
        </AdminField>
        <AdminField label="Department">
          <select className="input" value={engineerForm.department || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, department: e.target.value }))}>
            <option value="">Choose</option>
            {lookupOptions(departments)}
          </select>
        </AdminField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={engineerForm.active !== false} onChange={(e) => setEngineerForm((p) => ({ ...p, active: e.target.checked }))} />
        <span>{isAr ? 'فعال' : 'Active'}</span>
      </label>
      <DialogActions
        onDelete={engineerForm.id ? () => deleteCollectionDoc(WP_ENGINEERS_COLLECTION, engineerForm.id, isAr ? 'المهندس' : 'engineer') : undefined}
        deleteLabel={isAr ? 'حذف المهندس' : 'Delete engineer'}
      />
    </form>
  );

  const lookupCollectionForDialog = () => {
    if (dialogTab === 'positions') return WP_POSITIONS_COLLECTION;
    if (dialogTab === 'departments') return WP_DEPARTMENTS_COLLECTION;
    return WP_CITIES_COLLECTION;
  };

  const lookupSuccessText = () => {
    if (dialogTab === 'positions') return isAr ? 'تم حفظ المنصب.' : 'Position saved.';
    if (dialogTab === 'departments') return isAr ? 'تم حفظ القسم.' : 'Department saved.';
    return isAr ? 'تم حفظ المدينة.' : 'City saved.';
  };

  const renderLookupForm = () => (
    <form className="space-y-3" onSubmit={(event) => saveLookup(event, lookupCollectionForDialog(), lookupSuccessText())}>
      <AdminField label="ID">
        <input className="input" value={lookupForm.id} onChange={(e) => setLookupForm((p) => ({ ...p, id: e.target.value }))} />
      </AdminField>
      <AdminField label={isAr ? 'الاسم' : 'Name'}>
        <input className="input" value={lookupForm.name} onChange={(e) => setLookupForm((p) => ({ ...p, name: e.target.value }))} />
      </AdminField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={lookupForm.active !== false} onChange={(e) => setLookupForm((p) => ({ ...p, active: e.target.checked }))} />
        <span>{isAr ? 'فعال' : 'Active'}</span>
      </label>
      <DialogActions
        onDelete={lookupForm.id ? () => deleteCollectionDoc(lookupCollectionForDialog(), lookupForm.id, lookupForm.name || lookupForm.id) : undefined}
        deleteLabel={isAr ? 'حذف' : 'Delete'}
      />
    </form>
  );

  function DialogActions({ disabled, onDelete, deleteLabel }: { disabled?: boolean; onDelete?: () => void; deleteLabel?: string }) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
        <div>
          {onDelete && (
            <button type="button" className="btn-ghost inline-flex items-center gap-2 text-red-600" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              <span>{deleteLabel || (isAr ? 'حذف' : 'Delete')}</span>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => setDialogTab(null)}>{isAr ? 'إغلاق' : 'Close'}</button>
          <button type="submit" className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" disabled={busy || disabled}>
            <Save className="h-4 w-4" />
            <span>{isAr ? 'حفظ' : 'Save'}</span>
          </button>
        </div>
      </div>
    );
  }

  const dialogTitle = () => {
    if (dialogTab === 'employees') return employeeForm.id ? (isAr ? 'تعديل موظف' : 'Edit employee') : (isAr ? 'إضافة موظف' : 'Add employee');
    if (dialogTab === 'coordinators') return coordinatorForm.employeeId ? (isAr ? 'تعديل منسق' : 'Edit coordinator') : (isAr ? 'إضافة منسق' : 'Add coordinator');
    if (dialogTab === 'projects') return projectForm.id ? (isAr ? 'تعديل مشروع' : 'Edit project') : (isAr ? 'إضافة مشروع' : 'Add project');
    if (dialogTab === 'engineers') return engineerForm.id ? (isAr ? 'تعديل مهندس' : 'Edit engineer') : (isAr ? 'إضافة مهندس' : 'Add engineer');
    if (dialogTab === 'positions') return lookupForm.id ? (isAr ? 'تعديل منصب' : 'Edit position') : (isAr ? 'إضافة منصب' : 'Add position');
    if (dialogTab === 'departments') return lookupForm.id ? (isAr ? 'تعديل قسم' : 'Edit department') : (isAr ? 'إضافة قسم' : 'Add department');
    return lookupForm.id ? (isAr ? 'تعديل مدينة' : 'Edit city') : (isAr ? 'إضافة مدينة' : 'Add city');
  };

  const renderDialogForm = () => {
    if (dialogTab === 'employees') return renderEmployeeForm();
    if (dialogTab === 'coordinators') return renderCoordinatorForm();
    if (dialogTab === 'projects') return renderProjectForm();
    if (dialogTab === 'engineers') return renderEngineerForm();
    return renderLookupForm();
  };

  return (
    <div className="space-y-5 text-right" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-semibold">{isAr ? 'لوحة إدارة خطط العمل' : 'Work Plans Admin'}</div>
              <div className="mt-1 text-sm text-gray-500">
                {isAr ? 'كل القوائم والصلاحيات في مكان واحد، مع بحث سريع وإضافة مباشرة.' : 'All lists and access controls in one place, with quick search and direct add.'}
              </div>
            </div>
          </div>
          {activeSection.canAdd && (
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => openNew(activeSection.key as EditableTab)}>
              <Plus className="h-4 w-4" />
              <span>{isAr ? 'إضافة جديد' : 'Add new'}</span>
            </button>
          )}
        </div>
      </div>

      {message && <div className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="sticky top-0 z-20 -mx-1 overflow-x-auto bg-white/95 px-1 py-2 backdrop-blur md:hidden">
        <div className="flex gap-2">
          {sections.map(({ key, labelAr, labelEn, count, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700'}`}
                onClick={() => {
                  setTab(key);
                  resetMessages();
                }}
              >
                <Icon className="h-4 w-4" />
                <span>{isAr ? labelAr : labelEn}</span>
                <span className="rounded-lg bg-gray-100 px-1.5 text-xs text-gray-600">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
        {sections.map(({ key, labelAr, labelEn, helperAr, helperEn, count, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              className={`rounded-2xl border p-4 text-start shadow-sm transition ${active ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50'}`}
              onClick={() => {
                setTab(key);
                resetMessages();
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${active ? 'bg-white text-blue-700' : 'bg-gray-50 text-gray-600'}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-2xl font-semibold">{count}</div>
              </div>
              <div className="mt-3 font-semibold">{isAr ? labelAr : labelEn}</div>
              <div className="mt-1 text-xs text-gray-500">{isAr ? helperAr : helperEn}</div>
            </button>
          );
        })}
      </div>

      <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{isAr ? activeSection.labelAr : activeSection.labelEn}</div>
            <div className="mt-1 text-sm text-gray-500">{isAr ? activeSection.helperAr : activeSection.helperEn}</div>
          </div>
          {activeSection.canAdd && (
            <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => openNew(activeSection.key as EditableTab)}>
              <Plus className="h-4 w-4" />
              <span>{isAr ? 'إضافة جديد' : 'Add new'}</span>
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 ${isAr ? 'right-3' : 'left-3'}`} />
            <input
              className={`input ${isAr ? 'pr-9 text-right' : 'pl-9 text-left'}`}
              value={currentSearch}
              onChange={(event) => setCurrentSearch(event.target.value)}
              placeholder={isAr ? 'بحث وفلترة داخل هذا القسم' : 'Search and filter this section'}
            />
          </div>
          {currentSearch && (
            <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => setCurrentSearch('')}>
              <X className="h-4 w-4" />
              <span>{isAr ? 'مسح' : 'Clear'}</span>
            </button>
          )}
        </div>

        <div className="mt-4 max-h-[68vh] overflow-y-auto rounded-2xl bg-gray-50/60 p-3">
          {renderList()}
        </div>
      </section>

      {dialogTab && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-xl sm:max-w-5xl sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-4">
              <div>
                <div className="text-lg font-semibold">{dialogTitle()}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {isAr ? 'عدّل البيانات ثم اضغط حفظ، أو استخدم الحذف من أسفل النافذة.' : 'Edit the details, save, or use delete at the bottom.'}
                </div>
              </div>
              <button type="button" className="btn-ghost inline-flex items-center justify-center" onClick={() => setDialogTab(null)} aria-label={isAr ? 'إغلاق' : 'Close'}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(92vh-86px)] overflow-y-auto p-4">
              {renderDialogForm()}
            </div>
          </div>
        </div>
      )}

      {overlapDetailsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full overflow-hidden rounded-t-3xl border border-amber-200 bg-white shadow-xl sm:max-w-4xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50 p-4">
              <div>
                <div className="text-lg font-semibold text-amber-900">{isAr ? 'تفاصيل التداخل' : 'Overlap details'}</div>
                <div className="mt-1 text-sm text-amber-800">
                  {isAr ? `المنسق الحالي: ${employeeLabel(coordinatorForm.employeeId)}` : `Current coordinator: ${employeeLabel(coordinatorForm.employeeId)}`}
                </div>
              </div>
              <button type="button" className="btn-ghost bg-white" onClick={() => setOverlapDetailsOpen(false)} aria-label={isAr ? 'إغلاق' : 'Close'}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(92vh-86px)] space-y-3 overflow-y-auto p-4">
              {selectedCoordinatorOverlaps.map((coordinator) => {
                const details = coordinatorOverlapDetails(coordinator);
                return (
                  <div key={coordinator.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-gray-900">{employeeLabel(coordinator.employeeId)}</div>
                        <div className="mt-1 text-xs text-gray-500">{isAr ? 'منسق آخر لديه صلاحية متقاطعة' : 'Another coordinator with shared access'}</div>
                      </div>
                      <span className={`badge ${coordinator.active === false ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-green-200 bg-green-50 text-green-700'}`}>
                        {coordinator.active === false ? (isAr ? 'غير فعال' : 'Inactive') : (isAr ? 'فعال' : 'Active')}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                        <div className="text-xs font-semibold text-blue-800">{isAr ? 'الأقسام المشتركة' : 'Shared departments'}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {details.sharedDepartments.map((department) => (
                            <span key={department} className="rounded-xl border border-blue-200 bg-white px-2 py-1 text-xs text-blue-800">{department}</span>
                          ))}
                          {!details.sharedDepartments.length && <span className="text-xs text-blue-700">{isAr ? 'لا يوجد قسم مشترك.' : 'No shared department.'}</span>}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                        <div className="text-xs font-semibold text-emerald-800">{isAr ? 'الأشخاص المشتركون' : 'Shared people'}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {details.sharedPeople.map((employeeId) => (
                            <span key={employeeId} className="rounded-xl border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-800">{employeeLabel(employeeId)}</span>
                          ))}
                          {!details.sharedPeople.length && <span className="text-xs text-emerald-700">{isAr ? 'لا يوجد شخص مشترك.' : 'No shared person.'}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
