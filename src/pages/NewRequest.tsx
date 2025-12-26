import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import {
 getFirestore,
 collection,
 getDocs,
 getDoc,
 updateDoc,
 serverTimestamp,
 runTransaction,
 doc,
 setDoc,
} from 'firebase/firestore';
import type { DeptId, RequestStatus } from '../lib/types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, Trash2, ChevronDown, CheckCircle, AlertTriangle, XCircle, X } from 'lucide-react';

type Project = { id: string; nameAr?: string; nameEn?: string; name?: string; active?: boolean };
type Engineer = { id: string; nameAr?: string; nameEn?: string; active?: boolean };
type Item = {
 id: string;
 itemCode: string;
 nameAr?: string;
 nameEn?: string;
 descriptionAr?: string;
 descriptionEn?: string;
 unit: string;
 allowedUnits?: string[];
 ownerDeptId: DeptId;
};

type SelectedLine = {
 key: string;
 itemId: string;
 itemName: string;
 ownerDeptId: DeptId;
 unit: string;
 qty: number;
 status?: 'PENDING_OWNER' | 'OWNER_APPROVED' | 'OWNER_REJECTED' | string;
 ownerApprovedBy?: { uid?: string; fullName?: string; deptId?: string; atMs?: number | null; at?: any } | null;
 ownerRejectedBy?: { uid?: string; fullName?: string; deptId?: string; atMs?: number | null; at?: any } | null;
 deleted?: boolean;
 removedBy?: { uid?: string | null; fullName?: string | null; atMs?: number | null; at?: any } | null;
 lockedDeleted?: boolean;
 lockedRejected?: boolean;
};

type ActivityActor = {
 uid?: string | null;
 fullName?: string | null;
 deptId?: string | null;
};

type ActivityEntry = {
 id: string;
 type: string;
 summary: string;
 details?: string | null;
 actor?: ActivityActor | null;
 createdAt?: Date | null;
 statusKey?: string | null;
};

type PendingActivity = {
 type: string;
 summary: string;
 details?: string;
 statusKey?: string;
};

const LINE_STATUS_META = {
 OWNER_APPROVED: { label: 'Approved by owner', Icon: CheckCircle, wrapper: 'inline-flex items-center text-green-600', icon: 'h-4 w-4' },
 PENDING_OWNER: { label: 'Pending owner approval', Icon: AlertTriangle, wrapper: 'inline-flex items-center text-amber-500', icon: 'h-4 w-4' },
 OWNER_REJECTED: { label: 'Rejected by owner', Icon: XCircle, wrapper: 'inline-flex items-center justify-center h-5 w-5 rounded-full bg-red-600 text-white', icon: 'h-3.5 w-3.5' },
 DELETED: { label: 'Removed from request', Icon: Trash2, wrapper: 'inline-flex items-center justify-center h-5 w-5 rounded-full bg-white text-red-600 border border-red-200', icon: 'h-3.5 w-3.5' },
} as const;

const normalizeLineStatus = (line: SelectedLine) => {
 if (line.deleted) return 'DELETED';
 return String(line.status || 'PENDING_OWNER').toUpperCase();
};


const deriveLifecycleStatus = (lineSource: SelectedLine[], fallback: string = 'SUBMITTED') => {
 if (!lineSource.length) return 'CANCELED';
 const active = lineSource.filter(l => !l.deleted);
 if (!active.length) return 'CANCELED';

 const approvedCount = active.filter(l => normalizeLineStatus(l) === 'OWNER_APPROVED').length;
 const rejectedCount = active.filter(l => normalizeLineStatus(l) === 'OWNER_REJECTED').length;
 const pendingCount = active.length - approvedCount - rejectedCount;

 if (rejectedCount === active.length) return 'REJECTED';
 if (pendingCount === 0 && approvedCount > 0) return 'FULLY_APPROVED';
 if (approvedCount > 0) return 'PARTIALLY_APPROVED';
 if (pendingCount > 0) return 'SUBMITTED';
 return fallback;
};

const EDITABLE_STAGES = new Set<string>(['DRAFT','SUBMITTED','PARTIALLY_APPROVED','FULLY_APPROVED']);
const APPROVAL_WINDOW_STAGES = new Set<string>(['SUBMITTED','PARTIALLY_APPROVED','FULLY_APPROVED']);
const CANCELABLE_STAGES = new Set<string>(['SUBMITTED','PARTIALLY_APPROVED','FULLY_APPROVED','STORE_PREPARING']);
const DERIVED_STATUS_STAGES = new Set<string>(['SUBMITTED','PARTIALLY_APPROVED','FULLY_APPROVED']);
const STATUS_COLOR_MAP: Record<string, string> = {
 DRAFT: 'bg-gray-400',
 SUBMITTED: 'bg-blue-500',
 PARTIALLY_APPROVED: 'bg-amber-500',
 FULLY_APPROVED: 'bg-green-500',
 STORE_PREPARING: 'bg-purple-500',
 READY: 'bg-teal-500',
 REJECTED: 'bg-red-500',
 CANCELED: 'bg-gray-500',
 CLOSED: 'bg-slate-500',
};
const ACTIVITY_LOG_LIMIT = 50;
const REVISION_CONFLICT_CODE = 'revision/conflict';
const REVISION_CONFLICT_MESSAGE = 'Ù‡Ù†Ø§Ùƒ ØªØ­Ø¯ÙŠØ« Ø¬Ø¯ÙŠØ¯ØŒ Ø­Ø¯Ù‘Ø« Ø§Ù„ØµÙØ­Ø© Ø£ÙˆÙ„Ø§Ù‹';
const REVISION_HELPER = 'Ø­Ø¯Ø« ØªØ¹Ø¯ÙŠÙ„ Ø¹Ù„Ù‰ Ø§Ù„Ø-Ù„Ø¨ Ù…Ù† Ù…Ø³ØªØ®Ø¯Ù… Ø¢Ø®Ø±. Ø­Ø¯Ù‘Ø« Ø§Ù„ØµÙØ­Ø© Ù‚Ø¨Ù„ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ø­ÙØ¸.';

const toRevisionNumber = (value?: any): number => (
 typeof value === 'number' && Number.isFinite(value) ? value : 0
);

const createRevisionConflictError = () => {
 const err: any = new Error(REVISION_CONFLICT_MESSAGE);
 err.code = REVISION_CONFLICT_CODE;
 return err;
};

const isRevisionConflictError = (err: any) => (
 err?.code === REVISION_CONFLICT_CODE || err?.message === REVISION_CONFLICT_MESSAGE
);

