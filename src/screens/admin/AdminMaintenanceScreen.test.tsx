import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminMaintenanceScreen } from './AdminMaintenanceScreen';
import { App } from '../../App';
import { renderWithAuth } from '../../test-utils';
import * as flatsClient from './maintenance/flatsClient';

vi.mock('./maintenance/flatsClient');

const mockedList = vi.mocked(flatsClient.listFlats);
const mockedUpdate = vi.mocked(flatsClient.updateFlat);

const flatA: flatsClient.Flat = {
  id: 1,
  flatNumber: '101',
  block: 'A',
  isActive: true,
  monthlyMaintenanceAmount: 1500,
};

beforeEach(() => {
  mockedList.mockReset();
  mockedUpdate.mockReset();
  mockedList.mockResolvedValue([flatA]);
});

describe('AdminMaintenanceScreen', () => {
  it('AC1: lists flats with their real active flag and monthly maintenance amount', async () => {
    renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });

    expect(await screen.findByText('A-101')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByLabelText('Monthly amount for A-101')).toHaveValue(1500);
  });

  it('AC3: shows a validation error when the API rejects a negative amount', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue(new Error('Monthly maintenance amount must not be negative.'));
    renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
    await screen.findByText('A-101');

    await user.clear(screen.getByLabelText('Monthly amount for A-101'));
    await user.type(screen.getByLabelText('Monthly amount for A-101'), '-50');
    await user.click(screen.getByRole('button', { name: 'Save A-101' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Monthly maintenance amount must not be negative.',
    );
  });

  it('AC4: saves an accepted non-negative amount and reflects it with no error', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({ ...flatA, monthlyMaintenanceAmount: 0 });
    renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
    await screen.findByText('A-101');

    await user.clear(screen.getByLabelText('Monthly amount for A-101'));
    await user.type(screen.getByLabelText('Monthly amount for A-101'), '0');
    await user.click(screen.getByRole('button', { name: 'Save A-101' }));

    await waitFor(() => expect(screen.getByLabelText('Monthly amount for A-101')).toHaveValue(0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('AC7: attributes a saved edit to the logged-in admin', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({ ...flatA, monthlyMaintenanceAmount: 1800 });
    renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
    await screen.findByText('A-101');

    await user.clear(screen.getByLabelText('Monthly amount for A-101'));
    await user.type(screen.getByLabelText('Monthly amount for A-101'), '1800');
    await user.click(screen.getByRole('button', { name: 'Save A-101' }));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith(
        { role: 'admin', username: 'admin-jane' },
        1,
        { monthlyMaintenanceAmount: 1800 },
      ),
    );
  });

  it('AC8: toggles the active flag and saves it', async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({ ...flatA, isActive: false });
    renderWithAuth(<AdminMaintenanceScreen />, { role: 'admin', username: 'admin-jane' });
    await screen.findByText('A-101');

    await user.click(screen.getByRole('button', { name: 'Active' }));

    expect(await screen.findByRole('button', { name: 'Inactive' })).toBeInTheDocument();
    expect(mockedUpdate).toHaveBeenCalledWith(
      { role: 'admin', username: 'admin-jane' },
      1,
      { isActive: false },
    );
  });

  it('AC5: blocks a non-admin from navigating to Admin Maintenance', () => {
    renderWithAuth(<App />, { role: 'resident', initialEntries: ['/admin/maintenance'] });

    expect(screen.getByRole('heading', { name: 'Resident Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Maintenance' })).not.toBeInTheDocument();
  });
});
