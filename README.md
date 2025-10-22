# @dsherwin/react-sse

A lightweight, React-friendly library for consuming Server‑Sent Events (SSE) with multiple concurrent connections, stable React subscriptions, and helpful hooks. It uses a small internal store compatible with `useSyncExternalStore` to avoid unnecessary renders and expose referentially stable snapshots.

Key features:
- Multiple, independently authenticated SSE connections
- Per‑connection status tracking (connecting/open/error)
- Bounded, global event buffer (ring buffer)
- Simple hooks to read connection status, all events, or only the latest matching event
- Flexible filtering without causing render loops

## Installation

- npm: `npm install @dsherwin/react-sse`
- pnpm: `pnpm add @dsherwin/react-sse`
- yarn: `yarn add @dsherwin/react-sse`

Peer deps: `react` and `react-dom` v19 or newer. Ships ESM with TypeScript types.

## Core concepts

- Provider + store
  - Wrap your app with `<SSEProvider />`. It manages one or more connections, buffers events, and exposes a stable store for the hooks.
- Connections
  - Each connection has a unique id, URL, optional token loader, and optional list of event types.
- Events
  - All events from all connections are placed into a single bounded array (ring buffer) ordered by time. Each event records `connectionId`, `type`, and parsed JSON if possible.

## Quick start

```tsx
import { SSEProvider, type ConnectionConfig, useSSEEvents, useSSEConnection } from "@dsherwin/react-sse";

function AppProviders({ children }: { children: React.ReactNode }) {
  const connections: ConnectionConfig[] = [
    {
      id: "internal_data_svc",
      url: "https://api.example.com/sse",
      tokenLoader: async () => "YOUR_JWT_TOKEN", // called on connect
      // eventTypes: ["message", "custom"] // optional; omitted = default behavior (see below)
    },
  ];

  return (
    <SSEProvider
      enabled
      connections={connections}
      maxEvents={1000}
      onEvent={(e) => console.debug("[SSE]", e.connectionId, e.type, e.data ?? e.dataStr)}
      onOpen={(id) => console.debug("[SSE] open", id)}
      onError={(id, err) => console.error("[SSE] error", id, err)}
    >
      {children}
    </SSEProvider>
  );
}

function Header() {
  const conn = useSSEConnection("internal_data_svc");
  const events = useSSEEvents(); // all buffered events

  return (
    <div>
      <div>Status: {conn?.status ?? "idle"}</div>
      {conn?.error && <pre style={{color:'crimson'}}>Error: {conn.error}</pre>}
      <pre>{JSON.stringify(events.slice(-3), null, 2)}</pre>
    </div>
  );
}
```

## API

### Provider

```ts
export interface ConnectionConfig {
  id: string;
  url: string;
  tokenLoader: () => Promise<string>;
  tokenQueryParam?: string; // defaults to "authToken"
  connectOnMount?: boolean; // defaults to true
  eventTypes?: string[]; // custom SSE event names to listen for (undefined/empty = listen to all types)
}

export interface SSEProviderProps {
  connections?: ConnectionConfig[];
  maxEvents?: number; // ring buffer size across all connections (default 500)
  enabled?: boolean; // when false, does not connect
  onEvent?: (e: SSEMessage) => void;
  onOpen?: (id: string) => void;
  onError?: (id: string, error: unknown) => void;
}
```

Behavior notes:
- A per-tab UID is generated and appended to every connection URL as `?uid=<uid>` so the server can target events for the active browser tab. The same UID is reused for all connections in the tab. Utilities are provided: `getClientUid()` and `isClientUid(uid)` for comparing incoming payload metadata with the current tab.
- tokenLoader is called per connection when opening. Its result is appended to the URL as `?authToken=...` by default (override with `tokenQueryParam`). The `uid` param is placed before the token param in the URL.
- connectOnMount defaults to true. Set `false` to declare a connection but not auto‑connect.
- eventTypes
  - If provided and non‑empty: only those named SSE events are listened for.
  - If omitted or empty: the connection listens for default SSE "message" events. To receive custom named events, specify them in `eventTypes`.
