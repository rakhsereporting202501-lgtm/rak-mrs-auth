import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { Copy, Plus, Trash2, X } from 'lucide-react';
import { initFirebase } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  makeWpGroup,
  todayYmd,
  WP_EMPLOYEE_SEED,
  type WpAssignmentGroup,
  type WpEmployee,
  type WpPlanDoc,
  type WpPlanStatus,
} from '../lib/wpTypes';

type Project = { id: string; nameAr?: string; nameEn?: string; name?: string };
type Engineer = { id: string; nameAr?: string; nameEn?: string };

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function employeeHaystack(employee: WpEmployee) {
  return [
    employee.fullName,
    employee.memberCode,
    employee.position || '',
    employee.department || '',
  ].join(' ').toLowerCase();
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

  const [workDate, setWorkDate] = useState(todayYmd());
  const [status, setStatus] = useState<WpPlanStatus>('DRAFT');
  const [groups, setGroups] = useState<WpAssignmentGroup[]>([makeWpGroup()]);
  const [employees, setEmployees] = useState<WpEmployee[]>(WP_EMPLOYEE_SEED);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [planOwner, setPlanOwner] = useState<{ createdByUid?: string; createdBy?: WpPlanDoc['createdBy'] } | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState<Record<string, string>>({});
  const [sourcePlanId, setSourcePlanId] = useState<string | null>(copyId || null);
  const [loading, setLoading] = useState(!!id || !!copyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const readOnly = isEdit && status === 'SUBMITTED';
  const title = isEdit ? (readOnly ? 'View Work Plan' : 'Edit Work Plan') : 'New Work Plan';

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'wpEmployees'), (snap) => {
      if (snap.empty) return;
      const live = snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: data.id || data.memberCode || docSnap.id,
          memberCode: data.memberCode || docSnap.id,
          fullName: data.fullName || '',
          position: data.position || '',
          department: data.department || '',
        } as WpEmployee;
      }).filter((employee) => employee.fullName && employee.memberCode);
      if (live.length) setEmployees(live);
    }, (err) => {
      console.warn('WP employees collection unavailable; using seed data.', err);
    });
    return () => unsub();
  }, [db]);

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
        const snap = await getDoc(doc(db, 'wpPlans', loadId));
        if (!snap.exists()) {
          setError('Work plan not found.');
          return;
        }
        const data = { id: snap.id, ...(snap.data() as any) } as WpPlanDoc;
        setWorkDate(copyId ? todayYmd() : (data.workDate || todayYmd()));
        setStatus(copyId ? 'DRAFT' : (data.status || 'DRAFT'));
        setSourcePlanId(copyId ? data.id : (data.sourcePlanId || null));
        setPlanOwner(copyId ? null : { createdByUid: data.createdByUid, createdBy: data.createdBy });
        const loadedGroups = Array.isArray(data.groups) && data.groups.length
          ? data.groups.map((group) => ({
              id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              projectCode: group.projectCode || '',
              projectName: group.projectName || '',
              engineerNames: group.engineerNames || '',
              employeeIds: Array.isArray(group.employeeIds) ? group.employeeIds : [],
              employeeSnapshots: Array.isArray(group.employeeSnapshots) ? group.employeeSnapshots : [],
            }))
          : [makeWpGroup()];
        setGroups(loadedGroups);
      } catch (err: any) {
        setError(err?.message || 'Failed to load work plan.');
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

  const addEmployeeToGroup = (groupId: string, employee: WpEmployee) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((group) => {
      if (group.id !== groupId || group.employeeIds.includes(employee.id)) return group;
      return {
        ...group,
        employeeIds: [...group.employeeIds, employee.id],
        employeeSnapshots: [...group.employeeSnapshots.filter((e) => e.id !== employee.id), employee],
      };
    }));
    setEmployeeSearch((prev) => ({ ...prev, [groupId]: '' }));
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

  const getSelectedEmployees = (group: WpAssignmentGroup) => {
    return group.employeeIds.map((employeeId) => (
      employeeById.get(employeeId)
      || group.employeeSnapshots.find((employee) => employee.id === employeeId)
    )).filter(Boolean) as WpEmployee[];
  };

  const getEmployeeResults = (group: WpAssignmentGroup) => {
    const selected = new Set(group.employeeIds);
    const queryText = (employeeSearch[group.id] || '').toLowerCase().trim();
    const tokens = queryText.split(/\s+/).filter(Boolean);
    if (!tokens.length) return employees.filter((employee) => !selected.has(employee.id)).slice(0, 25);
    return employees
      .filter((employee) => !selected.has(employee.id))
      .filter((employee) => {
        const hay = employeeHaystack(employee);
        return tokens.every((token) => hay.includes(token));
      })
      .slice(0, 40);
  };

  const validate = () => {
    if (!workDate) return 'Work date is required.';
    if (!groups.length) return 'Add at least one group.';
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const label = `Group ${i + 1}`;
      if (!cleanText(group.projectCode)) return `${label}: project is required.`;
      if (!cleanText(group.engineerNames)) return `${label}: engineer is required.`;
      if (!group.employeeIds.length) return `${label}: select at least one employee.`;
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
        engineerNames: cleanText(group.engineerNames),
        employeeIds: snapshots.map((employee) => employee.id),
        employeeSnapshots: snapshots.map((employee) => ({
          id: employee.id,
          memberCode: employee.memberCode,
          fullName: employee.fullName,
          position: employee.position || '',
          department: employee.department || '',
        })),
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
      const payload = {
        workDate,
        status: nextStatus,
        groups: groupsPayload,
        sourcePlanId: sourcePlanId || null,
        createdByUid: ownerUid,
        createdBy: ownerInfo,
        updatedAt: serverTimestamp(),
        ...(nextStatus === 'SUBMITTED' ? { submittedAt: serverTimestamp() } : {}),
      };

      if (isEdit && id) {
        await updateDoc(doc(db, 'wpPlans', id), payload);
        setStatus(nextStatus);
        setGroups(groupsPayload);
        setSuccess(nextStatus === 'SUBMITTED' ? 'Work plan submitted.' : 'Draft saved.');
        if (nextStatus === 'SUBMITTED') nav('/wp');
      } else {
        const ref = doc(collection(db, 'wpPlans'));
        await setDoc(ref, {
          ...payload,
          createdAt: serverTimestamp(),
        });
        if (nextStatus === 'SUBMITTED') {
          nav('/wp');
        } else {
          nav(`/wp/${ref.id}`, { replace: true });
        }
      }
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        setError('Permission denied.');
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
              {fullName || user?.email || '-'}
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
            <div key={group.id} className="card p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">Group {index + 1}</div>
                  <div className="text-xs text-gray-500">{selectedEmployees.length} selected employee{selectedEmployees.length === 1 ? '' : 's'}</div>
                </div>
                {!readOnly && groups.length > 1 && (
                  <button type="button" className="btn-ghost text-red-600" onClick={() => removeGroup(group.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
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
                    placeholder="Optional"
                    onChange={(e) => updateGroup(group.id, { projectName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Engineer(s)</label>
                  <input
                    className="input w-full"
                    list="wp-engineer-options"
                    value={group.engineerNames}
                    disabled={readOnly}
                    placeholder="One or more engineers"
                    onChange={(e) => updateGroup(group.id, { engineerNames: e.target.value })}
                  />
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
                  <div className="mt-2 max-h-56 overflow-y-auto border border-gray-100 rounded-xl">
                    {employeeResults.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0"
                        onClick={() => addEmployeeToGroup(group.id, employee)}
                      >
                        <div className="text-sm font-semibold text-gray-900">{employee.fullName}</div>
                        <div className="text-xs text-gray-500">{employee.memberCode} - {employee.position || '-'} - {employee.department || '-'}</div>
                      </button>
                    ))}
                    {employeeResults.length === 0 && <div className="px-3 py-3 text-sm text-gray-500">No employees found.</div>}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedEmployees.map((employee) => (
                    <span key={employee.id} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white">
                      <span>
                        <span className="font-semibold">{employee.fullName}</span>
                        <span className="text-xs text-gray-500"> - {employee.memberCode}</span>
                      </span>
                      {!readOnly && (
                        <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => removeEmployeeFromGroup(group.id, employee.id)}>
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                  ))}
                  {selectedEmployees.length === 0 && <div className="text-sm text-gray-500">No employees selected.</div>}
                </div>
              </div>
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
