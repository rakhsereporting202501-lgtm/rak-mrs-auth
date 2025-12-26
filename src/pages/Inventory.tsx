import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchInventoryPage } from '../lib/firestoreQueries';
import type { ItemDoc } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

function parseDateVal(v:any): Date | null {
  if (!v) return null;
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    try { return v.toDate(); } catch {}
  }
  if (v instanceof Date) return v as Date;
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) {
      const y = Number(m[1]); const mm = Number(m[2]); const dd = Number(m[3]);
      return new Date(y, mm-1, dd, 0, 0, 0);
    }
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function formatDate(d: any){
  const date = parseDateVal(d);
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

export default function Inventory() {
  const { role } = useAuth();
  const nav = useNavigate();
  const myDepts = (role?.departmentIds || []) as string[];
  const isAdmin = !!role?.roles?.admin;
  const isStoreOfficer = !!role?.roles?.storeOfficer;
  const inStoreDept = (role?.departmentIds||[]).includes('Store');
  const isDeptManager = !!role?.roles?.deptManager;
  const canView = isAdmin || isStoreOfficer || isDeptManager;
  const [rows, setRows] = useState<ItemDoc[]>([]);
  const [q, setQ] = useState('');
  // Load columns from localStorage (persist category)
  const initialCols = (()=>{
    try{
      const raw = localStorage.getItem('inventory.filters');
      if(raw){ const obj = JSON.parse(raw); if(Array.isArray(obj.columns)) return obj.columns.filter((k:any)=>typeof k==='string'); }
    }catch{}
    return ['itemName'];
  })();
  const [columns, setColumns] = useState<string[]>(initialCols); // defaults
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateFilter, setDateFilter] = useState<string>(''); // YYYY-MM-DD (updatedAt)
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth()+1);
  const [calSelected, setCalSelected] = useState<string>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [sortKey, setSortKey] = useState<'code'|'name'|'unit'|'owner'|'available'|'reorder'|'updatedAt'>('code');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const colRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  useEffect(()=>{ (async()=>{ setLoading(true); try { setRows(await fetchInventoryPage(500)); } finally { setLoading(false); } })(); },[]);

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
      ? <span className="sort-pill">{sortDir === 'asc' ? 'ASC' : 'DESC'}</span>
      : null
  );

  // Redirect if not allowed to view inventory
  useEffect(()=>{ if (role && !canView) nav('/requests', { replace: true }); }, [canView, role]);

  // Persist columns
  useEffect(()=>{ try{ localStorage.setItem('inventory.filters', JSON.stringify({ columns })); }catch{} }, [columns.join(',')]);

  useEffect(()=>{
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!colRef.current?.contains(t)) setShowColumnPicker(false);
      if (!dateRef.current?.contains(t)) setShowDatePicker(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return ()=> window.removeEventListener('mousedown', onDown, true);
  },[]);

  function matchRow(r: any): boolean {
    const orGroups = q.split('|').map(s => s.trim()).filter(Boolean);
    const hay = [
      (r.itemCode||'').toString().toLowerCase(),
      (r.nameEn||r.nameAr||'').toLowerCase(),
      (r.unit||'').toLowerCase(),
      (r.ownerDeptId||'').toLowerCase(),
      ((r.descriptionEn||r.descriptionAr||'').toLowerCase()),
    ].join(' \n ');
    if (orGroups.length === 0) return true;
    return orGroups.some(group => group.split(/[\s,]+/).filter(Boolean).every(t => hay.includes(t.toLowerCase())));
  }

  const filtered = useMemo(()=>{
    let arr = rows.slice();
    // Enforce mandatory dept filter for non-admin/non-store dept managers
    if (!isAdmin && !inStoreDept) {
      const allowed = new Set((myDepts as any[]).map(x=> String(x).toUpperCase()));
      arr = arr.filter((r:any)=> allowed.has(String((r as any).ownerDeptId||'').toUpperCase()));
    }
    if (dateFilter){
      arr = arr.filter((r:any)=>{
        const d = parseDateVal((r as any).updatedAt);
        if(!d) return false;
        const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
        const key = `${y}-${m}-${dd}`;
        return key === dateFilter;
      });
    }
    if (q.trim()) arr = arr.filter(matchRow);
    arr.sort((a:any,b:any)=>{
      const dir = sortDir==='asc'? 1 : -1;
      if (sortKey==='code') return ((a.itemCode||'').localeCompare(b.itemCode||''))*dir;
      if (sortKey==='name') return ((a.nameEn||a.nameAr||'').localeCompare(b.nameEn||b.nameAr||''))*dir;
      if (sortKey==='unit') return ((a.unit||'').localeCompare(b.unit||''))*dir;
      if (sortKey==='owner') return ((a.ownerDeptId||'').localeCompare(b.ownerDeptId||''))*dir;
      if (sortKey==='available') return (((a.qty||0)-(b.qty||0))*dir);
      if (sortKey==='reorder') return ((((a as any).reorderLevel||0) - ((b as any).reorderLevel||0))*dir);
      if (sortKey==='updatedAt'){
        const ad = parseDateVal((a as any).updatedAt); const bd = parseDateVal((b as any).updatedAt);
        const av = ad? ad.getTime() : 0; const bv = bd? bd.getTime() : 0;
        return (av-bv)*dir;
      }
      return 0;
    });
    return arr;
  }, [rows, q, dateFilter, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize);
  useEffect(()=>{ if (page > pageCount) setPage(1); }, [pageCount]);

  const allColumns: { key:string, label:string }[] = [
    { key: 'itemName', label: 'Item name' },
    { key: 'owner', label: 'Owner dept' },
    { key: 'unit', label: 'Unit' },
    { key: 'description', label: 'Description' },
    { key: 'reorder', label: 'Reorder level' },
    { key: 'updatedAt', label: 'Updated at' },
  ];
  const toggleCol = (k: string) => setColumns(prev => prev.includes(k)? prev.filter(x=>x!==k) : [...prev, k]);
  const defaultCols = ['itemName'];
  const categoryIsDefault = useMemo(()=>{
    if (columns.length !== defaultCols.length) return false;
    const s = new Set(columns);
    return defaultCols.every(k=>s.has(k));
  }, [columns.join(',')]);
  const dateActiveBtn = !!dateFilter;
  const categoryActiveBtn = !categoryIsDefault;
  const dateBtnCls = dateActiveBtn ? 'btn-primary font-semibold' : 'btn-ghost';
  const categoryBtnCls = categoryActiveBtn ? 'btn-primary font-semibold' : 'btn-ghost';
  const pad2 = (n:number)=> String(n).padStart(2,'0');

  const clearAll = () => { setQ(''); setColumns(defaultCols); setDateFilter(''); setCalSelected(''); setPage(1); setSortKey('code'); setSortDir('asc'); };

  return (
    <div className="space-y-3">
      <div className="text-xl font-semibold">Inventory</div>
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[320px]">
          <input autoComplete="off" className="input w-1/2" placeholder={'Search items (multi-token, OR with |)'} value={q} onChange={e=>{ setQ(e.target.value); setPage(1); }} />
          <div ref={dateRef} className="relative">
            <button className={dateBtnCls} onClick={()=>{ if (dateFilter){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(dateFilter); if(m){ setCalYear(Number(m[1])); setCalMonth(Number(m[2])); setCalSelected(dateFilter); } } else { const n=new Date(); setCalYear(n.getFullYear()); setCalMonth(n.getMonth()+1); setCalSelected(''); } setShowDatePicker(v=>!v); }}>Date</button>
            {showDatePicker && (
              <div className="absolute right-0 z-10 mt-1 w-64 border bg-white rounded-md shadow p-3">
                <label className="block text-xs text-gray-600 mb-1">Updated at</label>
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
                          <button key={i} className={`h-8 rounded ${cls}`} onClick={()=>{ setCalSelected(ymd); }}>
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
          <div ref={colRef} className="relative">
            <button className={categoryBtnCls} onClick={()=>setShowColumnPicker(v=>!v)}>Category</button>
            {showColumnPicker && (
              <div className="absolute right-0 z-10 mt-1 w-64 border bg-white rounded-md shadow p-2 max-h-96 overflow-auto">
                <div className="px-2 py-1 text-xs text-gray-500">Columns (fixed: Item code, Available)</div>
                {allColumns.map(c=> (
                  <label key={c.key} className="flex items-center gap-2 px-2 py-1 hover:bg-blue-50 rounded">
                    <input type="checkbox" checked={columns.includes(c.key)} onChange={()=>toggleCol(c.key)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed" disabled={!(q.trim()||!categoryIsDefault||!!dateFilter||sortKey!=='code'||sortDir!=='asc'||page!==1)} onClick={clearAll}>Clear</button>
        </div>
        <div className="shrink-0">
          <div className="flex items-center gap-1">
            <button className="btn-ghost" onClick={()=>setPage(p=>Math.max(1,p-1))}>&lt; Prev</button>
            {Array.from({length: Math.min(10, pageCount)}).map((_,i)=>{
              const n = i+1; const cls = n===page? 'inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white' : 'inline-flex items-center justify-center h-8 w-8 rounded-full text-blue-700 hover:bg-blue-50';
              return <button key={n} className={cls} onClick={()=>setPage(n)}>{n}</button>;
            })}
            {pageCount>10 && <span className="px-2">â€¦ {pageCount}</span>}
            <button className="btn-ghost" onClick={()=>setPage(p=>Math.min(pageCount,p+1))}>Next &gt;</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card p-6">Loading...</div>
      ) : (
      <div className="card table-card">
        <div className="overflow-x-auto">
          <table className="table-modern">
            <thead className="table-head">
            <tr>
              <th className={headerClass('code')} onClick={()=>handleSort('code')}>
                <span className="header-content">Item code {sortBadge('code')}</span>
              </th>
              {columns.includes('itemName') && (
                <th className={headerClass('name')} onClick={()=>handleSort('name')}>
                  <span className="header-content">Item name {sortBadge('name')}</span>
                </th>
              )}
              {columns.includes('unit') && (
                <th className={headerClass('unit')} onClick={()=>handleSort('unit')}>
                  <span className="header-content">Unit {sortBadge('unit')}</span>
                </th>
              )}
              {columns.includes('owner') && (
                <th className={headerClass('owner')} onClick={()=>handleSort('owner')}>
                  <span className="header-content">Owner dept {sortBadge('owner')}</span>
                </th>
              )}
              <th className={headerClass('available')} onClick={()=>handleSort('available')}>
                <span className="header-content">Available {sortBadge('available')}</span>
              </th>
              {columns.includes('description') && (
                <th className="table-head-cell"><span className="header-content">Description</span></th>
              )}
              {columns.includes('reorder') && (
                <th className={headerClass('reorder')} onClick={()=>handleSort('reorder')}>
                  <span className="header-content">Reorder level {sortBadge('reorder')}</span>
                </th>
              )}
              {columns.includes('updatedAt') && (
                <th className={headerClass('updatedAt')} onClick={()=>handleSort('updatedAt')}>
                  <span className="header-content">Updated at {sortBadge('updatedAt')}</span>
                </th>
              )}
            </tr>
            </thead>
            <tbody>
            {pageItems.length? pageItems.map((r:any)=> (
              <tr key={r.id} className="table-row">
                <td className="p-3">{r.itemCode}</td>
                {columns.includes('itemName') && <td className="p-3">{r.nameEn||r.nameAr||'-'}</td>}
                {columns.includes('unit') && <td className="p-3">{r.unit}</td>}
                {columns.includes('owner') && <td className="p-3">{r.ownerDeptId}</td>}
                <td className="p-3">{r.qty}</td>
                {columns.includes('description') && <td className="p-3">{r.descriptionEn||r.descriptionAr||''}</td>}
                {columns.includes('reorder') && <td className="p-3">{(r as any).reorderLevel ?? '-'}</td>}
                {columns.includes('updatedAt') && <td className="p-3">{formatDate((r as any).updatedAt)}</td>}
              </tr>
            )): (
              <tr><td className="p-3 text-gray-500" colSpan={7}>No items</td></tr>
            )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
