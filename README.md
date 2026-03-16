# @dsherwin/react-sse

A lightweight, React-friendly library for consuming Server‑Sent Events (SSE) with multiple concurrent connections, stable React subscriptions, and helpful hooks. It uses a small internal store compatible with `useSyncExternalStore` to avoid unnecessary renders and expose referentially stable snapshots.

Key features:
- Multiple, independently authenticated SSE connections
- Per‑connection status tracking (connecting/open/error)
- Bounded, global event buffer (ring buffer)
- Simple hooks to read connection status, all events, or only the latest matching event
- Flexible filtering without causing render loops
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

## License

ISC © Dan Sherwin
