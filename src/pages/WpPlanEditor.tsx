import { useEffect, useMemo, useState, type DragEvent, type TouchEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { ChevronDown, Copy, Filter, GripVertical, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  makeWpGroup,
  tomorrowYmd,
  WP_COUNTERS_COLLECTION,
  WP_EMPLOYEE_SEED,
  WP_WORK_PLANS_COLLECTION,
  type WpAssignmentGroup,
  type WpEmployee,
  type WpPlanDoc,
  type WpPlanStatus,
} from '../lib/wpTypes';

type Project = { id: string; nameAr?: string; nameEn?: string; name?: string; code?: string };
type Engineer = { id: string; nameAr?: string; nameEn?: string; name?: string; position?: string; department?: string };
type PersonType = 'engineer' | 'employee';
type EditingPerson = { groupId: string; personType: PersonType; personId: string; name: string; position: string; department?: string };
type DragInfo = { groupId: string; personType: PersonType; personId: string };
type TouchInfo = DragInfo & { x: number; y: number };

const positionPalette = [
  'border-blue-200 bg-blue-50 text-blue-700',
  'border-emerald-200 bg-emerald-50 text-emerald-700',
  'border-amber-200 bg-amber-50 text-amber-700',
  'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
  'border-cyan-200 bg-cyan-50 text-cyan-700',
  'border-rose-200 bg-rose-50 text-rose-700',
  'border-violet-200 bg-violet-50 text-violet-700',
  'border-lime-200 bg-lime-50 text-lime-700',
];

const positionLabels: Record<string, string> = {
  labourer: 'عامل',
  pa: 'مساعد',
  rigger: 'عامل رفع',
  grinder: 'عامل قطع',
  'hse officer': 'مسؤول سلامة',
  'mechanical technician': 'فني ميكانيك',
  '6g welder': 'لحام 6G',
  scaffolder: 'عامل سقالات',
  technician: 'فني',
  'site engineer': 'مهندس موقع',
  supervisor: 'مشرف',
  'first aider': 'مسعف أولي',
  electrical: 'كهرباء',
  formen: 'فورمن',
  'qa qc inspector': 'مفتش جودة',
  'pickup driver': 'سائق بيك أب',
  fabricater: 'عامل تصنيع',
  fabricator: 'عامل تصنيع',
  'hiab driver': 'سائق هياب',
  'qc engineer': 'مهندس جودة',
  '3g welder': 'لحام 3G',
  mechanical: 'ميكانيك',
  painter: 'صباغ',
  'hse tl': 'قائد فريق السلامة',
  'tractor driver': 'سائق تراكتور',
  rescuer: 'منقذ',
  'electrical engineer': 'مهندس كهرباء',
  'crane driver': 'سائق كرين',
  'mechanical engineer': 'مهندس ميكانيك',
  'mechanical supervisor': 'مشرف ميكانيك',
  coordinator: 'منسق',
  electrician: 'كهربائي',
  'lifting supervisor': 'مشرف رفع',
  'trailer driver': 'سائق تريلة',
  'construction manager': 'مدير إنشاءات',
  'civil engineer': 'مهندس مدني',
  surveyor: 'مساح',
  storekeeper: 'أمين مخزن',
  'store keeper': 'أمين مخزن',
  'design engineer': 'مهندس تصميم',
  'team lead': 'قائد فريق',
  planner: 'مخطط',
  'cost engineer': 'مهندس كلفة',
  'pipe fitter': 'عامل تركيب أنابيب',
  'vehicle inspector': 'فاحص مركبات',
  'water tanker driver': 'سائق تانكر ماء',
  'vaccum driver': 'سائق فاكيوم',
  'bingo driver': 'سائق بنكو',
  'hino driver': 'سائق هينو',
  admin: 'إداري',
  'fire watcher': 'مراقب حريق',
  lead: 'قائد',
  'pmo manager': 'مدير PMO',
  carpenter: 'نجار',
  'draft man': 'رسام',
  'electrical lead': 'قائد كهرباء',
  'assist coordinator': 'مساعد منسق',
  'admin incharge': 'مسؤول إداري',
  'senior storekeeper': 'أمين مخزن أقدم',
  storeworker: 'عامل مخزن',
  welder: 'لحام',
  'fabrication cleaner': 'عامل تنظيف تصنيع',
  'workshop engineer': 'مهندس ورشة',
  sandblaster: 'عامل ساند بلاست',
  'construction team lead': 'قائد فريق إنشاءات',
  hse: 'سلامة',
  'hse manager': 'مدير سلامة',
  'journey coordinator': 'منسق رحلات',
  'hydrovac coordinator': 'منسق هايدروفاك',
  'lifting manager': 'مدير رفع',
  maintenance: 'صيانة',
  'driver - starex': 'سائق ستاركس',
  'taractor driver': 'سائق تراكتور',
  'jcb driver': 'سائق JCB',
  'hydrovac driver': 'سائق هايدروفاك',
  'logistics coordinator': 'منسق لوجستي',
  'forklift driver': 'سائق فوركلفت',
  'oil tanker driver': 'سائق تانكر نفط',
  'driver water tanker': 'سائق تانكر ماء',
  'driver starex': 'سائق ستاركس',
  'oil station officer': 'مسؤول محطة نفط',
  'shovel driver': 'سائق شفل',
  'sideboom driver': 'سائق سايد بوم',
  driver: 'سائق',
  'material engineer': 'مهندس مواد',
  'mechanical section head': 'رئيس قسم ميكانيك',
  'rescue & fire watcher & first aider': 'إنقاذ ومراقبة حريق وإسعاف أولي',
  'qa qc engineer': 'مهندس جودة',
  'qa-qc team lead': 'قائد فريق جودة',
  'trp supervisor': 'مشرف TRP',
  'trp lead': 'قائد TRP',
  rescue: 'إنقاذ',
};

const departmentLabels: Record<string, string> = {
  'logistic department': 'قسم اللوجستك',
  'vrp department': 'قسم VRP',
  'fabrication department': 'قسم التصنيع',
  'pa department': 'قسم PA',
  'wellhead department': 'قسم Wellhead',
  'd.w. team - pipeline': 'فريق D.W - الأنابيب',
  'hse department': 'قسم السلامة',
  'mechanical department': 'قسم الميكانيك',
  'scaffolding department': 'قسم السقالات',
  'pipeline department': 'قسم الأنابيب',
  'electrical department': 'قسم الكهرباء',
  'civil department': 'القسم المدني',
  'qa/qc department': 'قسم الجودة',
  'trp department': 'قسم TRP',
  'hydrovac department': 'قسم الهايدروفاك',
  'lifting department': 'قسم الرفع',
  'design department': 'قسم التصميم',
  'material department': 'قسم المواد',
  'cps department': 'قسم CPS',
};

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function displayPersonName(value: string) {
  const clean = cleanText(value || '');
  const arabicParts = clean.match(/[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g);
  return arabicParts?.join(' ').trim() || clean;
}

function projectDisplayName(project: Project) {
  return cleanText(project.nameEn || project.name || project.nameAr || project.code || project.id);
}

function isEnglishProjectText(value: string) {
  const clean = cleanText(value);
  if (!clean) return true;
  return /^[A-Za-z0-9 ._/#&()+-]+$/.test(clean);
}

function toEnglishName(value: string, fallback: string) {
  const english = value.replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return english || fallback.replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim() || 'Coordinator';
}

function statusLabel(status?: string) {
  if (status === 'DRAFT') return 'مسودة';
  if (status === 'SUBMITTED') return 'مرسلة';
  return status || '-';
}

function displayPosition(value?: string) {
  const clean = cleanText(value || '');
  if (!clean) return 'بدون منصب';
  return positionLabels[clean.toLowerCase()] || clean;
}

function displayDepartment(value?: string) {
  const clean = cleanText(value || '');
  if (!clean) return 'بدون قسم';
  return departmentLabels[clean.toLowerCase()] || clean;
}

function manualId(prefix: string, name: string) {
  return `${prefix}-${cleanText(name).toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')}`;
}

function normalizeEngineerNames(value: any): string[] {
  if (Array.isArray(value)) return value.map((entry) => cleanText(String(entry || ''))).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(/[;,\u060C\n]/).map((entry) => cleanText(entry)).filter(Boolean);
  }
  return [];
}

function normalizeDeptFilters(value: any): string[] {
  if (Array.isArray(value)) return value.map((entry) => cleanText(String(entry || ''))).filter(Boolean);
  if (typeof value === 'string' && value) return [cleanText(value)];
  return [];
}

function personSearchText(person: WpEmployee) {
  return [
    person.fullName,
    displayPersonName(person.fullName),
    person.memberCode,
    person.position || '',
    displayPosition(person.position || person.assignmentPosition || ''),
    person.assignmentPosition || '',
    person.department || '',
    displayDepartment(person.department || ''),
  ].join(' ').toLowerCase();
}

function snapshotPerson(person: WpEmployee): WpEmployee {
  const position = cleanText(person.assignmentPosition || person.position || '');
  return {
    id: person.id,
    memberCode: person.memberCode || '',
    fullName: cleanText(person.fullName || ''),
    position,
    assignmentPosition: position,
    originalPosition: cleanText(person.originalPosition || person.position || position),
    department: cleanText(person.department || ''),
    manual: !!person.manual,
  };
}

function positionClass(position: string) {
  const key = displayPosition(position);
  const hash = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return positionPalette[hash % positionPalette.length];
}

function monthKeyFromDate(workDate: string) {
  const clean = /^\d{4}-\d{2}-\d{2}$/.test(workDate) ? workDate : tomorrowYmd();
  return `${clean.slice(2, 4)}${clean.slice(5, 7)}`;
}

function makePlanCode(monthKey: string, sequenceNo: number) {
  return `WP-${monthKey}${String(sequenceNo).padStart(3, '0')}`;
}

function groupPeopleByDepartment(people: WpEmployee[]) {
  const groups = new Map<string, WpEmployee[]>();
  people.forEach((person) => {
    const dept = displayDepartment(person.department);
    groups.set(dept, [...(groups.get(dept) || []), person]);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default function WpPlanEditor() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const copyId = params.get('copy');
  const isEdit = !!id;
  const { app } = initFirebase();
  const db = getFirestore(app);
  const fullName = role?.fullName || user?.displayName || user?.email || '';
  const savedEditorFilters = useMemo(() => {
    try {
      const raw = localStorage.getItem('rakWp.editor.filters');
      return raw ? JSON.parse(raw) || {} : {};
    } catch {
      return {};
    }
  }, []);

  const [planCode, setPlanCode] = useState('');
  const [coordinatorNameEn, setCoordinatorNameEn] = useState('');
  const [workDate, setWorkDate] = useState(tomorrowYmd());
  const [status, setStatus] = useState<WpPlanStatus>('DRAFT');
  const [groups, setGroups] = useState<WpAssignmentGroup[]>([makeWpGroup()]);
  const [employees] = useState<WpEmployee[]>(WP_EMPLOYEE_SEED);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [planOwner, setPlanOwner] = useState<{ createdByUid?: string; createdBy?: WpPlanDoc['createdBy'] } | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState<Record<string, string>>({});
  const [engineerSearch, setEngineerSearch] = useState<Record<string, string>>({});
  const [employeeDeptFilters, setEmployeeDeptFilters] = useState<string[]>(() => normalizeDeptFilters(savedEditorFilters.employeeDeptFilters ?? savedEditorFilters.employeeDeptFilter));
  const [engineerDeptFilters, setEngineerDeptFilters] = useState<string[]>(() => normalizeDeptFilters(savedEditorFilters.engineerDeptFilters ?? savedEditorFilters.engineerDeptFilter));
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [deptPickerOpen, setDeptPickerOpen] = useState<Record<string, boolean>>({});
  const [editingPerson, setEditingPerson] = useState<EditingPerson | null>(null);
  const [positionDraft, setPositionDraft] = useState('');
  const [positionQuery, setPositionQuery] = useState('');
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [touchInfo, setTouchInfo] = useState<TouchInfo | null>(null);
  const [sourcePlanId, setSourcePlanId] = useState<string | null>(copyId || null);
  const [loading, setLoading] = useState(!!id || !!copyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const readOnly = isEdit && status === 'SUBMITTED';
  const title = isEdit ? (readOnly ? 'عرض خطة العمل' : 'تعديل خطة العمل') : 'خطة عمل جديدة';

  useEffect(() => {
    try {
      localStorage.setItem('rakWp.editor.filters', JSON.stringify({
        employeeDeptFilters,
        engineerDeptFilters,
      }));
    } catch {}
  }, [employeeDeptFilters, engineerDeptFilters]);

  useEffect(() => {
    let active = true;
    const loadLookups = async () => {
      try {
        const [projectSnap, engineerSnap] = await Promise.all([
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'engineers')),
        ]);
        if (!active) return;
        setProjects(projectSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
        setEngineers(engineerSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
      } catch (err) {
        console.warn('WP lookup load failed', err);
      }
    };
    loadLookups();
    return () => { active = false; };
  }, [db]);

  useEffect(() => {
    const loadPlan = async () => {
      const loadId = id || copyId;
      if (!loadId) return;
      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, WP_WORK_PLANS_COLLECTION, loadId));
        if (!snap.exists()) {
          setError('لم يتم العثور على خطة العمل.');
          return;
        }
        const data = { id: snap.id, ...(snap.data() as any) } as WpPlanDoc;
        setPlanCode(copyId ? '' : (data.planCode || data.id || ''));
        setCoordinatorNameEn(copyId ? '' : (data.coordinatorNameEn || ''));
        setWorkDate(copyId ? tomorrowYmd() : (data.workDate || tomorrowYmd()));
        setStatus(copyId ? 'DRAFT' : (data.status || 'DRAFT'));
        setSourcePlanId(copyId ? data.id : (data.sourcePlanId || null));
        setPlanOwner(copyId ? null : { createdByUid: data.createdByUid, createdBy: data.createdBy });
        const loadedGroups = Array.isArray(data.groups) && data.groups.length
          ? data.groups.map((group, index) => {
              const engineerNames = normalizeEngineerNames(group.engineerNames);
              const engineerSnapshots = Array.isArray(group.engineerSnapshots) && group.engineerSnapshots.length
                ? group.engineerSnapshots.map(snapshotPerson)
                : engineerNames.map((name) => snapshotPerson({
                    id: manualId('manual-engineer', name),
                    memberCode: 'MANUAL',
                    fullName: name,
                    position: 'مهندس',
                    department: '',
                    manual: true,
                  }));
              return {
                id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                projectCode: group.projectCode || '',
                projectName: '',
                engineerNames: engineerSnapshots.map((engineer) => engineer.fullName),
                engineerSnapshots,
                employeeIds: Array.isArray(group.employeeIds) ? group.employeeIds : [],
                employeeSnapshots: Array.isArray(group.employeeSnapshots)
                  ? group.employeeSnapshots.map(snapshotPerson)
                  : [],
                collapsed: index > 0,
              };
            })
          : [makeWpGroup()];
        setGroups(loadedGroups);
      } catch (err: any) {
        setError(err?.code === 'permission-denied'
          ? 'لا توجد صلاحية لقراءة خطة العمل. تأكد من نشر قواعد Firestore الخاصة بخطط العمل.'
          : 'تعذر تحميل خطة العمل.');
      } finally {
        setLoading(false);
      }
    };
    loadPlan();
  }, [db, id, copyId]);

  const employeeById = useMemo(() => {
    const map = new Map<string, WpEmployee>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const displayCoordinatorName = useMemo(() => {
    if (isEdit && !copyId) {
      return coordinatorNameEn
        || toEnglishName(String(planOwner?.createdBy?.fullName || planOwner?.createdBy?.email || ''), 'Coordinator');
    }
    return toEnglishName(fullName, user?.email?.split('@')[0] || 'Coordinator');
  }, [isEdit, copyId, coordinatorNameEn, planOwner, fullName, user?.email]);
  const displayCoordinatorLabel = displayCoordinatorName === 'Coordinator' ? 'منسق' : displayCoordinatorName;

  const engineerCandidates = useMemo(() => {
    const map = new Map<string, WpEmployee>();
    engineers.forEach((engineer) => {
      const name = cleanText(engineer.nameAr || engineer.nameEn || engineer.name || engineer.id);
      if (!name) return;
      const person = snapshotPerson({
        id: `engineer-${engineer.id}`,
        memberCode: 'ENGINEER',
        fullName: name,
        position: cleanText(engineer.position || 'مهندس'),
        department: cleanText(engineer.department || ''),
      });
      map.set(person.fullName.toLowerCase(), person);
    });
    employees.forEach((employee) => {
      const position = employee.position || '';
      const name = employee.fullName || '';
      if (!/engineer/i.test(`${position} ${name}`)) return;
      const snapshot = snapshotPerson({
        ...employee,
        id: `employee-${employee.id}`,
      });
      if (!map.has(snapshot.fullName.toLowerCase())) map.set(snapshot.fullName.toLowerCase(), snapshot);
    });
    return Array.from(map.values()).sort((a, b) => displayPersonName(a.fullName).localeCompare(displayPersonName(b.fullName)));
  }, [engineers, employees]);

  const employeeDepartments = useMemo(() => (
    Array.from(new Set(employees.map((employee) => employee.department || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [employees]);

  const engineerDepartments = useMemo(() => (
    Array.from(new Set(engineerCandidates.map((engineer) => engineer.department || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [engineerCandidates]);

  const positionSuggestions = useMemo(() => {
    const all = [
      ...employees.map((employee) => employee.position || ''),
      ...engineerCandidates.map((engineer) => engineer.position || ''),
    ].map(cleanText).filter(Boolean);
    return Array.from(new Set(all)).sort((a, b) => a.localeCompare(b));
  }, [employees, engineerCandidates]);

  const employeeUseMap = useMemo(() => {
    const map = new Map<string, { count: number; groups: string[] }>();
    groups.forEach((group, idx) => {
      group.employeeIds.forEach((employeeId) => {
        const current = map.get(employeeId) || { count: 0, groups: [] };
        current.count += 1;
        current.groups.push(`Group ${idx + 1}`);
        map.set(employeeId, current);
      });
    });
    return map;
  }, [groups]);

  const updateGroup = (groupId: string, patch: Partial<WpAssignmentGroup>) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((group) => group.id === groupId ? { ...group, ...patch } : group));
  };

  const addGroup = () => {
    if (readOnly) return;
    const nextGroup = makeWpGroup();
    setGroups((prev) => [
      ...prev.map((group) => ({ ...group, collapsed: true })),
      { ...nextGroup, collapsed: false },
    ]);
  };

  const removeGroup = (groupId: string) => {
    if (readOnly) return;
    setGroups((prev) => prev.length <= 1 ? prev : prev.filter((group) => group.id !== groupId));
  };

  const toggleGroup = (groupId: string) => {
    setGroups((prev) => prev.map((group) => (
      group.id === groupId
        ? { ...group, collapsed: !group.collapsed }
        : { ...group, collapsed: true }
    )));
  };

  const getSelectedEngineers = (group: WpAssignmentGroup) => {
    if (Array.isArray(group.engineerSnapshots) && group.engineerSnapshots.length) {
      return group.engineerSnapshots.map(snapshotPerson);
    }
    return group.engineerNames.map((name) => snapshotPerson({
      id: manualId('manual-engineer', name),
      memberCode: 'MANUAL',
      fullName: name,
      position: 'مهندس',
      department: '',
      manual: true,
    }));
  };

  const getSelectedEmployees = (group: WpAssignmentGroup) => {
    return group.employeeIds.map((employeeId) => {
      const snapshot = group.employeeSnapshots.find((employee) => employee.id === employeeId);
      const base = employeeById.get(employeeId);
      if (!snapshot && !base) return null;
      return snapshotPerson({
        ...(base || {}),
        ...(snapshot || {}),
        id: employeeId,
        memberCode: snapshot?.memberCode || base?.memberCode || '',
        fullName: snapshot?.fullName || base?.fullName || '',
        position: snapshot?.assignmentPosition || snapshot?.position || base?.position || '',
        assignmentPosition: snapshot?.assignmentPosition || snapshot?.position || base?.position || '',
        originalPosition: snapshot?.originalPosition || base?.position || snapshot?.position || '',
        department: snapshot?.department || base?.department || '',
      } as WpEmployee);
    }).filter(Boolean) as WpEmployee[];
  };

  const getPeopleResults = (group: WpAssignmentGroup, personType: PersonType) => {
    const queryText = ((personType === 'engineer' ? engineerSearch[group.id] : employeeSearch[group.id]) || '').toLowerCase().trim();
    const tokens = queryText.split(/\s+/).filter(Boolean);
    const deptFilters = personType === 'engineer' ? engineerDeptFilters : employeeDeptFilters;
    const selected = personType === 'engineer'
      ? new Set(getSelectedEngineers(group).map((engineer) => engineer.id))
      : new Set(group.employeeIds);
    const source = personType === 'engineer' ? engineerCandidates : employees.map(snapshotPerson);
    const filtered = source
      .filter((person) => !selected.has(person.id))
      .filter((person) => !deptFilters.length || deptFilters.includes(person.department || ''))
      .filter((person) => {
        if (!tokens.length) return true;
        const hay = personSearchText(person);
        return tokens.every((token) => hay.includes(token));
      })
      .sort((a, b) => displayPersonName(a.fullName).localeCompare(displayPersonName(b.fullName)));
    return filtered.slice(0, 80);
  };

  const addEngineerToGroup = (groupId: string, engineer: WpEmployee) => {
    if (readOnly) return;
    const snapshot = snapshotPerson(engineer);
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const selected = getSelectedEngineers(group);
      if (selected.some((entry) => entry.id === snapshot.id)) return group;
      const nextEngineers = [...selected, snapshot];
      return {
        ...group,
        engineerNames: nextEngineers.map((entry) => entry.fullName),
        engineerSnapshots: nextEngineers,
      };
    }));
  };

  const addTypedEngineer = (groupId: string) => {
    const name = cleanText(engineerSearch[groupId] || '');
    if (!name) return;
    addEngineerToGroup(groupId, {
      id: manualId('manual-engineer', name),
      memberCode: 'MANUAL',
      fullName: name,
      position: 'مهندس',
      department: '',
      manual: true,
    });
  };

  const addEmployeeToGroup = (groupId: string, employee: WpEmployee) => {
    if (readOnly) return;
    const snapshot = snapshotPerson(employee);
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId || group.employeeIds.includes(snapshot.id)) return group;
      return {
        ...group,
        employeeIds: [...group.employeeIds, snapshot.id],
        employeeSnapshots: [...group.employeeSnapshots.filter((entry) => entry.id !== snapshot.id), snapshot],
      };
    }));
  };

  const addTypedEmployee = (groupId: string) => {
    const name = cleanText(employeeSearch[groupId] || '');
    if (!name) return;
    addEmployeeToGroup(groupId, {
      id: manualId('manual-employee', name),
      memberCode: 'MANUAL',
      fullName: name,
      position: '',
      department: '',
      manual: true,
    });
  };

  const removePerson = (groupId: string, personType: PersonType, personId: string) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      if (personType === 'engineer') {
        const nextEngineers = getSelectedEngineers(group).filter((engineer) => engineer.id !== personId);
        return {
          ...group,
          engineerNames: nextEngineers.map((engineer) => engineer.fullName),
          engineerSnapshots: nextEngineers,
        };
      }
      return {
        ...group,
        employeeIds: group.employeeIds.filter((idValue) => idValue !== personId),
        employeeSnapshots: group.employeeSnapshots.filter((employee) => employee.id !== personId),
      };
    }));
  };

  const updatePersonPosition = (groupId: string, personType: PersonType, personId: string, position: string) => {
    if (readOnly) return;
    const cleanPosition = cleanText(position);
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      if (personType === 'engineer') {
        const nextEngineers = getSelectedEngineers(group).map((engineer) => (
          engineer.id === personId
            ? { ...engineer, position: cleanPosition, assignmentPosition: cleanPosition }
            : engineer
        ));
        return {
          ...group,
          engineerNames: nextEngineers.map((engineer) => engineer.fullName),
          engineerSnapshots: nextEngineers,
        };
      }
      const existing = group.employeeSnapshots.find((employee) => employee.id === personId)
        || employeeById.get(personId);
      if (!existing) return group;
      const nextSnapshot = {
        ...snapshotPerson(existing),
        position: cleanPosition,
        assignmentPosition: cleanPosition,
        originalPosition: existing.originalPosition || existing.position || '',
      };
      return {
        ...group,
        employeeSnapshots: [
          ...group.employeeSnapshots.filter((employee) => employee.id !== personId),
          nextSnapshot,
        ],
      };
    }));
  };

  const openPositionEditor = (groupId: string, personType: PersonType, person: WpEmployee) => {
    if (readOnly) return;
    const position = person.assignmentPosition || person.position || '';
    setEditingPerson({
      groupId,
      personType,
      personId: person.id,
      name: displayPersonName(person.fullName),
      position,
      department: person.department || '',
    });
    setPositionDraft(position);
    setPositionQuery('');
  };

  const savePositionEdit = () => {
    if (!editingPerson) return;
    updatePersonPosition(editingPerson.groupId, editingPerson.personType, editingPerson.personId, positionDraft);
    setEditingPerson(null);
  };

  const reorderPerson = (groupId: string, personType: PersonType, fromId: string, toId: string) => {
    if (readOnly || fromId === toId) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      if (personType === 'engineer') {
        const current = getSelectedEngineers(group);
        const fromIndex = current.findIndex((person) => person.id === fromId);
        const toIndex = current.findIndex((person) => person.id === toId);
        if (fromIndex < 0 || toIndex < 0) return group;
        const next = [...current];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...group, engineerNames: next.map((person) => person.fullName), engineerSnapshots: next };
      }
      const fromIndex = group.employeeIds.indexOf(fromId);
      const toIndex = group.employeeIds.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return group;
      const nextIds = [...group.employeeIds];
      const [moved] = nextIds.splice(fromIndex, 1);
      nextIds.splice(toIndex, 0, moved);
      return { ...group, employeeIds: nextIds };
    }));
  };

  const onDragStart = (event: DragEvent, info: DragInfo) => {
    if (readOnly) return;
    event.dataTransfer.effectAllowed = 'move';
    setDragInfo(info);
  };

  const onDropPerson = (event: DragEvent, target: DragInfo) => {
    event.preventDefault();
    if (!dragInfo || dragInfo.groupId !== target.groupId || dragInfo.personType !== target.personType) return;
    reorderPerson(target.groupId, target.personType, dragInfo.personId, target.personId);
    setDragInfo(null);
  };

  const onTouchStartPerson = (event: TouchEvent, info: DragInfo) => {
    if (readOnly) return;
    const touch = event.touches[0];
    setTouchInfo({ ...info, x: touch.clientX, y: touch.clientY });
  };

  const onTouchEndPerson = (event: TouchEvent, person: WpEmployee) => {
    if (!touchInfo) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchInfo.x;
    const dy = touch.clientY - touchInfo.y;
    const horizontal = Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.25;
    if (horizontal) {
      if (dx > 0) {
        removePerson(touchInfo.groupId, touchInfo.personType, touchInfo.personId);
      } else {
        openPositionEditor(touchInfo.groupId, touchInfo.personType, person);
      }
    }
    setTouchInfo(null);
  };

  const toggleDeptFilter = (personType: PersonType, department: string) => {
    const setter = personType === 'engineer' ? setEngineerDeptFilters : setEmployeeDeptFilters;
    setter((prev) => prev.includes(department)
      ? prev.filter((entry) => entry !== department)
      : [...prev, department]);
  };

  const clearDeptFilters = (personType: PersonType) => {
    if (personType === 'engineer') setEngineerDeptFilters([]);
    else setEmployeeDeptFilters([]);
  };

  const validate = () => {
    if (!workDate) return 'تاريخ العمل مطلوب.';
    if (!groups.length) return 'أضف مجموعة واحدة على الأقل.';
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const label = group.projectCode ? cleanText(group.projectCode) : `مجموعة ${i + 1}`;
      if (!cleanText(group.projectCode)) return `${label}: المشروع مطلوب.`;
      if (!isEnglishProjectText(group.projectCode)) return `${label}: يجب كتابة اسم المشروع باللغة الإنجليزية.`;
      if (!getSelectedEngineers(group).length) return `${label}: اختر أو اكتب مهندس واحد على الأقل.`;
      if (!group.employeeIds.length) return `${label}: اختر أو اكتب موظف واحد على الأقل.`;
    }
    return null;
  };

  const buildGroupsPayload = () => {
    return groups.map((group) => {
      const engineersPayload = getSelectedEngineers(group).map(snapshotPerson);
      const employeesPayload = getSelectedEmployees(group).map(snapshotPerson);
      return {
        id: group.id,
        projectCode: cleanText(group.projectCode),
        projectName: '',
        engineerNames: engineersPayload.map((engineer) => engineer.fullName),
        engineerSnapshots: engineersPayload,
        employeeIds: employeesPayload.map((employee) => employee.id),
        employeeSnapshots: employeesPayload,
      };
    });
  };

  const savePlan = async (nextStatus: WpPlanStatus) => {
    if (!user?.uid || readOnly) return;
    setError(null);
    setSuccess(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      const groupsPayload = buildGroupsPayload();
      const ownerUid = isEdit && planOwner?.createdByUid ? planOwner.createdByUid : user.uid;
      const ownerInfo = isEdit && planOwner?.createdBy
        ? planOwner.createdBy
        : {
            uid: user.uid,
            email: user.email || null,
            fullName: fullName || null,
          };
      const fallbackName = user.email?.split('@')[0] || 'Coordinator';
      const coordinatorNameEn = toEnglishName(String(ownerInfo.fullName || ''), fallbackName);
      const basePayload = {
        workDate,
        status: nextStatus,
        groups: groupsPayload,
        sourcePlanId: sourcePlanId || null,
        coordinatorNameEn,
        createdByUid: ownerUid,
        createdBy: ownerInfo,
        updatedAt: serverTimestamp(),
        ...(nextStatus === 'SUBMITTED' ? { submittedAt: serverTimestamp() } : {}),
      };

      if (isEdit && id) {
        await updateDoc(doc(db, WP_WORK_PLANS_COLLECTION, id), basePayload);
        setStatus(nextStatus);
        setGroups(groupsPayload.map((group, index) => ({ ...group, collapsed: index > 0 })));
        setSuccess(nextStatus === 'SUBMITTED' ? 'تم إرسال خطة العمل.' : 'تم حفظ المسودة.');
        if (nextStatus === 'SUBMITTED') nav('/wp');
      } else {
        const monthKey = monthKeyFromDate(workDate);
        const planId = await runTransaction(db, async (tx) => {
          const counterRef = doc(db, WP_COUNTERS_COLLECTION, `wp-${monthKey}`);
          const counterSnap = await tx.get(counterRef);
          const next = counterSnap.exists() ? Number((counterSnap.data() as any).next || 1) : 1;
          const seq = Math.max(1, next);
          const generatedCode = makePlanCode(monthKey, seq);
          const newPlanId = generatedCode.toLowerCase();
          const planRef = doc(db, WP_WORK_PLANS_COLLECTION, newPlanId);
          tx.set(counterRef, {
            next: seq + 1,
            monthKey,
            updatedAt: serverTimestamp(),
          }, { merge: true });
          tx.set(planRef, {
            ...basePayload,
            planCode: generatedCode,
            sequenceNo: seq,
            createdAt: serverTimestamp(),
          });
          return newPlanId;
        });
        if (nextStatus === 'SUBMITTED') {
          nav('/wp');
        } else {
          nav(`/wp/${planId}`, { replace: true });
        }
      }
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        setError('لا توجد صلاحية للحفظ. تأكد من نشر قواعد Firestore الخاصة بخطط العمل.');
      } else {
        setError('تعذر حفظ خطة العمل.');
      }
    } finally {
      setBusy(false);
    }
  };

  const renderDeptPicker = (groupId: string, personType: PersonType) => {
    const pickerKey = `${personType}-${groupId}`;
    if (!deptPickerOpen[pickerKey]) return null;
    const departments = personType === 'engineer' ? engineerDepartments : employeeDepartments;
    const selected = personType === 'engineer' ? engineerDeptFilters : employeeDeptFilters;
    return (
      <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-gray-500">الأقسام</div>
          <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => clearDeptFilters(personType)}>مسح</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {departments.map((department) => {
            const active = selected.includes(department);
            return (
              <button
                key={department}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}
                onClick={() => toggleDeptFilter(personType, department)}
              >
                {displayDepartment(department)}
              </button>
            );
          })}
          {!departments.length && <div className="text-sm text-gray-500">لا توجد أقسام.</div>}
        </div>
      </div>
    );
  };

  const renderPicker = (group: WpAssignmentGroup, personType: PersonType, groupIndex: number) => {
    const isEngineer = personType === 'engineer';
    const pickerKey = `${personType}-${group.id}`;
    const value = isEngineer ? engineerSearch[group.id] || '' : employeeSearch[group.id] || '';
    const setValue = isEngineer ? setEngineerSearch : setEmployeeSearch;
    const filters = isEngineer ? engineerDeptFilters : employeeDeptFilters;
    const people = getPeopleResults(group, personType);
    const grouped = groupPeopleByDepartment(people);
    return (
      <div className="space-y-2">
        {!readOnly && (
          <>
            <div className="relative">
              <input
                className="input w-full pr-20"
                value={value}
                placeholder={isEngineer ? 'ابحث أو اكتب اسم مهندس' : 'ابحث أو اكتب اسم موظف'}
                onFocus={() => setActiveDropdown(pickerKey)}
                onChange={(event) => {
                  setActiveDropdown(pickerKey);
                  setValue((prev) => ({ ...prev, [group.id]: event.target.value }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (isEngineer) addTypedEngineer(group.id);
                    else addTypedEmployee(group.id);
                  }
                }}
              />
              {value && (
                <button
                  type="button"
                  className="absolute right-11 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-gray-100"
                  onClick={() => setValue((prev) => ({ ...prev, [group.id]: '' }))}
                  aria-label="مسح"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className={`absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-full ${filters.length ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-500'}`}
                onClick={() => setDeptPickerOpen((prev) => ({ ...prev, [pickerKey]: !prev[pickerKey] }))}
                aria-label="فلترة الأقسام"
              >
                <Filter className="h-4 w-4" />
              </button>
            </div>
            {renderDeptPicker(group.id, personType)}
            {activeDropdown === pickerKey && (
              <div className="max-h-72 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
                {grouped.map(([department, entries]) => (
                  <div key={department}>
                    <div className="sticky top-0 bg-slate-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">
                      {department}
                    </div>
                    {entries.map((person) => {
                      const usage = personType === 'employee' ? employeeUseMap.get(person.id) : null;
                      const usedElsewhere = !!usage && usage.groups.some((label) => label !== `Group ${groupIndex + 1}`);
                      return (
                        <button
                          key={person.id}
                          type="button"
                          className={`w-full text-left px-3 py-2 border-b border-gray-50 last:border-b-0 ${usedElsewhere ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-blue-50'}`}
                          onClick={() => {
                            if (isEngineer) addEngineerToGroup(group.id, person);
                            else addEmployeeToGroup(group.id, person);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 break-words">{displayPersonName(person.fullName)}</div>
                              <div className="text-xs text-gray-500 break-words">
                                {displayPosition(person.position)} - {displayDepartment(person.department)}
                              </div>
                            </div>
                            {usedElsewhere && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">مستخدم</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {people.length === 0 && (
                  <div className="px-3 py-3 text-sm text-gray-500">
                    اضغط Enter لإضافة {isEngineer ? 'المهندس' : 'الموظف'} المكتوب.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderSelectedPerson = (groupId: string, personType: PersonType, person: WpEmployee) => {
    const duplicate = personType === 'employee' && (employeeUseMap.get(person.id)?.count || 0) > 1;
    const position = person.assignmentPosition || person.position || 'بدون منصب';
    const dragTarget = { groupId, personType, personId: person.id };
    return (
      <div
        key={person.id}
        draggable={!readOnly}
        onDragStart={(event) => onDragStart(event, dragTarget)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onDropPerson(event, dragTarget)}
        onTouchStart={(event) => onTouchStartPerson(event, dragTarget)}
        onTouchEnd={(event) => onTouchEndPerson(event, person)}
        className={`rounded-2xl border px-3 py-2 ${duplicate ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
      >
        <div className="flex items-center gap-2">
          {!readOnly && <GripVertical className="h-5 w-5 shrink-0 text-gray-400 cursor-grab" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 break-words">{displayPersonName(person.fullName)}</div>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${positionClass(position)}`}>
            {displayPosition(position)}
          </span>
          {!readOnly && (
            <div className="hidden sm:flex items-center gap-1">
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50"
                onClick={() => openPositionEditor(groupId, personType, person)}
                aria-label="تعديل المنصب"
              >
                <Pencil className="h-4 w-4 text-blue-600" />
              </button>
              <button
                type="button"
                className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => removePerson(groupId, personType, person.id)}
                aria-label="حذف"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const filteredPositionSuggestions = positionSuggestions
    .filter((position) => {
      const query = positionQuery.toLowerCase().trim();
      return !query || position.toLowerCase().includes(query) || displayPosition(position).toLowerCase().includes(query);
    })
    .slice(0, 20);

  if (loading) return <div className="card p-6">جاري التحميل...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">{title}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => nav('/wp')}>رجوع</button>
          {isEdit && (
            <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => nav(`/wp/new?copy=${id}`)}>
              <Copy className="h-4 w-4 icon-blue" />
              <span>نسخ كخطة جديدة</span>
            </button>
          )}
        </div>
      </div>

      {sourcePlanId && !isEdit && (
        <div className="card p-3 text-sm text-blue-700 bg-blue-50 border-blue-100">
          تم النسخ من خطة سابقة. راجع التاريخ والتوزيع قبل الحفظ.
        </div>
      )}

      <div className="card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">رقم الخطة</div>
            <div className="text-xl font-semibold text-gray-900 break-words">{planCode || 'خطة جديدة'}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`badge ${status === 'SUBMITTED' ? 'status-ready' : 'status-partially_approved'}`}>{statusLabel(status)}</span>
            <span className="badge border-gray-200 bg-gray-50 text-gray-700">{displayCoordinatorLabel}</span>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">تاريخ العمل</label>
          <input
            type="date"
            className="input w-full sm:max-w-xs"
            value={workDate}
            disabled={readOnly}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </div>
      </div>

      <datalist id="wp-project-options">
        {projects.map((project) => (
          <option key={project.id} value={projectDisplayName(project)} />
        ))}
      </datalist>

      <div className="space-y-3">
        {groups.map((group, index) => {
          const selectedEngineers = getSelectedEngineers(group);
          const selectedEmployees = getSelectedEmployees(group);
          const groupTitle = cleanText(group.projectCode) || `مجموعة ${index + 1}`;
          return (
            <div key={group.id} className="card p-0 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggleGroup(group.id)}>
                  <div className="text-base font-semibold text-gray-900 truncate">{groupTitle}</div>
                </button>
                <div className="flex items-center gap-2">
                  {!readOnly && groups.length > 1 && (
                    <button type="button" className="btn-ghost text-red-600" onClick={() => removeGroup(group.id)} aria-label="حذف المجموعة">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => toggleGroup(group.id)}>
                    <span className="text-sm">{group.collapsed ? 'إظهار' : 'إخفاء'}</span>
                    <ChevronDown className={`h-4 w-4 icon-blue transition-transform ${group.collapsed ? '' : 'rotate-180'}`} />
                  </button>
                </div>
              </div>

              {!group.collapsed && (
                <div className="px-4 pb-4 space-y-5 border-t border-gray-100">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">المشروع</label>
                    <input
                      className="input w-full"
                      list="wp-project-options"
                      value={group.projectCode}
                      disabled={readOnly}
                      placeholder="اسم المشروع بالإنجليزية"
                      onChange={(e) => updateGroup(group.id, { projectCode: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs text-gray-500">المهندسين</label>
                    {renderPicker(group, 'engineer', index)}
                    <div className="space-y-2">
                      {selectedEngineers.map((engineer) => renderSelectedPerson(group.id, 'engineer', engineer))}
                      {selectedEngineers.length === 0 && <div className="text-sm text-gray-500">لم يتم اختيار مهندسين.</div>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs text-gray-500">الموظفين</label>
                    {renderPicker(group, 'employee', index)}
                    <div className="space-y-2">
                      {selectedEmployees.map((employee) => renderSelectedPerson(group.id, 'employee', employee))}
                      {selectedEmployees.length === 0 && <div className="text-sm text-gray-500">لم يتم اختيار موظفين.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <button type="button" className="btn-ghost w-full inline-flex items-center justify-center gap-2" onClick={addGroup}>
          <Plus className="h-4 w-4 icon-blue" />
          <span>إضافة مجموعة</span>
        </button>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="text-sm text-green-600">{success}</div>}

      <div className="flex flex-col sm:flex-row justify-end gap-2 pb-8">
        {!readOnly && (
          <>
            <button type="button" className="btn-ghost disabled:opacity-50" disabled={busy} onClick={() => savePlan('DRAFT')}>
              {busy ? 'جاري الحفظ...' : 'حفظ مسودة'}
            </button>
            <button type="button" className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-50" disabled={busy} onClick={() => savePlan('SUBMITTED')}>
              <Send className="h-4 w-4" />
              <span>{busy ? 'جاري الإرسال...' : 'إرسال'}</span>
            </button>
          </>
        )}
      </div>

      {editingPerson && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-semibold text-gray-900 break-words">{editingPerson.name}</div>
                {editingPerson.department && <div className="text-xs text-gray-500">{displayDepartment(editingPerson.department)}</div>}
              </div>
              <button type="button" className="btn-ghost" onClick={() => setEditingPerson(null)} aria-label="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">المنصب</label>
              <input
                className="input w-full"
                value={positionDraft}
                onChange={(event) => {
                  setPositionDraft(event.target.value);
                  setPositionQuery(event.target.value);
                }}
                autoFocus
              />
            </div>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {filteredPositionSuggestions.map((position) => {
                const selected = positionDraft.split('/').map((part) => cleanText(part)).includes(position);
                return (
                  <button
                    key={position}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${selected ? positionClass(position) : 'border-gray-200 bg-white text-gray-600'}`}
                    onClick={() => {
                      setPositionDraft((prev) => {
                        const parts = prev.split('/').map((part) => cleanText(part)).filter(Boolean);
                        if (parts.includes(position)) return parts.filter((part) => part !== position).join(' / ');
                        return [...parts, position].join(' / ');
                      });
                    }}
                  >
                    {displayPosition(position)}
                  </button>
                );
              })}
              {!filteredPositionSuggestions.length && <div className="text-sm text-gray-500">لا توجد مناصب محفوظة.</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditingPerson(null)}>إلغاء</button>
              <button type="button" className="btn-primary" onClick={savePositionEdit}>حفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
