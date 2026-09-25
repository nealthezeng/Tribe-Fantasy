import { createHashRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { supabase } from './lib/supabase';
import { AdminPage } from './pages/admin/AdminPage';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { NotConfigured } from './pages/NotConfigured';
import { TallyPage } from './pages/TallyPage';

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'join', element: <JoinPage /> },
      { path: 'admin', element: <AdminPage /> },
      { path: 'tally', element: <TallyPage /> },
    ],
  },
]);

export function App() {
  if (!supabase) return <NotConfigured />;
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
