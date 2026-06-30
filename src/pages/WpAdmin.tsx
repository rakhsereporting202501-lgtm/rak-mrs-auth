import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ref, remove } from 'firebase/database';
import { Database, Hammer, Monitor, Plus, Save, Search, Trash2, UserRound } from 'lucide-react';
import { useWpAuth } from '../context/WpAuthContext';
import { initFirebase } from '../lib/firebase';
import { getWpDb, getWpRealtimeDb } from '../lib/wpFirebase';
import { cleanWpText, displayWpPersonName, normalizeWpEmployee, splitWpName, wpEmployeeSearchText } from '../lib/wpPeople';
import {
  WP_EMPLOYEE_SEED,
  WP_EMPLOYEES_COLLECTION,
  WP_ENGINEERS_COLLECTION,
  WP_PROJECTS_COLLECTION,
  WP_SESSIONS_COLLECTION,
  WP_SESSION_RTDB_PATH,
  type WpAccountType,
  type WpEmployee,
  type WpEngineer,
  type WpProject,
  type WpSessionDoc,
} from '../lib/wpTypes';
import { timestampMs } from '../lib/wpTypes';

type Tab = 'employees' | 'projects' | 'engineers' | 'sessions';

type EmployeeForm = {
  id: string;
  memberCode: string;
  fullName: string;
  nameAr: string;
  nameEn: string;
  position: string;
  department: string;
  accountType: WpAccountType;
  active: boolean;
  authEmail: string;
  authUid: string;
};

const emptyEmployeeForm: EmployeeForm = {
  id: '',
  memberCode: '',
  fullName: '',
  nameAr: '',
  nameEn: '',
  position: '',
  department: '',
  accountType: 'VIEWER',
  active: true,
  authEmail: '',
  authUid: '',
};

const emptyProject: WpProject = { id: '', code: '', name: '', nameAr: '', nameEn: '', active: true };
const emptyEngineer: WpEngineer = { id: '', name: '', nameAr: '', nameEn: '', position: 'Engineer', department: '', active: true };

