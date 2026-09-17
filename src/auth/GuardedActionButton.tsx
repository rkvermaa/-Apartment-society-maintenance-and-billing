import { useState } from 'react';
import { useAuth } from './useAuth';
import type { Role } from './AuthContext';
import { logger } from '../lib/logger';

export interface GuardedActionButtonProps {
  allowedRoles: Role[];
  actionName: string;
  label: string;
  onAction: () => void;
}

export function GuardedActionButton({ allowedRoles, actionName, label, onAction }: GuardedActionButtonProps) {
  const { role } = useAuth();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!role || !allowedRoles.includes(role)) {
      logger.warn('action_denied_role_mismatch', { actionName, role, allowedRoles });
      setError('You do not have permission to perform this action.');
      return;
    }
    setError(null);
    onAction();
  }

  return (
    <div>
      <button type="button" onClick={handleClick}>
        {label}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
