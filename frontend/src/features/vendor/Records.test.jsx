import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import Records from './Records';
import useData from '../../hooks/useData';
import { store, signIn, serviceDate } from '../../lib';
import { enqueue, queued } from '../../offline';
vi.mock('../../hooks/useData', () => ({ default: vi.fn() }));
vi.mock('../../offline', () => ({ enqueue: vi.fn().mockResolvedValue(undefined), queued: vi.fn().mockResolvedValue([]), syncQueue: vi.fn().mockResolvedValue(undefined) }));
const customers = [
  { _id: 'cow-person', name: 'Harshang Kaliya', morningCowMl: 1000, morningBuffaloMl: 0, eveningCowMl: 500, eveningBuffaloMl: 0 },
  { _id: 'buffalo-person', name: 'Buffalo Customer', morningCowMl: 0, morningBuffaloMl: 1500, eveningCowMl: 0, eveningBuffaloMl: 750 },
  { _id: 'both-person', name: 'Both Customer', morningCowMl: 500, morningBuffaloMl: 250, eveningCowMl: 0, eveningBuffaloMl: 1000 }
].map(c => ({ ...c, status: 'active', startDate: '2025-01-01', cowRatePaise: 6000, buffaloRatePaise: 8000 }));
beforeEach(() => {
  vi.clearAllMocks(); queued.mockResolvedValue([]);
  store.dispatch(signIn({ user: { id: 'owner', name: 'Owner', role: 'milkman' }, token: 'test-token' }));
  useData.mockImplementation(path => ({ data: path.startsWith('/customers') ? customers : [], loading: false, error: '', reload: vi.fn(), meta: { total: 3 } }));
});
const mount = () => render(<Provider store={store}><Records/></Provider>);
describe('Default-based customer delivery entry', () => {
  test('selects milk types per customer and saves all positive defaults without editing', async () => {
    mount();
    expect(screen.getByLabelText('Harshang Kaliya milk type')).toHaveValue('cow');
    expect(screen.getByLabelText('Buffalo Customer milk type')).toHaveValue('buffalo');
    expect(screen.getByLabelText('Both Customer milk type')).toHaveValue('both');
    expect(screen.getByLabelText('Harshang Kaliya quantity in litres')).toHaveValue(1);
    expect(screen.getByLabelText('Buffalo Customer quantity in litres')).toHaveValue(1.5);
    expect(screen.getByLabelText('Both Customer cow quantity in litres')).toHaveValue(0.5);
    expect(screen.getByRole('button', { name: 'Save deliveries' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save deliveries' }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    expect(enqueue.mock.calls[0][1].items.map(i => [i.customer_id, i.type, i.quantityMl])).toEqual([
      ['cow-person', 'cow', 1000], ['buffalo-person', 'buffalo', 1500], ['both-person', 'cow', 500], ['both-person', 'buffalo', 250]
    ]);
    await screen.findByText('Deliveries saved successfully.');
    expect(screen.getByRole('button', { name: 'Save deliveries' })).toBeDisabled();
  });
  test('shift changes use the corresponding stored defaults and do not count as manual edits', () => {
    mount(); fireEvent.change(screen.getByLabelText('Shift'), { target: { value: 'evening' } });
    expect(screen.getByLabelText('Harshang Kaliya quantity in litres')).toHaveValue(0.5);
    expect(screen.getByLabelText('Buffalo Customer quantity in litres')).toHaveValue(0.75);
    expect(screen.getByLabelText('Both Customer milk type')).toHaveValue('buffalo');
    expect(screen.getByLabelText('Both Customer quantity in litres')).toHaveValue(1);
    expect(screen.getByLabelText('Service date')).toBeEnabled();
  });
  test('an exceptional quantity applies only to this delivery and the next date restores defaults', async () => {
    mount(); fireEvent.change(screen.getByLabelText('Harshang Kaliya quantity in litres'), { target: { value: '2.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save deliveries' }));
    await screen.findByText('Deliveries saved successfully.');
    expect(enqueue.mock.calls[0][1].items[0].quantityMl).toBe(2250);
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2025-02-02' } });
    expect(screen.getByLabelText('Harshang Kaliya quantity in litres')).toHaveValue(1);
    expect(customers[0].morningCowMl).toBe(1000);
  });
  test('a row milk-type change affects only that customer and loads that type’s default', () => {
    mount(); fireEvent.change(screen.getByLabelText('Harshang Kaliya milk type'), { target: { value: 'buffalo' } });
    expect(screen.getByLabelText('Harshang Kaliya quantity in litres')).toHaveValue(0);
    expect(screen.getByLabelText('Buffalo Customer quantity in litres')).toHaveValue(1.5);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByLabelText('Harshang Kaliya milk type')).toHaveValue('cow');
    expect(screen.getByLabelText('Harshang Kaliya quantity in litres')).toHaveValue(1);
  });
  test('already recorded and queued defaults are excluded from a new batch', async () => {
    queued.mockResolvedValue([{ status: 'queued', body: { items: [{ customer_id: 'buffalo-person', date: serviceDate(), shift: 'morning', type: 'buffalo' }] } }]);
    useData.mockImplementation(path => ({ data: path.startsWith('/customers') ? customers : [{ _id: 'r1', customer_id: 'cow-person', date: serviceDate(), shift: 'morning', type: 'cow', quantityMl: 1000, totalPaise: 6000 }], loading: false, error: '', reload: vi.fn() }));
    mount(); await screen.findByText('Queued');
    fireEvent.click(screen.getByRole('button', { name: 'Save deliveries' }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    expect(enqueue.mock.calls[0][1].items).toHaveLength(2);
    expect(enqueue.mock.calls[0][1].items.every(i => i.customer_id === 'both-person')).toBe(true);
  });
});
