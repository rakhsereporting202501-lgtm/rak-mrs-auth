import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchVisibleRequests } from '../lib/firestoreQueries';
import type { RequestDoc, DeptId, ItemDoc } from '../lib/types';
import { doc, getFirestore, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useCollectionIndex } from '../lib/useCollectionIndex';
import { getFromDept, getLineDeptIds, resolveEngineerName, resolveProjectName, summarizeLines } from '../lib/requestPresentation';

type Project = { id: string; nameAr?: string; nameEn?: string; name?: string };
type Engineer = { id: string; nameAr?: string; nameEn?: string };

const STATUSES = ['DRAFT','SUBMITTED','DEPT_REVIEW','PARTIALLY_APPROVED','FULLY_APPROVED','STORE_PREPARING','READY','CLOSED','REJECTED','CANCELED'] as const;
type StatusKey = typeof STATUSES[number];
const STORE_PIPELINE: StatusKey[] = ['FULLY_APPROVED','STORE_PREPARING','READY','CLOSED'];

const DEPT_SEP = ' \u00B7 ';

function formatDate(d: any){
  if (!d) return '-';
  const date =
    d?.toDate ? d.toDate()
    : (d instanceof Date ? d
      : (typeof d === 'number' ? new Date(d) : null));
  if (!date) return '-';
  const dd = String(date.getDate()).padStart(2,'0');
  const mm = String(date.getMonth()+1).padStart(2,'0');
  const yyyy = date.getFullYear();
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2,'0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const hh = String(h).padStart(2,'0');
  return `${dd}-${mm}-${yyyy} ${hh}:${m} ${ampm}`;
}

function normalizeDeptLabel(value: any) {
  return String(value ?? '')
    .replace(/\u2022/g, DEPT_SEP)
    .replace(/\uFFFD/g, DEPT_SEP)
    .replace(/\s*\/\s*/g, DEPT_SEP)
    .replace(/\s+/g, ' ')
    .trim();
}

