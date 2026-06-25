// English-only build
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Inbox, Boxes, BarChart3, User, LogOut, Plus, Users, UserPlus, LayoutGrid, ClipboardList } from 'lucide-react';
import { getAuth, signOut } from 'firebase/auth';
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { confirmWpUnsavedChanges, setWpUnsavedChangesFlag } from '../lib/wpUnsaved';
// Language switcher removed: English-only build

export default function Sidebar({ open, onClose, collapsedDesktop }: { open: boolean; onClose: () => void; collapsedDesktop?: boolean; }) {
  const { role } = useAuth();
  const loc = useLocation();
  const logoSrc = `${import.meta.env.BASE_URL}logo.svg`;
  const isWpApp = loc.pathname.startsWith('/wp');
  const side = isWpApp ? 'right-0' : 'left-0';
  const hiddenTranslate = isWpApp ? 'translate-x-full' : '-translate-x-full';
  const collapsedTranslate = isWpApp ? 'sm:translate-x-full' : 'sm:-translate-x-full';
  const canRequest = !!role?.roles?.requester; // requester only
  const canInventory = !!role?.roles?.storeOfficer; // storeOfficer only
  const canInventoryV2 = !!role?.roles?.storeOfficer || !!role?.roles?.admin;
  const canReporting = !!role?.roles?.auditor; // auditor only
  const isAdmin = !!role?.roles?.admin;
  const showNew = !!canRequest;
  const homeHref = isWpApp ? '/wp' : '/requests';
  const appTitle = isWpApp ? 'خطط العمل' : 'RAK IMS';

  const handleSignOut = () => {
    if (!confirmWpUnsavedChanges()) return;
    setWpUnsavedChangesFlag(false);
    signOut(getAuth());
  };

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
      <aside className={`fixed ${side} top-0 z-50 h-full w-full sm:w-72 bg-white border ${open? '' : hiddenTranslate} ${collapsedDesktop ? collapsedTranslate : 'sm:translate-x-0'} transition-transform`} dir={isWpApp ? 'rtl' : 'ltr'}>
        <div className="p-4 flex items-center justify-between gap-2 border-b">
          <Link to={homeHref} onClick={onClose} className="flex items-center gap-2">
            <img src={logoSrc} className="h-6 w-6" alt="Logo" />
            <div className="font-semibold">{appTitle}</div>
          </Link>
          <button className="sm:hidden btn-ghost px-3 py-1 text-sm" onClick={onClose}>{isWpApp ? 'رجوع' : 'Back'}</button>
        </div>
        <div className="p-3 space-y-1">
          <Item to="/apps" icon={LayoutGrid} label={isWpApp ? 'التطبيقات' : 'Applications'} />
          {isWpApp ? (
            <>
              <Item to="/wp" icon={ClipboardList} label={'خطط العمل'} />
              <Item to="/wp/new" icon={Plus} label={'خطة جديدة'} />
            </>
          ) : (
            <>
          <Item to="/requests" icon={Inbox} label={'Requests'} />
          {showNew && (
            <NavLink to="/requests/new" className={({isActive})=>`flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50 ${isActive?'bg-blue-50':''}`} onClick={onClose}>
              <Plus className="h-4 w-4 icon-blue"/><span>New Request</span>
            </NavLink>
          )}
          {canInventory && <Item to="/inventory" icon={Boxes} label={'Inventory'} />}
          {canInventoryV2 && <Item to="/inventory-v2" icon={Boxes} label={'Inventory V2'} />}
          {canReporting && <Item to="/reporting" icon={BarChart3} label={'Reporting'} />}
          {isAdmin && <Item to="/users" icon={Users} label={'Users'} />}
          {isAdmin && <Item to="/users/new" icon={UserPlus} label={'Create User'} />}
            </>
          )}
          <Item to="/profile" icon={User} label={isWpApp ? 'الملف الشخصي' : 'Profile'} />
          <button onClick={handleSignOut} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-blue-50">
            <LogOut className="h-4 w-4 icon-blue"/><span>{isWpApp ? 'تسجيل الخروج' : 'Sign out'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
