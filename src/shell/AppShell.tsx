import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';
import { useAuth } from '../auth/useAuth';

export function AppShell() {
  const { logout } = useAuth();

  return (
    <div data-testid="app-shell">
      <header>
        <Navigation />
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
