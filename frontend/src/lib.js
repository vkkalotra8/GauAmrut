import axios from 'axios';
import { configureStore, createSlice } from '@reduxjs/toolkit';
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000/api', timeout: 15000 });
const session = createSlice({ name: 'session', initialState: { token: null, user: null, demo: false }, reducers: { updateUser: (state, action) => { state.user = { ...state.user, ...action.payload }; }, signIn: (_state, action) => ({ ...action.payload, demo: false }), preview: () => ({ token: null, demo: true, user: { id: 'demo', name: 'Aarav Patel', businessName: 'Shree Krishna Dairy', code: 'GAU8K2P4', role: 'milkman' } }), signOut: () => ({ token: null, user: null, demo: false }) } });
export const { signIn, preview, signOut, updateUser } = session.actions;
export const store = configureStore({ reducer: { session: session.reducer } });
api.interceptors.request.use(config => { const token = store.getState().session.token; if (token) config.headers.Authorization = `Bearer ${token}`; return config; });
api.interceptors.response.use(r => r, e => { if (e.response?.status === 401 && store.getState().session.token) store.dispatch(signOut()); return Promise.reject(e); });
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format((value || 0) / 100);
export const serviceDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const message = error => error.response?.data?.error?.message || (error.code === 'ERR_NETWORK' ? 'Cannot reach the API. Check that the backend is running, then retry.' : error.message || 'Something went wrong. Please retry.');
export function decimalUnits(value, scale = 100) {
  if (!/^\d+(\.\d{1,3})?$/.test(String(value))) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = String(value).split('.');
  const digits = String(scale).length - 1;
  if (fraction.length > digits) throw new Error(`Use at most ${digits} decimal places.`);
  const result = Number(whole) * scale + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.');
  return result;
}
