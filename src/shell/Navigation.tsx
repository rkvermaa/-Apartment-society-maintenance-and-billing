import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { navConfigByRole } from './navConfig';
import './Navigation.css';

export function Navigation() {
  const { role } = useAuth();

  if (!role) {
    return null;
  }

  const items = navConfigByRole[role];

  return (
    <nav aria-label="Main navigation" data-testid="app-navigation">
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <NavLink to={item.path} className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}>
              {({ isActive }) => <span aria-current={isActive ? 'page' : undefined}>{item.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