const formatActivityTime = (date?: Date | null) => {
 if (!date) return '';
 const now = new Date();
 const diffMs = now.getTime() - date.getTime();
 const fourHoursMs = 4 * 60 * 60 * 1000;
 const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
 const entryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
 const timeString = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

 if (diffMs < 60 * 1000) return 'just now';
 if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 1000))}m ago`;
 if (diffMs < fourHoursMs) return `${Math.floor(diffMs / (60 * 60 * 1000))}h ago`;
 if (entryDay === today) return `today, ${timeString}`;
 if (entryDay === today - 24 * 60 * 60 * 1000) return `yesterday, ${timeString}`;
 return `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1)
  .toString()
  .padStart(2, '0')}-${date.getFullYear()}, ${timeString}`;
};

const formatActorLabel = (actor?: ActivityActor | null) => {
 if (!actor) return 'Unknown user';
 const base = actor.fullName || actor.uid || 'Unknown user';
 return actor.deptId ? `${base} - ${actor.deptId}` : base;
};

const extractStatusFromDetails = (details?: string | null): string | null => {
 if (!details) return null;
 const statusMatch = details.match(/Status:\s*([A-Z_ ]+)->\s*([A-Z_]+)/i);
 if (statusMatch) return statusMatch[2]?.trim().toUpperCase() || null;
 const initialMatch = details.match(/Initial status\s+([A-Z_]+)/i);
 if (initialMatch) return initialMatch[1]?.trim().toUpperCase() || null;
 return null;
};

const resolveTimestampMs = (value?: any) => {
 if (value == null) return null;
 if (typeof value === 'number') return value;
 if (typeof value?.toMillis === 'function') return value.toMillis();
 if (typeof value?.seconds === 'number') {
  const ns = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
  return value.seconds * 1000 + Math.floor(ns / 1e6);
 }
 return null;
};
const sanitizeRemovedBy = (value: SelectedLine['removedBy']) => {
 if (!value) return null;
 const uid = value.uid ?? null;
 const fullName = value.fullName ?? null;
 const atMs = value.atMs ?? resolveTimestampMs(value.at);
 if (!uid && !fullName && !atMs) return null;
 return { uid, fullName, atMs };
};

const isPlainObject = (value: unknown): value is Record<string, any> => {
 if (value === null || typeof value !== 'object') return false;
 const proto = Object.getPrototypeOf(value);
 return proto === Object.prototype || proto === null;
};

const pruneUndefinedDeep = <T,>(value: T): T => {
 if (Array.isArray(value)) {
  return value.map(entry => {
   const cleaned = pruneUndefinedDeep(entry);
   return (cleaned === undefined ? null : cleaned) as any;
  }) as unknown as T;
 }
 if (isPlainObject(value)) {
  const next: Record<string, any> = {};
  Object.entries(value).forEach(([key, val]) => {
   if (val === undefined) return;
   next[key] = pruneUndefinedDeep(val);
  });
  return next as T;
 }
 return value;
};


const formatOwnerTimestamp = (value?: any) => {
 const ms = resolveTimestampMs(value);
 if (!ms) return '';
 const date = new Date(ms);
 const day = date.getDate().toString().padStart(2, '0');
 const month = date.toLocaleString('en-US', { month: 'short' });
 const time = date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
 return `${day} ${month} ${time}`;
};

const normalizeDeptId = (value?: string | null): DeptId => ((value || '').trim() as DeptId);

export default function NewRequest() {
 const { user, role } = useAuth();
 const nav = useNavigate();
 const [searchParams] = useSearchParams();
 const existingRqParam = searchParams.get('rq');
 const viewMode = !!existingRqParam;
 const db = getFirestore();
 const fullName = role?.fullName || user?.displayName || (user?.email?.split('@')[0] ?? '');
 const myDeptIds = useMemo(() => {
  const source = (role?.departmentIds || []) as string[];
  return source.map((d) => normalizeDeptId(d)).filter(Boolean) as DeptId[];
 }, [ (role?.departmentIds || []).join('|') ]);
 const primaryUserDept = useMemo(() => (myDeptIds.length > 0 ? myDeptIds[0] : null), [myDeptIds]);
 const isAdminRole = !!role?.roles?.admin;
 const isDeptManagerRole = !!role?.roles?.deptManager;
 const isStoreOfficerRole = !!role?.roles?.storeOfficer;
 const hasRequesterRole = !!role?.roles?.requester;
 const deptUpperSet = useMemo(() => new Set((myDeptIds || []).map(d => String(d).toUpperCase())), [myDeptIds.join(',')]);
 const isStoreDeptUser = deptUpperSet.has('STORE');
 const canInitiateRequest = hasRequesterRole || isDeptManagerRole || isAdminRole;
 useEffect(() => { if (!canInitiateRequest && !viewMode) nav('/requests', { replace: true }); }, [canInitiateRequest, viewMode]);
 const storeTeamCanSeeDept = (dept?: string | null) => {
  if (isStoreDeptUser) return true;
  if (!isStoreOfficerRole) return false;
  const normalized = String(dept || '').toUpperCase();
  if (!normalized) return false;
  return deptUpperSet.has(normalized);
 };
 useEffect(() => () => {
  if (copyTimeoutRef.current) {
   clearTimeout(copyTimeoutRef.current);
   copyTimeoutRef.current = null;
  }
 }, []);

 const [projects, setProjects] = useState<Project[]>([]);
 const [engineers, setEngineers] = useState<Engineer[]>([]);
 const [items, setItems] = useState<Item[]>([]);
 const [existingMeta, setExistingMeta] = useState<any|null>(null);
 const [requestLoading, setRequestLoading] = useState(false);
 const [loading, setLoading] = useState(true);
 const [busy, setBusy] = useState(false);
 const [cancelBusy, setCancelBusy] = useState(false);
 const [storeActionBusy, setStoreActionBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [copiedRqCode, setCopiedRqCode] = useState(false);
 const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

 const requestFromDept = viewMode
  ? normalizeDeptId(existingMeta?.fromDept || existingMeta?.createdBy?.departmentId || myDeptIds[0] || null)
  : normalizeDeptId(myDeptIds[0] || null);
 const deriveActorDeptId = useCallback(
  () => (primaryUserDept || requestFromDept || existingMeta?.fromDept || null),
  [primaryUserDept, requestFromDept, existingMeta?.fromDept]
 );
 const baseStatus = viewMode ? (existingMeta?.status || existingMeta?.stage || 'DRAFT') : 'DRAFT';
 const baseStatusKey = String(baseStatus || 'DRAFT').toUpperCase();
 const [statusOverride, setStatusOverride] = useState<string | null>(null);
 useEffect(() => { setStatusOverride(null); }, [baseStatus, viewMode, existingRqParam]);
 const requestStatusRaw = statusOverride || baseStatus;
 const requestStatusKey = String(requestStatusRaw || 'DRAFT').toUpperCase();
 const isDraftServer = baseStatusKey === 'DRAFT';
 const isMyRequest = !viewMode || !existingMeta?.createdBy?.uid || existingMeta.createdBy.uid === user?.uid;
 const isMyFromDept = requestFromDept ? deptUpperSet.has(String(requestFromDept).toUpperCase()) : false;
 const stageAllowsEdits = !viewMode || EDITABLE_STAGES.has(baseStatusKey);
 const isStoreTeam = isStoreOfficerRole || isStoreDeptUser;
 const requestIsFullyApproved = requestStatusKey === 'FULLY_APPROVED';
 const requestIsPreparing = requestStatusKey === 'STORE_PREPARING';
 const requestIsReady = requestStatusKey === 'READY';
 const requestIsClosed = requestStatusKey === 'CLOSED';
 const storeCanActOnRequest = viewMode && storeTeamCanSeeDept(requestFromDept);
 const showPreparingButton = storeCanActOnRequest && requestIsFullyApproved;
 const showCancelPreparingButton = storeCanActOnRequest && requestIsPreparing;
 const showReadyButton = storeCanActOnRequest && requestIsPreparing;
 const storeViewFilterActive =
  storeCanActOnRequest
  && !isDeptManagerRole
  && !hasRequesterRole
  && ['FULLY_APPROVED','STORE_PREPARING','READY','CLOSED'].includes(requestStatusKey);
 const canRequesterEdit = hasRequesterRole && isMyRequest;
 const canDeptManagerEdit = isDeptManagerRole && isMyFromDept;
 const canAdminEdit = isAdminRole;
 const canApproveLines = isDeptManagerRole && APPROVAL_WINDOW_STAGES.has(baseStatusKey);

 const [projectId, setProjectId] = useState('');
 const [engineerId, setEngineerId] = useState('');
 const [urgent, setUrgent] = useState(false);
 const [note, setNote] = useState('');
 const lockedNotePrefixRef = useRef<string>('');
 const [lines, setLines] = useState<SelectedLine[]>([]);
 const [requestId, setRequestId] = useState<string | null>(null);
 const rqRef = useRef<string | null>(null);
 const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
 const [activityLoading, setActivityLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
 const [dirty, setDirty] = useState(false);
 const [showLeave, setShowLeave] = useState(false);
 const revisionRef = useRef<number>(0);
  const [infoOpen, setInfoOpen] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(true);
  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const [showEngineerSheet, setShowEngineerSheet] = useState(false);
  const [itemsSheetOpen, setItemsSheetOpen] = useState(false);
  const [itemsSheetSearch, setItemsSheetSearch] = useState('');
  const [itemsSheetSelection, setItemsSheetSelection] = useState<Record<string, boolean>>({});
  const [itemDetailOpen, setItemDetailOpen] = useState(false);
  const [itemDetailKey, setItemDetailKey] = useState<string | null>(null);
  const [itemDetailQty, setItemDetailQty] = useState(0);
  const [itemDetailUnit, setItemDetailUnit] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const touchStartRef = useRef<number | null>(null);
 const [mobileProjectSearch, setMobileProjectSearch] = useState('');
 const [mobileEngineerSearch, setMobileEngineerSearch] = useState('');
 const pendingNavRef = useRef<null | { kind: 'push'|'replace'|'pop', args?: any[] }>(null);
 const [pendingHref, setPendingHref] = useState<string | null>(null);
 const origPushRef = useRef(history.pushState);
 const origReplaceRef = useRef(history.replaceState);
 const metaLineDeptIds = useMemo(() => {
  const base = Array.isArray(existingMeta?.lineDeptIds) ? existingMeta?.lineDeptIds : (Array.isArray(existingMeta?.deptIndex) ? existingMeta.deptIndex : []);
  return (base || []).map((id: any) => String(id || '').toUpperCase());
 }, [existingMeta?.lineDeptIds, existingMeta?.deptIndex]);
 const hasLinesFromMyDept = useMemo(
  () => lines.some(l => deptUpperSet.has(String(l.ownerDeptId || '').toUpperCase())),
  [lines, deptUpperSet]
 );
 const renderedLines = useMemo(() => {
  if (!storeViewFilterActive) return lines;
  return lines.filter(line => {
   const statusKey = normalizeLineStatus(line);
   const ownerStatus = String(line.status || '').toUpperCase();
   return !line.deleted && statusKey !== 'DELETED' && ownerStatus === 'OWNER_APPROVED';
  });
 }, [lines, storeViewFilterActive]);
 const metaLinesFromMyDept = metaLineDeptIds.some(id => deptUpperSet.has(id));
 const canDeptManagerOnOwnedLines = isDeptManagerRole && (hasLinesFromMyDept || metaLinesFromMyDept);
 const canShowCloseButton = viewMode && requestIsReady && (
  isAdminRole
  || (isDeptManagerRole && (isMyFromDept || canDeptManagerOnOwnedLines))
 );
 const canEditHeader = stageAllowsEdits && (canAdminEdit || canRequesterEdit || canDeptManagerEdit);
 const canPersistRequest = stageAllowsEdits && (canAdminEdit || canRequesterEdit || canDeptManagerEdit || canDeptManagerOnOwnedLines);
 const canEditLines = canPersistRequest;
 const canAddLines = isDraftServer && (isAdminRole || (hasRequesterRole && isMyRequest) || (isDeptManagerRole && isMyFromDept));
 const allowRejectWindow = !isDraftServer && EDITABLE_STAGES.has(baseStatusKey);
 const canDeleteLine = (line: SelectedLine) => {
  if (!canEditLines) return false;
  if (line.lockedDeleted) return false;
  if (isAdminRole) return true;
  if (!isMyRequest) return false;
  if (isDraftServer) return true;
  return hasRequesterRole && isMyRequest;
 };
 const canCancelRequest = Boolean(
  viewMode
  && requestId
  && CANCELABLE_STAGES.has(baseStatusKey)
  && (
     isAdminRole
     || (hasRequesterRole && isMyRequest)
     || (isDeptManagerRole && isMyFromDept)
    )
 );

 // UI dropdowns state
 const [projectQuery, setProjectQuery] = useState('');
 const [projOpen, setProjOpen] = useState(false);
 const [engineerQuery, setEngineerQuery] = useState('');
 const [engOpen, setEngOpen] = useState(false);
 const projAnchorRef = useRef<HTMLDivElement>(null);
 const engAnchorRef = useRef<HTMLDivElement>(null);
 const projectInputRef = useRef<HTMLInputElement>(null);
 const engineerInputRef = useRef<HTMLInputElement>(null);
 const extractRevision = useCallback((data: any) => toRevisionNumber(resolveTimestampMs(data?.updatedAt)), []);
 const updateLocalRevision = useCallback((rev: number) => { revisionRef.current = rev; }, []);
 const ensureRevisionUnchanged = useCallback((snap: any) => {
  const live = typeof snap?.exists === 'function' && snap.exists() ? extractRevision(snap.data()) : 0;
  const expected = revisionRef.current || 0;
  if (viewMode) {
   if (expected && live && live !== expected) {
    throw createRevisionConflictError();
   }
   if (expected === 0 && live) {
    throw createRevisionConflictError();
   }
  }
  return live;
 }, [extractRevision, viewMode]);
 const handlePossibleConflict = useCallback((err: any) => {
  if (isRevisionConflictError(err)) {
   setError(`${REVISION_CONFLICT_MESSAGE}. ${REVISION_HELPER}`);
   return true;
  }
  return false;
 }, []);

 useEffect(() => {
  (async () => {
   try {
    const p = await getDocs(collection(db, 'projects'));
    const e = await getDocs(collection(db, 'engineers'));
    const it = await getDocs(collection(db, 'items'));
    setProjects(p.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Project[]);
    setEngineers(e.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Engineer[]);
    setItems(it.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Item[]);
   } finally { setLoading(false); }
  })();
 }, []);

 useEffect(() => {
  if (!projectId || !projects.length || projectQuery) return;
  const meta = projects.find(p => p.id === projectId);
  if (meta) setProjectQuery(meta.nameEn || meta.nameAr || meta.name || '');
 }, [projectId, projects, projectQuery]);

 useEffect(() => {
  if (!engineerId || !engineers.length || engineerQuery) return;
  const meta = engineers.find(e => e.id === engineerId);
  if (meta) setEngineerQuery(meta.nameEn || meta.nameAr || '');
 }, [engineerId, engineers, engineerQuery]);

 useEffect(() => {
  if (!existingRqParam) return;
  (async () => {
   setRequestLoading(true);
   try {
    const snap = await getDoc(doc(db, 'requests', existingRqParam));
    if (!snap.exists()) {
     setError('Request not found.');
     return;
    }
    const data = snap.data() as any;
    const rev = extractRevision(data);
    updateLocalRevision(rev);
    setExistingMeta({ id: snap.id, ...data });
    const rqCode = data.rqCode || snap.id;
    setRequestId(rqCode);
    rqRef.current = rqCode;
    setProjectId(data.projectId || '');
    setProjectQuery(data.projectNameEn || data.projectNameAr || data.projectName || '');
    setEngineerId(data.engineerId || '');
    setEngineerQuery(data.engineerNameEn || data.engineerNameAr || '');
    setUrgent(!!data.urgent);
    setNote(data.note || '');
    lockedNotePrefixRef.current = data.note || '';
    const docLines = Array.isArray(data.lines) && data.lines.length
     ? data.lines
     : (Array.isArray(data.draftLines) ? data.draftLines : []);
    setLines(docLines.map((ln: any, idx: number) => ({
     key: ln.key || `${ln.itemId || 'line'}-${idx}`,
     itemId: ln.itemId,
     itemName: ln.itemName,
     ownerDeptId: normalizeDeptId(ln.ownerDeptId),
     unit: ln.unit,
     qty: ln.qty,
     status: ln.status,
     ownerApprovedBy: ln.ownerApprovedBy || null,
     ownerRejectedBy: ln.ownerRejectedBy || null,
     deleted: !!ln.deleted,
     lockedDeleted: !!ln.deleted,
     lockedRejected: String(ln.status || '').toUpperCase() === 'OWNER_REJECTED',
     removedBy: sanitizeRemovedBy(ln.removedBy),
    })));
    setDirty(false);
   } catch (err) {
    console.error(err);
    setError('Failed to load request.');
   } finally {
    setRequestLoading(false);
   }
  })();
 }, [existingRqParam, db]);

 useEffect(() => {
  if (existingRqParam) return;
  // Reset form state when leaving view mode
  setExistingMeta(null);
  setRequestId(null);
  rqRef.current = null;
  setProjectId('');
  setProjectQuery('');
  setEngineerId('');
  setEngineerQuery('');
  setUrgent(false);
  setNote('');
  lockedNotePrefixRef.current = '';
  setLines([]);
  setDirty(false);
  setError(null);
  updateLocalRevision(0);
 }, [existingRqParam]);

 useEffect(() => {
  if (!existingRqParam || !user?.uid) return;
  (async () => {
   try {
    const payload: any = {};
    payload[`readBy.${user.uid}`] = serverTimestamp();
    await updateDoc(doc(db, 'requests', existingRqParam), payload);
   } catch {}
  })();
 }, [existingRqParam, user?.uid, db]);

 // Global click-away to close dropdowns
 useEffect(() => {
  const onDown = (e: MouseEvent) => {
   const t = e.target as Node;
   const inProj = projAnchorRef.current?.contains(t) ?? false;
   const inEng = engAnchorRef.current?.contains(t) ?? false;
   const inAdd = (itemAnchorRef.current?.contains(t) ?? false) || !!document.getElementById('item-combobox-overlay')?.contains(t as Node);
   if (!inProj) setProjOpen(false);
   if (!inEng) setEngOpen(false);
   if (!inAdd) setComboOpen(false);
  };
  window.addEventListener('mousedown', onDown, true);
  return () => window.removeEventListener('mousedown', onDown, true);
 }, []);

 // Warn on reload
 useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => { if (!dirty) return; e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
 }, [dirty]);

 // Intercept history navigation
 useEffect(() => {
  const origPush = history.pushState; const origReplace = history.replaceState;
  origPushRef.current = origPush; origReplaceRef.current = origReplace;
  function guardPush(this: History, ...args: any[]){ if(dirty){ pendingNavRef.current={kind:'push', args}; setShowLeave(true); return; } return origPush.apply(this,args as any); }
  function guardReplace(this: History, ...args: any[]){ if(dirty){ pendingNavRef.current={kind:'replace', args}; setShowLeave(true); return; } return origReplace.apply(this,args as any); }
  history.pushState = guardPush as any;
  history.replaceState = guardReplace as any;
  const onPop = () => { if(!dirty) return; history.go(1); pendingNavRef.current={kind:'pop'}; setShowLeave(true); };
  window.addEventListener('popstate', onPop);
  return () => { history.pushState = origPush; history.replaceState = origReplace; window.removeEventListener('popstate', onPop); };
 }, [dirty]);

 // Intercept anchor/link clicks
 useEffect(() => {
  const onDocClick = (e: MouseEvent) => {
   if (!dirty) return;
   const el = e.target as Element | null; if (!el) return;
   const anchor = el.closest('a') as HTMLAnchorElement | null; if (!anchor) return;
   const href = anchor.getAttribute('href');
   if (!href || href.startsWith('#') || anchor.target === '_blank') return;
   const url = new URL(href, window.location.href);
   if (url.origin !== window.location.origin) return;
   e.preventDefault();
   setPendingHref(url.pathname + url.search + url.hash);
   setShowLeave(true);
  };
  document.addEventListener('click', onDocClick, true);
  return () => document.removeEventListener('click', onDocClick, true);
 }, [dirty]);


 const getAvailableQty = (itemId: string): number | undefined => {
  const match = items.find(i => i.itemCode === itemId);
  const qtyVal = (match as any)?.qty;
  return typeof qtyVal === 'number' ? qtyVal : undefined;
 };

 const findInventoryViolation = (lineList: SelectedLine[]) => {
  for (const line of lineList) {
   if (!line) continue;
   const statusKey = normalizeLineStatus(line);
   if (statusKey === 'DELETED' || statusKey === 'OWNER_REJECTED') continue;
   if (!storeTeamCanSeeDept(line.ownerDeptId)) continue;
   const available = getAvailableQty(line.itemId);
   if (typeof available === 'number' && line.qty > available) {
    return { line, available };
   }
  }
  return null;
 };

 const save = async (status: 'DRAFT' | 'SUBMITTED', opts: { redirect?: boolean } = {}) => {
  const { redirect = false } = opts;
  if (busy) return; setBusy(true); setError(null);
  console.log('save() auth context', { uid: user?.uid, role });
  try {
   if (!viewMode && !canInitiateRequest) { setError('You do not have permission to create requests.'); setBusy(false); return; }
   if (viewMode && !canPersistRequest) { setError('You do not have permission to modify this request.'); setBusy(false); return; }
   if (!projectId || !engineerId || lines.length === 0) { setError('Please choose a project and engineer and add at least one item'); setBusy(false); return; }

   let previousNoteValue = existingMeta?.note ?? existingMeta?.notes ?? '';
   const newNoteValue = note || '';
   const actorDeptId = deriveActorDeptId();
   const activityActor: ActivityActor = {
    uid: user?.uid || null,
    fullName: fullName || user?.displayName || user?.email || null,
    deptId: actorDeptId,
   };
   const actorName = activityActor.fullName || activityActor.uid || 'User';
   const actorDeptLabel = activityActor.deptId ? ` (${activityActor.deptId})` : '';
   const actorLabel = `${actorName}${actorDeptLabel}`;
   const pendingActivities: PendingActivity[] = [];
   const changeDetails: string[] = [];
   const addDetail = (label: string, body?: string) => {
    changeDetails.push(body ? `${label}: ${body}` : label);
   };
   const addListDetail = (label: string, items: string[]) => {
    if (!items.length) return;
    changeDetails.push(`${label}:\n - ${items.join('\n - ')}`);
   };
   const describeProject = (id?: string | null) => {
    if (!id) return 'Unassigned';
    const meta = projects.find(p => p.id === id);
    return meta?.nameEn || meta?.nameAr || meta?.name || id;
   };
   const describeEngineer = (id?: string | null) => {
    if (!id) return 'Unassigned';
    const meta = engineers.find(e => e.id === id);
    return meta?.nameEn || meta?.nameAr || id;
   };
   const describeLine = (line: Partial<SelectedLine> | null | undefined) => {
    if (!line) return 'Item';
    const label = line.itemName || line.itemId || 'Item';
    const code = line.itemId ? ` (${line.itemId})` : '';
    return line.ownerDeptId ? `${label}${code} - ${line.ownerDeptId}` : `${label}${code}`;
   };
   const describeLineQty = (line: Partial<SelectedLine> | null | undefined) => {
    if (!line || line.qty == null) return 'qty ?';
    const unit = line.unit ? ` ${line.unit}` : '';
    return `${line.qty}${unit}`;
   };
   const lineKey = (line: Partial<SelectedLine> | null | undefined, idx: number) => {
    if (!line) return `idx-${idx}`;
    if (line.key) return line.key;
    const owner = line.ownerDeptId || 'dept';
    return `${line.itemId || 'item'}-${owner}-${idx}`;
   };
   const normalizedLines: SelectedLine[] = lines.map((ln) => {
    const { lockedDeleted, lockedRejected, ...rest } = ln;
    return {
     ...rest,
     ownerDeptId: normalizeDeptId(ln.ownerDeptId),
     deleted: !!ln.deleted,
    };
   });
   if (status !== 'DRAFT') {
    const violation = findInventoryViolation(normalizedLines);
    if (violation) {
     const { line, available } = violation;
     setError(`Cannot submit or approve because ${line.itemName} (${line.itemId}) requests ${line.qty} but only ${available ?? 0} available.`);
     setBusy(false);
     return;
    }
   }
   const lineDeptList = Array.from(new Set(normalizedLines.filter(l => !l.deleted).map((l) => l.ownerDeptId).filter(Boolean)));
   const fromDept: DeptId = normalizeDeptId(
    viewMode
     ? (existingMeta?.fromDept || existingMeta?.createdBy?.departmentId || requestFromDept || myDeptIds[0] || null)
     : (requestFromDept || myDeptIds[0] || (lineDeptList[0] as any) || null)
   );
   const deriveLineDeptIds = (lineSource: SelectedLine[]) => {
    const set = new Set<string>();
    lineSource.forEach(l => {
     if (l.deleted) return;
     const dept = normalizeDeptId(l.ownerDeptId);
     if (dept) set.add(dept);
    });
    if (fromDept) set.add(fromDept);
    return Array.from(set) as DeptId[];
   };
   const deptIndex = deriveLineDeptIds(normalizedLines);
   const createdByPayload = viewMode && existingMeta?.createdBy
    ? existingMeta.createdBy
    : { uid: user?.uid, email: user?.email, fullName, departmentId: fromDept };

   let rqCode: string = rqRef.current || requestId || '';
   if (!rqCode) {
    const deptCode = (fromDept === 'Store') ? 'STR' : (fromDept || 'GEN').toString().slice(0, 3).toUpperCase();
    const now = new Date(); const mm = String(now.getMonth() + 1).padStart(2, '0'); const dd = String(now.getDate()).padStart(2, '0');
    const ymd = `${now.getFullYear()}${mm}${dd}`; const counterId = `${deptCode}-${ymd}`;
    const seq = await runTransaction(db, async (tx) => { const ref = doc(db, 'counters', counterId); const snap = await tx.get(ref); let next = snap.exists() ? ((snap.data() as any).next || 1) : 1; tx.set(ref, { next: next + 1 }, { merge: true }); return next; });
    rqCode = `${deptCode}-${mm}${dd}${String(seq).padStart(3, '0')}`;
   }

   const isAdmin = !!role?.roles?.admin;
   const isDeptManager = !!role?.roles?.deptManager;
   const canAutoApproveDept = (dept: any) => isAdmin || (isDeptManager && myDeptIds.includes(dept));
   const existingAutoApproved: Record<string, boolean> =
    isPlainObject(existingMeta?.autoApprovedByDept)
     ? { ...(existingMeta?.autoApprovedByDept as Record<string, boolean>) }
     : {};
   const autoApprovedByDept: Record<string, boolean> =
    status === 'DRAFT'
     ? {}
     : { ...existingAutoApproved };

   const linesForSubmit = normalizedLines.map(l => {
    const ownerStatusKey = String(l.status || '').toUpperCase();
    let nextStatus = ownerStatusKey || 'PENDING_OWNER';
    let nextApprovedBy = l.ownerApprovedBy || null;
    let nextRejectedBy = l.ownerRejectedBy || null;
    let nextRemovedBy = sanitizeRemovedBy(l.removedBy);
    if (l.deleted) {
     nextStatus = 'PENDING_OWNER';
     nextApprovedBy = null;
     nextRejectedBy = null;
     nextRemovedBy = sanitizeRemovedBy(l.removedBy);
    }
    return {
     ...l,
     status: nextStatus,
     ownerApprovedBy: nextApprovedBy,
     ownerRejectedBy: nextRejectedBy,
     deleted: !!l.deleted,
     removedBy: nextRemovedBy,
    };
   });
   const fallbackStatus = (existingMeta?.status as RequestStatus) || 'SUBMITTED';
   const lifecycleStatus = deriveLifecycleStatus(linesForSubmit, fallbackStatus) as RequestStatus;
   const allowLifecycleChange =
    !viewMode
    || isAdminRole
    || (hasRequesterRole && isMyRequest)
    || (isDeptManagerRole && (isMyFromDept || canDeptManagerOnOwnedLines));
   let derivedStatus: RequestStatus =
    status === 'DRAFT'
     ? 'DRAFT'
     : (allowLifecycleChange ? lifecycleStatus : fallbackStatus);
   if (status !== 'DRAFT' && baseStatusKey === 'DRAFT') {
    derivedStatus = 'SUBMITTED';
   }

   const basePayloadLines = status === 'DRAFT'
    ? normalizedLines
      .filter(l => !l.deleted)
      .map((l) => {
       const {
        deleted,
        removedBy,
        status: lineStatus,
        ownerApprovedBy,
        ownerRejectedBy,
        lockedDeleted,
        lockedRejected,
        ...rest
       } = l;
       return rest;
      })
    : linesForSubmit;
   const payloadLines = basePayloadLines.map(line => pruneUndefinedDeep({ ...line })) as SelectedLine[];

   const docRef = doc(db, 'requests', rqCode);
   let nextDoc: Record<string, any>;
   let prevDoc: Record<string, any> | null = null;
   let prevActivityLog: any[] = [];
   if (viewMode) {
    const latestSnap = await getDoc(docRef);
    const latestData = latestSnap.exists() ? (latestSnap.data() as Record<string, any>) : null;
    if (!latestData && !existingMeta) {
     throw new Error('Request no longer exists.');
    }
    const base = latestData || existingMeta || {};
    prevDoc = base;
    prevActivityLog = Array.isArray(base.activityLog) ? base.activityLog : [];
    nextDoc = Object.keys(base).reduce((acc, key) => {
     if (key === 'id') return acc;
     acc[key] = (base as Record<string, any>)[key];
     return acc;
    }, {} as Record<string, any>);
   } else {
    nextDoc = {};
    prevActivityLog = Array.isArray(existingMeta?.activityLog)
     ? (existingMeta?.activityLog as any[])
     : [];
   }
   if (prevDoc) {
    const prevNoteValue =
     typeof prevDoc.note === 'string'
      ? prevDoc.note
      : (typeof prevDoc.notes === 'string' ? prevDoc.notes : '');
    previousNoteValue = prevNoteValue ?? '';
   }

   delete nextDoc.draftLines;
   nextDoc.rqCode = rqCode;
   if (!nextDoc.createdAt) {
    nextDoc.createdAt = existingMeta?.createdAt || serverTimestamp();
   }
   if (!viewMode || !existingMeta) {
    nextDoc.createdBy = createdByPayload;
    nextDoc.fromDept = fromDept;
   }
   nextDoc.projectId = projectId;
   nextDoc.engineerId = engineerId;
   nextDoc.urgent = urgent;
   nextDoc.note = note || '';
   nextDoc.notes = note || '';
   nextDoc.status = derivedStatus;
   nextDoc.stage = derivedStatus;
   if (derivedStatus === 'CANCELED') {
    nextDoc.canceledAt = serverTimestamp();
    nextDoc.canceledBy = {
     uid: user?.uid || null,
     fullName: fullName || user?.displayName || user?.email || null,
     deptId: requestFromDept || null,
    };
   } else {
    if ('canceledAt' in nextDoc) delete nextDoc.canceledAt;
    if ('canceledBy' in nextDoc) delete nextDoc.canceledBy;
   }
   nextDoc.lines = payloadLines;
   nextDoc.lineDeptIds = deptIndex;
   nextDoc.deptIndex = deptIndex;
   nextDoc.autoApprovedByDept = status === 'DRAFT' ? {} : autoApprovedByDept;
   const nextRevision = Date.now();
   nextDoc.updatedAt = nextRevision;
   nextDoc.readBy = nextDoc.readBy || existingMeta?.readBy || {};

   const prevStatusValue = String(prevDoc?.status || prevDoc?.stage || 'DRAFT').toUpperCase() as RequestStatus;
   if (!prevDoc) {
    addDetail('Initial status', derivedStatus);
   } else if (prevStatusValue !== derivedStatus) {
    addDetail('Status', `${prevStatusValue} -> ${derivedStatus}`);
   }
   if (previousNoteValue !== newNoteValue) {
    const appended =
     previousNoteValue && newNoteValue.startsWith(previousNoteValue)
      ? newNoteValue.slice(previousNoteValue.length).trim()
      : '';
    if (!previousNoteValue && newNoteValue) {
     addDetail('Note added', newNoteValue);
    } else if (previousNoteValue && !newNoteValue) {
     addDetail('Note cleared', previousNoteValue);
    } else if (appended) {
     addDetail('Note appended', appended);
    } else {
     addDetail('Note updated', newNoteValue);
    }
   }
   if (prevDoc) {
    if ((prevDoc.projectId || '') !== projectId) {
     addDetail('Project', `${describeProject(prevDoc.projectId)} -> ${describeProject(projectId)}`);
    }
    if ((prevDoc.engineerId || '') !== engineerId) {
     addDetail('Engineer', `${describeEngineer(prevDoc.engineerId)} -> ${describeEngineer(engineerId)}`);
    }
    if (!!prevDoc.urgent !== urgent) {
     const beforeUrgent = !!prevDoc.urgent;
     addDetail('Urgent flag', `${beforeUrgent ? 'On' : 'Off'} -> ${urgent ? 'On' : 'Off'}`);
    }
    const prevLinesRaw: SelectedLine[] = Array.isArray(prevDoc.lines)
     ? (prevDoc.lines as SelectedLine[])
     : [];
    const lineDiff = (() => {
     const prevMap = new Map<string, SelectedLine>();
     prevLinesRaw.forEach((ln, idx) => {
      prevMap.set(lineKey(ln, idx), ln);
     });
     const added: string[] = [];
     const updated: string[] = [];
     payloadLines.forEach((ln, idx) => {
      const key = lineKey(ln, idx);
      if (!prevMap.has(key)) {
       added.push(`${describeLine(ln)} (${describeLineQty(ln)})`);
       return;
      }
      const prevLine = prevMap.get(key)!;
      prevMap.delete(key);
      const changeParts: string[] = [];
      if ((prevLine.qty ?? null) !== (ln.qty ?? null)) {
       changeParts.push(`qty ${prevLine.qty ?? '-'}->${ln.qty ?? '-'}`);
      }
      if ((prevLine.unit || '') !== (ln.unit || '')) {
       changeParts.push(`unit ${prevLine.unit || '-'}->${ln.unit || '-'}`);
      }
      const prevStatus = normalizeLineStatus(prevLine);
      const nextStatus = normalizeLineStatus(ln as SelectedLine);
      if (prevStatus !== nextStatus) {
       changeParts.push(`status ${prevStatus}->${nextStatus}`);
      }
      const prevDeleted = !!prevLine.deleted;
      const nextDeleted = !!ln.deleted;
      if (prevDeleted !== nextDeleted) {
       changeParts.push(nextDeleted ? 'marked removed' : 'restored');
      }
      if (changeParts.length) {
       updated.push(`${describeLine(ln)} (${changeParts.join(', ')})`);
      }
     });
     const removed: string[] = [];
     prevMap.forEach((line) => {
      removed.push(`${describeLine(line)} (${describeLineQty(line)})`);
     });
     return { added, updated, removed };
    })();
    addListDetail('Items added', lineDiff.added);
    addListDetail('Items updated', lineDiff.updated);
    addListDetail('Items removed', lineDiff.removed);
   }
   if (!prevDoc) {
    addDetail('Project', describeProject(projectId));
    addDetail('Engineer', describeEngineer(engineerId));
    addDetail('Items', `${payloadLines.length}`);
   }
   const detailText = changeDetails.join('\n');
   let activityType: string;
   let summary: string;
   if (!prevDoc) {
    activityType = 'request_created';
    summary = `${actorLabel} created the request`;
   } else if (changeDetails.length) {
    activityType = 'request_updated';
    summary = `${actorLabel} updated the request`;
   } else {
    activityType = 'request_saved';
    summary = `${actorLabel} saved the request`;
   }
   pendingActivities.push({
    type: activityType,
    summary,
    details: detailText || undefined,
    statusKey: derivedStatus,
   });
   const nowMs = Date.now();
   const nextActivityEntries = pendingActivities.map((entry, idx) => {
    const createdAtMs = nowMs + idx;
    return {
     id: `evt-${createdAtMs}-${Math.random().toString(36).slice(2, 8)}`,
     type: entry.type,
     summary: entry.summary,
     details: entry.details || '',
     actor: activityActor,
     createdAtMs,
     statusKey: entry.statusKey || derivedStatus,
    };
   });
   const activityLog = [...nextActivityEntries, ...prevActivityLog].slice(0, ACTIVITY_LOG_LIMIT);
   nextDoc.activityLog = activityLog;
   const payloadForWrite = pruneUndefinedDeep(nextDoc);
   console.log('saving payload', payloadForWrite);
   await runTransaction(db, async (tx) => {
    if (viewMode) {
     const snap = await tx.get(docRef);
     ensureRevisionUnchanged(snap);
     tx.set(docRef, payloadForWrite);
    } else {
     tx.set(docRef, payloadForWrite);
    }
   });
   updateLocalRevision(nextRevision);
   setRequestId(rqCode);
   rqRef.current = rqCode;
   setLines(payloadLines.map((ln, idx) => ({
    ...ln,
    key: ln.key || `${ln.itemId || 'line'}-${idx}`,
    lockedDeleted: !!ln.deleted,
    lockedRejected: String(ln.status || '').toUpperCase() === 'OWNER_REJECTED',
   })));
   if (viewMode) {
    setExistingMeta(prev => ({
     ...(prev || {}),
     rqCode,
     fromDept,
     createdBy: createdByPayload,
     projectId,
     engineerId,
     urgent,
     note,
     notes: note,
     status: derivedStatus,
     stage: derivedStatus,
     updatedAt: nextRevision,
     lines: payloadLines,
     lineDeptIds: deptIndex,
     deptIndex,
     autoApprovedByDept: status === 'DRAFT' ? {} : autoApprovedByDept,
     activityLog,
    }));
    lockedNotePrefixRef.current = note || '';
   }
   setDirty(false);
   if (redirect) {
    nav('/requests');
   }
  } catch (e: any) {
   console.error(e);
   if (!handlePossibleConflict(e)) {
    const code = e?.code || 'unknown';
    const msg = e?.message || String(e);
    setError(`Error [${code}]: ${msg}`);
   }
  } finally { setBusy(false); }
 };

 const readOnlyHeader = !canEditHeader;
 const readOnlyLines = !canEditLines;
 const readOnly = readOnlyHeader;
 const storeNoteAppendAllowed = viewMode && storeTeamCanSeeDept(requestFromDept);
 const canFullyEditNotes = stageAllowsEdits && (canAdminEdit || canRequesterEdit);
 const canAppendDeptNotes = stageAllowsEdits && !canFullyEditNotes && isDeptManagerRole && (isMyFromDept || canDeptManagerOnOwnedLines);
 const canAppendStoreNotes = !requestIsClosed && !canFullyEditNotes && !canAppendDeptNotes && storeNoteAppendAllowed;
 const canAppendNotes = canAppendDeptNotes || canAppendStoreNotes;
 const canEditNotes = canFullyEditNotes || canAppendNotes;

 const handleNoteChange = (value: string) => {
  if (!canEditNotes) return;
  if (!canAppendNotes) {
   if (value !== note) {
    setDirty(true);
    setNote(value);
   }
   return;
  }
  const base = lockedNotePrefixRef.current || '';
  let next = value;
  if (base) {
   if (!next.startsWith(base)) {
    if (base.startsWith(next)) {
     next = base;
    } else {
     const appended = next.length >= base.length ? next.slice(base.length) : '';
     next = base + appended;
    }
   }
  }
  if (next !== note) {
   setDirty(true);
   setNote(next);
  }
 };

 useEffect(() => {
  if (!viewMode) {
   lockedNotePrefixRef.current = '';
   return;
  }
  if (canAppendNotes) {
   lockedNotePrefixRef.current = existingMeta?.note || existingMeta?.notes || '';
  } else {
   lockedNotePrefixRef.current = '';
  }
 }, [viewMode, canAppendNotes, existingMeta?.note, existingMeta?.notes]);

 useEffect(() => {
  if (!viewMode) {
   setActivityEntries([]);
   setActivityLoading(false);
   return;
  }
  if (!existingMeta) {
   setActivityEntries([]);
   setActivityLoading(true);
   return;
  }
  const rawLog = Array.isArray((existingMeta as any)?.activityLog)
   ? ((existingMeta as any).activityLog as any[])
   : [];
  const parsed = rawLog.map((entry: any, idx: number) => {
   const ms =
    typeof entry?.createdAtMs === 'number'
     ? entry.createdAtMs
     : resolveTimestampMs(entry?.createdAt);
   const createdAt =
    typeof ms === 'number'
     ? new Date(ms)
     : (entry?.createdAt?.toDate ? entry.createdAt.toDate() : null);
    return {
     id: entry?.id || `evt-${idx}`,
     type: entry?.type || 'event',
     summary: entry?.summary || '',
     details: entry?.details || '',
     actor: entry?.actor || null,
     createdAt,
     statusKey: entry?.statusKey || null,
    } as ActivityEntry;
   });
  setActivityEntries(parsed);
  setActivityLoading(false);
 }, [viewMode, existingMeta]);
 useEffect(() => {
  setExpandedHistory({});
 }, [existingRqParam, requestId]);
 const showProjectClear = !readOnly && !!projectId;
 const showEngineerClear = !readOnly && !!engineerId;
 const clearProjectSelection = () => {
  if (readOnly) return;
  setProjectId('');
  setProjectQuery('');
  setProjOpen(true);
  setEngOpen(false);
  setDirty(true);
  setTimeout(() => projectInputRef.current?.focus(), 0);
 };
 const clearEngineerSelection = () => {
  if (readOnly) return;
  setEngineerId('');
  setEngineerQuery('');
  setEngOpen(true);
  setProjOpen(false);
  setDirty(true);
  setTimeout(() => engineerInputRef.current?.focus(), 0);
 };
 const historyStatusKeyForEntry = (entry: ActivityEntry) => {
  if (entry.statusKey) return entry.statusKey;
  const fromDetails = extractStatusFromDetails(entry.details);
  return fromDetails || requestStatusKey;
 };
 const historyColorForEntry = (entry: ActivityEntry) => {
  const key = historyStatusKeyForEntry(entry);
  return STATUS_COLOR_MAP[key] || 'bg-gray-300';
 };
 const toggleHistoryEntry = (id: string) => {
  setExpandedHistory(prev => ({ ...prev, [id]: !prev[id] }));
 };
 const appendHistoryEntry = async (type: string, summary: string, details?: string, statusKey?: string) => {
  if (!requestId) return;
  const actor: ActivityActor = {
   uid: user?.uid || null,
   fullName: fullName || user?.displayName || user?.email || null,
   deptId: deriveActorDeptId(),
  };
  const nowMs = Date.now();
  const newEntry = {
   id: `evt-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
   type,
   summary,
   details: details || '',
   actor,
   createdAtMs: nowMs,
   statusKey: statusKey || null,
  };
  const prevLog = Array.isArray(existingMeta?.activityLog) ? existingMeta?.activityLog : [];
  const nextLog = [newEntry, ...prevLog].slice(0, ACTIVITY_LOG_LIMIT);
  const nextRevision = Date.now();
  try {
   await runTransaction(db, async (tx) => {
    const ref = doc(db, 'requests', requestId);
    const snap = await tx.get(ref);
    ensureRevisionUnchanged(snap);
    tx.update(ref, { activityLog: nextLog, updatedAt: nextRevision });
   });
   updateLocalRevision(nextRevision);
   setExistingMeta(prev => (prev ? { ...prev, activityLog: nextLog, updatedAt: nextRevision } : prev));
   setActivityEntries(prevEntries => [
    {
     id: newEntry.id,
     type,
     summary,
     details: newEntry.details,
     actor,
     createdAt: new Date(nowMs),
     statusKey: statusKey || null,
    },
    ...prevEntries,
   ].slice(0, ACTIVITY_LOG_LIMIT));
  } catch (err) {
   if (!handlePossibleConflict(err)) throw err;
  }
 };
 const transitionRequestStatus = useCallback(async (nextStatus: RequestStatus, summary: string) => {
  if (!requestId) return;
  setStoreActionBusy(true);
  setError(null);
  try {
   const prevStatus = requestStatusKey;
   const actor: ActivityActor = {
    uid: user?.uid || null,
    fullName: fullName || user?.displayName || user?.email || null,
    deptId: deriveActorDeptId(),
   };
   const nowMs = Date.now();
   const newEntry = {
    id: `evt-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'status_transition',
    summary,
    details: `Status: ${prevStatus} -> ${nextStatus}`,
    actor,
    createdAtMs: nowMs,
    statusKey: nextStatus,
   };
   const prevLog = Array.isArray(existingMeta?.activityLog) ? existingMeta?.activityLog : [];
   const nextLog = [newEntry, ...prevLog].slice(0, ACTIVITY_LOG_LIMIT);
   const nextRevision = Date.now();
   const aggregateQuantities = (reqData: any) => {
    const totals = new Map<string, number>();
    const reqLines = Array.isArray(reqData?.lines) ? reqData.lines : [];
    reqLines.forEach((ln: any) => {
     const itemId = ln?.itemId;
     const qty = Number(ln?.qty);
     const statusKey = String(ln?.status || '').toUpperCase();
     if (!itemId || !Number.isFinite(qty) || qty <= 0) return;
     if (ln?.deleted) return;
     if (statusKey === 'OWNER_REJECTED') return;
     totals.set(itemId, (totals.get(itemId) || 0) + qty);
    });
    return totals;
   };
   await runTransaction(db, async (tx) => {
    const ref = doc(db, 'requests', requestId);
    const snap = await tx.get(ref);
    ensureRevisionUnchanged(snap);
    if (nextStatus === 'READY') {
     const totals = aggregateQuantities(snap.data());
     const itemSnapshots: { ref: ReturnType<typeof doc>; currentQty: number; needed: number }[] = [];
     for (const [itemId, needed] of totals.entries()) {
      if (needed <= 0) continue;
      const itemRef = doc(db, 'items', itemId);
      const itemSnap = await tx.get(itemRef);
      const currentQty = Number(itemSnap.data()?.qty);
      if (!Number.isFinite(currentQty)) {
       throw new Error(`Item ${itemId} is missing stock info.`);
      }
      if (currentQty < needed) {
       throw new Error(`Not enough stock for ${itemId}. Need ${needed}, have ${currentQty}.`);
      }
      itemSnapshots.push({ ref: itemRef, currentQty, needed });
     }
     itemSnapshots.forEach(({ ref, currentQty, needed }) => {
      tx.update(ref, { qty: currentQty - needed });
     });
    }
    tx.update(ref, {
     status: nextStatus,
     stage: nextStatus,
     updatedAt: nextRevision,
     activityLog: nextLog,
    });
   });
   updateLocalRevision(nextRevision);
   const entryForUi: ActivityEntry = {
    id: newEntry.id,
    type: newEntry.type,
    summary: newEntry.summary,
    details: newEntry.details,
    actor: newEntry.actor,
    createdAt: new Date(nowMs),
    statusKey: newEntry.statusKey,
   };
   setExistingMeta(prev => (prev ? { ...prev, status: nextStatus, stage: nextStatus, activityLog: nextLog, updatedAt: nextRevision } : prev));
   setActivityEntries(prev => [entryForUi, ...prev].slice(0, ACTIVITY_LOG_LIMIT));
   setStatusOverride(null);
  } catch (err: any) {
   console.error(err);
   if (!handlePossibleConflict(err)) {
    if (typeof err?.message === 'string' && err.message.toLowerCase().includes('stock')) {
     setError(err.message);
     return;
    }
    const code = err?.code || 'unknown';
    setError(`Failed to update status (${code}).`);
   }
  } finally {
   setStoreActionBusy(false);
  }
 }, [db, requestId, requestStatusKey, existingMeta?.activityLog, user?.uid, fullName, deriveActorDeptId]);

 const lineStatusInfo = (line: SelectedLine) => {
  const status = line.status;
  if (!status) return null;
  const normalized = normalizeLineStatus(line);
  const meta = LINE_STATUS_META[normalized as keyof typeof LINE_STATUS_META];
  if (!meta) return null;
  const Icon = meta.Icon;
  let tooltip: string = meta.label;
  if (normalized === 'OWNER_APPROVED' && line.ownerApprovedBy?.fullName) {
   const at = formatOwnerTimestamp(line.ownerApprovedBy.atMs ?? line.ownerApprovedBy.at);
   tooltip = `Approved by ${line.ownerApprovedBy.fullName}${at ? ` at ${at}` : ''}`;
  } else if (normalized === 'OWNER_REJECTED' && line.ownerRejectedBy?.fullName) {
   const at = formatOwnerTimestamp(line.ownerRejectedBy.atMs ?? line.ownerRejectedBy.at);
   tooltip = `Rejected by ${line.ownerRejectedBy.fullName}${at ? ` at ${at}` : ''}`;
  } else if (normalized === 'DELETED') {
   const remover = line.removedBy?.fullName;
   const at = formatOwnerTimestamp(line.removedBy?.atMs ?? line.removedBy?.at);
   tooltip = remover
    ? `Removed by ${remover}${at ? ` at ${at}` : ''}`
    : 'Removed from request';
  }
  const wrapperClass = meta.wrapper || 'inline-flex items-center text-gray-500';
  const iconClass = meta.icon || 'h-4 w-4';
  return { Icon, tooltip, wrapperClass, iconClass, label: meta.label };
 };

 const renderLineStatusIcon = (line: SelectedLine) => {
  const info = lineStatusInfo(line);
  if (!info) return null;
  const { Icon, tooltip, wrapperClass, iconClass } = info;
  return (
   <span className={wrapperClass} title={tooltip}>
    <Icon className={iconClass} />
   </span>
  );
 };

 const dropLineApproval = (line: SelectedLine): SelectedLine => ({
  ...line,
  status: 'PENDING_OWNER',
  ownerApprovedBy: null,
  ownerRejectedBy: null,
  removedBy: line.deleted ? sanitizeRemovedBy(line.removedBy) : null,
  lockedRejected: false,
 });

 useEffect(() => {
  if (!viewMode || !DERIVED_STATUS_STAGES.has(baseStatusKey)) {
   setStatusOverride(null);
   return;
  }
const derived = deriveLifecycleStatus(lines);
  setStatusOverride(derived === baseStatusKey ? null : derived);
 }, [viewMode, lines, baseStatusKey]);

 const approveLine = (line: SelectedLine) => {
  if (!canApproveLines) return;
  const ownsDept = deptUpperSet.has(String(line.ownerDeptId || '').toUpperCase());
  if (!ownsDept) {
   setError(`You do not have permission to approve items owned by ${line.ownerDeptId}.`);
   return;
  }
  if (storeTeamCanSeeDept(line.ownerDeptId)) {
   const available = getAvailableQty(line.itemId);
   if (typeof available === 'number' && line.qty > available) {
    setError(`Cannot approve this item because ${line.qty} requested but only ${available} in stock.`);
    return;
   }
  }
  setLines(prev => prev.map(l => {
   if (l.key !== line.key) return l;
   return {
    ...l,
    deleted: false,
    status: 'OWNER_APPROVED',
    ownerApprovedBy: {
     uid: user?.uid,
     fullName,
     deptId: line.ownerDeptId,
     atMs: Date.now(),
    },
    lockedRejected: false,
   };
  }));
  setDirty(true);
 };

 const unapproveLine = (line: SelectedLine) => {
  if (!canApproveLines) return;
  const ownsDept = deptUpperSet.has(String(line.ownerDeptId || '').toUpperCase());
  if (!ownsDept) return;
  setLines(prev => prev.map(l => (l.key === line.key ? dropLineApproval(l) : l)));
  setDirty(true);
 };

 const rejectLine = (line: SelectedLine) => {
  if (!allowRejectWindow || !isDeptManagerRole) return;
  const ownerUpper = String(line.ownerDeptId || '').toUpperCase();
  const canAct = isMyFromDept || deptUpperSet.has(ownerUpper);
  if (!canAct) return;
  setLines(prev => prev.map(l => {
   if (l.key !== line.key) return l;
   const alreadyRejected = String(l.status || '').toUpperCase() === 'OWNER_REJECTED';
   if (alreadyRejected) {
    return {
     ...dropLineApproval(l),
     deleted: false,
    };
   }
   return {
    ...l,
    deleted: false,
    status: 'OWNER_REJECTED',
    ownerApprovedBy: null,
    ownerRejectedBy: {
     uid: user?.uid,
     fullName,
     deptId: line.ownerDeptId,
     atMs: Date.now(),
    },
    lockedRejected: false,
   };
  }));
  setDirty(true);
 };

 const toggleDeleteLine = (line: SelectedLine) => {
  if (!canDeleteLine(line)) return;
  if (line.lockedDeleted) return;
  if (isDraftServer) {
   setLines(prev => prev.filter(l => l.key !== line.key));
   setDirty(true);
   return;
  }

  const removedSnapshot = {
   uid: user?.uid,
   fullName,
   atMs: Date.now(),
  };
  setLines(prev => prev.map(l => {
   if (l.key !== line.key) return l;
   const nextDeleted = !l.deleted;
   const base = dropLineApproval(l);
   if (nextDeleted) {
    return {
     ...base,
     deleted: true,
     lockedDeleted: l.lockedDeleted || false,
     removedBy: removedSnapshot,
    };
   }
   return {
    ...base,
    deleted: false,
     lockedDeleted: false,
    removedBy: null,
   };
  }));
  setDirty(true);
 };

 const onCancelRequest = async () => {
  if (!canCancelRequest || !requestId) {
   if (dirty) {
    setShowLeave(true);
   } else {
    nav(-1);
   }
   return;
  }
  const confirmMessage = dirty
   ? 'You have unsaved changes. Cancel this request anyway?'
   : 'Cancel this request for everyone?';
  if (!window.confirm(confirmMessage)) return;
  setCancelBusy(true);
  setError(null);
  try {
   const prevStatusBeforeCancel = String(existingMeta?.status || existingMeta?.stage || 'SUBMITTED').toUpperCase();
   const cancelMeta: any = {
    status: 'CANCELED',
    stage: 'CANCELED',
    canceledAt: serverTimestamp(),
   };
   cancelMeta.canceledBy = {
    uid: user?.uid || null,
    fullName,
    deptId: requestFromDept,
   };
   const nextRevision = Date.now();
   await runTransaction(db, async (tx) => {
    const ref = doc(db, 'requests', requestId);
    const snap = await tx.get(ref);
    ensureRevisionUnchanged(snap);
    tx.update(ref, { ...cancelMeta, updatedAt: nextRevision });
   });
   updateLocalRevision(nextRevision);
   setExistingMeta(prev => prev ? { ...prev, ...cancelMeta, updatedAt: nextRevision } : prev);
   setDirty(false);
   setStatusOverride(null);
   await appendHistoryEntry(
    'request_canceled',
    'Request canceled',
    `Status: ${prevStatusBeforeCancel} -> CANCELED`,
    'CANCELED'
   );
  } catch (err: any) {
   console.error(err);
   if (!handlePossibleConflict(err)) {
    const code = err?.code || 'unknown';
    setError(`Failed to cancel request (${code}).`);
   }
  } finally {
   setCancelBusy(false);
  }
 };
 const onSaveDraftClick = async () => { if (!canPersistRequest || !dirty) return; await save('DRAFT', { redirect: false }); };
 const onSaveChangesClick = async () => { if (!canPersistRequest || !dirty) return; await save('SUBMITTED', { redirect: false }); };
 const onSubmitClick = async () => {
  if (!canPersistRequest) return;
  if (dirty || !requestId) await save('DRAFT', { redirect: false });
  await save('SUBMITTED', { redirect: true });
 };

 // Add-row combobox state
 const [search, setSearch] = useState('');
 const [comboOpen, setComboOpen] = useState(false);
 const [draftItemId, setDraftItemId] = useState('');
 const [draftUnit, setDraftUnit] = useState('');
 const [draftQty, setDraftQty] = useState(1);
 const [addErr, setAddErr] = useState('');
 const itemAnchorRef = useRef<HTMLDivElement>(null);

 const deptOrder: DeptId[] = ['HSE','TRP','VRP','Store'];

const filteredItems = useMemo(() => {
  const helper = (query: string, excludeExisting: boolean) => {
    const q = query.trim();
    const raw = q.toLowerCase();
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const deptTokens = tokens.filter(t => deptOrder.some(d => d.toLowerCase() === t));
    const textTokens = tokens.filter(t => !deptTokens.includes(t));
    const existing = new Set(lines.map(l => l.itemId));
    return items.filter(it => {
      if (excludeExisting && existing.has(it.itemCode)) return false; // hide already-added
      if (!q) return true;
      const name = (it.nameEn || it.nameAr || '').toLowerCase();
      const code = (it.itemCode || '').toLowerCase();
      const desc = (it.descriptionEn || it.descriptionAr || '').toLowerCase();
      const textOk = textTokens.every(t => name.includes(t) || code.includes(t) || desc.includes(t));
      const deptOk = deptTokens.length ? deptTokens.some(t => (it.ownerDeptId || '').toString().toLowerCase() === t) : true;
      return textOk && deptOk;
    });
  };
  return helper(search, true);
}, [items, search, lines]);

 const currentItem = items.find(x => x.itemCode === draftItemId || (x.nameEn || x.nameAr) === (search || ''));
 const allowedUnits = currentItem?.allowedUnits?.length ? currentItem.allowedUnits : (currentItem?.unit ? [currentItem.unit] : []);

 const resetDraftRow = () => { setDraftItemId(''); setDraftUnit(''); setDraftQty(1); setSearch(''); };
 const selectItem = (it: Item) => {
  if (!canAddLines) return;
  setDraftItemId(it.itemCode);
  setDraftUnit(it.allowedUnits?.[0] || it.unit || '');
  setSearch(it.nameEn || it.nameAr || it.itemCode);
  setComboOpen(false);
 };
 const addOrUpdateLine = () => {
  if (!canAddLines) { setAddErr('You cannot add items to this request.'); return; }
  setAddErr('');
  const it = items.find(x => x.itemCode === draftItemId || (x.nameEn || x.nameAr) === search);
  if (!it || !draftUnit || draftQty <= 0) return;
  if (lines.some(l => l.itemId === it.itemCode)) { setAddErr('Item already added. Please edit its quantity.'); return; }
  const key = `${it.itemCode}-${Date.now()}`;
  const ownerDeptId = normalizeDeptId(it.ownerDeptId);
  if (!ownerDeptId) { setAddErr('Item is missing an owner department.'); return; }
  const enforceInventory = storeTeamCanSeeDept(ownerDeptId);
  if (enforceInventory) {
   const available = getAvailableQty(it.itemCode);
   if (typeof available === 'number' && draftQty > available) {
    setAddErr(`Requested quantity (${draftQty}) exceeds available stock (${available}).`);
    return;
   }
  }
  if (!canEditHeader && !deptUpperSet.has(String(ownerDeptId || '').toUpperCase())) {
   setAddErr('You can only add items owned by your departments.');
   return;
  }
  const line: SelectedLine = {
   key,
   itemId: it.itemCode,
   itemName: (it.nameEn || it.nameAr || it.itemCode),
   ownerDeptId,
   unit: draftUnit,
   qty: draftQty,
   status: 'PENDING_OWNER',
   ownerApprovedBy: null,
   ownerRejectedBy: null,
   deleted: false,
   removedBy: null,
   lockedDeleted: false,
   lockedRejected: false,
  };
  setLines(prev => [...prev, line]);
  setDirty(true);
  resetDraftRow();
 };

 const ItemOverlay: React.FC = () => {
  if (!canAddLines || !comboOpen) return null;
  const rect = itemAnchorRef.current?.getBoundingClientRect(); if (!rect) return null;
  const style: React.CSSProperties = { position: 'fixed', left: rect.left, top: rect.bottom + 4, width: rect.width, maxHeight: '28rem', overflowY: 'auto', zIndex: 9999 };
  return createPortal(
   <div id="item-combobox-overlay" className="border bg-white rounded-md shadow" style={style} onMouseDown={e => e.preventDefault()}>
    {deptOrder.map(group => {
     const groupItems = filteredItems.filter(x => (x.ownerDeptId as any) === group).sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));
     if (!groupItems.length) return null;
     return (
      <div key={group}>
       <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">{group}</div>
       {groupItems.map(it => (
        <button key={it.itemCode} type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50" onMouseDown={e => { e.preventDefault(); selectItem(it); }}>
         {it.nameEn || it.nameAr || it.itemCode}
        </button>
       ))}
      </div>
     );
    })}
    {filteredItems.length === 0 && <div className="px-3 py-2 text-gray-500">No items</div>}
   </div>,
   document.body
  );
 };

 // Edit row state and overlay
 const [editingKey, setEditingKey] = useState<string | null>(null);
 const [editSearch, setEditSearch] = useState('');
 const [editOpen, setEditOpen] = useState(false);
 const [editItemId, setEditItemId] = useState('');
 const [editUnit, setEditUnit] = useState('');
 const [editQty, setEditQty] = useState(1);
 const editItemAnchorRef = useRef<HTMLDivElement>(null);

 const startEdit = (key: string) => {
  if (!canEditLines) return;
  const ln = lines.find(l => l.key === key); if (!ln) return;
  if (ln.deleted) return;
  const it = items.find(i => i.itemCode === ln.itemId);
  setEditingKey(key);
  setEditItemId(it?.itemCode || ln.itemId);
  setEditUnit(ln.unit);
  setEditQty(ln.qty);
  setEditSearch(it?.nameEn || it?.nameAr || ln.itemName);
  setEditOpen(false);
 };

 const filteredEditItems = useMemo(() => {
  const q = editSearch.trim();
  if (!q) return items;
  const raw = q.toLowerCase();
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const deptTokens = tokens.filter(t => deptOrder.some(d => d.toLowerCase() === t));
  const textTokens = tokens.filter(t => !deptTokens.includes(t));
  const existing = new Set(lines.map(l => l.itemId));
  if (editingKey) {
   const current = lines.find(l => l.key === editingKey);
   if (current) existing.delete(current.itemId);
  }
  return items.filter(it => {
   if (existing.has(it.itemCode)) return false;
   const name = (it.nameEn || it.nameAr || '').toLowerCase();
   const code = (it.itemCode || '').toLowerCase();
   const desc = (it.descriptionEn || it.descriptionAr || '').toLowerCase();
   const textOk = textTokens.every(t => name.includes(t) || code.includes(t) || desc.includes(t));
   const deptOk = deptTokens.length ? deptTokens.some(t => (it.ownerDeptId || '').toString().toLowerCase() === t) : true;
   return textOk && deptOk;
  });
 }, [items, editSearch, editingKey, lines]);

 const selectEditItem = (it: Item) => {
  if (!canEditLines) return;
  setEditItemId(it.itemCode);
  setEditUnit(it.allowedUnits?.[0] || it.unit || '');
  setEditSearch(it.nameEn || it.nameAr || it.itemCode);
  setEditOpen(false);
 };

 const saveEdit = () => {
  if (!canEditLines || !editingKey) return;
  const it = items.find(x => x.itemCode === editItemId || (x.nameEn || x.nameAr) === editSearch);
  if (!it || !editUnit || editQty <= 0) return;
  const enforceInventory = storeTeamCanSeeDept(it.ownerDeptId as DeptId);
  if (enforceInventory) {
   const available = getAvailableQty(it.itemCode);
   if (typeof available === 'number' && editQty > available) {
    setError(`Cannot set ${it.itemCode} to ${editQty}. Only ${available} in stock.`);
    return;
   }
  }
  if (!canEditHeader && !deptUpperSet.has(String(it.ownerDeptId || '').toUpperCase())) return;
  setLines(prev => prev.map(l => {
   if (l.key !== editingKey) return l;
   const nextLine: SelectedLine = {
    ...l,
    key: l.key,
    itemId: it.itemCode,
    itemName: (it.nameEn || it.nameAr || it.itemCode),
    ownerDeptId: it.ownerDeptId as DeptId,
    unit: editUnit,
    qty: editQty,
    deleted: l.deleted,
   };
   return dropLineApproval(nextLine);
  }));
  setEditingKey(null);
  setEditOpen(false);
  setDirty(true);
 };

 const cancelEdit = () => { setEditingKey(null); setEditOpen(false); };
 const handleStartPreparing = () => transitionRequestStatus('STORE_PREPARING', 'Store started preparing the request');
 const handleCancelPreparing = () => transitionRequestStatus('FULLY_APPROVED', 'Store canceled preparing');
 const handleMarkReady = () => transitionRequestStatus('READY', 'Store marked the request READY');
 const handleCloseRequest = () => transitionRequestStatus('CLOSED', 'Request closed');

 const EditOverlay: React.FC = () => {
  if (!canEditLines || !editOpen || !editingKey) return null;
  const rect = editItemAnchorRef.current?.getBoundingClientRect(); if (!rect) return null;
  const style: React.CSSProperties = { position: 'fixed', left: rect.left, top: rect.bottom + 4, width: rect.width, maxHeight: '28rem', overflowY: 'auto', zIndex: 9999 };
  return createPortal(
   <div id="item-edit-overlay" className="border bg-white rounded-md shadow" style={style} onMouseDown={e => e.preventDefault()}>
    {deptOrder.map(group => {
     const groupItems = filteredEditItems.filter(x => (x.ownerDeptId as any) === group).sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''));
     if (!groupItems.length) return null;
     return (
      <div key={group}>
       <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50">{group}</div>
       {groupItems.map(it => (
        <button key={it.itemCode} type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50" onMouseDown={e => { e.preventDefault(); selectEditItem(it); }}>
         {it.nameEn || it.nameAr || it.itemCode}
        </button>
       ))}
      </div>
     );
    })}
    {filteredEditItems.length === 0 && <div className="px-3 py-2 text-gray-500">No items</div>}
   </div>,
   document.body
  );
 };

 const headerTitle = viewMode ? (existingMeta?.rqCode || existingRqParam || 'Request') : 'New Request';
 const submittedName = viewMode && existingMeta
  ? (existingMeta.createdBy?.fullName || existingMeta.createdBy?.email || '-')
  : fullName;
 const submittedDept = viewMode && existingMeta
  ? (existingMeta.createdBy?.departmentId || existingMeta.fromDept || '-')
  : ((myDeptIds || []).join(' \u00B7 ') || '-');
 const selectedProjectName = useMemo(() => {
  const p = projects.find(pr => pr.id === projectId);
  return p ? (p.nameEn || p.nameAr || p.name || p.id) : '';
 }, [projects, projectId]);
 const selectedEngineerName = useMemo(() => {
  const e = engineers.find(en => en.id === engineerId);
  return e ? (e.nameEn || e.nameAr || e.id) : '';
 }, [engineers, engineerId]);
  const filterItemsForQuery = useCallback((query: string, excludeExisting: boolean) => {
    const q = query.trim();
    const raw = q.toLowerCase();
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const deptTokens = tokens.filter(t => deptOrder.some(d => d.toLowerCase() === t));
    const textTokens = tokens.filter(t => !deptTokens.includes(t));
    const existing = new Set(lines.map(l => l.itemId));
    return items.filter(it => {
      if (excludeExisting && existing.has(it.itemCode)) return false;
      if (!q) return true;
      const name = (it.nameEn || it.nameAr || '').toLowerCase();
      const code = (it.itemCode || '').toLowerCase();
      const desc = (it.descriptionEn || it.descriptionAr || '').toLowerCase();
      const textOk = textTokens.every(t => name.includes(t) || code.includes(t) || desc.includes(t));
      const deptOk = deptTokens.length ? deptTokens.some(t => (it.ownerDeptId || '').toString().toLowerCase() === t) : true;
      return textOk && deptOk;
    });
  }, [items, lines, deptOrder]);

  const itemsGroupedByDept = useMemo(() => {
    const map = new Map<string, Item[]>();
    filterItemsForQuery(itemsSheetSearch, true)
      .forEach(it => {
        const dept = String(it.ownerDeptId || 'Other');
        if (!map.has(dept)) map.set(dept, []);
        map.get(dept)!.push(it);
      });
    map.forEach(list => list.sort((a, b) => (a.nameEn || a.nameAr || a.itemCode || '').localeCompare(b.nameEn || b.nameAr || b.itemCode || '')));
    return map;
  }, [filterItemsForQuery, itemsSheetSearch]);
 const itemDetailLine = useMemo(() => {
  if (!itemDetailKey) return null;
  return lines.find(l => l.key === itemDetailKey) || null;
 }, [itemDetailKey, lines]);
 const itemDetailItem = useMemo(() => {
  if (!itemDetailLine) return null;
  return items.find(i => i.itemCode === itemDetailLine.itemId) || null;
 }, [items, itemDetailLine]);
 const itemDetailUnits = useMemo(() => {
  if (itemDetailItem?.allowedUnits?.length) return itemDetailItem.allowedUnits;
  if (itemDetailItem?.unit) return [itemDetailItem.unit];
  if (itemDetailLine?.unit) return [itemDetailLine.unit];
  return [];
 }, [itemDetailItem, itemDetailLine]);
  const itemDetailAvailable = useMemo(
    () => (itemDetailLine ? getAvailableQty(itemDetailLine.itemId) : undefined),
    [itemDetailLine]
  );
  const canSeeItemDetailInventory = itemDetailLine ? storeTeamCanSeeDept(itemDetailLine.ownerDeptId) : false;
  const itemDetailQtyOptions = useMemo(() => Array.from({ length: 1000 }, (_, i) => i), []);
  useEffect(() => {
    if (!itemDetailLine) return;
    setItemDetailQty(itemDetailLine.qty);
    setItemDetailUnit(itemDetailLine.unit || '');
  }, [itemDetailLine]);
 const requestStatusBadge = viewMode && requestStatusRaw
  ? (
    <span className={`badge badge-status status-${String(requestStatusRaw).toLowerCase().replace(/\s+/g,'_')}`}>
     {requestStatusRaw}
    </span>
   )
  : null;
 if (loading || requestLoading) return <div className="card p-6">Loading...</div>;
 const handleCopyRqCode = async () => {
  if (!viewMode || !headerTitle) return;
  try {
   if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(headerTitle);
   } else {
    const area = document.createElement('textarea');
    area.value = headerTitle;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
   }
   if (copyTimeoutRef.current) {
    clearTimeout(copyTimeoutRef.current);
   }
   setCopiedRqCode(true);
   copyTimeoutRef.current = setTimeout(() => {
    setCopiedRqCode(false);
    copyTimeoutRef.current = null;
   }, 1500);
  } catch (err) {
   console.error('Failed to copy request code', err);
  }
 };
 const isDraftView = isDraftServer;
 const toggleSelectItem = (id: string) => {
  setItemsSheetSelection(prev => ({ ...prev, [id]: !prev[id] }));
 };
 const addSelectedItems = () => {
  const selectedIds = Object.entries(itemsSheetSelection).filter(([, v]) => v).map(([k]) => k);
  if (!selectedIds.length) return;
  setLines(prev => {
   const existingKeys = new Set(prev.map(l => `${l.itemId}|${l.ownerDeptId}`));
   const additions: SelectedLine[] = [];
   selectedIds.forEach(id => {
    const it = items.find(x => x.itemCode === id);
    if (!it) return;
    const key = `${it.itemCode}|${it.ownerDeptId}`;
    if (existingKeys.has(key)) return;
    const unit = (it.allowedUnits && it.allowedUnits[0]) || it.unit || '';
    additions.push({
     key: `${it.itemCode}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
     itemId: it.itemCode,
     itemName: it.nameEn || it.nameAr || it.itemCode,
     ownerDeptId: it.ownerDeptId,
     unit,
     qty: 0,
     status: 'PENDING_OWNER',
     ownerApprovedBy: null,
     ownerRejectedBy: null,
     deleted: false,
     removedBy: null,
     lockedDeleted: false,
     lockedRejected: false,
    });
   });
   if (!additions.length) return prev;
   return [...prev, ...additions];
  });
  setItemsSheetSelection({});
  setItemsSheetSearch('');
  setDirty(true);
  setItemsSheetOpen(false);
 };
 const openItemDetail = (line: SelectedLine) => {
  setItemDetailKey(line.key);
  setItemDetailQty(line.qty);
  setItemDetailUnit(line.unit || '');
  setItemDetailOpen(true);
 };
 const closeItemDetail = () => setItemDetailOpen(false);
  const changeItemDetailUnit = (unit: string) => {
    if (!itemDetailLine || readOnlyLines) return;
    setItemDetailUnit(unit);
    setLines(prev => prev.map(l => l.key === itemDetailLine.key ? { ...l, unit } : l));
    setDirty(true);
  };
  const changeItemDetailQty = (qty: number) => {
    if (!itemDetailLine || readOnlyLines) return;
    setItemDetailQty(qty);
    setLines(prev => prev.map(l => l.key === itemDetailLine.key ? { ...l, qty } : l));
    setDirty(true);
  };
  const adjustWheelQty = (delta: number) => {
    setItemDetailQty(prev => {
      const next = Math.min(999, Math.max(0, prev + delta));
      changeItemDetailQty(next);
      return next;
    });
  };
  const onWheelQty = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    adjustWheelQty(e.deltaY > 0 ? 1 : -1);
  };
  const onTouchStartQty = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartRef.current = e.touches[0].clientY;
  };
  const onTouchMoveQty = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartRef.current === null) return;
    const delta = touchStartRef.current - e.touches[0].clientY;
    if (Math.abs(delta) > 12) {
      adjustWheelQty(delta > 0 ? 1 : -1);
      touchStartRef.current = e.touches[0].clientY;
    }
  };
  const onTouchEndQty = () => {
    touchStartRef.current = null;
  };

 const showSaveDraftButton = isDraftServer && canPersistRequest;
 const showSubmitButton = isDraftServer && ((hasRequesterRole && isMyRequest) || (isDeptManagerRole && isMyFromDept));
 const showGeneralSaveButton = canPersistRequest && !isDraftServer;
 const showBackButton = true;
 const showCancelRequestButton = canCancelRequest;
 const handleBackClick = () => {
  if (dirty) {
   pendingNavRef.current = null;
   setPendingHref('/requests');
   setShowLeave(true);
   return;
  }
  nav('/requests');
 };
 const handleCancelRequestClick = () => {
  if (cancelBusy) return;
  void onCancelRequest();
 };

 return (
  <div className="space-y-4">
   {/* Mobile header & grouped card */}
   <div className="sm:hidden space-y-4">
    <div className="flex items-center justify-between">
     {viewMode ? (
      <button
       type="button"
       className="text-xl font-semibold inline-flex items-center gap-2 hover:text-blue-700 focus:outline-none"
       onClick={handleCopyRqCode}
       title="Copy request code"
      >
       <span>{headerTitle}</span>
       {copiedRqCode && <span className="text-xs font-medium text-green-600">Copied</span>}
      </button>
     ) : (
      <div className="text-xl font-semibold">New Request</div>
     )}
     {viewMode && requestStatusBadge}
    </div>

    {/* Collapsible info card */}
        <div className="card border">
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between"
            onClick={() => setInfoOpen(v => !v)}
          >
            <div className="text-base font-semibold text-gray-800">Details</div>
            <div className="flex items-center gap-2 text-sm text-blue-600">
              {infoOpen ? 'Hide' : 'Show'}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${infoOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
     {infoOpen && (
      <div className="px-4 pb-4 space-y-3">
       <div className="flex items-center justify-between text-xs text-gray-500">
        <div>
         <div className="text-[11px] uppercase tracking-wide text-gray-500">Requested By</div>
         <div className="text-sm font-semibold text-gray-800">{submittedName}</div>
        </div>
        <div className="text-right">
         <div className="text-[11px] uppercase tracking-wide text-gray-500">Department</div>
         <div className="text-sm font-semibold text-gray-800">{submittedDept}</div>
        </div>
       </div>
       {/* Project selector */}
       <button
        type="button"
        className={`w-full px-4 py-3 rounded-xl border text-left font-semibold ${projectId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-200'}`}
        onClick={() => { if (readOnly) return; setShowProjectSheet(true); }}
        disabled={readOnly}
       >
        {projectId ? selectedProjectName || 'Project' : 'Select Project'}
       </button>

       {/* Engineer selector */}
       <button
        type="button"
        className={`w-full px-4 py-3 rounded-xl border text-left font-semibold ${engineerId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-200'}`}
        onClick={() => { if (readOnly) return; setShowEngineerSheet(true); }}
        disabled={readOnly}
       >
        {engineerId ? selectedEngineerName || 'Engineer' : 'Select Engineer'}
       </button>

       {/* Urgent toggle */}
       <div className={`w-full px-4 py-3 rounded-xl border flex items-center justify-between ${urgent ? 'bg-red-50 border-red-400' : 'bg-white border-gray-200'}`}>
        <div className="text-sm font-semibold text-gray-700">Urgent</div>
        <button
         type="button"
         className={`h-7 w-12 rounded-full p-1 transition ${urgent ? 'bg-red-500 border border-red-500' : 'bg-gray-200'}`}
         onClick={() => { if (readOnly) return; setUrgent(!urgent); setDirty(true); }}
        >
         <div className={`h-5 w-5 rounded-full transition transform ${urgent ? 'bg-white translate-x-5' : 'bg-gray-400 translate-x-0'}`} />
        </button>
       </div>
      </div>
     )}
    </div>

        {/* Items card (mobile) */}
        <div className="card border">
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between"
            onClick={() => setItemsOpen(v => !v)}
          >
            <div className="text-base font-semibold text-gray-800">Items</div>
            <div className="flex items-center gap-2 text-sm text-blue-600">
              {itemsOpen ? 'Hide' : 'Show'}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${itemsOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
     {itemsOpen && (
      <div className="px-4 pb-4 space-y-3">
       {renderedLines.length > 0 && renderedLines.map(line => {
        const statusKey = normalizeLineStatus(line);
        const canSeeInventory = storeTeamCanSeeDept(line.ownerDeptId);
        const availableQty = canSeeInventory ? getAvailableQty(line.itemId) : undefined;
        const qtyLabel = typeof availableQty === 'number' ? `${line.qty}/${availableQty}` : `${line.qty}`;
        const statusInfo = lineStatusInfo(line);
        const statusTooltip = statusInfo?.tooltip || statusKey;
        const StatusIcon = statusInfo?.Icon;
        const statusWrapper = statusInfo?.wrapperClass || 'inline-flex items-center text-gray-500';
        const statusColorClass =
          (statusWrapper.split(' ').find(c => c.startsWith('text-'))) ||
          (statusKey === 'OWNER_APPROVED' ? 'text-green-600'
            : statusKey === 'PENDING_OWNER' ? 'text-amber-500'
            : statusKey === 'OWNER_REJECTED' ? 'text-red-600'
            : statusKey === 'DELETED' ? 'text-red-500'
            : 'text-gray-500');
        const statusIconCls = `${statusInfo?.iconClass || 'h-4 w-4'} ${statusColorClass}`;
        const ownerUpper = String(line.ownerDeptId || '').toUpperCase();
        const ownerStatusKey = String(line.status || '').toUpperCase();
        const lineStatusKey = normalizeLineStatus(line);
        const isDeleted = lineStatusKey === 'DELETED';
        const isRejected = ownerStatusKey === 'OWNER_REJECTED';
        const isApproved = ownerStatusKey === 'OWNER_APPROVED';
        const ownerDeptMatches = deptUpperSet.has(ownerUpper);
        const showApproveButtons = !isDraftView && !isDeleted && !isRejected && canApproveLines && ownerDeptMatches;
        const actionButtons: React.ReactNode[] = [];
        const canEditThisLine = canEditLines && (canEditHeader || ownerDeptMatches);
        const canShowDelete = canDeleteLine(line);
        const blockRejectForOwner = isDeptManagerRole && isMyRequest && canShowDelete;
        const canShowReject = canEditLines && allowRejectWindow && !isDraftView && isDeptManagerRole && (isMyFromDept || ownerDeptMatches) && !blockRejectForOwner;

        if (isDeleted) {
         if (!line.lockedDeleted && canEditThisLine && (isDraftView || dirty)) {
          actionButtons.push(
           <button key={`${line.key}-restore`} className="btn-ghost px-3 text-sm font-medium text-gray-700 border border-gray-300 bg-white" onClick={() => toggleDeleteLine(line)}>Restore</button>,
          );
         } else {
          actionButtons.push(<span key={`${line.key}-removed`} className="text-xs text-gray-400">Removed</span>);
         }
        } else if (isRejected) {
         if (canShowReject && dirty && !line.lockedRejected) {
          actionButtons.push(
           <button key={`${line.key}-accept`} className="btn-ghost px-3 text-sm font-medium text-green-700 border border-green-400 bg-white" onClick={() => rejectLine(line)}>Accept</button>,
          );
         } else {
          actionButtons.push(<span key={`${line.key}-rejected`} className="text-xs text-red-600 font-semibold">Rejected</span>);
         }
        } else if (isApproved && showApproveButtons) {
         actionButtons.push(
          <button
           key={`${line.key}-disapprove`}
           className="btn-ghost px-3 text-sm font-medium text-amber-700 border border-amber-400 bg-white"
           onClick={()=>unapproveLine(line)}
          >
           Disapprove
          </button>,
         );
        } else {
         if (canEditThisLine) {
          actionButtons.push(
           <button key={`${line.key}-edit`} className="btn-ghost" onClick={() => openItemDetail(line)}><Pencil className="h-4 w-4 icon-blue" /></button>,
          );
          if (canShowDelete) {
           actionButtons.push(
            <button key={`${line.key}-del`} className="btn-ghost" onClick={() => toggleDeleteLine(line)}><Trash2 className="h-4 w-4 text-red-600" /></button>,
           );
          }
         } else {
          actionButtons.push(<span key={`${line.key}-view`} className="text-xs text-gray-400">View only</span>);
         }
         if (canShowReject) {
          actionButtons.push(
           <button
            key={`${line.key}-reject`}
            className="btn-line-reject"
            title="Reject item"
            onClick={() => rejectLine(line)}
           >
            <XCircle className="h-4 w-4 text-white" />
           </button>,
          );
         }
         if (showApproveButtons) {
          actionButtons.push(
           <button
            key={`${line.key}-approve`}
            className="btn-line-approve"
            title="Approve"
            onClick={()=>approveLine(line)}
           >
            <CheckCircle className="h-4 w-4 text-white" />
           </button>,
          );
         }
        }

        return (
         <div
          key={line.key}
          className={`w-full rounded-xl border border-gray-200 p-3 bg-white shadow-sm text-left transition-all duration-300 ease-out ${line.deleted ? 'bg-gray-50 border-dashed border-red-200' : ''}`}
         >
          <div className="flex items-start gap-3">
           <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
            {StatusIcon && (
             <span className={statusWrapper}>
              <StatusIcon className={statusIconCls} />
             </span>
            )}
             <div className="text-sm font-semibold text-gray-900 break-words">
              {line.itemName} <span className="text-gray-500 text-xs">({line.itemId})</span>
             </div>
            </div>
            <div className="text-[11px] text-gray-500 mt-2">
             {line.deleted ? (statusTooltip || 'Removed') : statusTooltip}
            </div>
           </div>
           <div className="text-right space-y-2 min-w-[140px]">
            <div className="flex items-baseline justify-end gap-1">
             <span className="text-xs text-gray-400">{line.unit || '-'}</span>
             <div className="flex items-baseline gap-1">
              <span className={`text-lg font-semibold ${line.qty === 0 ? 'text-red-600' : 'text-gray-900'}`}>{line.qty}</span>
              {typeof availableQty === 'number' && <span className="text-xs text-gray-400">/{availableQty}</span>}
             </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
             {actionButtons}
            </div>
           </div>
          </div>
         </div>
        );
              })}

       {canAddLines && (
         <button
          type="button"
          className="w-full px-4 py-3 rounded-xl border text-center font-semibold text-blue-700 border-blue-200 hover:border-blue-400"
          onClick={() => setItemsSheetOpen(true)}
         >
          Select New Item
         </button>
       )}
      </div>
     )}
        </div>

        {/* Notes card (mobile) */}
        <div className="card border">
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center justify-between"
            onClick={() => setNotesOpen(v => !v)}
          >
            <div className="text-base font-semibold text-gray-800">
              Notes <span className="text-sm text-gray-400 font-medium">(optional)</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-blue-600">
              {notesOpen ? 'Hide' : 'Show'}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${notesOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
          {notesOpen && (
            <div className="px-4 pb-4">
              <textarea
                autoComplete="off"
                className={`input resize-none w-full ${!canEditNotes ? 'cursor-not-allowed bg-gray-100 text-gray-600' : ''}`}
                rows={4}
                wrap="off"
                style={{ overflowX: 'auto', overflowY: 'auto', whiteSpace: 'pre' }}
                value={note}
                readOnly={!canEditNotes}
                disabled={!canEditNotes}
                onChange={e => handleNoteChange(e.target.value)}
                placeholder="Notes (Optional)"
              ></textarea>
            </div>
          )}
        </div>

        {viewMode && (
          <div className="sm:hidden card mt-4 p-0 overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100"
              onClick={() => setHistoryOpen(prev => !prev)}
            >
              <span className="text-base font-semibold text-gray-800">History</span>
              <div className="flex items-center gap-2 text-sm text-blue-600">
                {historyOpen ? 'Hide' : 'Show'}
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            <div
              className={`transition-[max-height] duration-300 ${historyOpen ? 'max-h-[320px]' : 'max-h-0'} overflow-hidden`}
            >
              {historyOpen && (
                <div className="max-h-[320px] overflow-y-auto">
                  {activityLoading ? (
                    <div className="px-4 py-6 text-sm text-gray-500">Loading…</div>
                  ) : activityEntries.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-gray-500">No history yet.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <ul className="divide-y divide-gray-100 min-w-full">
                        {activityEntries.map(entry => {
                          const expanded = !!expandedHistory[entry.id];
                          return (
                            <li key={entry.id}>
                              <button
                                type="button"
                                className="w-full px-4 py-3 text-left"
                                onClick={() => toggleHistoryEntry(entry.id)}
                              >
                                <div className="flex items-start gap-3">
                                  <span className={`mt-1 h-2.5 w-2.5 rounded-full ${historyColorForEntry(entry)}`} />
                                  <div className="flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="text-sm font-semibold text-gray-900">{formatActorLabel(entry.actor)}</p>
                                      <span className="text-xs text-gray-400 whitespace-nowrap">
                                        {entry.createdAt ? formatActivityTime(entry.createdAt) : ''}
                                      </span>
                                    </div>
                                    {expanded && entry.details && entry.details.trim() && (
                                      <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">
                                        {entry.details}
                                      </p>
                                    )}
                                  </div>
                                  <ChevronDown
                                    className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                                  />
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mobile action buttons */}
        <div className="sm:hidden space-y-2">
          {error && <div className="text-red-600 text-sm font-semibold">{error}</div>}
          <div className="flex flex-wrap gap-2 justify-end">
            {showBackButton && (
              <button
                className="btn-ghost"
                onClick={handleBackClick}
              >
                Back
              </button>
            )}
            {showCancelRequestButton && (
              <button
                className="btn-ghost text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={busy || cancelBusy}
                onClick={handleCancelRequestClick}
              >
                {cancelBusy ? 'Canceling...' : 'Cancel Request'}
              </button>
            )}
            {showSaveDraftButton && (
              <button className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed" disabled={!dirty || busy} onClick={onSaveDraftClick}>
                {busy ? 'Saving...' : 'Save Draft'}
              </button>
            )}
            {showPreparingButton && (
              <button
                className="btn-primary bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={storeActionBusy}
                onClick={handleStartPreparing}
              >
                {storeActionBusy ? 'Updating...' : 'PREPARING'}
              </button>
            )}
            {showCancelPreparingButton && (
              <button
                className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={storeActionBusy}
                onClick={handleCancelPreparing}
              >
                {storeActionBusy ? 'Updating...' : 'Cancel PREPARING'}
              </button>
            )}
            {showReadyButton && (
              <button
                className="btn-primary bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={storeActionBusy}
                onClick={handleMarkReady}
              >
                {storeActionBusy ? 'Updating...' : 'READY'}
              </button>
            )}
            {canShowCloseButton && (
              <button
                className="btn-primary bg-gray-900 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={storeActionBusy}
                onClick={handleCloseRequest}
              >
                {storeActionBusy ? 'Updating...' : 'Close'}
              </button>
            )}
            {showGeneralSaveButton && (
              <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={!dirty || busy} onClick={onSaveChangesClick}>
                {busy ? 'Saving...' : 'Save'}
              </button>
            )}
            {showSubmitButton && (
              <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={busy} onClick={onSubmitClick}>
                {busy ? 'Sending...' : 'Submit'}
              </button>
            )}
          </div>
        </div>
      </div>

   {/* Desktop / tablet original layout */}
   <div className="hidden sm:block space-y-4">
    <div className="flex items-center gap-3">
     {viewMode ? (
      <button
       type="button"
       className="text-xl font-semibold inline-flex items-center gap-2 hover:text-blue-700 focus:outline-none"
       onClick={handleCopyRqCode}
       title="Copy request code"
      >
       <span>{headerTitle}</span>
       {copiedRqCode && <span className="text-xs font-medium text-green-600">Copied</span>}
      </button>
     ) : (
      <div className="text-xl font-semibold">{headerTitle}</div>
     )}
     {requestStatusBadge}
    </div>
    <div className="card p-6 space-y-4">
     <div className="grid sm:grid-cols-3 gap-3">
     <div>
      <div className="text-sm text-gray-600">Requested By</div>
      <div className="font-semibold">{submittedName}</div>
     </div>
     <div>
      <div className="text-sm text-gray-600">Department</div>
      <div className="font-semibold">{submittedDept}</div>
     </div>
     <div className="flex items-center gap-2">
      <label className="flex items-center gap-2">
       <input type="checkbox" checked={urgent} disabled={readOnly} onChange={e => { if (readOnly) return; setUrgent(e.target.checked); setDirty(true); }} className={readOnly ? 'cursor-not-allowed accent-gray-400' : ''} />
       <span>Urgent</span>
      </label>
     </div>
    </div>

    <div className="card table-card">
     <div className="overflow-x-auto">
      <table className="table-modern">
       <thead className="table-head">
       <tr>
        <th className="table-head-cell"><span className="header-content">Item name</span></th>
        <th className="table-head-cell"><span className="header-content">Owner dept</span></th>
        <th className="table-head-cell"><span className="header-content">Unit</span></th>
        <th className="table-head-cell"><span className="header-content">Quantity</span></th>
        <th className="table-head-cell"><span className="header-content">Actions</span></th>
       </tr>
      </thead>
      <tbody>
       {renderedLines.map(l => {
        const ownerUpper = String(l.ownerDeptId || '').toUpperCase();
        const canSeeInventory = storeTeamCanSeeDept(l.ownerDeptId);
        const availableQty = canSeeInventory ? getAvailableQty(l.itemId) : undefined;
        const qtyDisplay = canSeeInventory && typeof availableQty === 'number'
         ? (
           <span>
            <strong className="text-lg font-semibold text-gray-900">{l.qty}</strong>
            <span className="text-gray-500">/{availableQty}</span>
           </span>
          )
         : l.qty;
        const statusIcon = renderLineStatusIcon(l);
        const ownerDeptMatches = deptUpperSet.has(String(l.ownerDeptId || '').toUpperCase());
        const ownerStatusKey = String(l.status || '').toUpperCase();
        const lineStatusKey = normalizeLineStatus(l);
        const isDeleted = lineStatusKey === 'DELETED';
        const isRejected = ownerStatusKey === 'OWNER_REJECTED';
        const isApproved = ownerStatusKey === 'OWNER_APPROVED';
        const showApproveButtons = !isDraftView && !isDeleted && !isRejected && canApproveLines && ownerDeptMatches;
        const actionButtons: React.ReactNode[] = [];
        const canEditThisLine = canEditLines && (canEditHeader || ownerDeptMatches);
        const canShowDelete = canDeleteLine(l);
        const blockRejectForOwner = isDeptManagerRole && isMyRequest && canShowDelete;
        const canShowReject = canEditLines && allowRejectWindow && !isDraftView && isDeptManagerRole && (isMyFromDept || ownerDeptMatches) && !blockRejectForOwner;

        if (isDeleted) {
         if (!l.lockedDeleted && canEditThisLine && (isDraftView || dirty)) {
          actionButtons.push(
           <button key={`${l.key}-restore`} className="btn-ghost px-4 text-sm font-medium text-gray-700 border border-gray-300 bg-white transition-all duration-150" onClick={() => toggleDeleteLine(l)}>Restore</button>,
          );
         } else {
          actionButtons.push(<span key={`${l.key}-removed`} className="text-xs text-gray-400">Removed</span>);
         }
        } else if (isRejected) {
         if (canShowReject && dirty && !l.lockedRejected) {
          actionButtons.push(
           <button key={`${l.key}-accept`} className="btn-ghost px-4 text-sm font-medium text-green-700 border border-green-400 bg-white transition-all duration-150" onClick={() => rejectLine(l)}>Accept</button>,
          );
         } else {
          actionButtons.push(<span key={`${l.key}-rejected`} className="text-xs text-red-600 font-semibold">Rejected</span>);
         }
        } else if (isApproved && showApproveButtons) {
         actionButtons.push(
          <button
           key={`${l.key}-disapprove`}
           className="btn-ghost px-4 text-sm font-medium text-amber-700 border border-amber-400 bg-white transition-all duration-150"
           onClick={()=>unapproveLine(l)}
          >
           Disapprove
          </button>,
         );
        } else {
         if (canEditThisLine) {
          actionButtons.push(
           <button key={`${l.key}-edit`} className="btn-ghost" onClick={() => startEdit(l.key)}><Pencil className="h-4 w-4 icon-blue" /></button>,
          );
          if (canShowDelete) {
           actionButtons.push(
            <button key={`${l.key}-del`} className="btn-ghost" onClick={() => toggleDeleteLine(l)}><Trash2 className="h-4 w-4 text-red-600" /></button>,
           );
          }
         } else {
          actionButtons.push(<span key={`${l.key}-view`} className="text-xs text-gray-400">View only</span>);
         }
         if (canShowReject) {
          actionButtons.push(
           <button
            key={`${l.key}-reject`}
            className="btn-line-reject"
            title="Reject item"
            onClick={() => rejectLine(l)}
           >
            <XCircle className="h-4 w-4 text-white" />
           </button>,
          );
         }
         if (showApproveButtons) {
          actionButtons.push(
           <button
            key={`${l.key}-approve`}
            className="btn-line-approve"
            title="Approve"
            onClick={()=>approveLine(l)}
           >
            <CheckCircle className="h-4 w-4 text-white" />
           </button>,
          );
         }
        }
        if (!canEditLines) {
         return (
          <tr key={l.key} className="table-row">
           <td className="p-3">
            <div className="flex items-center gap-2">
             {statusIcon}
             <span>{l.itemName} <span className="text-gray-500">({l.itemId})</span></span>
            </div>
           </td>
           <td className="p-3">{l.ownerDeptId}</td>
           <td className="p-3">{l.unit}</td>
           <td className="p-3">{qtyDisplay}</td>
           <td className="p-3">
            <div className="flex flex-wrap gap-2 transition-all duration-200">
             {actionButtons}
            </div>
           </td>
          </tr>
         );
        }
        const isEdit = l.key === editingKey;
        if (!isEdit) return (
         <tr key={l.key} className="table-row">
          <td className="p-3">
           <div className="flex items-center gap-2">
            {statusIcon}
            <span>{l.itemName} <span className="text-gray-500">({l.itemId})</span></span>
           </div>
          </td>
          <td className="p-3">{l.ownerDeptId}</td>
          <td className="p-3">{l.unit}</td>
          <td className="p-3">{qtyDisplay}</td>
          <td className="p-3">
           <div className="flex flex-wrap gap-2 transition-all duration-200">
            {actionButtons}
           </div>
          </td>
         </tr>
        );

        const editCur = items.find(i => i.itemCode === editItemId) || items.find(i => (i.nameEn || i.nameAr) === editSearch);
        const editUnits = editCur?.allowedUnits?.length ? editCur.allowedUnits : (editCur?.unit ? [editCur.unit] : []);
        return (
         <tr key={l.key} className="table-row bg-gray-50">
          <td className="p-3 align-top">
           <div ref={editItemAnchorRef} className="relative">
            <input autoComplete="off" className="input pr-16" placeholder="Search item" value={editSearch}
             onFocus={() => { if (readOnly) return; setEditOpen(true); setProjOpen(false); setEngOpen(false); setComboOpen(false); }}
             onChange={e => { setEditSearch(e.target.value); setEditOpen(true); setProjOpen(false); setEngOpen(false); setComboOpen(false); }}
             onKeyDown={e => { if (e.key === 'Escape') setEditOpen(false); }} />
            {canEditLines && editSearch && (
             <button
              type="button"
              className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              aria-label="Clear item search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setEditSearch(''); setEditItemId(''); setEditUnit(''); setEditOpen(true); }}
             >
              <X className="h-4 w-4" />
             </button>
            )}
            <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <EditOverlay />
           </div>
          </td>
          <td className="p-3 align-top">{editCur?.ownerDeptId || l.ownerDeptId}</td>
          <td className="p-3 align-top">
           <select className="input" disabled={!editCur} value={editUnit} onChange={e => setEditUnit(e.target.value)}>
            <option value="">Unit</option>
            {editUnits.map(u => <option key={u} value={u}>{u}</option>)}
           </select>
          </td>
          <td className="p-3 align-top">
           <input autoComplete="off" className="input" type="number" min={1} value={editQty} onChange={e => setEditQty(Number(e.target.value))} />
          </td>
          <td className="p-3 align-top">
           <div className="flex gap-2">
            <button type="button" className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={!editCur || !editUnit || editQty <= 0} onClick={saveEdit}>Save</button>
            <button type="button" className="btn-ghost" onClick={cancelEdit}>Cancel</button>
           </div>
          </td>
         </tr>
        );
       })}
       {canAddLines && (
       <tr className="table-row bg-white/60">
        <td className="p-3 align-top">
         <div ref={itemAnchorRef} className="relative">
          <input autoComplete="off" className="input pr-16" placeholder="Search item (e.g. HSE, FI)" value={search}
           onFocus={() => { if (!canAddLines) return; setComboOpen(true); setProjOpen(false); setEngOpen(false); }}
           onChange={e => { if (!canAddLines) return; setSearch(e.target.value); setComboOpen(true); setProjOpen(false); setEngOpen(false); }}
           onKeyDown={e => { if (e.key === 'Escape') setComboOpen(false); }} />
          {canAddLines && (search || draftItemId) && (
           <button
            type="button"
            className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
            aria-label="Clear item selection"
            onMouseDown={e => e.preventDefault()}
            onClick={() => { resetDraftRow(); setAddErr(''); setComboOpen(false); }}
           >
            <X className="h-4 w-4" />
           </button>
          )}
          <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <ItemOverlay />
         </div>
         {addErr && <div className="text-red-600 text-xs mt-1">{addErr}</div>}
        </td>
        <td className="p-3 align-top">{currentItem?.ownerDeptId || '-'}</td>
        <td className="p-3 align-top">
         <select className="input" disabled={!currentItem} value={draftUnit} onChange={e => setDraftUnit(e.target.value)}>
          <option value="">Unit</option>
          {allowedUnits.map(u => <option key={u} value={u}>{u}</option>)}
         </select>
        </td>
        <td className="p-3 align-top">
         <input autoComplete="off" className="input" type="number" min={1} value={draftQty} onChange={e => setDraftQty(Number(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') addOrUpdateLine(); if (e.key === 'Escape') { setSearch(''); setDraftUnit(''); setDraftQty(1); } }} placeholder="Quantity" />
        </td>
        <td className="p-3 align-top">
         <div className="flex gap-2">
          <button type="button" className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canAddLines || !currentItem || !draftUnit || draftQty <= 0} onClick={addOrUpdateLine}>Add</button>
          <button type="button" className="btn-ghost" onClick={() => { setSearch(''); setDraftUnit(''); setDraftQty(1); setComboOpen(false); }}>Clear</button>
         </div>
        </td>
       </tr>
       )}
     </tbody>
      </table>
     </div>
    </div>

    <div className="grid sm:grid-cols-3 gap-3">
     <div>
      <label className="text-sm text-gray-600 block mb-1">Project</label>
      <div ref={projAnchorRef} className="relative">
       <input ref={projectInputRef} autoComplete="off" className={`input pr-16 ${readOnly ? 'cursor-not-allowed bg-gray-100 text-gray-600' : ''}`} placeholder="Select project" value={projectQuery}
        disabled={readOnly} readOnly={readOnly}
        onFocus={() => { if (readOnly) return; setProjOpen(true); setEngOpen(false); }}
        onChange={e => { if (readOnly) return; setProjectQuery(e.target.value); setProjOpen(true); setEngOpen(false); setDirty(true); }} />
       {showProjectClear && (
        <button
         type="button"
         className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
         aria-label="Clear project selection"
         onMouseDown={e => e.preventDefault()}
         onClick={clearProjectSelection}
        >
         <X className="h-4 w-4" />
        </button>
       )}
       <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
       {projOpen && (
        <div className="absolute z-10 mt-1 w-full border bg-white rounded-md shadow" style={{ maxHeight: '28rem', overflowY: 'auto' }}>
         {projects
          .filter(p => { const q = projectQuery.toLowerCase(); const name = (p.nameEn || p.nameAr || p.name || '').toLowerCase(); return !q || name.includes(q); })
          .sort((a, b) => (a.nameEn || a.nameAr || a.name || '').localeCompare(b.nameEn || b.nameAr || b.name || ''))
          .map(p => (
           <button key={p.id} type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50" onClick={() => { setProjectId(p.id); setProjectQuery(p.nameEn || p.nameAr || p.name || ''); setProjOpen(false); }}>{p.nameEn || p.nameAr || p.name}</button>
          ))}
         {projects.length === 0 && <div className="px-3 py-2 text-gray-500">No projects</div>}
        </div>
       )}
      </div>
     </div>
     <div>
      <label className="text-sm text-gray-600 block mb-1">Engineer</label>
      <div ref={engAnchorRef} className="relative">
       <input ref={engineerInputRef} autoComplete="off" className={`input pr-16 ${readOnly ? 'cursor-not-allowed bg-gray-100 text-gray-600' : ''}`} placeholder="Select engineer" value={engineerQuery}
        disabled={readOnly} readOnly={readOnly}
        onFocus={() => { if (readOnly) return; setEngOpen(true); setProjOpen(false); }}
        onChange={e => { if (readOnly) return; setEngineerQuery(e.target.value); setEngOpen(true); setProjOpen(false); setDirty(true); }} />
       {showEngineerClear && (
        <button
         type="button"
         className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
         aria-label="Clear engineer selection"
         onMouseDown={e => e.preventDefault()}
         onClick={clearEngineerSelection}
        >
         <X className="h-4 w-4" />
        </button>
       )}
       <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
       {engOpen && (
        <div className="absolute z-10 mt-1 w-full border bg-white rounded-md shadow" style={{ maxHeight: '28rem', overflowY: 'auto' }}>
         {engineers
          .filter(en => { const q = engineerQuery.toLowerCase(); const name = (en.nameEn || en.nameAr || '').toLowerCase(); return !q || name.includes(q); })
          .sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''))
          .map(en => (
           <button key={en.id} type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50" onClick={() => { setEngineerId(en.id); setEngineerQuery(en.nameEn || en.nameAr || ''); setEngOpen(false); }}>{en.nameEn || en.nameAr}</button>
          ))}
         {engineers.length === 0 && <div className="px-3 py-2 text-gray-500">No engineers</div>}
        </div>
       )}
      </div>
     </div>
    </div>

    {/* Notes */}
    <div>
     <label className="text-sm text-gray-600 block mb-1">Notes (Optional)</label>
     <textarea
      autoComplete="off"
      className={`input resize-none ${!canEditNotes ? 'cursor-not-allowed bg-gray-100 text-gray-600' : ''}`}
      rows={3}
      wrap="off"
      style={{ overflowX: 'auto', overflowY: 'auto', whiteSpace: 'pre' }}
      value={note}
      readOnly={!canEditNotes}
      disabled={!canEditNotes}
      onChange={e => handleNoteChange(e.target.value)}
      placeholder="Notes (Optional)"
     ></textarea>
    </div>

    {error && <div className="text-red-600">{error}</div>}

    <div className="flex flex-wrap gap-2 justify-end">
     {showBackButton && (
      <button
       className="btn-ghost"
       onClick={handleBackClick}
      >
       Back
      </button>
     )}
    {showCancelRequestButton && (
     <button
      className="btn-ghost text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={busy || cancelBusy}
      onClick={handleCancelRequestClick}
      >
       {cancelBusy ? 'Canceling...' : 'Cancel Request'}
      </button>
     )}
    {showSaveDraftButton && (
     <button className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed" disabled={!dirty || busy} onClick={onSaveDraftClick}>
      {busy ? 'Saving...' : 'Save Draft'}
     </button>
    )}
    {showPreparingButton && (
     <button
      className="btn-primary bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={storeActionBusy}
      onClick={handleStartPreparing}
     >
      {storeActionBusy ? 'Updating...' : 'PREPARING'}
     </button>
    )}
    {showCancelPreparingButton && (
     <button
      className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={storeActionBusy}
      onClick={handleCancelPreparing}
     >
      {storeActionBusy ? 'Updating...' : 'Cancel PREPARING'}
     </button>
    )}
    {showReadyButton && (
     <button
      className="btn-primary bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={storeActionBusy}
      onClick={handleMarkReady}
     >
      {storeActionBusy ? 'Updating...' : 'READY'}
     </button>
    )}
    {canShowCloseButton && (
     <button
      className="btn-primary bg-gray-900 hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={storeActionBusy}
      onClick={handleCloseRequest}
     >
      {storeActionBusy ? 'Updating...' : 'Close'}
     </button>
    )}
    {showGeneralSaveButton && (
     <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={!dirty || busy} onClick={onSaveChangesClick}>
      {busy ? 'Saving...' : 'Save'}
     </button>
    )}
     {showSubmitButton && (
      <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={busy} onClick={onSubmitClick}>
       {busy ? 'Sending...' : 'Submit'}
      </button>
     )}
    </div>
   </div>

      {viewMode && (
        <div className="card mt-6 p-0 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100"
            onClick={() => setHistoryOpen(prev => !prev)}
          >
      <span className="text-base font-semibold text-gray-800">History</span>
      <div className="flex items-center gap-2 text-sm text-blue-600">
       {historyOpen ? 'Hide' : 'Show'}
       <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`} />
      </div>
     </button>
     <div
      className={`transition-[max-height] duration-300 ${historyOpen ? 'max-h-[320px]' : 'max-h-0'} overflow-hidden`}
     >
      {historyOpen && (
       <div className="max-h-[320px] overflow-y-auto">
        {activityLoading ? (
         <div className="px-4 py-6 text-sm text-gray-500">Loadingâ€¦</div>
        ) : activityEntries.length === 0 ? (
         <div className="px-4 py-6 text-sm text-gray-500">No history yet.</div>
        ) : (
         <div className="overflow-x-auto">
          <ul className="divide-y divide-gray-100 min-w-full">
           {activityEntries.map(entry => {
            const expanded = !!expandedHistory[entry.id];
            return (
             <li key={entry.id}>
              <button
               type="button"
               className="w-full px-4 py-3 text-left"
               onClick={() => toggleHistoryEntry(entry.id)}
              >
               <div className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${historyColorForEntry(entry)}`} />
                <div className="flex-1">
                 <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">{formatActorLabel(entry.actor)}</p>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                   {entry.createdAt ? formatActivityTime(entry.createdAt) : ''}
                  </span>
                 </div>
                 {expanded && entry.details && entry.details.trim() && (
                  <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">
                   {entry.details}
                  </p>
                 )}
                </div>
                <ChevronDown
                 className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                />
               </div>
              </button>
             </li>
            );
           })}
          </ul>
         </div>
        )}
       </div>
      )}
     </div>
    </div>
   )}

   </div>{/* end desktop/tablet content */}

      {/* Mobile project selector */}
   {showProjectSheet && (
    <div className="sm:hidden fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={()=>setShowProjectSheet(false)}>
     <div className="bg-white rounded-t-3xl h-[75vh] p-4 flex flex-col" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
       <div className="text-base font-semibold">Select Project</div>
       <button className="btn-ghost" onClick={()=>setShowProjectSheet(false)}>X</button>
      </div>
      <input
       autoComplete="off"
       className="input mb-3"
       placeholder="Search project"
       value={mobileProjectSearch}
       onChange={e=>setMobileProjectSearch(e.target.value)}
      />
      <div className="flex-1 overflow-y-auto space-y-1">
       {projects
        .filter(p => {
         const q = mobileProjectSearch.toLowerCase();
         const name = (p.nameEn || p.nameAr || p.name || '').toLowerCase();
         return !q || name.includes(q);
        })
        .sort((a, b) => (a.nameEn || a.nameAr || a.name || '').localeCompare(b.nameEn || b.nameAr || b.name || ''))
        .map(p => (
         <button
          key={p.id}
          type="button"
          className="w-full text-left px-3 py-2 rounded-lg border hover:bg-blue-50"
          onClick={() => {
           setProjectId(p.id);
           setProjectQuery(p.nameEn || p.nameAr || p.name || '');
           setShowProjectSheet(false);
           setDirty(true);
          }}
         >
          {p.nameEn || p.nameAr || p.name || p.id}
         </button>
        ))}
       {projects.length === 0 && <div className="px-3 py-2 text-gray-500">No projects</div>}
      </div>
     </div>
    </div>
   )}

   {/* Mobile engineer selector */}
          {showEngineerSheet && (
            <div className="sm:hidden fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={()=>setShowEngineerSheet(false)}>
              <div className="bg-white rounded-t-3xl h-[75vh] p-4 flex flex-col" onClick={e=>e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-base font-semibold">Select Engineer</div>
       <button className="btn-ghost" onClick={()=>setShowEngineerSheet(false)}>X</button>
      </div>
      <input
       autoComplete="off"
       className="input mb-3"
       placeholder="Search engineer"
       value={mobileEngineerSearch}
       onChange={e=>setMobileEngineerSearch(e.target.value)}
      />
      <div className="flex-1 overflow-y-auto space-y-1">
       {engineers
        .filter(en => {
         const q = mobileEngineerSearch.toLowerCase();
         const name = (en.nameEn || en.nameAr || '').toLowerCase();
         return !q || name.includes(q);
        })
        .sort((a, b) => (a.nameEn || a.nameAr || '').localeCompare(b.nameEn || b.nameAr || ''))
        .map(en => (
         <button
          key={en.id}
          type="button"
          className="w-full text-left px-3 py-2 rounded-lg border hover:bg-blue-50"
          onClick={() => {
           setEngineerId(en.id);
           setEngineerQuery(en.nameEn || en.nameAr || '');
           setShowEngineerSheet(false);
           setDirty(true);
          }}
         >
          {en.nameEn || en.nameAr || en.id}
         </button>
        ))}
       {engineers.length === 0 && <div className="px-3 py-2 text-gray-500">No engineers</div>}
      </div>
     </div>
    </div>
   )}

   {/* Mobile item selector */}
   {itemsSheetOpen && (
    <div className="sm:hidden fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => { setItemsSheetOpen(false); setItemsSheetSelection({}); }}>
     <div className="bg-white rounded-t-3xl h-[75vh] p-4 flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
       <div className="text-base font-semibold">Select New Item</div>
       <button className="btn-ghost" onClick={() => { setItemsSheetOpen(false); setItemsSheetSelection({}); }}>X</button>
      </div>
      <input
       autoComplete="off"
       className="input mb-3"
       placeholder="Search items"
       value={itemsSheetSearch}
       onChange={e => setItemsSheetSearch(e.target.value)}
      />
      <div className="flex-1 overflow-y-auto space-y-3 pb-24">
       {(() => {
        const orderedDepts = [...deptOrder, ...Array.from(itemsGroupedByDept.keys()).filter(d => !deptOrder.includes(d))];
        if (!orderedDepts.length) {
         return <div className="text-sm text-gray-500 px-2">No items</div>;
        }
        return orderedDepts.map(dept => {
         const list = itemsGroupedByDept.get(dept) || [];
         if (!list.length) return null;
         return (
          <div key={dept} className="space-y-2">
           <div className="text-xs text-gray-500 font-semibold px-1">{dept}</div>
           <div className="space-y-2">
            {list.map(it => {
             const selected = !!itemsSheetSelection[it.itemCode];
             return (
              <button
               key={it.itemCode}
               type="button"
               className={`w-full text-left p-3 rounded-xl border transition ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 hover:border-blue-300'}`}
               onClick={() => { if (!canAddLines) return; toggleSelectItem(it.itemCode); }}
               disabled={!canAddLines}
              >
               <div className="font-semibold break-words">{it.nameEn || it.nameAr || it.itemCode}</div>
               <div className={`text-xs ${selected ? 'text-blue-100' : 'text-gray-500'}`}>{it.itemCode}</div>
              </button>
             );
            })}
           </div>
          </div>
         );
        });
       })()}
      </div>
      <div className="border-t border-gray-100 pt-3">
       <button
        type="button"
        className={`w-full py-3 rounded-xl font-semibold transition ${Object.values(itemsSheetSelection).some(Boolean) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        disabled={!Object.values(itemsSheetSelection).some(Boolean)}
        onClick={addSelectedItems}
       >
        {Object.values(itemsSheetSelection).filter(Boolean).length > 0
         ? `Add ${Object.values(itemsSheetSelection).filter(Boolean).length} Item${Object.values(itemsSheetSelection).filter(Boolean).length > 1 ? 's' : ''}`
         : 'Add Items'}
       </button>
      </div>
     </div>
    </div>
   )}

   {/* Mobile item detail */}
   {itemDetailOpen && itemDetailLine && (
    <div className="sm:hidden fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={closeItemDetail}>
     <div className="bg-white rounded-t-3xl h-[75vh] p-4 flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3">
       <div className="text-base font-semibold break-words">
        {itemDetailLine.itemName} <span className="text-gray-500 text-xs">({itemDetailLine.itemId})</span>
       </div>
       <button className="btn-ghost" onClick={closeItemDetail}>X</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 pb-20">
       <div className="grid grid-cols-2 gap-3">
        <div>
         <div className="text-[11px] uppercase text-gray-500">Owner dept</div>
         <div className="text-sm font-semibold text-gray-800">{itemDetailLine.ownerDeptId || '-'}</div>
        </div>
        <div className="text-right">
         <div className="text-[11px] uppercase text-gray-500">Status</div>
         <div className="text-sm font-semibold text-gray-800">{normalizeLineStatus(itemDetailLine)}</div>
        </div>
       </div>

      <div className="space-y-2">
        <div className="text-xs text-gray-500">Unit</div>
        <div className="flex flex-wrap gap-2">
         {itemDetailUnits.map(u => {
          const active = u === itemDetailUnit;
          return (
           <button
            key={u}
            type="button"
            className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-800'}`}
            onClick={() => changeItemDetailUnit(u)}
            disabled={readOnlyLines}
           >
            {u}
           </button>
          );
         })}
         {itemDetailUnits.length === 0 && <div className="text-xs text-gray-500">No units</div>}
        </div>
       </div>

       <div className="space-y-2">
        <div className="text-xs text-gray-500">Quantity</div>
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-blue-50 to-white p-4 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-gray-500">Enter quantity</div>
            <div className="text-xs text-gray-400">
              {canSeeItemDetailInventory && typeof itemDetailAvailable === 'number' ? `Stock ${itemDetailAvailable}` : ''}
            </div>
          </div>
          <div className="flex items-end justify-between">
            <div className="text-3xl font-bold text-gray-900">{itemDetailQty}</div>
            {canSeeItemDetailInventory && typeof itemDetailAvailable === 'number' && (
              <div className="text-sm text-blue-600 font-semibold">/{itemDetailAvailable}</div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(key => {
              const isClear = key === 'C';
              const isBack = key === '⌫';
              return (
                <button
                  key={key}
                  type="button"
                  className={`h-12 rounded-xl text-lg font-semibold border transition ${
                    isClear ? 'bg-gray-100 text-gray-600 border-gray-200' :
                    isBack ? 'bg-gray-100 text-gray-600 border-gray-200' :
                    'bg-white text-gray-900 border-gray-200 hover:border-blue-300'
                  } ${readOnlyLines ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                  disabled={readOnlyLines}
                  onClick={() => {
                    if (isClear) {
                      changeItemDetailQty(0);
                      return;
                    }
                    if (isBack) {
                      const next = Math.floor(itemDetailQty / 10);
                      changeItemDetailQty(next);
                      return;
                    }
                    const nextStr = `${itemDetailQty}${key}`.slice(-4); // cap length
                    let next = Number(nextStr);
                    if (Number.isNaN(next)) next = 0;
                    next = Math.min(999, next);
                    changeItemDetailQty(next);
                  }}
                >
                  {key}
                </button>
              );
            })}
          </div>
        </div>
       </div>
      </div>
      <div className="border-t border-gray-100 pt-3">
       <button type="button" className="btn-primary w-full" onClick={closeItemDetail}>Done</button>
      </div>
     </div>
    </div>
   )}

   {/* Spacer to allow dropdowns to fully show near page bottom */}
   <div className="hidden sm:block" style={{ height: '40vh' }} />

   {showLeave && (
    <div className="fixed inset-0 z-[99999] bg-black/30 flex items-center justify-center">
     <div className="card p-6 max-w-md w-full">
      <div className="text-base font-semibold mb-2">Unsaved changes</div>
      <p className="text-sm text-gray-600 mb-4">You have unsaved changes. Stay on this page to save your draft, or leave without saving.</p>
      <div className="flex gap-2 justify-end">
       <button className="btn-primary" onClick={() => { setShowLeave(false); pendingNavRef.current = null; setPendingHref(null); }}>Stay on this page</button>
       <button className="btn-ghost" onClick={() => {
        const p = pendingNavRef.current; const href = pendingHref; setShowLeave(false); setPendingHref(null); pendingNavRef.current = null;
        if (href) { window.location.href = href; return; }
        if (!p) return; if (p.kind === 'push' && p.args) { (origPushRef.current as any).apply(history, p.args as any); } else if (p.kind === 'replace' && p.args) { (origReplaceRef.current as any).apply(history, p.args as any); } else if (p.kind === 'pop') { history.back(); }
       }}>Leave without saving</button>
      </div>
     </div>
    </div>
   )}
  </div>
 );
}





