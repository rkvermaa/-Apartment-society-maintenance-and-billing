import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { authenticate } from '../auth/credentials';
import { navConfigByRole } from '../shell/navConfig';
import { logger } from '../lib/logger';

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const role = authenticate(username, password);
    if (!role) {
      logger.warn('login_failed', { username });
      setError('Invalid username or password.');
      return;
    }

    logger.info('login_succeeded', { username, role });
    login(role, username);
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
