import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

export default function RequestDetails(){
  const { id } = useParams();
  const [data, setData] = useState<any|null>(null);
  const [loading, setLoading] = useState(true);
  const db = getFirestore();
  useEffect(()=>{ (async()=>{
    if(!id) return;
    try{ const snap = await getDoc(doc(db,'requests', id)); setData(snap.data()); } finally { setLoading(false); }
  })() }, [id]);
  if(loading) return <div className="card p-6">Loading...</div>;
  if(!data) return <div className="card p-6">Not found</div>;
  return (
    <div className="space-y-3">
      <div className="text-xl font-semibold">{data.rqCode || id}</div>
      <div className="card p-6">
        <div className="text-sm text-gray-600">Project: {data.projectNameAr||data.projectNameEn||'-'}</div>
        <div className="text-sm text-gray-600">Engineer: {data.engineerNameAr||data.engineerNameEn||'-'}</div>
        <div className="text-sm text-gray-600">Status: {data.stage||data.status}</div>
      </div>
    </div>
  );
}

