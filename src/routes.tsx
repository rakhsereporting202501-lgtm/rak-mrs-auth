import { createBrowserRouter, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AppLauncher from './pages/AppLauncher';
import Requests from './pages/Requests';
import NewRequest from './pages/NewRequest';
import Inventory from './pages/Inventory';
import InventoryV2 from './pages/InventoryV2';
import InventoryV2Create from './pages/InventoryV2Create';
import InventoryV2Item from './pages/InventoryV2Item';
import InventoryV2Add from './pages/InventoryV2Add';
import InventoryV2Stock from './pages/InventoryV2Stock';
import Reporting from './pages/Reporting';
import Profile from './pages/Profile';
import Users from './pages/Users';
import UsersNew from './pages/UsersNew';
import AdminSeed from './pages/AdminSeed';
import AdminSeedUsers from './pages/AdminSeedUsers';
import RequestDetails from './pages/RequestDetails';
import WpPlans from './pages/WpPlans';
import WpPlanEditor from './pages/WpPlanEditor';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';

function Protected({ children, shell = true }: { children: JSX.Element; shell?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return shell ? <AppShell>{children}</AppShell> : children;
}

const basename = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

export const router = createBrowserRouter([
  { path: '/', element: <Protected shell={false}><AppLauncher /></Protected> },
  { path: '/apps', element: <Protected shell={false}><AppLauncher /></Protected> },
  { path: '/requests', element: <Protected><Requests /></Protected> },
  { path: '/requests/new', element: <Protected><NewRequest /></Protected> },
  { path: '/requests/:id', element: <Protected><RequestDetails /></Protected> },
  { path: '/inventory', element: <Protected><Inventory /></Protected> },
  { path: '/inventory-v2', element: <Protected><InventoryV2 /></Protected> },
  { path: '/inventory-v2/create', element: <Protected><InventoryV2Create /></Protected> },
  { path: '/inventory-v2/create/new', element: <Protected><InventoryV2Item /></Protected> },
  { path: '/inventory-v2/create/:id', element: <Protected><InventoryV2Item /></Protected> },
  { path: '/inventory-v2/add', element: <Protected><InventoryV2Add /></Protected> },
  { path: '/inventory-v2/stock', element: <Protected><InventoryV2Stock /></Protected> },
  { path: '/reporting', element: <Protected><Reporting /></Protected> },
  { path: '/profile', element: <Protected><Profile /></Protected> },
  { path: '/users', element: <Protected><Users /></Protected> },
  { path: '/users/new', element: <Protected><UsersNew /></Protected> },
  { path: '/users/departments', element: <Navigate to="/users" replace /> },
  { path: '/users/:uid', element: <Protected><UsersNew /></Protected> },
  { path: '/admin/seed', element: <Protected><AdminSeed /></Protected> },
  { path: '/admin/seed-users', element: <Protected><AdminSeedUsers /></Protected> },
  { path: '/wp', element: <Protected><WpPlans /></Protected> },
  { path: '/wp/new', element: <Protected><WpPlanEditor /></Protected> },
  { path: '/wp/:id', element: <Protected><WpPlanEditor /></Protected> },
  { path: '/login', element: <Login /> },
  { path: '*', element: <Navigate to="/apps" replace /> },
], { basename });
