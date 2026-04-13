import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import { getClientUid, isClientUid, SSEProvider, useSSEEvents } from './react_sse';

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly init?: EventSourceInit;
  closed = false;

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.init = init;
    MockEventSource.instances.push(this);
  }

  addEventListener() {}

  close() {
    this.closed = true;
  }
}

describe('SSE Utilities', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  it('getClientUid returns a consistent ID within a session', () => {
    const uid1 = getClientUid();
    const uid2 = getClientUid();
    
    expect(uid1).toBe(uid2);
    expect(uid1.length).toBeGreaterThan(10);
  });

  it('isClientUid correctly identifies the current client UID', () => {
    const uid = getClientUid();
    expect(isClientUid(uid)).toBe(true);
    expect(isClientUid('different-uid')).toBe(false);
    expect(isClientUid(null)).toBe(false);
  });
});

describe('SSE Hooks', () => {
  it('useSSEEvents should return empty array by default', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      React.createElement(SSEProvider, { connections: [] }, children)
    );

    const { result } = renderHook(() => useSSEEvents(), { wrapper });

    expect(result.current).toEqual([]);
  });

  it('does not reconnect when equivalent connection configs are recreated on rerender', async () => {
    const Shell = ({tick}: {tick: number}) => React.createElement(
      SSEProvider,
      {
        connections: [
          {
            id: 'chronix',
            url: '/sse',
            withCredentials: true,
            eventTypes: ['notification', 'job_progress'],
            tokenLoader: async () => 'token',
          },
        ],
      },
      React.createElement('div', null, tick),
    );

    const { rerender } = render(React.createElement(Shell, { tick: 1 }));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0]?.closed).toBe(false);

    rerender(React.createElement(Shell, { tick: 2 }));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0]?.closed).toBe(false);
  });
});
