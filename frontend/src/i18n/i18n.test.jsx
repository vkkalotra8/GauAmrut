import React from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from './index';
import LanguageSelect from '../components/LanguageSelect';

describe('i18n Localization & Language Switching', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('provides English translations by default', () => {
    expect(i18n.language).toBe('en');
    expect(i18n.t('nav.overview')).toBe('Overview');
    expect(i18n.t('common.morning')).toBe('Morning');
    expect(i18n.t('records.cowMilk')).toBe('Cow milk');
    expect(i18n.t('common.save')).toBe('Save');
  });

  test('switches and correctly retrieves Hindi translations', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.language).toBe('hi');
    expect(i18n.t('nav.overview')).toBe('अवलोकन');
    expect(i18n.t('common.morning')).toBe('सुबह');
    expect(i18n.t('records.cowMilk')).toBe('गाय का दूध');
    expect(i18n.t('common.save')).toBe('सहेजें');
    expect(document.documentElement.lang).toBe('hi');
  });

  test('switches and correctly retrieves Gujarati translations', async () => {
    await i18n.changeLanguage('gu');
    expect(i18n.language).toBe('gu');
    expect(i18n.t('nav.overview')).toBe('ઝાંખી');
    expect(i18n.t('common.morning')).toBe('સવાર');
    expect(i18n.t('records.cowMilk')).toBe('ગાયનું દૂધ');
    expect(i18n.t('common.save')).toBe('સાચવો');
    expect(document.documentElement.lang).toBe('gu');
  });

  test('falls back gracefully to provided default string for missing keys', () => {
    expect(i18n.t('nonExistentKey', 'Fallback String')).toBe('Fallback String');
  });

  test('LanguageSelect component renders with accessible label and updates language', async () => {
    const handleChange = vi.fn();
    render(<LanguageSelect onChange={handleChange} />);

    const select = screen.getByRole('combobox', { name: 'Select language' });
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('en');

    fireEvent.change(select, { target: { value: 'hi' } });
    expect(i18n.language).toBe('hi');
    expect(handleChange).toHaveBeenCalledWith('hi');

    fireEvent.change(select, { target: { value: 'gu' } });
    expect(i18n.language).toBe('gu');
    expect(handleChange).toHaveBeenCalledWith('gu');
  });
});
