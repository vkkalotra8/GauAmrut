import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import NotificationsDrawer from '../components/NotificationsDrawer';
import { CustomerHistory, CustomerPayments, CustomerProfile } from './customer/Portal';
import AdminPortal from './admin/AdminPortal';
import useData from '../hooks/useData';
import { store, signIn, api } from '../lib';

vi.mock('../hooks/useData', () => ({ default: vi.fn() }));
vi.mock('../lib', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      get: vi.fn().mockImplementation((path) => {
        if (path === '/notifications') {
          return Promise.resolve({
            data: {
              success: true,
              data: [
                { _id: 'notif-1', title: 'Payment Claim Submitted', message: 'Meera claimed ₹1500', type: 'payment', read: false, createdAt: new Date().toISOString() },
                { _id: 'notif-2', title: 'Dispute Raised', message: 'Bill discrepancy reported', type: 'dispute', read: true, createdAt: new Date().toISOString() }
              ]
            }
          });
        }
        if (path.includes('/pdf')) {
          return Promise.resolve({ data: new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' }) });
        }
        return Promise.resolve({ data: { success: true, data: [] } });
      }),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: { _id: 'created-1' } } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: { _id: 'updated-1' } } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: { key: 'test' } } })
    }
  };
});

describe('New Platform Capabilities Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.dispatch(signIn({
      user: { id: 'test-user', name: 'Test User', role: 'customer', businessName: 'Pure Farm Dairy' },
      token: 'test-token'
    }));
  });

  test('NotificationsDrawer displays unread count badge and opens popover list', async () => {
    render(
      <Provider store={store}>
        <MemoryRouter>
          <NotificationsDrawer />
        </MemoryRouter>
      </Provider>
    );

    // Wait for notifications to load
    await waitFor(() => {
      expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
    });

    // Unread count badge should appear with '1'
    const badge = await screen.findByText('1');
    expect(badge).toBeInTheDocument();

    // Click bell icon
    fireEvent.click(screen.getByLabelText('Notifications'));

    // Verify popover opened
    expect(await screen.findByText('Payment Claim Submitted')).toBeInTheDocument();
    expect(screen.getByText('Meera claimed ₹1500')).toBeInTheDocument();
    expect(screen.getByText('Dispute Raised')).toBeInTheDocument();

    // Click "Mark all read"
    const markAllBtn = screen.getByText(/Mark all read/i);
    fireEvent.click(markAllBtn);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/notifications/read-all');
    });
  });

  test('CustomerHistory supports Vacation Pause scheduling and requests tab', async () => {
    const mockAdjustments = [
      {
        _id: 'adj-1',
        type: 'vacation',
        startDate: '2026-09-20',
        endDate: '2026-09-25',
        shift: 'both',
        reason: 'Out of town',
        status: 'pending'
      }
    ];

    useData.mockImplementation((path) => {
      if (path.startsWith('/delivery-adjustments')) {
        return { data: mockAdjustments, loading: false, error: '', reload: vi.fn() };
      }
      return { data: [], loading: false, error: '', reload: vi.fn() };
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/records?tab=adjustments']}>
          <CustomerHistory />
        </MemoryRouter>
      </Provider>
    );

    // Check that adjustments tab displays vacation pause item
    expect(await screen.findByText('Vacation pause')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20')).toBeInTheDocument();
    expect(screen.getByText(/to 2026-09-25/)).toBeInTheDocument();
    expect(screen.getByText('Out of town')).toBeInTheDocument();

    // Open modal to schedule new pause
    fireEvent.click(screen.getByRole('button', { name: /Request vacation or extra milk/i }));
    expect(screen.getByRole('button', { name: /Schedule vacation pause/i })).toBeInTheDocument();
  });

  test('CustomerPayments provides PDF bill invoice download', async () => {
    const mockBills = [
      { _id: 'bill-1', month: '2026-08', openingPaise: 0, chargesPaise: 300000, paidPaise: 300000, closingPaise: 0 }
    ];

    useData.mockImplementation((path) => {
      if (path.startsWith('/bills')) {
        return { data: mockBills, loading: false, error: '', reload: vi.fn(), meta: { total: 1 } };
      }
      return { data: [], loading: false, error: '', reload: vi.fn() };
    });

    // Mock URL.createObjectURL and revokeObjectURL
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();

    render(
      <Provider store={store}>
        <MemoryRouter>
          <CustomerPayments />
        </MemoryRouter>
      </Provider>
    );

    const pdfButton = await screen.findByRole('button', { name: /PDF/i });
    expect(pdfButton).toBeInTheDocument();

    fireEvent.click(pdfButton);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/bills/bill-1/pdf', { responseType: 'blob' });
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  test('AdminPortal renders platform sections with management actions', async () => {
    store.dispatch(signIn({
      user: {
        id: 'admin-1',
        name: 'Super Admin',
        role: 'admin',
        adminRole: 'super_admin',
        permissions: ['dashboard.read', 'users.read', 'users.manage', 'dairies.read', 'dairies.manage', 'disputes.read', 'disputes.manage', 'settings.read', 'settings.manage']
      },
      token: 'admin-token'
    }));

    useData.mockImplementation((path) => {
      if (path.startsWith('/admin/dashboard')) {
        return { data: { dairies: 5, customers: 42, users: 48, activeUsers: 45, deliveries: 1200 }, loading: false };
      }
      if (path.startsWith('/admin/dairies')) {
        return {
          data: [{ _id: 'd-1', businessName: 'Krishna Farms', name: 'Krishna', phone: '9876543210', code: 'KRISHNA1', verified: false }],
          meta: { total: 1 },
          loading: false,
          reload: vi.fn()
        };
      }
      return { data: [], loading: false, reload: vi.fn() };
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/admin/dairies']}>
          <AdminPortal logout={vi.fn()} error="" />
        </MemoryRouter>
      </Provider>
    );

    // Verify dairy verification action
    expect(await screen.findByText('Krishna Farms')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify dairy/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Verify dairy/i }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/admin/dairies/d-1/verify', { verified: true });
    });

    // Admin can export the dairy directory PDF, share it through the native
    // share sheet, or push it to a specific number
    expect(screen.getByRole('button', { name: /Download PDF/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share on WhatsApp/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send to a number/i })).toBeInTheDocument();

    // The share button pulls the same authenticated blob as its download button
    // and hands the real file to the OS, so WhatsApp receives the PDF itself.
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(window.navigator, 'canShare', { configurable: true, value: () => true });
    try {
      fireEvent.click(screen.getByRole('button', { name: /Share on WhatsApp/i }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));

      const [{ files: [file] }] = share.mock.calls[0];
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('gauamrut-dairy-directory.pdf');
      expect(file.type).toBe('application/pdf');
      expect(api.get).toHaveBeenCalledWith('/admin/dairies.pdf', { responseType: 'blob' });
    } finally {
      delete window.navigator.share;
      delete window.navigator.canShare;
    }
  });

  test('CustomerProfile shows verify prompts for unverified contact details', async () => {
    useData.mockImplementation((path) => {
      if (path.startsWith('/profile')) {
        return {
          data: { name: 'Meera', email: 'meera@example.com', phone: '9876543210', emailVerifiedAt: null, phoneVerifiedAt: null, status: 'active', language: 'en', updatedAt: 1, cowRatePaise: 6000, buffaloRatePaise: 8000 },
          loading: false, error: '', reload: vi.fn()
        };
      }
      return { data: [], loading: false, error: '', reload: vi.fn() };
    });

    render(
      <Provider store={store}>
        <MemoryRouter>
          <CustomerProfile />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByRole('button', { name: /Verify email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify mobile number/i })).toBeInTheDocument();

    // Opening the mobile verification flow sends a code over WhatsApp
    fireEvent.click(screen.getByRole('button', { name: /Verify mobile number/i }));
    expect(await screen.findByText(/send a 6-digit code to your mobile number on WhatsApp/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send code/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/profile/verification/request', { channel: 'phone' });
    });

    // Entering the code confirms the verification
    const otpInput = await screen.findByLabelText(/6-digit code/i);
    fireEvent.change(otpInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/profile/verification/confirm', { channel: 'phone', otp: '123456' });
    });
  });

  test('CustomerProfile shows Verified badges when contact details are verified', async () => {
    useData.mockImplementation((path) => {
      if (path.startsWith('/profile')) {
        return {
          data: { name: 'Meera', email: 'meera@example.com', phone: '9876543210', emailVerifiedAt: '2026-10-01T00:00:00.000Z', phoneVerifiedAt: '2026-10-01T00:00:00.000Z', status: 'active', language: 'en', updatedAt: 1 },
          loading: false, error: '', reload: vi.fn()
        };
      }
      return { data: [], loading: false, error: '', reload: vi.fn() };
    });

    render(
      <Provider store={store}>
        <MemoryRouter>
          <CustomerProfile />
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findAllByText('Verified')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Verify email/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verify mobile number/i })).not.toBeInTheDocument();
  });
});
