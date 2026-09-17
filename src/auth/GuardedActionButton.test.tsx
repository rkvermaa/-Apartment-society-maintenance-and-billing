import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuardedActionButton } from './GuardedActionButton';
import { renderWithAuth } from '../test-utils';

describe('GuardedActionButton', () => {
  it('AC2: denies a resident attempting an admin-only action and shows an error', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderWithAuth(
      <GuardedActionButton allowedRoles={['admin']} actionName="record_payment" label="Record Payment" onAction={onAction} />,
      { role: 'resident' },
    );

    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to perform this action.');
  });

  it('AC2: denies an admin attempting a resident-only action and shows an error', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderWithAuth(
      <GuardedActionButton allowedRoles={['resident']} actionName="submit_payment" label="Submit Payment" onAction={onAction} />,
      { role: 'admin' },
    );

    await user.click(screen.getByRole('button', { name: 'Submit Payment' }));

    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('AC3: grants a user performing an action restricted to their own role', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderWithAuth(
      <GuardedActionButton allowedRoles={['admin']} actionName="record_payment" label="Record Payment" onAction={onAction} />,
      { role: 'admin' },
    );

    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
