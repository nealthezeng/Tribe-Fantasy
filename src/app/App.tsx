import { createHashRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { supabase } from './lib/supabase';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { NotConfigured } from './pages/NotConfigured';

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'join', element: <JoinPage /> },
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
