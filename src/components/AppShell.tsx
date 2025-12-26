import { useMemo, useState } from 'react';
import Sidebar from './Sidebar';
import { Menu, ChevronLeft, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const loc = useLocation();
  const isRequestsPage = useMemo(() => loc.pathname === '/requests', [loc.pathname]);
  const isNewRequestPage = useMemo(() => loc.pathname.startsWith('/requests/new'), [loc.pathname]);
  const isAr = false;
  const logoSrc = `${import.meta.env.BASE_URL}logo.svg`;
  return (
    <div className="min-h-screen bg-white flex">
      <Sidebar open={open} onClose={() => setOpen(false)} collapsedDesktop={collapsed} />
      <div className="flex-1 flex flex-col">
        {/* Desktop top bar for menu toggle */}
        <div className="hidden sm:flex items-center justify-between px-4 py-3 border-b bg-white sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <img src={logoSrc} className="h-7 w-7" alt="Logo" />
            <div className="text-base font-semibold">RAK IMS</div>
          </div>
          <button
            className="btn-ghost flex items-center gap-2"
            onClick={() => setCollapsed(v => !v)}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5 icon-blue" /> : <PanelLeftClose className="h-5 w-5 icon-blue" />}
            <span className="text-sm font-medium text-blue-700">{collapsed ? 'Show menu' : 'Hide menu'}</span>
          </button>
        </div>
        {/* Mobile top bar */}
        <div className="sm:hidden sticky top-0 z-40 bg-white/90 backdrop-blur border-b">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              {isNewRequestPage ? (
                <Link to="/requests" className="flex items-center gap-2">
                  <ChevronLeft className="h-5 w-5 icon-blue" />
                  <img src={logoSrc} className="h-7 w-7" alt="Logo" />
                  <div className="text-base font-semibold">RAK IMS</div>
                </Link>
              ) : (
                <>
                  <img src={logoSrc} className="h-7 w-7" alt="Logo" />
                  <div className="text-base font-semibold">RAK IMS</div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isRequestsPage && (
                <button
                  className="btn-ghost p-2"
                  aria-label="Search & filter"
                  onClick={() => window.dispatchEvent(new CustomEvent('requests:toggle-filter'))}
                >
                  <span className="sr-only">Search</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 icon-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
                  </svg>
                </button>
              )}
              {!isNewRequestPage && (
                <button
                  className="btn-ghost flex items-center gap-2"
                  onClick={()=>setOpen(true)}
                  aria-label="Menu">
                  <Menu className="h-5 w-5 icon-blue"/>
                  <span className="text-sm font-medium text-blue-700">Menu</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <main className="p-3 sm:p-4 lg:p-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
