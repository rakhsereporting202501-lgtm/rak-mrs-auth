import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Reporting(){
  const { role } = useAuth();
  const nav = useNavigate();
  const canReporting = !!role?.roles?.auditor;
  useEffect(()=>{ if (!canReporting) nav('/requests', { replace: true }); }, [canReporting]);
  return (
    <div className="space-y-3">
      <div className="text-xl font-semibold">Reporting</div>
      <div className="card p-6 text-gray-500">Reports dashboard (coming soon)</div>
    </div>
  );
}
