import { useEffect, useMemo, useState } from 'react';
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
import { ChevronDown, Copy, Plus, Trash2, X } from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  makeWpGroup,
  todayYmd,
  WP_COUNTERS_COLLECTION,
  WP_EMPLOYEE_SEED,
  WP_WORK_PLANS_COLLECTION,
  type WpAssignmentGroup,
  type WpEmployee,
  type WpPlanDoc,
  type WpPlanStatus,
} from '../lib/wpTypes';

type Project = { id: string; nameAr?: string; nameEn?: string; name?: string };
type Engineer = { id: string; nameAr?: string; nameEn?: string };
type EngineerCandidate = { id: string; name: string; position?: string; department?: string };

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function employeeHaystack(employee: WpEmployee) {
  return [
    employee.fullName,
    employee.memberCode,
    employee.position || '',
    employee.assignmentPosition || '',
    employee.department || '',
  ].join(' ').toLowerCase();
}

function splitNames(value: string): string[] {
  return value
    .split(/[;,،\n]/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function splitNameTokens(value: string): string[] {
  return value
    .split(/[;,\u060C\n]/)
    .map((part) => cleanText(part))
    .filter(Boolean);
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

function slugify(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'coordinator';
}

function manualEmployeeId(name: string) {
  return `manual-${cleanText(name).toLowerCase()}`;
}

function normalizeEngineerNames(value: any): string[] {
  if (Array.isArray(value)) return value.map((entry) => cleanText(String(entry || ''))).filter(Boolean);
  if (typeof value === 'string') return splitNameTokens(value);
  return [];
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
  const [workDate, setWorkDate] = useState(todayYmd());
  const [status, setStatus] = useState<WpPlanStatus>('DRAFT');
  const [groups, setGroups] = useState<WpAssignmentGroup[]>([makeWpGroup()]);
  const [employees] = useState<WpEmployee[]>(WP_EMPLOYEE_SEED);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [planOwner, setPlanOwner] = useState<{ createdByUid?: string; createdBy?: WpPlanDoc['createdBy'] } | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState<Record<string, string>>({});
  const [engineerDraft, setEngineerDraft] = useState<Record<string, string>>({});
  const [manualName, setManualName] = useState<Record<string, string>>({});
  const [manualPosition, setManualPosition] = useState<Record<string, string>>({});
  const [manualDepartment, setManualDepartment] = useState<Record<string, string>>({});
  const [employeeDeptFilter, setEmployeeDeptFilter] = useState(() => typeof savedEditorFilters.employeeDeptFilter === 'string' ? savedEditorFilters.employeeDeptFilter : '');
  const [employeePositionFilter, setEmployeePositionFilter] = useState(() => typeof savedEditorFilters.employeePositionFilter === 'string' ? savedEditorFilters.employeePositionFilter : '');
  const [employeeSortKey, setEmployeeSortKey] = useState<'name' | 'position' | 'department'>(() => (
    ['name', 'position', 'department'].includes(savedEditorFilters.employeeSortKey) ? savedEditorFilters.employeeSortKey : 'name'
  ));
  const [engineerDeptFilter, setEngineerDeptFilter] = useState(() => typeof savedEditorFilters.engineerDeptFilter === 'string' ? savedEditorFilters.engineerDeptFilter : '');
  const [engineerPositionFilter, setEngineerPositionFilter] = useState(() => typeof savedEditorFilters.engineerPositionFilter === 'string' ? savedEditorFilters.engineerPositionFilter : '');
  const [engineerSortKey, setEngineerSortKey] = useState<'name' | 'position' | 'department'>(() => (
    ['name', 'position', 'department'].includes(savedEditorFilters.engineerSortKey) ? savedEditorFilters.engineerSortKey : 'name'
  ));
  const [sourcePlanId, setSourcePlanId] = useState<string | null>(copyId || null);
  const [loading, setLoading] = useState(!!id || !!copyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const readOnly = isEdit && status === 'SUBMITTED';
  const title = isEdit ? (readOnly ? 'View Work Plan' : 'Edit Work Plan') : 'New Work Plan';

  useEffect(() => {
    try {
      localStorage.setItem('rakWp.editor.filters', JSON.stringify({
        employeeDeptFilter,
        employeePositionFilter,
        employeeSortKey,
        engineerDeptFilter,
        engineerPositionFilter,
        engineerSortKey,
      }));
    } catch {}
  }, [employeeDeptFilter, employeePositionFilter, employeeSortKey, engineerDeptFilter, engineerPositionFilter, engineerSortKey]);

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
          setError('Work plan not found.');
          return;
        }
        const data = { id: snap.id, ...(snap.data() as any) } as WpPlanDoc;
        setPlanCode(copyId ? '' : (data.planCode || data.id || ''));
        setCoordinatorNameEn(copyId ? '' : (data.coordinatorNameEn || ''));
        setWorkDate(copyId ? todayYmd() : (data.workDate || todayYmd()));
        setStatus(copyId ? 'DRAFT' : (data.status || 'DRAFT'));
        setSourcePlanId(copyId ? data.id : (data.sourcePlanId || null));
        setPlanOwner(copyId ? null : { createdByUid: data.createdByUid, createdBy: data.createdBy });
        const loadedGroups = Array.isArray(data.groups) && data.groups.length
          ? data.groups.map((group) => ({
              id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              projectCode: group.projectCode || '',
              projectName: group.projectName || '',
              engineerNames: normalizeEngineerNames(group.engineerNames),
              employeeIds: Array.isArray(group.employeeIds) ? group.employeeIds : [],
              employeeSnapshots: Array.isArray(group.employeeSnapshots)
                ? group.employeeSnapshots.map((employee) => ({
                    ...employee,
                    originalPosition: employee.originalPosition || employee.position || '',
                    assignmentPosition: employee.assignmentPosition || employee.position || '',
                  }))
                : [],
              collapsed: false,
            }))
          : [makeWpGroup()];
        setGroups(loadedGroups);
      } catch (err: any) {
        setError(err?.code === 'permission-denied'
          ? 'Permission denied. Publish the RAK WP Firestore rules before using this page.'
          : (err?.message || 'Failed to load work plan.'));
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

  const employeeDepartments = useMemo(() => (
    Array.from(new Set(employees.map((employee) => employee.department || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [employees]);

  const employeePositions = useMemo(() => (
    Array.from(new Set(employees.map((employee) => employee.position || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [employees]);

  const engineerCandidates = useMemo(() => {
    const map = new Map<string, EngineerCandidate>();
    engineers.forEach((engineer) => {
      const name = cleanText(engineer.nameEn || engineer.nameAr || engineer.id);
      if (!name) return;
      map.set(name.toLowerCase(), { id: `engineer-${engineer.id}`, name, position: 'Engineer', department: '' });
    });
    employees.forEach((employee) => {
      const position = employee.position || '';
      const name = employee.fullName || '';
      if (!/engineer/i.test(`${position} ${name}`)) return;
      const key = name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: `employee-${employee.id}`,
          name,
          position,
          department: employee.department || '',
        });
      }
    });
    return Array.from(map.values());
  }, [engineers, employees]);

  const engineerDepartments = useMemo(() => (
    Array.from(new Set(engineerCandidates.map((engineer) => engineer.department || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [engineerCandidates]);

  const engineerPositions = useMemo(() => (
    Array.from(new Set(engineerCandidates.map((engineer) => engineer.position || '').filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [engineerCandidates]);

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
    setGroups((prev) => [...prev, makeWpGroup()]);
  };

  const removeGroup = (groupId: string) => {
    if (readOnly) return;
    setGroups((prev) => prev.length <= 1 ? prev : prev.filter((group) => group.id !== groupId));
  };

  const toggleGroup = (groupId: string) => {
    setGroups((prev) => prev.map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group));
  };

  const addEngineerName = (groupId: string, name: string) => {
    if (readOnly) return;
    const cleanName = cleanText(name);
    if (!cleanName) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const merged = Array.from(new Set([...(group.engineerNames || []), cleanName]));
      return { ...group, engineerNames: merged };
    }));
    setEngineerDraft((prev) => ({ ...prev, [groupId]: '' }));
  };

  const addEngineer = (groupId: string) => {
    if (readOnly) return;
    const names = splitNameTokens(engineerDraft[groupId] || '');
    if (!names.length) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const merged = Array.from(new Set([...(group.engineerNames || []), ...names]));
      return { ...group, engineerNames: merged };
    }));
    setEngineerDraft((prev) => ({ ...prev, [groupId]: '' }));
  };

  const getEngineerResults = (group: WpAssignmentGroup) => {
    const selected = new Set(group.engineerNames.map((name) => name.toLowerCase()));
    const queryText = (engineerDraft[group.id] || '').toLowerCase().trim();
    const tokens = queryText.split(/\s+/).filter(Boolean);
    const filtered = engineerCandidates
      .filter((engineer) => !selected.has(engineer.name.toLowerCase()))
      .filter((engineer) => !engineerDeptFilter || engineer.department === engineerDeptFilter)
      .filter((engineer) => !engineerPositionFilter || engineer.position === engineerPositionFilter)
      .filter((engineer) => {
        if (!tokens.length) return true;
        const hay = [engineer.name, engineer.position || '', engineer.department || ''].join(' ').toLowerCase();
        return tokens.every((token) => hay.includes(token));
      });
    filtered.sort((a, b) => {
      if (engineerSortKey === 'position') {
        const cmp = (a.position || '').localeCompare(b.position || '');
        if (cmp) return cmp;
      }
      if (engineerSortKey === 'department') {
        const cmp = (a.department || '').localeCompare(b.department || '');
        if (cmp) return cmp;
      }
      return a.name.localeCompare(b.name);
    });
    return filtered.slice(0, 40);
  };

  const removeEngineer = (groupId: string, name: string) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((group) => (
      group.id === groupId
        ? { ...group, engineerNames: group.engineerNames.filter((entry) => entry !== name) }
        : group
    )));
  };

  const snapshotEmployee = (employee: WpEmployee): WpEmployee => ({
    id: employee.id,
    memberCode: employee.memberCode,
    fullName: employee.fullName,
    position: employee.assignmentPosition || employee.position || '',
    assignmentPosition: employee.assignmentPosition || employee.position || '',
    originalPosition: employee.originalPosition || employee.position || '',
    department: employee.department || '',
    manual: !!employee.manual,
  });

  const addEmployeeToGroup = (groupId: string, employee: WpEmployee) => {
    if (readOnly) return;
    const snapshot = snapshotEmployee(employee);
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId || group.employeeIds.includes(snapshot.id)) return group;
      return {
        ...group,
        employeeIds: [...group.employeeIds, snapshot.id],
        employeeSnapshots: [...group.employeeSnapshots.filter((e) => e.id !== snapshot.id), snapshot],
      };
    }));
    setEmployeeSearch((prev) => ({ ...prev, [groupId]: '' }));
  };

  const addManualEmployeeToGroup = (groupId: string) => {
    if (readOnly) return;
    const name = cleanText(manualName[groupId] || '');
    if (!name) return;
    const position = cleanText(manualPosition[groupId] || '');
    const department = cleanText(manualDepartment[groupId] || '');
    const employee: WpEmployee = {
      id: manualEmployeeId(name),
      memberCode: 'MANUAL',
      fullName: name,
      position,
      assignmentPosition: position,
      originalPosition: position,
      department,
      manual: true,
    };
    addEmployeeToGroup(groupId, employee);
    setManualName((prev) => ({ ...prev, [groupId]: '' }));
    setManualPosition((prev) => ({ ...prev, [groupId]: '' }));
    setManualDepartment((prev) => ({ ...prev, [groupId]: '' }));
  };

  const removeEmployeeFromGroup = (groupId: string, employeeId: string) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        employeeIds: group.employeeIds.filter((idValue) => idValue !== employeeId),
        employeeSnapshots: group.employeeSnapshots.filter((employee) => employee.id !== employeeId),
      };
    }));
  };

  const updateEmployeePosition = (groupId: string, employeeId: string, position: string) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId) return group;
      const existing = group.employeeSnapshots.find((employee) => employee.id === employeeId)
        || employeeById.get(employeeId);
      if (!existing) return group;
      const nextSnapshot = {
        ...snapshotEmployee(existing),
        position,
        assignmentPosition: position,
        originalPosition: existing.originalPosition || existing.position || '',
      };
      return {
        ...group,
        employeeSnapshots: [
          ...group.employeeSnapshots.filter((employee) => employee.id !== employeeId),
          nextSnapshot,
        ],
      };
    }));
  };

  const getSelectedEmployees = (group: WpAssignmentGroup) => {
    return group.employeeIds.map((employeeId) => {
      const snapshot = group.employeeSnapshots.find((employee) => employee.id === employeeId);
      const base = employeeById.get(employeeId);
      if (!snapshot && !base) return null;
      return {
        ...(base || {}),
        ...(snapshot || {}),
        id: employeeId,
        memberCode: snapshot?.memberCode || base?.memberCode || '',
        fullName: snapshot?.fullName || base?.fullName || '',
        position: snapshot?.assignmentPosition || snapshot?.position || base?.position || '',
        assignmentPosition: snapshot?.assignmentPosition || snapshot?.position || base?.position || '',
        originalPosition: snapshot?.originalPosition || base?.position || snapshot?.position || '',
        department: snapshot?.department || base?.department || '',
      } as WpEmployee;
    }).filter(Boolean) as WpEmployee[];
  };

  const getEmployeeResults = (group: WpAssignmentGroup) => {
    const selectedInCurrent = new Set(group.employeeIds);
    const queryText = (employeeSearch[group.id] || '').toLowerCase().trim();
    const tokens = queryText.split(/\s+/).filter(Boolean);
    const available = employees
      .filter((employee) => !selectedInCurrent.has(employee.id))
      .filter((employee) => !employeeDeptFilter || employee.department === employeeDeptFilter)
      .filter((employee) => !employeePositionFilter || employee.position === employeePositionFilter);
    const filtered = !tokens.length
      ? available
      : available
      .filter((employee) => {
        const hay = employeeHaystack(employee);
        return tokens.every((token) => hay.includes(token));
      });
    filtered.sort((a, b) => {
      if (employeeSortKey === 'position') {
        const cmp = (a.position || '').localeCompare(b.position || '');
        if (cmp) return cmp;
      }
      if (employeeSortKey === 'department') {
        const cmp = (a.department || '').localeCompare(b.department || '');
        if (cmp) return cmp;
      }
      return a.fullName.localeCompare(b.fullName);
    });
    return filtered.slice(0, tokens.length ? 40 : 25);
  };

  const validate = () => {
    if (!workDate) return 'Work date is required.';
    if (!groups.length) return 'Add at least one group.';
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const label = `Group ${i + 1}`;
      if (!cleanText(group.projectCode)) return `${label}: project is required.`;
      if (!isEnglishProjectText(group.projectCode) || !isEnglishProjectText(group.projectName || '')) {
        return `${label}: project must be written in English.`;
      }
      if (!group.engineerNames.length) return `${label}: select or type at least one engineer.`;
      if (!group.employeeIds.length) return `${label}: select or type at least one employee.`;
    }
    return null;
  };

  const buildGroupsPayload = () => {
    return groups.map((group) => {
      const snapshots = getSelectedEmployees(group);
      return {
        id: group.id,
        projectCode: cleanText(group.projectCode),
        projectName: cleanText(group.projectName || ''),
        engineerNames: group.engineerNames.map(cleanText).filter(Boolean),
        employeeIds: snapshots.map((employee) => employee.id),
        employeeSnapshots: snapshots.map((employee) => {
          const effectivePosition = employee.assignmentPosition || employee.position || '';
          return {
            id: employee.id,
            memberCode: employee.memberCode,
            fullName: employee.fullName,
            position: effectivePosition,
            assignmentPosition: effectivePosition,
            originalPosition: employee.originalPosition || employee.position || '',
            department: employee.department || '',
            manual: !!employee.manual,
          };
        }),
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
        setGroups(groupsPayload.map((group) => ({ ...group, collapsed: false })));
        setSuccess(nextStatus === 'SUBMITTED' ? 'Work plan submitted.' : 'Draft saved.');
        if (nextStatus === 'SUBMITTED') nav('/wp');
      } else {
        const dateKey = workDate.replace(/-/g, '');
        const coordinatorSlug = slugify(coordinatorNameEn);
        const planId = await runTransaction(db, async (tx) => {
          const counterRef = doc(db, WP_COUNTERS_COLLECTION, `${coordinatorSlug}-${dateKey}`);
          const counterSnap = await tx.get(counterRef);
          const next = counterSnap.exists() ? Number((counterSnap.data() as any).next || 1) : 1;
          const seq = Math.max(1, next);
          const seqText = String(seq).padStart(3, '0');
          const newPlanId = `wp-${coordinatorSlug}-${dateKey}-${seqText}`;
          const planRef = doc(db, WP_WORK_PLANS_COLLECTION, newPlanId);
          tx.set(counterRef, {
            next: seq + 1,
            dateKey,
            coordinatorNameEn,
            updatedAt: serverTimestamp(),
          }, { merge: true });
          tx.set(planRef, {
            ...basePayload,
            planCode: `${coordinatorSlug.toUpperCase()}-${dateKey}-${seqText}`,
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
        setError('Permission denied. Publish the RAK WP Firestore rules before saving.');
      } else {
        setError(err?.message || 'Failed to save work plan.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="card p-6">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">{title}</div>
          <div className="text-sm text-gray-500">RAK WP</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => nav('/wp')}>Back</button>
          {isEdit && (
            <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => nav(`/wp/new?copy=${id}`)}>
              <Copy className="h-4 w-4 icon-blue" />
              <span>Copy as New</span>
            </button>
          )}
        </div>
      </div>

      {sourcePlanId && !isEdit && (
        <div className="card p-3 text-sm text-blue-700 bg-blue-50 border-blue-100">
          Copied from previous plan. Review the date and assignments before saving.
        </div>
      )}

      {isEdit && planCode && (
        <div className="card p-4">
          <div className="text-xs text-gray-500">Plan ID</div>
          <div className="text-xl font-semibold text-gray-900 break-words">{planCode}</div>
        </div>
      )}

      <div className="card p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Work date</label>
            <input
              type="date"
              className="input w-full"
              value={workDate}
              disabled={readOnly}
              onChange={(e) => setWorkDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <div className={`h-10 px-3 rounded-xl border flex items-center text-sm font-semibold ${status === 'SUBMITTED' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
              {status}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Coordinator</label>
            <div className="h-10 px-3 rounded-xl border border-gray-200 flex items-center text-sm text-gray-700 truncate">
              {displayCoordinatorName}
            </div>
          </div>
        </div>
      </div>

      <datalist id="wp-project-options">
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.nameEn || project.nameAr || project.name || project.id}
          </option>
        ))}
      </datalist>
      <datalist id="wp-engineer-options">
        {engineers.map((engineer) => (
          <option key={engineer.id} value={engineer.nameEn || engineer.nameAr || engineer.id} />
        ))}
      </datalist>

      <div className="space-y-3">
        {groups.map((group, index) => {
          const selectedEmployees = getSelectedEmployees(group);
          const employeeResults = getEmployeeResults(group);
          return (
            <div key={group.id} className="card p-0 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <button type="button" className="flex-1 text-left" onClick={() => toggleGroup(group.id)}>
                  <div className="text-base font-semibold">Group {index + 1}</div>
                  <div className="text-xs text-gray-500">
                    {group.projectCode || 'No project'} - {group.engineerNames.length} engineer{group.engineerNames.length === 1 ? '' : 's'} - {selectedEmployees.length} employee{selectedEmployees.length === 1 ? '' : 's'}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {!readOnly && groups.length > 1 && (
                    <button type="button" className="btn-ghost text-red-600" onClick={() => removeGroup(group.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button type="button" className="btn-ghost inline-flex items-center gap-2" onClick={() => toggleGroup(group.id)}>
                    <span className="text-sm">{group.collapsed ? 'Show' : 'Hide'}</span>
                    <ChevronDown className={`h-4 w-4 icon-blue transition-transform ${group.collapsed ? '' : 'rotate-180'}`} />
                  </button>
                </div>
              </div>

              {!group.collapsed && (
                <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Project</label>
                      <input
                        className="input w-full"
                        list="wp-project-options"
                        value={group.projectCode}
                        disabled={readOnly}
                        placeholder="Example: DS01"
                        onChange={(e) => updateGroup(group.id, { projectCode: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Project description</label>
                      <input
                        className="input w-full"
                        value={group.projectName || ''}
                        disabled={readOnly}
                        placeholder="English only"
                        onChange={(e) => updateGroup(group.id, { projectName: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Engineer(s)</label>
                    {!readOnly && (
                      <div className="space-y-2">
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <input
                            className="input w-full"
                            value={engineerDraft[group.id] || ''}
                            placeholder="Search or type engineer name"
                            onChange={(e) => setEngineerDraft((prev) => ({ ...prev, [group.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addEngineer(group.id);
                              }
                            }}
                          />
                          <button type="button" className="btn-primary" onClick={() => addEngineer(group.id)}>Add Typed</button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <select className="input" value={engineerDeptFilter} onChange={(e) => setEngineerDeptFilter(e.target.value)}>
                            <option value="">All departments</option>
                            {engineerDepartments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
                          </select>
                          <select className="input" value={engineerPositionFilter} onChange={(e) => setEngineerPositionFilter(e.target.value)}>
                            <option value="">All positions</option>
                            {engineerPositions.map((position) => <option key={position} value={position}>{position}</option>)}
                          </select>
                          <select className="input" value={engineerSortKey} onChange={(e) => setEngineerSortKey(e.target.value as any)}>
                            <option value="name">Sort by name</option>
                            <option value="position">Sort by position</option>
                            <option value="department">Sort by department</option>
                          </select>
                        </div>
                        <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-xl">
                          {getEngineerResults(group).map((engineer) => (
                            <button
                              key={engineer.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0"
                              onClick={() => addEngineerName(group.id, engineer.name)}
                            >
                              <div className="text-sm font-semibold text-gray-900">{engineer.name}</div>
                              <div className="text-xs text-gray-500">{engineer.position || '-'} - {engineer.department || '-'}</div>
                            </button>
                          ))}
                          {getEngineerResults(group).length === 0 && <div className="px-3 py-3 text-sm text-gray-500">No engineers found.</div>}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.engineerNames.map((name) => (
                        <span key={name} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                          <span>{name}</span>
                          {!readOnly && (
                            <button type="button" className="text-blue-500 hover:text-red-600" onClick={() => removeEngineer(group.id, name)}>
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </span>
                      ))}
                      {group.engineerNames.length === 0 && <div className="text-sm text-gray-500">No engineers selected.</div>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Employees</label>
                    {!readOnly && (
                      <input
                        className="input w-full"
                        value={employeeSearch[group.id] || ''}
                        placeholder="Search by name, code, department, or position"
                        onChange={(e) => setEmployeeSearch((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      />
                    )}

                    {!readOnly && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <select className="input" value={employeeDeptFilter} onChange={(e) => setEmployeeDeptFilter(e.target.value)}>
                          <option value="">All departments</option>
                          {employeeDepartments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
                        </select>
                        <select className="input" value={employeePositionFilter} onChange={(e) => setEmployeePositionFilter(e.target.value)}>
                          <option value="">All positions</option>
                          {employeePositions.map((position) => <option key={position} value={position}>{position}</option>)}
                        </select>
                        <select className="input" value={employeeSortKey} onChange={(e) => setEmployeeSortKey(e.target.value as any)}>
                          <option value="name">Sort by name</option>
                          <option value="position">Sort by position</option>
                          <option value="department">Sort by department</option>
                        </select>
                      </div>
                    )}

                    {!readOnly && (
                      <div className="mt-2 max-h-56 overflow-y-auto border border-gray-100 rounded-xl">
                        {employeeResults.map((employee) => {
                          const usage = employeeUseMap.get(employee.id);
                          const usedElsewhere = !!usage && usage.groups.some((label) => label !== `Group ${index + 1}`);
                          const rowClass = usedElsewhere
                            ? 'bg-amber-50 hover:bg-amber-100'
                            : 'hover:bg-blue-50';
                          return (
                            <button
                              key={employee.id}
                              type="button"
                              className={`w-full text-left px-3 py-2 border-b border-gray-50 last:border-b-0 ${rowClass}`}
                              onClick={() => addEmployeeToGroup(group.id, employee)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{employee.fullName}</div>
                                  <div className="text-xs text-gray-500">{employee.memberCode} - {employee.position || '-'} - {employee.department || '-'}</div>
                                </div>
                                {usedElsewhere && <span className="text-[11px] font-semibold text-amber-700">Already used</span>}
                              </div>
                            </button>
                          );
                        })}
                        {employeeResults.length === 0 && <div className="px-3 py-3 text-sm text-gray-500">No employees found.</div>}
                      </div>
                    )}

                    {!readOnly && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <input
                          className="input sm:col-span-2"
                          value={manualName[group.id] || ''}
                          placeholder="Manual employee name"
                          onChange={(e) => setManualName((prev) => ({ ...prev, [group.id]: e.target.value }))}
                        />
                        <input
                          className="input"
                          value={manualPosition[group.id] || ''}
                          placeholder="Position"
                          onChange={(e) => setManualPosition((prev) => ({ ...prev, [group.id]: e.target.value }))}
                        />
                        <div className="flex gap-2">
                          <input
                            className="input"
                            value={manualDepartment[group.id] || ''}
                            placeholder="Department"
                            onChange={(e) => setManualDepartment((prev) => ({ ...prev, [group.id]: e.target.value }))}
                          />
                          <button type="button" className="btn-primary" onClick={() => addManualEmployeeToGroup(group.id)}>Add</button>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {selectedEmployees.map((employee) => {
                        const usage = employeeUseMap.get(employee.id);
                        const duplicate = !!usage && usage.count > 1;
                        return (
                          <div
                            key={employee.id}
                            className={`rounded-xl border px-3 py-3 ${duplicate ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}
                          >
                            <div className="grid gap-3 sm:grid-cols-[1fr_180px_44px] sm:items-center">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900 break-words">{employee.fullName}</div>
                                <div className="text-xs text-gray-500 break-words">
                                  {employee.memberCode || '-'} - {employee.department || '-'}
                                  {duplicate ? ` - ${usage?.groups.join(', ')}` : ''}
                                </div>
                              </div>
                              <div>
                                <label className="block text-[11px] text-gray-500 mb-1">Position</label>
                                <input
                                  className="input w-full"
                                  value={employee.assignmentPosition || employee.position || ''}
                                  disabled={readOnly}
                                  onChange={(e) => updateEmployeePosition(group.id, employee.id, e.target.value)}
                                />
                              </div>
                              {!readOnly && (
                                <button type="button" className="btn-ghost text-red-600" onClick={() => removeEmployeeFromGroup(group.id, employee.id)}>
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {selectedEmployees.length === 0 && <div className="text-sm text-gray-500">No employees selected.</div>}
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
          <span>Add Group</span>
        </button>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="text-sm text-green-600">{success}</div>}

      <div className="flex flex-col sm:flex-row justify-end gap-2 pb-8">
        {!readOnly && (
          <>
            <button type="button" className="btn-ghost disabled:opacity-50" disabled={busy} onClick={() => savePlan('DRAFT')}>
              {busy ? 'Saving...' : 'Save Draft'}
            </button>
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy} onClick={() => savePlan('SUBMITTED')}>
              {busy ? 'Submitting...' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
