import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';

export function AppShell() {
  return (
    <div data-testid="app-shell">
      <header>
        <Navigation />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
