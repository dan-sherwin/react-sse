import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getClientUid, isClientUid, SSEProvider, useSSEEvents } from './react_sse';

describe('SSE Utilities', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
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
});