- maxEvents caps memory usage. Oldest events are pruned when exceeded.

### Types

```ts
export type SSEConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface SSEMessage<T = unknown> {
  connectionId: string;
  type: string;
  dataStr: string; // raw SSE payload string
  data?: T;        // parsed JSON if possible
  lastEventId?: string;
  timestamp: number; // ms
  uid?: string;    // client tab UID; set by this library when available
}

export interface SSEConnectionState {
  id: string;
  url: string;
  status: SSEConnectionStatus;
  lastEvent?: SSEMessage;
  error?: string;
}

export type EventsFilter<T = unknown> = {
  connectionIds?: string[];
  types?: string[];
  predicate?: (m: SSEMessage<T>) => boolean;
  sinceTs?: number;
};
```

### Hooks

- useSSEConnection(id: string): SSEConnectionState | undefined
  - Subscribe to one connection’s status and lastEvent.

- useSSEConnections(ids?: string[]): Record<string, SSEConnectionState>
  - Subscribe to all connections, or only a subset by id.

- useSSEEvents<T = unknown>(filter?: EventsFilter<T>): SSEMessage<T>[]
  - Subscribe to the global event buffer. If no `filter` is passed, returns the store’s events array by reference for maximum stability. If a `filter` is provided, filtering is applied inside `useMemo` to avoid render loops. Tip: memoize the filter object.

- useSSEEvent<T = unknown>(connectionId: string | string[], type?: string | string[]): SSEMessage<T> | undefined
  - Returns only the latest event that matches the provided connection id(s) and optional type(s). The component re‑renders only when a new matching event object arrives, not for unrelated events.

- useLiveSSEEvent<T = unknown>(connectionId: string | string[], type?: string | string[]): SSEMessage<T> | undefined
  - Live-only version of useSSEEvent. It only returns events that arrive after the component mounts. It will not replay the last matching event on first render or re-renders.

- useSSEManager(): { connect: (cfg: ConnectionConfig) => void; disconnect: (id: string) => void }
  - Imperative helpers to connect/disconnect at runtime.

## Examples

### Filter events by type

```tsx
import { useMemo } from "react";
import { useSSEEvents, type EventsFilter } from "@dsherwin/react-sse";

function ErrorsOnly() {
  const filter = useMemo<EventsFilter>(() => ({ types: ["error", "warning"] }), []);
  const events = useSSEEvents(filter);
  return <pre>{JSON.stringify(events, null, 2)}</pre>;
}
```

### React to just the latest matching event

```tsx
import { useSSEEvent } from "@dsherwin/react-sse";

function LatestOrderEvent() {
  const evt = useSSEEvent("internal_data_svc", ["order_created", "order_updated"]);
  if (!evt) return null;
  return <div>Latest order event: {evt.type}</div>;
}
```

### Multiple connection ids

```tsx
function LatestFromEither() {
  const evt = useSSEEvent(["svc_a", "svc_b"], "heartbeat");
  return <pre>{JSON.stringify(evt, null, 2)}</pre>;
}
```

## Performance tips

- Memoize filter objects passed to `useSSEEvents` to keep their identity stable across renders.
- Prefer `useSSEEvent` when you only care about the most recent matching event; it avoids re-renders from unrelated traffic.
- Tune `maxEvents` based on your app’s needs to balance history vs. memory.

## SSR

This library expects a browser with `window.EventSource`. During SSR it no‑ops; ensure you only render SSE‑dependent UI on the client.

## Changelog highlights (behavioral)

- If `eventTypes` is undefined or empty, the connection listens for default SSE `message` events. Provide explicit `eventTypes` to receive additional/custom named events.
- `useSSEEvents` returns the raw store array when unfiltered for referential stability. Filtering is applied via `useMemo`.
- `useSSEEvent` supports multiple connection ids and multiple event types and only triggers on matching events.

## License

ISC © Dan Sherwin