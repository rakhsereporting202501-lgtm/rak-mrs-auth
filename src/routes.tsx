import { createBrowserRouter, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Requests from './pages/Requests';
import NewRequest from './pages/NewRequest';
import Inventory from './pages/Inventory';
import Reporting from './pages/Reporting';
import Profile from './pages/Profile';
import Users from './pages/Users';
import UsersNew from './pages/UsersNew';
import UsersDepartments from './pages/UsersDepartments';
import AdminSeed from './pages/AdminSeed';
import AdminSeedUsers from './pages/AdminSeedUsers';
import RequestDetails from './pages/RequestDetails';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

const basename = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

export const router = createBrowserRouter([
  { path: '/', element: <Protected><Requests /></Protected> },
  { path: '/requests', element: <Protected><Requests /></Protected> },
  { path: '/requests/new', element: <Protected><NewRequest /></Protected> },
  { path: '/requests/:id', element: <Protected><RequestDetails /></Protected> },
  { path: '/inventory', element: <Protected><Inventory /></Protected> },
  { path: '/reporting', element: <Protected><Reporting /></Protected> },
  { path: '/profile', element: <Protected><Profile /></Protected> },
  { path: '/users', element: <Protected><Users /></Protected> },
  { path: '/users/new', element: <Protected><UsersNew /></Protected> },
  { path: '/users/departments', element: <Protected><UsersDepartments /></Protected> },
  { path: '/users/:uid', element: <Protected><UsersNew /></Protected> },
  { path: '/admin/seed', element: <Protected><AdminSeed /></Protected> },
  { path: '/admin/seed-users', element: <Protected><AdminSeedUsers /></Protected> },
  { path: '/login', element: <Login /> },
  { path: '*', element: <Navigate to="/requests" replace /> },
], { basename });