function safeDocId(value: string) {
  return cleanWpText(value).replace(/[\/#?[\]]+/g, '-');
}

function chunked<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export default function WpAdmin() {
  const { isAdmin, locale } = useWpAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<WpEmployee[]>([]);
  const [projects, setProjects] = useState<WpProject[]>([]);
  const [engineers, setEngineers] = useState<WpEngineer[]>([]);
  const [sessions, setSessions] = useState<WpSessionDoc[]>([]);
  const [qText, setQText] = useState('');
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployeeForm);
  const [projectForm, setProjectForm] = useState<WpProject>(emptyProject);
  const [engineerForm, setEngineerForm] = useState<WpEngineer>(emptyEngineer);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      accountType: employee.accountType || 'VIEWER',
      active: employee.active !== false,
      authEmail: employee.authEmail || '',
      authUid: employee.authUid || '',
    });
    setTab('employees');
  };

  const saveEmployee = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const id = safeDocId(employeeForm.id || employeeForm.memberCode || employeeForm.fullName);
      const fullName = cleanWpText(employeeForm.fullName || [employeeForm.nameEn, employeeForm.nameAr].filter(Boolean).join(' '));
      const employee = normalizeWpEmployee({
        ...employeeForm,
        id,
        memberCode: employeeForm.memberCode || id,
        fullName,
      });
      await setDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, id), {
        ...employee,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setEmployeeForm(emptyEmployeeForm);
      setMessage(isAr ? 'تم حفظ الموظف.' : 'Employee saved.');
    } finally {
      setBusy(false);
    }
  };

  const deleteEmployee = async (employee: WpEmployee) => {
    if (!window.confirm(isAr ? 'هل تريد حذف هذا الموظف؟' : 'Delete this employee?')) return;
    await deleteDoc(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, employee.id));
  };

  const seedEmployees = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const normalized = WP_EMPLOYEE_SEED.map((employee) => normalizeWpEmployee({ ...employee, accountType: 'VIEWER', active: true }));
      for (const part of chunked(normalized, 400)) {
        const batch = writeBatch(getWpDb());
        part.forEach((employee) => {
          batch.set(doc(getWpDb(), WP_EMPLOYEES_COLLECTION, employee.id), {
            ...employee,
            source: 'xlsx-seed',
            updatedAt: serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
      }
      setMessage(isAr ? 'تمت إضافة بيانات الموظفين الأولية.' : 'Employee seed imported.');
    } finally {
      setBusy(false);
    }
  };

  const seedEngineersFromEmployees = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const source = employees.length ? employees : WP_EMPLOYEE_SEED.map((employee) => normalizeWpEmployee(employee));
      const engineerPeople = source.filter((employee) => /engineer/i.test(`${employee.position || ''} ${employee.fullName || ''}`));
      for (const part of chunked(engineerPeople, 400)) {
        const batch = writeBatch(getWpDb());
        part.forEach((employee) => {
          batch.set(doc(getWpDb(), WP_ENGINEERS_COLLECTION, employee.id), {
            id: employee.id,
            name: employee.fullName,
            nameAr: employee.nameAr || splitWpName(employee.fullName).nameAr,
            nameEn: employee.nameEn || splitWpName(employee.fullName).nameEn,
            position: employee.position || 'Engineer',
            department: employee.department || '',
            active: true,
            source: 'employee-seed',
            updatedAt: serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
      }
      setMessage(isAr ? 'تم إنشاء قائمة المهندسين من بيانات الموظفين.' : 'Engineers seeded from employees.');
    } finally {
      setBusy(false);
    }
  };

  const importProjectsFromInventory = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const oldDb = getFirestore(initFirebase().app);
      const snap = await getDocs(collection(oldDb, 'projects'));
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
      for (const part of chunked(rows, 400)) {
        const batch = writeBatch(getWpDb());
        part.forEach((project: any) => {
          const id = safeDocId(project.id || project.code || project.nameEn || project.name || project.nameAr);
          batch.set(doc(getWpDb(), WP_PROJECTS_COLLECTION, id), {
            id,
            code: project.code || project.id || '',
            name: project.name || project.nameEn || project.nameAr || project.code || project.id || '',
            nameAr: project.nameAr || '',
            nameEn: project.nameEn || project.name || project.code || project.id || '',
            active: project.active !== false,
            source: 'inventory-projects',
            updatedAt: serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
      }
      setMessage(isAr ? 'تم نسخ المشاريع من تطبيق المخزن.' : 'Projects copied from inventory app.');
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

  const revokeSession = async (session: WpSessionDoc) => {
    await updateDoc(doc(getWpDb(), WP_SESSIONS_COLLECTION, session.id), {
      active: false,
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await remove(ref(getWpRealtimeDb(), `${WP_SESSION_RTDB_PATH}/${session.employeeId}/${session.id}`));
  };

  if (!isAdmin) {
    return <div className="alert alert-error" dir={isAr ? 'rtl' : 'ltr'}>{isAr ? 'هذه الصفحة خاصة بالأدمن فقط.' : 'Admin only.'}</div>;
  }

  const tabButton = (key: Tab, labelAr: string, labelEn: string, Icon: any) => (
    <button
      type="button"
      className={`btn-ghost inline-flex items-center gap-2 ${tab === key ? 'border-blue-300 bg-blue-50 text-blue-700' : ''}`}
      onClick={() => setTab(key)}
    >
      <Icon className="h-4 w-4" />
      <span>{isAr ? labelAr : labelEn}</span>
    </button>
  );

  return (
    <div className="space-y-4 text-right" dir={isAr ? 'rtl' : 'ltr'}>
      <div>
        <div className="text-xl font-semibold">{isAr ? 'إدارة خطط العمل' : 'Work Plans Admin'}</div>
        <div className="text-sm text-gray-500 mt-1">
          {isAr ? 'إدارة الموظفين والمشاريع والمهندسين والجلسات.' : 'Manage employees, projects, engineers, and sessions.'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabButton('employees', 'الموظفين', 'Employees', UserRound)}
        {tabButton('projects', 'المشاريع', 'Projects', Database)}
        {tabButton('engineers', 'المهندسين', 'Engineers', Hammer)}
        {tabButton('sessions', 'الجلسات', 'Sessions', Monitor)}
      </div>

      {message && <div className="rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      {tab === 'employees' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="card p-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 ${isAr ? 'right-3' : 'left-3'}`} />
                <input className={`input ${isAr ? 'pr-9 text-right' : 'pl-9 text-left'}`} value={qText} onChange={(e) => setQText(e.target.value)} placeholder={isAr ? 'بحث' : 'Search'} />
              </div>
              <button type="button" className="btn-ghost" disabled={busy} onClick={seedEmployees}>{isAr ? 'استيراد الموظفين' : 'Import employees'}</button>
            </div>
            <div className="mt-3 max-h-[620px] overflow-y-auto space-y-2">
              {filteredEmployees.map((employee) => (
                <div key={employee.id} className="rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-3">
                  <button type="button" className="min-w-0 text-start" onClick={() => editEmployee(employee)}>
                    <div className="font-semibold text-sm">{displayWpPersonName(employee, locale)}</div>
                    <div className="text-xs text-gray-500">{employee.memberCode} - {employee.position || '-'} - {employee.department || '-'}</div>
                    <div className="mt-1">
                      <span className="badge border-blue-200 bg-blue-50 text-blue-700">{employee.accountType || 'VIEWER'}</span>
                    </div>
                  </button>
                  <button type="button" className="btn-ghost text-red-600" onClick={() => deleteEmployee(employee)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <form className="card p-4 space-y-3" onSubmit={saveEmployee}>
            <div className="font-semibold">{isAr ? 'تفاصيل الموظف' : 'Employee details'}</div>
            <input className="input" placeholder="ID" value={employeeForm.id} onChange={(e) => setEmployeeForm((p) => ({ ...p, id: e.target.value }))} />
            <input className="input" placeholder={isAr ? 'كود الموظف' : 'Member code'} value={employeeForm.memberCode} onChange={(e) => setEmployeeForm((p) => ({ ...p, memberCode: e.target.value }))} />
            <input className="input" placeholder={isAr ? 'الاسم الكامل' : 'Full name'} value={employeeForm.fullName} onChange={(e) => setEmployeeForm((p) => ({ ...p, fullName: e.target.value }))} />
            <input className="input" placeholder={isAr ? 'الاسم العربي' : 'Arabic name'} value={employeeForm.nameAr} onChange={(e) => setEmployeeForm((p) => ({ ...p, nameAr: e.target.value }))} />
            <input className="input" placeholder={isAr ? 'الاسم الإنجليزي' : 'English name'} value={employeeForm.nameEn} onChange={(e) => setEmployeeForm((p) => ({ ...p, nameEn: e.target.value }))} />
            <input className="input" placeholder={isAr ? 'المنصب' : 'Position'} value={employeeForm.position} onChange={(e) => setEmployeeForm((p) => ({ ...p, position: e.target.value }))} />
            <input className="input" placeholder={isAr ? 'القسم' : 'Department'} value={employeeForm.department} onChange={(e) => setEmployeeForm((p) => ({ ...p, department: e.target.value }))} />
            <select className="input" value={employeeForm.accountType} onChange={(e) => setEmployeeForm((p) => ({ ...p, accountType: e.target.value as WpAccountType }))}>
              <option value="VIEWER">VIEWER</option>
              <option value="COORDINATOR">COORDINATOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <input className="input" placeholder="Firebase Auth Email" value={employeeForm.authEmail} onChange={(e) => setEmployeeForm((p) => ({ ...p, authEmail: e.target.value }))} />
            <input className="input" placeholder="Firebase Auth UID" value={employeeForm.authUid} onChange={(e) => setEmployeeForm((p) => ({ ...p, authUid: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={employeeForm.active} onChange={(e) => setEmployeeForm((p) => ({ ...p, active: e.target.checked }))} />
              <span>{isAr ? 'فعال' : 'Active'}</span>
            </label>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {isAr
                ? 'كلمة مرور المنسق والأدمن تدار من Firebase Authentication في مشروع Work Plan Rak.'
                : 'Coordinator/admin passwords are managed in Firebase Authentication for Work Plan Rak.'}
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary inline-flex items-center gap-2 disabled:opacity-50" disabled={busy}>
                <Save className="h-4 w-4" />
                <span>{isAr ? 'حفظ' : 'Save'}</span>
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEmployeeForm(emptyEmployeeForm)}>
                <Plus className="h-4 w-4 inline" /> {isAr ? 'جديد' : 'New'}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === 'projects' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="card p-4">
            <button type="button" className="btn-ghost mb-3" disabled={busy} onClick={importProjectsFromInventory}>
              {isAr ? 'نسخ المشاريع من تطبيق المخزن' : 'Copy projects from inventory'}
            </button>
            <div className="space-y-2">
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
            <input className="input" placeholder="ID" value={projectForm.id || ''} onChange={(e) => setProjectForm((p) => ({ ...p, id: e.target.value }))} />
            <input className="input" placeholder="Code" value={projectForm.code || ''} onChange={(e) => setProjectForm((p) => ({ ...p, code: e.target.value }))} />
            <input className="input" placeholder="English name" value={projectForm.nameEn || ''} onChange={(e) => setProjectForm((p) => ({ ...p, nameEn: e.target.value }))} />
            <input className="input" placeholder="Arabic name" value={projectForm.nameAr || ''} onChange={(e) => setProjectForm((p) => ({ ...p, nameAr: e.target.value }))} />
            <button className="btn-primary" type="submit">{isAr ? 'حفظ' : 'Save'}</button>
          </form>
        </div>
      )}

      {tab === 'engineers' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="card p-4">
            <button type="button" className="btn-ghost mb-3" disabled={busy} onClick={seedEngineersFromEmployees}>
              {isAr ? 'إنشاء من بيانات الموظفين' : 'Seed from employees'}
            </button>
            <div className="space-y-2">
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
            <input className="input" placeholder="ID" value={engineerForm.id || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, id: e.target.value }))} />
            <input className="input" placeholder="English name" value={engineerForm.nameEn || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, nameEn: e.target.value, name: e.target.value }))} />
            <input className="input" placeholder="Arabic name" value={engineerForm.nameAr || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, nameAr: e.target.value }))} />
            <input className="input" placeholder="Position" value={engineerForm.position || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, position: e.target.value }))} />
            <input className="input" placeholder="Department" value={engineerForm.department || ''} onChange={(e) => setEngineerForm((p) => ({ ...p, department: e.target.value }))} />
            <button className="btn-primary" type="submit">{isAr ? 'حفظ' : 'Save'}</button>
          </form>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="card p-4 space-y-2">
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
      )}
    </div>
  );
}
