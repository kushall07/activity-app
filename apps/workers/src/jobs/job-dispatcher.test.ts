import { describe, expect, it, vi } from 'vitest';
import { JobDispatcher } from './job-dispatcher.js';
import type { JobHandler } from './job-handler.js';

const envelope = (type: string) =>
  JSON.stringify({ type, id: 'job-1', createdAt: new Date().toISOString(), payload: { a: 1 } });

describe('JobDispatcher', () => {
  const handle = vi.fn(async () => undefined);
  const handler: JobHandler = { type: 'system.ping', handle };
  const dispatcher = new JobDispatcher([handler]);

  it('routes a valid message to its handler', async () => {
    await expect(dispatcher.dispatch(envelope('system.ping'))).resolves.toBe('handled');
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1', payload: { a: 1 } }),
    );
  });

  it('reports invalid JSON and envelopes instead of throwing', async () => {
    await expect(dispatcher.dispatch('not json')).resolves.toBe('invalid');
    await expect(dispatcher.dispatch(JSON.stringify({ type: 'x' }))).resolves.toBe('invalid');
  });

  it('reports unknown job types', async () => {
    await expect(dispatcher.dispatch(envelope('nope'))).resolves.toBe('unknown_type');
  });

  it('propagates handler errors so SQS can retry', async () => {
    const failing = new JobDispatcher([
      { type: 'boom', handle: async () => Promise.reject(new Error('fail')) },
    ]);
    await expect(failing.dispatch(envelope('boom'))).rejects.toThrow('fail');
  });

  it('rejects duplicate handler registrations', () => {
    expect(() => new JobDispatcher([handler, handler])).toThrow(/Duplicate/);
  });
});
