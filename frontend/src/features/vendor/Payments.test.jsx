import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import Payments from './Payments';
import useData from '../../hooks/useData';
import { store, signIn, api } from '../../lib';

vi.mock('../../hooks/useData', () => ({ default: vi.fn() }));
vi.mock('../../lib', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      post: vi.fn().mockResolvedValue({ data: { data: { receipt: 'GA-TEST-12345', generated: 2, skipped: 1 } } }),
      patch: vi.fn().mockResolvedValue({ data: { data: { claim: { status: 'approved' }, payment: { _id: 'pay-123', receipt: 'GA-TEST-12345' } } } }),
      get: vi.fn().mockResolvedValue({
        data: {
          data: {
            receipt: 'GA-TEST-12345',
            date: new Date().toISOString(),
            method: 'upi',
            reference: 'UTR112233',
            amountPaise: 5000,
            dairy: { businessName: 'Test Dairy', ownerName: 'Aarav' },
            customer: { name: 'Kavita Patel' },
            balanceAfterPaise: 2000
          }
        }
      })
    }
  };
});

const mockBills = [
  { _id: 'b1', customer_id: 'c1', month: '2026-08', openingPaise: 5000, chargesPaise: 18000, paidPaise: 10000, closingPaise: 13000 }
];

const mockCustomers = [
  { _id: 'c1', name: 'Kavita Patel' }
];

const mockClaims = [
  { _id: 'cl1', customer_id: 'c1', customerName: 'Kavita Patel', amountPaise: 5000, method: 'upi', reference: 'UTR998877', notes: 'GPay payment', status: 'pending', createdAt: new Date().toISOString() }
];

const mockPayments = [
  { _id: 'p1', customer_id: 'c1', amountPaise: 10000, method: 'upi', receipt: 'GA-RECORDED-001', createdAt: new Date().toISOString() }
];

const mockAdjustments = [
  { _id: 'adj1', customer_id: 'c1', customerName: 'Kavita Patel', type: 'waiver', amountPaise: 2000, reason: 'Delayed delivery waiver', billMonth: '2026-08', status: 'applied', createdAt: new Date().toISOString() }
];

beforeEach(() => {
  vi.clearAllMocks();
  store.dispatch(signIn({ user: { id: 'owner-1', name: 'Aarav', role: 'milkman', businessName: 'Test Dairy' }, token: 'fake-jwt' }));
  useData.mockImplementation(path => {
    if (path.startsWith('/bills')) return { data: mockBills, loading: false, error: '', reload: vi.fn(), meta: { total: 1 } };
    if (path.startsWith('/customers')) return { data: mockCustomers, loading: false, error: '', reload: vi.fn() };
    if (path.startsWith('/payment-claims')) return { data: mockClaims, loading: false, error: '', reload: vi.fn() };
    if (path.startsWith('/payments')) return { data: mockPayments, loading: false, error: '', reload: vi.fn() };
    if (path.startsWith('/adjustments')) return { data: mockAdjustments, loading: false, error: '', reload: vi.fn() };
    return { data: [], loading: false, error: '', reload: vi.fn() };
  });
});

const mount = () => render(<Provider store={store}><Payments /></Provider>);

describe('Vendor Bills & Payments feature', () => {
  test('renders bills table displaying opening balance, charges, paid and closing due', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Bills & payments' })).toBeInTheDocument();
    expect(screen.getByText('Opening (Carried)')).toBeInTheDocument();
    expect(screen.getByText('Kavita Patel')).toBeInTheDocument();
    expect(screen.getByText('2026-08')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
  });

  test('switches to customer payment claims tab, displays pending claims and allows approval', async () => {
    mount();
    const claimsTab = screen.getByRole('button', { name: /Customer payment claims/ });
    fireEvent.click(claimsTab);

    expect(await screen.findByText('UTR998877')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/payment-claims/cl1/review', { action: 'approve' });
    });
  });

  test('rejecting a claim opens rejection modal requiring a reason', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Customer payment claims/ }));

    const rejectButton = await screen.findByRole('button', { name: 'Reject' });
    fireEvent.click(rejectButton);

    expect(screen.getByRole('heading', { name: 'Reject payment claim' })).toBeInTheDocument();
    const reasonInput = screen.getByLabelText('Rejection reason');
    fireEvent.change(reasonInput, { target: { value: 'Payment not found in bank statement' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/payment-claims/cl1/review', {
        action: 'reject',
        reason: 'Payment not found in bank statement'
      });
    });
  });

  test('switches to receipts tab and views digital receipt', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Receipts' }));

    const viewReceiptBtn = await screen.findByRole('button', { name: 'View receipt' });
    fireEvent.click(viewReceiptBtn);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/payments/p1/receipt');
      expect(screen.getByText(/VERIFIED RECEIPT/)).toBeInTheDocument();
      expect(screen.getByText('GA-TEST-12345')).toBeInTheDocument();
    });
  });

  test('reverses a payment with mandatory reason', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Receipts' }));

    const reverseBtn = await screen.findByRole('button', { name: 'Reverse' });
    fireEvent.click(reverseBtn);

    expect(screen.getByRole('heading', { name: 'Reverse payment & restore balance' })).toBeInTheDocument();
    const reasonInput = screen.getByLabelText('Reversal reason (audit log)');
    fireEvent.change(reasonInput, { target: { value: 'Cheque bounced at clearing house' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm payment reversal' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/payments/p1/reverse', {
        reason: 'Cheque bounced at clearing house'
      });
    });
  });

  test('renders adjustments tab, lists adjustments, and creates a credit adjustment', async () => {
    mount();
    const adjTab = screen.getByRole('button', { name: 'Adjustments & credits' });
    fireEvent.click(adjTab);

    expect(await screen.findByText('Delayed delivery waiver')).toBeInTheDocument();
    expect(screen.getByText('waiver')).toBeInTheDocument();

    const applyBtn = screen.getAllByRole('button', { name: 'Apply adjustment' })[0];
    fireEvent.click(applyBtn);

    expect(screen.getByRole('heading', { name: 'Create account adjustment' })).toBeInTheDocument();

    const customerSelect = screen.getByLabelText('Customer');
    fireEvent.change(customerSelect, { target: { value: 'c1' } });

    const typeSelect = screen.getByLabelText('Adjustment type');
    fireEvent.change(typeSelect, { target: { value: 'credit' } });

    const amountInput = screen.getByLabelText('Adjustment amount (₹)');
    fireEvent.change(amountInput, { target: { value: '25.00' } });

    const reasonInput = screen.getByLabelText('Adjustment reason (required)');
    fireEvent.change(reasonInput, { target: { value: 'Overbilling goodwill credit' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & apply adjustment' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/adjustments', expect.objectContaining({
        customer_id: 'c1',
        type: 'credit',
        amountPaise: 2500,
        reason: 'Overbilling goodwill credit'
      }));
    });
  });
});

