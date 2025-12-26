// English-only build
import { NavLink, Link } from 'react-router-dom';
import { Inbox, Boxes, BarChart3, User, LogOut, Plus } from 'lucide-react';
import { getAuth, signOut } from 'firebase/auth';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
// Language switcher removed: English-only build

export default function Sidebar({ open, onClose, collapsedDesktop }: { open: boolean; onClose: () => void; collapsedDesktop?: boolean; }) {
  const { role } = useAuth();
  const side = 'left-0';
  const logoSrc = `${import.meta.env.BASE_URL}logo.svg`;
  const canRequest = !!role?.roles?.requester; // requester only
  const canInventory = !!role?.roles?.storeOfficer; // storeOfficer only
  const canReporting = !!role?.roles?.auditor; // auditor only
  const showNew = !!canRequest;
  const homeHref = '/requests';

  const Item = ({ to, icon:Icon, label }:{to:string, icon:any, label:string}) => (
    <NavLink to={to} className={({isActive})=>`flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50 ${isActive?'bg-blue-50':''}`} onClick={onClose}>
      <Icon className="h-4 w-4 icon-blue"/><span>{label}</span>
    </NavLink>
  );

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <>
      {/* Mobile overlay */}
      <div className={`fixed inset-0 bg-black/20 z-40 sm:hidden ${open? 'block' : 'hidden'}`} onClick={onClose} />
      {/* Panel */}
      <aside className={`fixed ${side} top-0 z-50 h-full w-full sm:w-72 bg-white border ${open? '' : 'translate-x-[-100%]'} ${collapsedDesktop ? 'sm:-translate-x-full' : 'sm:translate-x-0'} transition-transform`}>
        <div className="p-4 flex items-center justify-between gap-2 border-b">
          <Link to={homeHref} onClick={onClose} className="flex items-center gap-2">
            <img src={logoSrc} className="h-6 w-6" alt="Logo" />
            <div className="font-semibold">RAK IMS</div>
          </Link>
          <button className="sm:hidden btn-ghost px-3 py-1 text-sm" onClick={onClose}>Back</button>
        </div>
        <div className="p-3 space-y-1">
          <Item to="/requests" icon={Inbox} label={'Requests'} />
          {showNew && (
            <NavLink to="/requests/new" className={({isActive})=>`flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50 ${isActive?'bg-blue-50':''}`} onClick={onClose}>
              <Plus className="h-4 w-4 icon-blue"/><span>New Request</span>
            </NavLink>
          )}
          {canInventory && <Item to="/inventory" icon={Boxes} label={'Inventory'} />}
          {canReporting && <Item to="/reporting" icon={BarChart3} label={'Reporting'} />}
          <Item to="/profile" icon={User} label={'Profile'} />
          <button onClick={()=>signOut(getAuth())} className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50">
            <LogOut className="h-4 w-4 icon-blue"/><span>Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
