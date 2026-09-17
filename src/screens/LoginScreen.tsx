import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { Role } from '../auth/AuthContext';
import { navConfigByRole } from '../shell/navConfig';
import { logger } from '../lib/logger';

interface SessionResponse {
  token: string;
  role: Role;
  username: string;
}

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      logger.warn('login_failed', { username });
      setError('Invalid username or password.');
      return;
    }

    const session = (await res.json()) as SessionResponse;
    logger.info('login_succeeded', { username: session.username, role: session.role });
    login(session.role, session.username, session.token);
    navigate(navConfigByRole[session.role][0].path, { replace: true });
  }

  return (
    <div>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit">Log in</button>
      </form>
    </div>
  );
}
