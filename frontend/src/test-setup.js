import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import './i18n';

if (typeof window !== 'undefined' && window.HTMLDialogElement) {
  window.HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true; });
  window.HTMLDialogElement.prototype.close = vi.fn(function () { this.open = false; });
}

afterEach(cleanup);
