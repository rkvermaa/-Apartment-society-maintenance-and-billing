import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { navConfigByRole } from './navConfig';

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
            <NavLink to={item.path}>{item.label}</NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