export default function Requests() {
  const { role, user } = useAuth();
  const nav = useNavigate();
  const db = getFirestore();
  const savedFilters = useMemo(() => {
    try {
      const raw = localStorage.getItem('requests.filters');
      return raw ? JSON.parse(raw) || {} : {};
    } catch {
      return {};
    }
  }, []);
  const savedDate = typeof savedFilters?.dateFilter === 'string' ? savedFilters.dateFilter : '';
  const defaultColumns = ['createdBy','projectName','engineer','itemsPreview'];
  const allowedSortKeys = ['rq','createdBy','from','for','projectName','engineer','itemsPreview','autoApproved','status','urgent','note','updatedAt'] as const;
  const savedSortKey = (allowedSortKeys as readonly string[]).includes(savedFilters?.sortKey) ? savedFilters.sortKey : 'updatedAt';
  const allowedColumns = ['createdBy','fromDept','forDept','projectName','engineer','itemsPreview','autoApproved','urgent','note'] as const;
  const myDepts = (role?.departmentIds || []) as DeptId[];
  const deptFilterKey = myDepts.join(',');
  const deptFilterList = useMemo(
    () => (myDepts || []).filter((d): d is DeptId => !!d),
    [deptFilterKey],
  );
  const deptFilterSet = useMemo(() => new Set(deptFilterList), [deptFilterKey]);
  const storeOfficer = !!role?.roles?.storeOfficer;
  const inStoreDept = (role?.departmentIds||[]).includes('Store' as any);
  const isAdmin = !!role?.roles?.admin;
  const isDeptManager = !!role?.roles?.deptManager;
  const isRequester = !!role?.roles?.requester;
  const viewerUid = user?.uid || '';

  const [rows, setRows] = useState<RequestDoc[]>([]);
  const [q, setQ] = useState(() => (typeof savedFilters?.q === 'string' ? savedFilters.q : ''));
  const [selStatuses, setSelStatuses] = useState<StatusKey[]>(()=>{
    const arr = Array.isArray(savedFilters?.statuses) ? savedFilters.statuses : [];
    const valid = arr.filter((s:any)=>STATUSES.includes(s)) as StatusKey[];
    if (valid.length) return valid;
    return [];
  });
  const [page, setPage] = useState(() => (typeof savedFilters?.page === 'number' && savedFilters.page > 0 ? savedFilters.page : 1));
  const pageSize = 20;
  const [sortKey, setSortKey] = useState<
    'rq'
    | 'createdBy'
    | 'from'
    | 'for'
    | 'projectName'
    | 'engineer'
    | 'itemsPreview'
    | 'autoApproved'
    | 'status'
    | 'urgent'
    | 'note'
    | 'updatedAt'
  >(() => savedSortKey as any);
  const [sortDir, setSortDir] = useState<'asc'|'desc'>(() => (savedFilters?.sortDir === 'asc' ? 'asc' : 'desc'));
  const [columns, setColumns] = useState<string[]>(()=>{
    const cols = Array.isArray(savedFilters?.columns)
      ? savedFilters.columns.filter((k:any)=>typeof k==='string' && (allowedColumns as readonly string[]).includes(k))
      : [];
    return cols.length ? cols : defaultColumns;
  });
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateFilter, setDateFilter] = useState<string>(() => savedDate || ''); // internal: YYYY-MM-DD
  const [dateText, setDateText] = useState<string>(() => (savedDate ? ymdToDmy(savedDate) : '')); // UI: dd-mm-yyyy
  const [calYear, setCalYear] = useState<number>(() => savedDate ? Number(savedDate.slice(0,4)) || new Date().getFullYear() : new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(() => savedDate ? Number(savedDate.slice(5,7)) || (new Date().getMonth()+1) : (new Date().getMonth()+1)); // 1-12
  const [calSelected, setCalSelected] = useState<string>(() => savedDate || ''); // YYYY-MM-DD
  const statusRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const [showMobileFilter, setShowMobileFilter] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [showPager, setShowPager] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [rowLoadingId, setRowLoadingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const { data: itemsById } = useCollectionIndex<ItemDoc>('items');
  const { data: projectsById } = useCollectionIndex<Project>('projects');
  const { data: engineersById } = useCollectionIndex<Engineer>('engineers');

  const getVisibleLineNames = useCallback(
    (doc: RequestDoc | any, limit?: number) => {
      const fromDept = getFromDept(doc);
      const owns = !deptFilterSet.size || deptFilterSet.has(fromDept as any);
      const itemsMap = itemsById || {};
      return summarizeLines(doc, {
        items: itemsMap,
        deptList: owns ? [] : deptFilterList,
        limit,
      });
    },
    [deptFilterSet, deptFilterList, itemsById],
  );

  const handleSort = (key: typeof sortKey) => {
    setSortDir(prev => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
  };

  const headerClass = (key?: typeof sortKey) => {
    let cls = 'table-head-cell';
    if (key) cls += ' sortable';
    if (key && sortKey === key) cls += ' active-sort';
    return cls;
  };

  const sortBadge = (key?: typeof sortKey) => (
    key && sortKey === key
      ? <span className="sort-pill">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
      : null
  );
  useEffect(()=>{ (async()=>{ setLoading(true); try { setRows(await fetchVisibleRequests(myDepts, { storeOfficer, inStoreDept, isAdmin, isDeptManager, isRequester }, 500, user?.uid || undefined)); } finally { setLoading(false); } })(); }, [storeOfficer, inStoreDept, isAdmin, isDeptManager, isRequester, myDepts.join(','), user?.uid]);

  // Persist filters
  useEffect(()=>{
    try{
      localStorage.setItem('requests.filters', JSON.stringify({
        statuses: selStatuses,
        columns,
        q,
        dateFilter,
        sortKey,
        sortDir,
        page,
      }));
    }catch{}
  }, [selStatuses.join(','), columns.join(','), q, dateFilter, sortKey, sortDir, page]);

  useEffect(()=>{
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!statusRef.current?.contains(t)) setShowStatusPicker(false);
      if (!colRef.current?.contains(t)) setShowColumnPicker(false);
      if (!dateRef.current?.contains(t)) setShowDatePicker(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return ()=> window.removeEventListener('mousedown', onDown, true);
  },[]);

  // Mobile filter toggle via AppShell event
  const openMobileFilter = useCallback(() => { setSheetExpanded(false); setShowMobileFilter(true); }, []);
  const closeMobileFilter = useCallback(() => { setShowMobileFilter(false); setSheetExpanded(false); }, []);

  useEffect(() => {
    const handler = () => openMobileFilter();
    window.addEventListener('requests:toggle-filter', handler as any);
    return () => window.removeEventListener('requests:toggle-filter', handler as any);
  }, [openMobileFilter]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const height = document.documentElement.scrollHeight;
      const view = window.innerHeight;
      setShowScrollTop(y > 200);
      setShowPager(y + view >= height - 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

function matchRow(r: any): boolean {
  const orGroups = q.split('|').map(s => s.trim()).filter(Boolean);
  const projectLabel = resolveProjectName(r, projectsById).toLowerCase();
  const engineerLabel = resolveEngineerName(r, engineersById).toLowerCase();
  const fromDept = getFromDept(r).toLowerCase();
  const forDepts = getLineDeptIds(r).join(' ').toLowerCase();
  const itemTokens = getVisibleLineNames(r).join(' ').toLowerCase();
    const hay = [
      (r.rqCode||r.code||r.id||'').toString().toLowerCase(),
      (r.createdBy?.fullName||'').toLowerCase(),
      (r.createdBy?.departmentId||'').toLowerCase(),
      projectLabel,
      engineerLabel,
      (r.projectId||'').toLowerCase(),
      (r.engineerId||'').toLowerCase(),
      (r.status||'').toLowerCase(),
      fromDept,
      forDepts,
      itemTokens,
      (r.urgent? 'urgent' : ''),
    ].join(' \n ');

    const d = r.updatedAt?.toDate ? r.updatedAt.toDate() : (r.createdAt?.toDate ? r.createdAt.toDate() : null);
    const dateTexts: string[] = [];
    if (d){
      dateTexts.push(d.toLocaleDateString());
      dateTexts.push(d.toLocaleString());
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      const mnames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      dateTexts.push(`${mm}/${dd}/${yyyy}`);
      dateTexts.push(`${dd}/${mm}/${yyyy}`);
      dateTexts.push(`${dd} ${mnames[d.getMonth()]}`);
      dateTexts.push(`${mnames[d.getMonth()]} ${dd}`);
    }

    if (orGroups.length === 0) return true;
    const ok = orGroups.some(group => {
      const tokens = group.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      return tokens.every(t => hay.includes(t) || dateTexts.some(dt => dt.toLowerCase().includes(t)));
    });
    return ok;
  }

  async function openRequestRow(r: RequestDoc) {
    setRowError(null);
    setRowLoadingId(r.id);
    try {
      if (user?.uid) {
        const payload: any = {};
        payload[`readBy.${user.uid}`] = serverTimestamp();
        await updateDoc(doc(db, 'requests', r.id), payload);
      }
      nav(`/requests/new?rq=${r.id}`);
    } catch (err) {
      console.error('openRequestRow failed', err);
      setRowError('Could not open this request. Please try again.');
      setRowLoadingId(null);
    }
  }

  const filtered = useMemo(()=>{
    let arr = rows.slice();
    arr = arr.filter(r => {
      const statusKey = String((r.status || (r as any).stage || '')).toUpperCase();
      if (statusKey !== 'DRAFT') return true;
      return viewerUid && r.createdBy?.uid === viewerUid;
    });
    if (selStatuses.length) arr = arr.filter(r => selStatuses.includes((r.status||'') as StatusKey));
    if (dateFilter){
      arr = arr.filter((r:any)=>{
        const d = r.updatedAt?.toDate ? r.updatedAt.toDate() : (r.createdAt?.toDate ? r.createdAt.toDate() : null);
        if(!d) return false;
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const key = `${y}-${m}-${dd}`;
        return key === dateFilter;
      });
    }
    if (q.trim()) arr = arr.filter(matchRow);
    arr.sort((a:any,b:any)=>{
      const dir = sortDir==='asc'? 1 : -1;
      if (sortKey==='updatedAt'){
        const av = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
        const bv = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
        return (av-bv)*dir;
      }
      if (sortKey==='status') return ((a.status||'').localeCompare(b.status||''))*dir;
      if (sortKey==='rq') return ((a.rqCode||a.code||a.id||'').localeCompare(b.rqCode||b.code||b.id||''))*dir;
      if (sortKey==='createdBy') return ((a.createdBy?.fullName||'').localeCompare(b.createdBy?.fullName||''))*dir;
      if (sortKey==='from') return (getFromDept(a).localeCompare(getFromDept(b)))*dir;
      if (sortKey==='for') return ((getLineDeptIds(a).join(',')).localeCompare(getLineDeptIds(b).join(',')))*dir;
      if (sortKey==='projectName') {
        const av = resolveProjectName(a, projectsById) || '';
        const bv = resolveProjectName(b, projectsById) || '';
        return av.localeCompare(bv) * dir;
      }
      if (sortKey==='engineer') {
        const av = resolveEngineerName(a, engineersById) || '';
        const bv = resolveEngineerName(b, engineersById) || '';
        return av.localeCompare(bv) * dir;
      }
      if (sortKey==='itemsPreview') {
        const av = getVisibleLineNames(a).join(DEPT_SEP);
        const bv = getVisibleLineNames(b).join(DEPT_SEP);
        return av.localeCompare(bv) * dir;
      }
      if (sortKey==='urgent') return (((a.urgent?1:0) - (b.urgent?1:0)))*dir;
      if (sortKey==='note') return ((a.note||'').localeCompare(b.note||''))*dir;
      return 0;
    });
    return arr;
  }, [rows, q, selStatuses.join(','), dateFilter, sortKey, sortDir, getVisibleLineNames, projectsById, engineersById, viewerUid]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize);
  useEffect(()=>{ if (page > pageCount) setPage(1); }, [pageCount]);

  const badgeActive = 'inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white';
  const badge = 'inline-flex items-center justify-center h-8 w-8 rounded-full text-blue-700 hover:bg-blue-50';

  const categoryIsDefault = useMemo(()=>{
    if (columns.length !== defaultColumns.length) return false;
    const s = new Set(columns);
    return defaultColumns.every(k=>s.has(k));
  }, [columns.join(',')]);
  const statusActiveBtn = selStatuses.length > 0;
  const categoryActiveBtn = !categoryIsDefault;
  const dateActiveBtn = !!dateFilter;
  const statusBtnCls = statusActiveBtn ? 'btn-primary font-semibold' : 'btn-ghost';
  const categoryBtnCls = categoryActiveBtn ? 'btn-primary font-semibold' : 'btn-ghost';
  const dateBtnCls = dateActiveBtn ? 'btn-primary font-semibold' : 'btn-ghost';

  const defaults = { q:'', page:1, sortKey:'updatedAt' as const, sortDir:'desc' as const };
  const rqExactMatch = useMemo(()=>{
    const trimmed = q.trim();
    return /^[A-Z]{2,4}-\d{7}$/.test(trimmed) ? trimmed : '';
  }, [q]);
  const dirtyTable = useMemo(()=>{
    const a = selStatuses.length>0;
    const b = !categoryIsDefault;
    const c = !!dateFilter;
    const d = q.trim().length>0;
    const e = page !== defaults.page;
    const f = !(sortKey===defaults.sortKey && sortDir===defaults.sortDir);
    return a||b||c||d||e||f;
  }, [selStatuses.join(','), categoryIsDefault, dateFilter, q, page, sortKey, sortDir]);
  const resetAll = () => {
    if (!dirtyTable) return;
    setQ('');
    setSelStatuses([]);
    setColumns(defaultColumns);
    setDateFilter('');
    setDateText('');
    setCalSelected('');
    setSortKey('updatedAt');
    setSortDir('desc');
    setPage(1);
  };

  // Helpers to convert between UI text and internal filter
  function ymdToDmy(ymd: string): string {
    if(!ymd) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if(!m) return '';
    const [,y,mm,dd] = m; return `${dd}-${mm}-${y}`;
  }
  function dmyToYmd(dmy: string): string | null {
    const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(dmy);
    if(!m) return null;
    let [,_dd,_mm,y] = m as any;
    const dd = String(parseInt(_dd,10)).padStart(2,'0');
    const mm = String(parseInt(_mm,10)).padStart(2,'0');
    const d = Number(dd), mo = Number(mm);
    if (d<1 || d>31 || mo<1 || mo>12) return null;
    return `${y}-${mm}-${dd}`;
  }
  const pad2 = (n:number)=> String(n).padStart(2,'0');

  const toggleStatus = (s: StatusKey) => setSelStatuses(prev => prev.includes(s)? prev.filter(x=>x!==s) : [...prev, s]);
const allColumns: { key:string, label:string }[] = [
    { key: 'createdBy', label: 'Created by' },
    { key: 'fromDept', label: 'From dept' },
    { key: 'forDept', label: 'For dept' },
    { key: 'projectName', label: 'Project' },
    { key: 'engineer', label: 'Engineer' },
    { key: 'itemsPreview', label: 'Items' },
    { key: 'note', label: 'Note' },
  ];
  const toggleCol = (k: string) => setColumns(prev => prev.includes(k)? prev.filter(x=>x!==k) : [...prev, k]);
  const hasActiveFilters = !!(q.trim() || selStatuses.length || dateFilter || (columns && (columns.sort().join(',') !== defaultColumns.sort().join(','))));
  const mobileInlineCols = columns.filter(c => c !== 'itemsPreview' && c !== 'note');
  const mobileLongCols = columns.filter(c => c === 'itemsPreview' || c === 'note');
  const sortOptions = [
    { key: 'status', label: 'Status' },
    { key: 'createdBy', label: 'Created by' },
    { key: 'projectName', label: 'Project' },
    { key: 'engineer', label: 'Engineer' },
    { key: 'itemsPreview', label: 'Items' },
    { key: 'updatedAt', label: 'Last update' },
  ] as const;
  const handleCopyId = (id: string) => {
    try { navigator?.clipboard?.writeText(id); } catch {}
    setCopyToast(`Copied ${id}`);
    setTimeout(()=>setCopyToast(null), 1800);
  };

  return (
    <>
    <div className="space-y-3 pb-24 sm:pb-0">
      <div className="hidden sm:flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[320px]">
          <div className="relative w-1/2">
            <input autoComplete="off" className="input w-full pr-16" placeholder={'Search (multi-token, supports OR with |)'} value={q} onChange={e=>{ setQ(e.target.value); setPage(1); }} />
            {rqExactMatch && (
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-xs font-semibold px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                onClick={()=>nav(`/requests/new?rq=${rqExactMatch}`)}
              >
                Open
              </button>
            )}
          </div>
          <div ref={statusRef} className="relative">
            <button className={statusBtnCls} onClick={()=>setShowStatusPicker(v=>!v)}>Status</button>
            {showStatusPicker && (
              <div className="absolute right-0 z-10 mt-1 w-56 border bg-white rounded-md shadow p-2 max-h-80 overflow-auto">
                {STATUSES.map(s=> (
                  <label key={s} className="flex items-center gap-2 px-2 py-1 hover:bg-blue-50 rounded">
                    <input type="checkbox" checked={selStatuses.includes(s)} onChange={()=>toggleStatus(s)} />
                    <span>{s}</span>
                  </label>
                ))}
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost" onClick={()=>setSelStatuses([])}>Clear</button>
                  <button className="btn-primary" onClick={()=>setShowStatusPicker(false)}>Apply</button>
                </div>
              </div>
            )}
          </div>
          <div ref={colRef} className="relative">
            <button className={categoryBtnCls} onClick={()=>setShowColumnPicker(v=>!v)}>Category</button>
            {showColumnPicker && (
              <div className="absolute right-0 z-10 mt-1 w-64 border bg-white rounded-md shadow p-2 max-h-96 overflow-auto">
                <div className="px-2 py-1 text-xs text-gray-500">Columns (fixed: RQ, Status, Last Update)</div>
                {allColumns.map(c=> (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-1 hover:bg-blue-50 rounded">
                    <input type="checkbox" checked={columns.includes(c.key)} onChange={()=>toggleCol(c.key)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div ref={dateRef} className="relative">
            <button className={dateBtnCls} onClick={()=>{
              setDateText(ymdToDmy(dateFilter));
              if (dateFilter) {
                const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateFilter);
                if (m) { setCalYear(Number(m[1])); setCalMonth(Number(m[2])); setCalSelected(dateFilter); }
              } else {
                const now = new Date(); setCalYear(now.getFullYear()); setCalMonth(now.getMonth()+1); setCalSelected('');
              }
              setShowDatePicker(v=>!v);
            }}>Last Update</button>
            {showDatePicker && (
              <div className="absolute right-0 z-10 mt-1 w-64 border bg-white rounded-md shadow p-3">
                <label className="block text-xs text-gray-600 mb-1">Last update</label>
                {/* Simple calendar */}
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <button className="btn-ghost" onClick={()=>{ let m = calMonth-1, y=calYear; if(m<1){ m=12; y--; } setCalMonth(m); setCalYear(y); }}>&lt;</button>
                    <div className="font-semibold">{new Date(calYear, calMonth-1, 1).toLocaleString(undefined,{ month:'short'})} {calYear}</div>
                    <button className="btn-ghost" onClick={()=>{ let m = calMonth+1, y=calYear; if(m>12){ m=1; y++; } setCalMonth(m); setCalYear(y); }}>&gt;</button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-600 mb-1">
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=> <div key={d}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {(()=>{
                      const first = new Date(calYear, calMonth-1, 1);
                      const start = first.getDay();
                      const days = new Date(calYear, calMonth, 0).getDate();
                      const cells: (number|null)[] = [];
                      for(let i=0;i<start;i++) cells.push(null);
                      for(let d=1; d<=days; d++) cells.push(d);
                      return cells.map((d,i)=>{
                        if(d===null) return <div key={i} className="h-8"/>;
                        const ymd = `${calYear}-${pad2(calMonth)}-${pad2(d)}`;
                        const selected = calSelected===ymd;
                        const cls = selected? 'bg-blue-600 text-white' : 'hover:bg-blue-50';
                        return (
                          <button key={i} className={`h-8 rounded ${cls}`} onClick={()=>{ setCalSelected(ymd); setDateText(ymdToDmy(ymd)); }}>
                            {d}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
                <div className="mt-2 flex gap-2 justify-end">
                  <button className="btn-primary" onClick={()=>{ setDateFilter(calSelected||''); setShowDatePicker(false); setSortKey('updatedAt'); setSortDir('desc'); setPage(1); }}>Apply</button>
                </div>
              </div>
            )}
          </div>
          <button className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed" disabled={!dirtyTable} onClick={resetAll}>Clear</button>
        </div>
        <div className="shrink-0">
          <div className="flex items-center gap-1">
            <button className="btn-ghost" onClick={()=>setPage(p=>Math.max(1,p-1))}>&lt; Prev</button>
            {Array.from({length: Math.min(10, pageCount)}).map((_,i)=>{
              const n = i+1; const cls = n===page? badgeActive : badge;
              return <button key={n} className={cls} onClick={()=>setPage(n)}>{n}</button>;
            })}
            {pageCount>10 && <span className="px-2">... {pageCount}</span>}
            <button className="btn-ghost" onClick={()=>setPage(p=>Math.min(pageCount,p+1))}>Next &gt;</button>
          </div>
        </div>
      </div>

      {/* Mobile title */}
      <div className="sm:hidden text-xl font-semibold mt-1">Requests</div>

      {loading ? (
        <div className="card p-6">Loading...</div>
      ) : (
      <>
        {/* Mobile cards */}
        <div className="sm:hidden space-y-3">
          {pageItems.map((r:any)=> {
            const urgent = !!r.urgent;
            const unread = user?.uid ? !(r?.readBy?.[user.uid]) : false;
            const urgentUnread = urgent && unread;
            const stageKey = String(r.status||'').toLowerCase().replace(/\s+/g,'_');
            const badgeClass = `badge badge-status status-${stageKey}`;
            let cardCls = 'card p-4 space-y-3 border shadow-sm';
            cardCls += urgent ? ' border-red-500' : ' border-blue-500';
            if (urgentUnread) cardCls += ' bg-red-100';
            else if (urgent) cardCls += ' bg-red-50';
            else if (unread) cardCls += ' bg-blue-50';
            else cardCls += ' bg-white';
            if (rowLoadingId === r.id) cardCls += ' row-loading';
            const mainId = r.rqCode || r.code || r.id;
            const cardStyle: React.CSSProperties = {
              backgroundColor: urgent
                ? (unread ? '#ef4444' : '#fee2e2')
                : (unread ? '#e0f2fe' : '#ffffff'),
              borderColor: urgent ? '#ef4444' : '#3b82f6',
              color: urgentUnread ? '#ffffff' : undefined,
            };
            const createdByLabel = r.createdBy?.fullName || '-';
            const fromDept = normalizeDeptLabel(getFromDept(r)) || '-';
            const forDept = (() => {
              const depts = getLineDeptIds(r).map(normalizeDeptLabel).filter(Boolean);
              return depts.length ? depts.join(DEPT_SEP) : '-';
            })();
            const projectLabel = resolveProjectName(r, projectsById) || '-';
            const engineerLabel = resolveEngineerName(r, engineersById) || '-';
            const itemsLabel = (() => {
              const names = getVisibleLineNames(r, 10);
              return names.length ? names.join(DEPT_SEP) : '-';
            })();
            const noteLabel = r.note || '';
            const inlineFields = mobileInlineCols.map(key => {
              switch(key){
                case 'createdBy': return { key, label: 'Created by', value: createdByLabel };
                case 'fromDept': return { key, label: 'From Dept', value: fromDept };
                case 'forDept': return { key, label: 'For Dept', value: forDept };
                case 'projectName': return { key, label: 'Project', value: projectLabel };
                case 'engineer': return { key, label: 'Engineer', value: engineerLabel };
                default: return null;
              }
            }).filter(Boolean) as {key:string,label:string,value:string}[];
            const longFields = mobileLongCols.map(key => {
              if (key === 'itemsPreview') return { key, label: 'Items', value: itemsLabel };
              if (key === 'note') return { key, label: 'Note', value: noteLabel || '-' };
              return null;
            }).filter(Boolean) as {key:string,label:string,value:string}[];
            const dateLabel = formatDate(r.updatedAt || r.createdAt);
              return (
              <div key={r.id} className={cardCls + ' cursor-pointer'} style={cardStyle} onClick={()=>openRequestRow(r)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-xl font-semibold break-words ${urgentUnread ? 'text-white' : 'text-gray-900'}`}
                      onClick={(e)=>{ e.stopPropagation(); handleCopyId(mainId); }}
                    >
                      {mainId}
                    </div>
                    <div className={`text-xs mt-1 ${urgentUnread ? 'text-white/80' : 'text-gray-500'}`}>{dateLabel}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={badgeClass}>{r.status}</span>
                  </div>
                </div>

                {inlineFields.length > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    {inlineFields.map(f => (
                      <div key={f.key} className="min-w-0">
                        <div className={`text-[11px] font-medium ${urgentUnread ? 'text-white/80' : 'text-gray-500'}`}>{f.label}</div>
                        <div className={`text-sm font-semibold break-words ${urgentUnread ? 'text-white' : 'text-gray-900'}`}>{f.value || '-'}</div>
                      </div>
                    ))}
                  </div>
                )}

                {longFields.map(f => (
                  <div key={f.key}>
                    <div className={`text-[11px] font-medium ${urgentUnread ? 'text-white/80' : 'text-gray-500'}`}>{f.label}</div>
                    <div className={`text-sm font-semibold whitespace-pre-wrap break-words ${urgentUnread ? 'text-white' : 'text-gray-900'}`}>{f.value || '-'}</div>
                  </div>
                ))}
              </div>
            );
          })}
          {pageItems.length===0 && (
            <div className="card p-4 text-gray-500">No results</div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block card table-card">
          <div className="overflow-x-auto">
            <table className="table-modern">
              <thead className="table-head">
                <tr>
                <th className={headerClass('rq')} onClick={()=>handleSort('rq')}>
                  <span className="header-content">RQ {sortBadge('rq')}</span>
                </th>
                {columns.includes('createdBy') && (
                  <th className={headerClass('createdBy')} onClick={()=>handleSort('createdBy')}>
                    <span className="header-content">Created by {sortBadge('createdBy')}</span>
                  </th>
                )}
                {columns.includes('fromDept') && (
                  <th className={headerClass('from')} onClick={()=>handleSort('from')}>
                    <span className="header-content">From dept {sortBadge('from')}</span>
                  </th>
                )}
                {columns.includes('forDept') && (
                  <th className={headerClass('for')} onClick={()=>handleSort('for')}>
                    <span className="header-content">For dept {sortBadge('for')}</span>
                  </th>
                )}
                {columns.includes('projectName') && (
                  <th className={headerClass('projectName')} onClick={()=>handleSort('projectName')}>
                    <span className="header-content">Project {sortBadge('projectName')}</span>
                  </th>
                )}
                {columns.includes('engineer') && (
                  <th className={headerClass('engineer')} onClick={()=>handleSort('engineer')}>
                    <span className="header-content">Engineer {sortBadge('engineer')}</span>
                  </th>
                )}
                {columns.includes('itemsPreview') && (
                  <th className={headerClass('itemsPreview')} onClick={()=>handleSort('itemsPreview')}>
                    <span className="header-content">Items {sortBadge('itemsPreview')}</span>
                  </th>
                )}
                {columns.includes('autoApproved') && (
                  <th className={headerClass('autoApproved')} onClick={()=>handleSort('autoApproved')}>
                    <span className="header-content">Auto-approved {sortBadge('autoApproved')}</span>
                  </th>
                )}
                <th className={`${headerClass('status')} text-center`} onClick={()=>handleSort('status')}>
                  <span className="header-content justify-center gap-1">Status {sortBadge('status')}</span>
                </th>
                {columns.includes('urgent') && (
                  <th className={headerClass('urgent')} onClick={()=>handleSort('urgent')}>
                    <span className="header-content">Urgent {sortBadge('urgent')}</span>
                  </th>
                )}
                {columns.includes('note') && (
                  <th className={headerClass('note')} onClick={()=>handleSort('note')}>
                    <span className="header-content">Note {sortBadge('note')}</span>
                  </th>
                )}
                <th className={headerClass('updatedAt')} onClick={()=>handleSort('updatedAt')}>
                  <span className="header-content">Last Update {sortBadge('updatedAt')}</span>
                </th>
              </tr>
              </thead>
              <tbody>
              {pageItems.map((r:any)=> {
                const urgent = !!r.urgent;
                const unread = user?.uid ? !(r?.readBy?.[user.uid]) : false;
                let rowCls = 'table-row';
                if (urgent && unread) rowCls += ' table-row-urgent';
                else if (urgent) rowCls += ' table-row-urgent-soft';
                else if (unread) rowCls += ' table-row-unread';
                if (rowLoadingId === r.id) rowCls += ' row-loading';
                const stageKey = String(r.status||'').toLowerCase().replace(/\s+/g,'_');
                const badgeClass = `badge badge-status status-${stageKey}`;
                return (
                <tr key={r.id} className={rowCls + ' cursor-pointer'} onClick={()=>openRequestRow(r)}>
                  <td className="p-3">{r.rqCode||r.code||r.id}</td>
                  {columns.includes('createdBy') && <td className="p-3">{r.createdBy?.fullName||'-'}</td>}
                  {columns.includes('fromDept') && <td className="p-3">{normalizeDeptLabel(getFromDept(r)) || '-'}</td>}
                  {columns.includes('forDept') && <td className="p-3">{(() => {
                    const depts = getLineDeptIds(r).map(normalizeDeptLabel).filter(Boolean);
                    return depts.length ? depts.join(DEPT_SEP) : '-';
                  })()}</td>}
                  {columns.includes('projectName') && <td className="p-3">{resolveProjectName(r, projectsById) || '-'}</td>}
                  {columns.includes('engineer') && <td className="p-3">{resolveEngineerName(r, engineersById) || '-'}</td>}
                  {columns.includes('itemsPreview') && <td className="p-3">{(() => {
                    const names = getVisibleLineNames(r, 10);
                    return names.length ? names.join(DEPT_SEP) : '-';
                  })()}</td>}
                  {columns.includes('autoApproved') && <td className="p-3">{(() => {
                    const map = r.autoApprovedByDept || {};
                    const flag = Object.values(map).some(Boolean);
                    return flag ? 'Yes' : 'No';
                  })()}</td>}
                  <td className="p-3 text-center align-middle"><span className={badgeClass}>{r.status}</span></td>
                  {columns.includes('urgent') && <td className="p-3">{r.urgent? 'Yes':'No'}</td>}
                  {columns.includes('note') && <td className="p-3">{r.note||''}</td>}
                  <td className="p-3">{formatDate(r.updatedAt || r.createdAt)}</td>
                </tr>
              );})}
              {pageItems.length===0 && (
                <tr><td className="p-4 text-gray-500" colSpan={9}>No results</td></tr>
              )}
              </tbody>
            </table>
          </div>
        </div>
      </>
      )}
      {rowError && (
        <div className="alert alert-error">
          <span>{rowError}</span>
          <button className="ml-auto text-sm font-semibold underline" onClick={()=>setRowError(null)}>Dismiss</button>
        </div>
      )}

      {/* Mobile bottom pager styled like desktop */}
      {showPager && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
            <button className="btn-ghost" onClick={()=>setPage(p=>Math.max(1,p-1))}>&lt; Prev</button>
            <div className="flex items-center gap-2 overflow-x-auto">
              {Array.from({length: Math.min(10, pageCount)}).map((_,i)=>{
                const n = i+1;
                const active = n===page;
                const cls = active
                  ? 'px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white border border-blue-600'
                  : 'px-3 py-2 rounded-lg text-sm border border-gray-200 text-gray-800';
                return <button key={n} className={cls} onClick={()=>setPage(n)}>{n}</button>;
              })}
              {pageCount > 10 && <span className="px-2 text-sm text-gray-600">... {pageCount}</span>}
            </div>
            <button className="btn-ghost" onClick={()=>setPage(p=>Math.min(pageCount,p+1))}>Next &gt;</button>
          </div>
        </div>
      )}

      {/* Mobile bottom sheet filter */}
      {showMobileFilter && (
        <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={closeMobileFilter}>
          <div
            className={`bg-white rounded-t-3xl shadow-xl max-h-[100vh] ${sheetExpanded ? 'h-[100vh]' : 'h-[75vh]'} flex flex-col w-screen`}
            onClick={(e)=>e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-base font-semibold">FILTER</div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost text-xl"
                  onClick={()=>setSheetExpanded(prev => !prev)}
                  aria-label={sheetExpanded ? 'Collapse' : 'Expand'}
                >
                  {sheetExpanded ? 'v' : '^'}
                </button>
                <button className="btn-ghost" onClick={closeMobileFilter}>X</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-2">Search</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Search requests"
                    value={q}
                    onChange={e=>{ setQ(e.target.value); setPage(1); }}
                  />
                  {rqExactMatch && (
                    <button className="btn-primary" onClick={()=>nav(`/requests/new?rq=${rqExactMatch}`)}>Open</button>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Status</div>
                <div className="grid grid-cols-2 gap-2">
                  {STATUSES.map(s => (
                    <button
                      key={s}
                      className={`px-3 py-2 rounded border text-sm ${selStatuses.includes(s) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200'}`}
                      onClick={()=>toggleStatus(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Category</div>
                <div className="grid grid-cols-2 gap-2">
                  {allColumns.map(c => (
                    <button
                      key={c.key}
                      className={`px-3 py-2 rounded border text-sm text-left ${columns.includes(c.key) ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200'}`}
                      onClick={()=>toggleCol(c.key)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Sort</div>
                <div className="grid grid-cols-2 gap-2">
                  {sortOptions.map(opt => (
                    <button
                      key={opt.key}
                      className={`px-3 py-2 rounded border text-sm ${sortKey === opt.key ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200'}`}
                      onClick={()=>{ setSortKey(opt.key as any); setSortDir(prev => sortKey === opt.key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">Last update</div>
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <button className="btn-ghost" onClick={()=>{ let m = calMonth-1, y=calYear; if(m<1){ m=12; y--; } setCalMonth(m); setCalYear(y); }}>&lt;</button>
                    <div className="font-semibold">{new Date(calYear, calMonth-1, 1).toLocaleString(undefined,{ month:'short'})} {calYear}</div>
                    <button className="btn-ghost" onClick={()=>{ let m = calMonth+1, y=calYear; if(m>12){ m=1; y++; } setCalMonth(m); setCalYear(y); }}>&gt;</button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-600 mb-1">
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=> <div key={d}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {(()=>{
                      const first = new Date(calYear, calMonth-1, 1);
                      const start = first.getDay();
                      const days = new Date(calYear, calMonth, 0).getDate();
                      const cells: (number|null)[] = [];
                      for(let i=0;i<start;i++) cells.push(null);
                      for(let d=1; d<=days; d++) cells.push(d);
                      return cells.map((d,i)=>{
                        if(d===null) return <div key={i} className="h-8"/>;
                        const ymd = `${calYear}-${pad2(calMonth)}-${pad2(d)}`;
                        const selected = calSelected===ymd;
                        const cls = selected? 'bg-blue-600 text-white' : 'hover:bg-blue-50';
                        return (
                          <button key={i} className={`h-8 rounded ${cls}`} onClick={()=>{ 
                            if (calSelected === ymd) { setCalSelected(''); setDateText(''); setDateFilter(''); return; }
                            setCalSelected(ymd); setDateText(ymdToDmy(ymd)); setDateFilter(ymd); setSortKey('updatedAt'); setSortDir('desc'); setPage(1); 
                          }}>
                            {d}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
                <div className="text-sm text-gray-600">{dateText || 'No date selected'}</div>
              </div>
            </div>
            <div className="px-4 py-3 border-t">
              <button
                className={`w-full py-2 rounded-lg font-semibold ${hasActiveFilters ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                onClick={()=>{
                  resetAll();
                  setShowMobileFilter(false);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {showScrollTop && (
      <button
        className="sm:hidden fixed bottom-20 right-4 z-30 h-12 w-12 rounded-full shadow-lg bg-blue-600 text-white flex items-center justify-center"
        onClick={()=>window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Scroll to top"
      >
        Up
      </button>
    )}
    {copyToast && (
      <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm shadow-lg">
        {copyToast}
      </div>
    )}
    </>
  );
}

