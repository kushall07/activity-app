import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiStatusCard } from './ApiStatusCard';

const data = {
  status: 'ok' as const,
  service: 'api',
  version: '0.1.0',
  uptimeSeconds: 42,
  timestamp: '2026-11-01T00:00:00.000Z',
  checks: {
    postgres: { status: 'up' as const, latencyMs: 3, detail: 'postgis 3.4.3' },
    redis: { status: 'up' as const, latencyMs: 1 },
  },
};

describe('ApiStatusCard', () => {
  it('shows connected state and dependency checks', async () => {
    await render(
      <ApiStatusCard apiUrl="http://x" data={data} loading={false} onRetry={() => {}} />,
    );
    expect(screen.getByText('Connected to API')).toBeTruthy();
    expect(screen.getByText(/postgres · 3 ms · postgis 3.4.3/)).toBeTruthy();
  });

  it('shows the error and lets the user retry', async () => {
    const onRetry = jest.fn();
    await render(
      <ApiStatusCard
        apiUrl="http://x"
        error={new Error('Could not reach API')}
        loading={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('API unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByText('Check again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
