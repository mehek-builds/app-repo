// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlansScreen from './PlansScreen';

afterEach(cleanup);

describe('PlansScreen', () => {
  it('shows every total, defaults to three months, and updates renewal copy with the radio choice', () => {
    const onContinue = vi.fn();
    render(
      <PlansScreen
        snapshot={null}
        onBack={() => {}}
        onContinue={onContinue}
        onManageBilling={() => {}}
      />,
    );

    expect(screen.getByText('$19.99')).toBeTruthy();
    expect(screen.getByText('$39.99')).toBeTruthy();
    expect(screen.getByText('$89.99')).toBeTruthy();
    expect(screen.getByText('Most popular')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /3 Months/i })).toHaveProperty('checked', true);
    expect(screen.getByText(/Renews every 3 months at \$89\.99/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /1 Month/i }));
    expect(screen.getByText(/Renews monthly at \$39\.99/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with 1 month' }));
    expect(onContinue).toHaveBeenCalledWith('litos_plus_month', 'manual');
  });

  it('states that Free submission is manual and Litos+ automatic submission is opt-in', () => {
    render(
      <PlansScreen
        snapshot={null}
        onBack={() => {}}
        onContinue={() => {}}
        onManageBilling={() => {}}
      />,
    );
    expect(screen.getByText('You submit each form')).toBeTruthy();
    expect(screen.getByText('Automatic submission is opt-in')).toBeTruthy();
  });
});
