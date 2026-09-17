import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { Role } from '../auth/AuthContext';
import { navConfigByRole } from '../shell/navConfig';
import { logger } from '../lib/logger';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let response: Response;
    try {
      response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      logger.warn('login_failed', { username });
      setError(INVALID_CREDENTIALS_MESSAGE);
      return;
    }

    if (!response.ok) {
      logger.warn('login_failed', { username });
      setError(INVALID_CREDENTIALS_MESSAGE);
      return;
    }

    const { role, token } = (await response.json()) as { role: Role; token: string };
    logger.info('login_succeeded', { username, role });
    login(role, token);
    navigate(navConfigByRole[role][0].path, { replace: true });
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
