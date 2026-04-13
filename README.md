# @dsherwin/react-sse

A lightweight, React-friendly library for consuming Server‑Sent Events (SSE) with multiple concurrent connections, stable React subscriptions, and helpful hooks. It uses a small internal store compatible with `useSyncExternalStore` to avoid unnecessary renders and expose referentially stable snapshots.

Key features:
- Multiple, independently authenticated SSE connections
- Per‑connection status tracking (connecting/open/error)
- Bounded, global event buffer (ring buffer)
- Simple hooks to read connection status, all events, or only the latest matching event
- Flexible filtering without causing render loops
- Automatic per-tab `uid` query parameter support for server-side targeting and replay helpers
- Declarative connection diffing so equivalent rerenders do not tear down active streams
- **Built-in Testing Support**: Modern testing setup with Vitest and React Testing Library.

## Installation

```bash
npm install @dsherwin/react-sse
```

Peer deps: `react` and `react-dom` v19 or newer. Ships ESM with TypeScript types.

## Quick Start

```tsx
import { SSEProvider, type ConnectionConfig, useSSEEvents, useSSEConnection } from "@dsherwin/react-sse";

function AppProviders({ children }: { children: React.ReactNode }) {
  const connections: ConnectionConfig[] = [
    {
      id: "internal_data_svc",
      url: "https://api.example.com/sse",
      tokenLoader: async () => "YOUR_JWT_TOKEN",
    },
  ];

  return (
    <SSEProvider connections={connections}>
      {children}
    </SSEProvider>
  );
}

function Header() {
  const conn = useSSEConnection("internal_data_svc");
  const events = useSSEEvents();

  return (
    <div>
      <div>Status: {conn?.status ?? "idle"}</div>
      <pre>{JSON.stringify(events.slice(-3), null, 2)}</pre>
    </div>
  );
}
```

## Connection Notes

- `uid` is automatically appended to each connection URL and persisted per browser tab via `sessionStorage`.
- If `tokenLoader` resolves a value, it is appended as the `authToken` query parameter by default. Override the parameter name with `tokenQueryParam`.
- Use `withCredentials: true` when your backend expects cookie-based auth.
- Named SSE events must be listed in `eventTypes`; otherwise the provider only listens for the default `message` event.
- The provider compares connection definitions by effective config, so rerendering with equivalent connection arrays will not force unnecessary reconnects.

## Testing

This project uses [Vitest](https://vitest.dev/) for unit testing.

```bash
# Run tests in watch mode
npm test

# Run tests once (for CI/CD)
npm test -- --run
```

## API

### Hooks

- `useSSEConnection(id: string)`: Subscribe to one connection’s status.
- `useSSEConnections(ids?: string[])`: Subscribe to all connections.
- `useSSEEvents(filter?)`: Subscribe to the global event buffer.
- `useSSEEvent(connectionId, type?)`: Get only the latest matching event.
- `useLiveSSEEvent(connectionId, type?)`: Only returns events that arrive after mount.
- `useSSEManager()`: Imperative `connect` and `disconnect` helpers.

## License

ISC © Dan Sherwin
