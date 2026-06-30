import './index.css';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { AuthProvider } from './context/AuthContext';
import { WpAuthProvider } from './context/WpAuthContext';

export default function App() {
  return (
    <AuthProvider>
      <WpAuthProvider>
        <RouterProvider router={router} />
      </WpAuthProvider>
    </AuthProvider>
  );
}
