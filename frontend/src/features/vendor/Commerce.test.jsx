import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import Products from './Products';
import Orders from './Orders';
import Disputes from './Disputes';
import useData from '../../hooks/useData';
import { store, signIn, api } from '../../lib';

vi.mock('../../hooks/useData', () => ({ default: vi.fn() }));
vi.mock('../../lib', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: {
      post: vi.fn().mockImplementation((path, body) => {
        if (path && path.includes('/replies')) {
          return Promise.resolve({
            data: {
              success: true,
              data: {
                _id: 'dsp-1',
                title: 'Test Dispute',
                description: 'Test description',
                status: 'under_review',
                replies: [
                  { actor: 'u1', role: 'customer', authorName: 'Kavita', message: 'First message', createdAt: new Date().toISOString() },
                  { actor: 'owner-1', role: 'milkman', authorName: 'Dairy Owner', message: body?.message || 'Reply', createdAt: new Date().toISOString() }
                ]
              }
            }
          });
        }
        return Promise.resolve({ data: { success: true, data: { _id: 'new-id' } } });
      }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: { _id: 'updated-id', status: 'confirmed' } } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true, data: { deleted: true } } }),
      get: vi.fn().mockResolvedValue({
        data: {
          success: true,
          data: {
            _id: 'dsp-1',
            title: 'Test Dispute',
            description: 'Test description',
            status: 'open',
            replies: [
              { actor: 'u1', role: 'customer', authorName: 'Kavita', message: 'First message', createdAt: new Date().toISOString() }
            ]
          }
        }
      })
    }
  };
});

const mockProducts = [
  { _id: 'p1', name: 'Gir Cow Ghee 500ml', type: 'ghee', unit: 'piece', pricePaise: 65000, description: 'Bilona ghee', available: true, deleted: false },
  { _id: 'p2', name: 'Fresh Paneer 250g', type: 'paneer', unit: 'pack', pricePaise: 12000, description: 'Soft paneer', available: false, deleted: false }
];

const mockOrders = [
  {
    _id: 'o1',
    customer_id: 'c1',
    customerName: 'Kavita Patel',
    customerPhone: '9876543210',
    deliveryDate: '2026-09-15',
    shift: 'morning',
    status: 'placed',
    totalPaise: 24000,
    items: [
      { product_id: 'p2', name: 'Fresh Paneer 250g', unit: 'pack', unitPricePaise: 12000, quantity: 2, totalPaise: 24000 }
    ]
  }
];

const mockCustomers = [
  { _id: 'c1', name: 'Kavita Patel', phone: '9876543210' }
];

const mockDisputes = [
  {
    _id: 'd1',
    customer_id: 'c1',
    customerName: 'Kavita Patel',
    type: 'quantity_mismatch',
    targetType: 'delivery',
    title: 'Missing milk bottle',
    description: 'Received only 1 bottle',
    status: 'open',
    createdAt: new Date().toISOString(),
    replies: [
      { actor: 'c1', role: 'customer', authorName: 'Kavita Patel', message: 'Received only 1 bottle', createdAt: new Date().toISOString() }
    ]
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  store.dispatch(signIn({ user: { id: 'owner-1', name: 'Aarav Dairy Owner', role: 'milkman', businessName: 'Aarav Dairy' }, token: 'fake-jwt' }));
  useData.mockImplementation(path => {
    if (path.startsWith('/products')) return { data: mockProducts, loading: false, error: '', reload: vi.fn() };
    if (path.startsWith('/orders')) return { data: mockOrders, loading: false, error: '', reload: vi.fn(), meta: { total: 1 } };
    if (path.startsWith('/customers')) return { data: mockCustomers, loading: false, error: '', reload: vi.fn() };
    if (path.startsWith('/disputes')) return { data: mockDisputes, loading: false, error: '', reload: vi.fn(), meta: { total: 1 } };
    return { data: null, loading: false, error: '', reload: vi.fn() };
  });
});

describe('Products Catalogue Component', () => {
  test('Renders product catalogue and allows adding new product', async () => {
    render(
      <Provider store={store}>
        <Products />
      </Provider>
    );

    expect(screen.getByText('Gir Cow Ghee 500ml')).toBeInTheDocument();
    expect(screen.getByText('Fresh Paneer 250g')).toBeInTheDocument();

    // Open Add Product modal
    const addBtn = screen.getByRole('button', { name: /add product/i });
    fireEvent.click(addBtn);

    expect(screen.getByLabelText(/price/i)).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByLabelText(/product name/i), { target: { value: 'Curd 500g' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '50.00' } });

    const submitBtn = screen.getAllByRole('button', { name: /add product/i })[1];
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/products', expect.objectContaining({
        name: 'Curd 500g',
        pricePaise: 5000
      }));
    });
  });

  test('Toggles product availability', async () => {
    render(
      <Provider store={store}>
        <Products />
      </Provider>
    );

    const availableBtn = screen.getAllByTitle('Click to toggle availability')[0];
    fireEvent.click(availableBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/products/p1', { available: false });
    });
  });
});

describe('Orders Management Component', () => {
  test('Renders order with price freeze snapshot and allows vendor confirmation', async () => {
    render(
      <Provider store={store}>
        <Orders />
      </Provider>
    );

    expect(screen.getByText('Kavita Patel')).toBeInTheDocument();
    expect(screen.getByText('Fresh Paneer 250g')).toBeInTheDocument();

    // Confirm order
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/orders/o1/status', { status: 'confirmed' });
    });
  });

  test('Allows cancelling order with reason', async () => {
    render(
      <Provider store={store}>
        <Orders />
      </Provider>
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.getByText('Cancellation Reason')).toBeInTheDocument();

    const reasonInput = screen.getByLabelText(/cancellation reason/i);
    fireEvent.change(reasonInput, { target: { value: 'Out of stock' } });

    const submitCancelBtn = screen.getByRole('button', { name: /confirm cancellation/i });
    fireEvent.click(submitCancelBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/orders/o1/status', {
        status: 'cancelled',
        reason: 'Out of stock'
      });
    });
  });
});

describe('Disputes Component', () => {
  test('Renders disputes list, opens thread and submits reply', async () => {
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Disputes />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText('Missing milk bottle')).toBeInTheDocument();

    // Open thread
    const threadBtn = screen.getByRole('button', { name: /open thread/i });
    fireEvent.click(threadBtn);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type a reply/i)).toBeInTheDocument();
    });

    const replyInput = screen.getByPlaceholderText(/type a reply/i);
    fireEvent.change(replyInput, { target: { value: 'We will send a replacement today.' } });

    const sendBtn = screen.getByRole('button', { name: /send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/disputes/dsp-1/replies', {
        message: 'We will send a replacement today.'
      });
    });
  });
});
