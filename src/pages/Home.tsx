import { useAuth } from '../context/AuthContext';

import { getDisplayName } from '../lib/displayName';

// English-only build

import { useEffect, useMemo, useState } from 'react';

import type { RequestDoc, DeptId, ItemDoc } from '../lib/types';

import { fetchVisibleRequests } from '../lib/firestoreQueries';

import { Plus } from 'lucide-react';

import { Link, useNavigate } from 'react-router-dom';

import { doc, getFirestore, serverTimestamp, updateDoc } from 'firebase/firestore';

import { useCollectionIndex } from '../lib/useCollectionIndex';

import { getFromDept, resolveEngineerName, resolveProjectName, summarizeLines } from '../lib/requestPresentation';



type Project = { id: string; nameAr?: string; nameEn?: string; name?: string };

type Engineer = { id: string; nameAr?: string; nameEn?: string };



export default function Home() {

  const { user, role } = useAuth();

  const name = getDisplayName(role, user);

  const nav = useNavigate();

  const db = getFirestore();

  const [rows, setRows] = useState<RequestDoc[]|null>(null);

  const [loading, setLoading] = useState(true);

  const { data: itemsById } = useCollectionIndex<ItemDoc>('items');

  const { data: projectsById } = useCollectionIndex<Project>('projects');

  const { data: engineersById } = useCollectionIndex<Engineer>('engineers');



  const myDepts = (role?.departmentIds || []) as DeptId[];

  const storeOfficer = !!role?.roles?.storeOfficer;

  const inStoreDept = (role?.departmentIds||[]).includes('Store' as any);

  const isAdmin = !!role?.roles?.admin;

  const canRequest = !!role?.roles?.requester;

  const isDeptManager = !!role?.roles?.deptManager;

  const isRequester = !!role?.roles?.requester;

  // Only redirect Home for Store department users (not for storeOfficer role alone)

  useEffect(() => { if (inStoreDept && !isAdmin) nav('/requests', { replace: true }); }, [inStoreDept, isAdmin]);

  useEffect(()=>{ (async()=>{

    setLoading(true);

    try {

      setRows(await fetchVisibleRequests(myDepts, { storeOfficer, inStoreDept, isAdmin, isDeptManager, isRequester }, 20, (user as any)?.uid || (undefined as any)));

    } catch { setRows([]); }

    finally { setLoading(false); }

  })(); }, [storeOfficer, inStoreDept, isAdmin, isDeptManager, isRequester, (myDepts||[]).join(',')]);

  const visibleRows = useMemo(()=>{
    if (rows === null) return null;
    const viewer = user?.uid || '';
    const filtered = rows.filter(r => {
      const stage = String((r as any).status || (r as any).stage || '').toUpperCase();
      if (stage !== 'DRAFT') return true;
      return !!viewer && (r as any).createdBy?.uid === viewer;
    });
    const getTs = (r: RequestDoc) => {
      const raw = (r as any).updatedAt;
      if (raw?.toMillis) return raw.toMillis();
      if (raw?.seconds) return raw.seconds * 1000;
      const created = (r as any).createdAt;
      if (created?.toMillis) return created.toMillis();
      if (created?.seconds) return created.seconds * 1000;
      return 0;
    };
    return filtered.sort((a, b) => getTs(b) - getTs(a));
  }, [rows, user?.uid]);



  async function openRequest(r: any){
    try{
      if(user?.uid){
        const patch: any = {};
        patch[`readBy.${user.uid}`] = serverTimestamp();
        await updateDoc(doc(db,'requests', r.id), patch);
      }
    }catch{}
    nav(`/requests/new?rq=${r.id}`);
  }



  return (

    <div className="space-y-6">

      <div className="hero-card">

        <div className="hero-title">Welcome, {name}.</div>

        <div className="hero-meta">{(role?.departmentIds||[]).join(' - ') || '-'}</div>

        {role?.roles && (

          <div className="hero-badges">

            {Object.entries(role.roles).filter(([_,v])=>v).map(([k])=> (

              <span key={k} className="badge-light">{k}</span>

            ))}

          </div>

        )}

      </div>



      <div className="flex items-center justify-between">

        <div className="text-base font-semibold">Recent requests</div>

        <Link to="/requests" className="text-sm underline">Show all</Link>

      </div>

      {loading ? (

        <div className="card p-6">Loading...</div>

      ) : (

      <div className="rq-strip overflow-x-auto -mx-1 sm:-mx-2 lg:-mx-3">

        <div className="flex gap-3 p-1 sm:p-2 lg:p-3">

          {canRequest && (

          <Link to="/requests/new" className="rq-card rq-blue min-w-[208px] flex flex-col items-center justify-center text-center border-dashed hover:bg-gray-50">

            <div className="flex items-center gap-3 text-blue-700">

              <Plus className="h-6 w-6"/><div className="text-base font-semibold">New Request</div>

            </div>

          </Link>)}

          {visibleRows===null ? (

            <div className="rq-card min-w-[520px] animate-pulse"/>

          ) : visibleRows.length===0 ? (

            <div className="rq-card min-w-[520px] flex items-center justify-center text-gray-500">No recent requests</div>

          ) : (

            visibleRows.map(r => {

              const urgent = !!(r as any).urgent;

              const primaryDept = myDepts[0];

              const unread = user?.uid ? !(r as any)?.readBy?.[user.uid] : false;

              const cls = unread ? 'rq-unread' : (urgent ? 'rq-urgent' : 'rq-blue');

              const rq = (r as any).rqCode || (r as any).code || r.id;

              const project = resolveProjectName(r, projectsById);

              const engineer = resolveEngineerName(r, engineersById);

              const stage = (r as any).stage || (r as any).status || 'SUBMITTED';

              const isStore = !!role?.roles?.storeOfficer || (role?.departmentIds||[]).includes('Store' as any);

              const actionLabel = isStore ? (stage==='FULLY_APPROVED'? 'Preparing' : stage==='STORE_PREPARING'? 'Complete' : 'Open') : 'Approve';

              const stageKey = String(stage).toLowerCase().replace(/\s+/g,'_');

              const statusClass = `badge-status status-${stageKey}`;

              const actionClass = unread || urgent ? 'action-equal action-onblue' : 'action-equal action-onwhite';

              const fromDept = getFromDept(r);

              const showAll = !primaryDept || primaryDept === fromDept;

              const allNames = summarizeLines(r, { items: itemsById, limit: 20 });

              const deptNames = primaryDept ? summarizeLines(r, { items: itemsById, dept: primaryDept, limit: 20 }) : [];

              const visibleNames = showAll ? allNames : deptNames;

              const itemsLine = visibleNames.length ? visibleNames.join(', ') : '-';

              return (

                <button key={r.id} onClick={()=>openRequest(r)} className={`${cls} rq-card min-w-[416px] text-left justify-between`}>

                  <div>

                    <div className="rq-title mb-1">{rq}</div>

                    <p className="rq-meta whitespace-normal break-words">{[

                      `${fromDept || '-'} - ${r.createdBy?.fullName||'-'}`,

                      project,

                      engineer

                    ].filter(Boolean).join(' - ')}</p>

                    <div className="rq-meta mt-1 clamp-2">{itemsLine}</div>

                  </div>

                  <div className="rq-footer">

                    <span className={statusClass}>{stage}</span>

                    <span className={actionClass}>{actionLabel}</span>

                  </div>

                </button>

              );

            })

          )}

        </div>

      </div>

      )}



      <div className="card p-6 text-gray-500">Dashboard (coming soon)</div>

    </div>

  );

}

