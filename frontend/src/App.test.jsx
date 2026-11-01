import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { store, signOut, decimalUnits } from './lib';
beforeEach(() => store.dispatch(signOut()));
describe('GauAmrut workspace', () => {
  test('opens a clearly identified read-only demo and navigates to customer search', async () => {
    render(<Provider store={store}><MemoryRouter><App/></MemoryRouter></Provider>);
    expect(screen.getByLabelText('Email address')).toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: /Explore the demo/ }));
    expect(await screen.findByRole('heading', { name: 'A fresh day, Aarav.' })).toBeInTheDocument();
    expect(screen.getByText(/Sample data, read-only preview/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Customers' }));
    expect(await screen.findByRole('heading', { name: 'Your customers' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search customers' }), { target: { value: 'Meera' } });
    expect(screen.getByRole('heading', { name: 'Meera Shah' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rajesh Patel' })).not.toBeInTheDocument();
  });
  test('decimal parsing does not introduce floating point rounding into accounting input', () => {
    expect(decimalUnits('60.05')).toBe(6005); expect(decimalUnits('1.125', 1000)).toBe(1125);
    expect(() => decimalUnits('1.001')).toThrow(); expect(() => decimalUnits('-1')).toThrow();
  });
  test('publishes legal and payment-disclaimer pages without requiring sign-in', () => {
    render(<Provider store={store}><MemoryRouter initialEntries={['/terms']}><App/></MemoryRouter></Provider>);
    expect(screen.getByRole('heading', { name: 'Terms of service' })).toBeInTheDocument();
    expect(screen.getByText(/does not hold money, initiate settlement, or guarantee UPI/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  });
});
