import { AuthProvider, useAuth } from './auth/AuthContext';
import { BalancePage } from './pages/BalancePage';
import { LoginPage } from './pages/LoginPage';

function Routes() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <BalancePage /> : <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}
