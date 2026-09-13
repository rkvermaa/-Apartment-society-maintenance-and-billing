import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { Role } from '../auth/AuthContext';
import { navConfigByRole } from '../shell/navConfig';

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('resident');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login(role);
    navigate(navConfigByRole[role][0].path, { replace: true });
  }

  return (
    <div>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="username">Username</label>
        <input id="username" name="username" type="text" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" />
        <label htmlFor="role">Role</label>
        <select id="role" name="role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="resident">Resident</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit">Log in</button>
      </form>
    </div>
  );
}
