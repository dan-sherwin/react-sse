import React, {createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from "react";

// Per-tab/browser UID utilities
const UID_STORAGE_KEY = "@react-sse:uid";

function generateUid(): string {
  // Prefer crypto.randomUUID when available
  try {
    // @ts-ignore
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      // @ts-ignore
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback: timestamp + random
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cachedUid: string | undefined;

export function getClientUid(): string {
  if (cachedUid) return cachedUid;
  if (typeof window === "undefined") return ""; // SSR safe
  try {
    const ss = window.sessionStorage;
    let uid = ss.getItem(UID_STORAGE_KEY) || "";
    if (!uid) {
      uid = generateUid();
      ss.setItem(UID_STORAGE_KEY, uid);
    }
    cachedUid = uid;
    return uid;
  } catch {
    // If sessionStorage is unavailable (e.g., privacy mode), just keep an in-memory uid
    cachedUid = generateUid();
    return cachedUid;
  }
}

export function isClientUid(uid?: string | null): boolean {
  if (!uid) return false;
  return uid === getClientUid();
}

// Types
export type SSEConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface SSEMessage<T = unknown> {
  connectionId: string;
  type: string;
  dataStr: string;
  data?: T;
  lastEventId?: string;
  timestamp: number;
  uid?: string; // client tab UID; set by this library when available
}

export interface SSEConnectionState {
  id: string;
  url: string;
  status: SSEConnectionStatus;
  lastEvent?: SSEMessage;
  error?: string;
}

export interface ConnectionConfig {
  id: string;
  url: string;
  tokenLoader: () => Promise<string>;
  tokenQueryParam?: string; // defaults to "authToken"
  connectOnMount?: boolean; // defaults to true
  eventTypes?: string[]; // custom SSE event names to listen for (defaults to ['message'])
}

export interface SSEProviderProps extends PropsWithChildren {
  connections?: ConnectionConfig[];
  maxEvents?: number; // ring buffer size across all connections
  enabled?: boolean;
  onEvent?: (e: SSEMessage) => void;
  onOpen?: (id: string) => void;
  onError?: (id: string, error: unknown) => void;
}

// Internal store
interface InternalState {
  connections: Record<string, SSEConnectionState>;
  events: SSEMessage[];
}

type Listener = () => void;

class Store {
  constructor(private maxEvents: number) {}
  private state: InternalState = { connections: {}, events: [] };
  private listeners = new Set<Listener>();

  getState = () => this.state;
  subscribe = (l: Listener) => (this.listeners.add(l), () => this.listeners.delete(l));
  notify = () => this.listeners.forEach((l) => l());

  setConnection(connect: SSEConnectionState) {
    this.state = {
      ...this.state,
      connections: { ...this.state.connections, [connect.id]: connect },
    };
    this.notify();
  }

  removeConnection(id: string) {
    const { [id]: _removed, ...rest } = this.state.connections;
    this.state = { ...this.state, connections: rest };
    this.notify();
  }

  pushEvent(msg: SSEMessage) {
    const events = [...this.state.events, msg];
    if (events.length > this.maxEvents) events.splice(0, events.length - this.maxEvents);
    this.state = {
      ...this.state,
      events,
      connections: {
        ...this.state.connections,
        [msg.connectionId]: {
          ...(this.state.connections[msg.connectionId] || { id: msg.connectionId, url: "", status: "open" as const }),
          lastEvent: msg,
          status: "open",
        },
      },
    };
    this.notify();
  }
}

class SSEManager {
  private sources = new Map<string, EventSource>();
  constructor(private store: Store, private callbacks?: { onEvent?: (e: SSEMessage) => void; onOpen?: (id: string) => void; onError?: (id: string, error: unknown) => void }) {}

  private buildUrl(urlStr: string, token: string, tokenQueryParam = "authToken") {
    const uid = getClientUid();
    try {
      const url = new URL(urlStr, typeof window !== "undefined" ? window.location.origin : undefined);
      // Ensure uid param is added prior to token param (ordering of URLSearchParams is preserved in toString)
      if (uid) url.searchParams.set("uid", uid);
      if (token) url.searchParams.set(tokenQueryParam || "authToken", token);
      return url.toString();
    } catch {
      // Fallback string manipulation if URL constructor fails (e.g., non-standard schemes)
      const hasQuery = urlStr.includes("?");
      const parts: string[] = [];
      if (uid) parts.push(`uid=${encodeURIComponent(uid)}`);
      if (token) parts.push(`${encodeURIComponent(tokenQueryParam || "authToken")}=${encodeURIComponent(token)}`);
      if (!hasQuery) {
        return `${urlStr}?${parts.join("&")}`;
      } else {
        // Append ensuring uid appears before token
        const sep = urlStr.endsWith("?") || urlStr.endsWith("&") ? "" : "&";
        return `${urlStr}${sep}${parts.join("&")}`;
      }
    }
  }

  connect(cfg: ConnectionConfig) {
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") return; // SSR no-op
    if (this.sources.has(cfg.id)) return; // already connected/connecting

    this.store.setConnection({ id: cfg.id, url: cfg.url, status: "connecting" });

    // Fetch token asynchronously per-connection, then open EventSource
    (async () => {
      let token: string;
      try {
        token = await cfg.tokenLoader();
      } catch (e) {
        this.store.setConnection({ id: cfg.id, url: cfg.url, status: "error", error: `token: ${String(e)}` });
        this.callbacks?.onError?.(cfg.id, e);
        return;
      }

      const fullUrl = this.buildUrl(cfg.url, token, cfg.tokenQueryParam ?? "authToken");
      const es = new EventSource(fullUrl);
      this.sources.set(cfg.id, es);

      es.addEventListener("open", () => {
        this.store.setConnection({ id: cfg.id, url: fullUrl, status: "open" });
        this.callbacks?.onOpen?.(cfg.id);
      });

      es.addEventListener("error", (err: Event) => {
        this.store.setConnection({ id: cfg.id, url: fullUrl, status: "error", error: String((err as any)?.message ?? "SSE error") });
        this.callbacks?.onError?.(cfg.id, err);
      });

      const types = (cfg.eventTypes && cfg.eventTypes.length ? cfg.eventTypes : ["message"]).slice();
      for (const t of types) {
        es.addEventListener(t, (ev: MessageEvent) => {
          const msg: SSEMessage = {
            connectionId: cfg.id,
            type: t,
            dataStr: ev.data,
            lastEventId: (ev as any).lastEventId,
            timestamp: Date.now(),
            uid: getClientUid(),
          };
          try { msg.data = JSON.parse(ev.data); } catch {}
          this.store.pushEvent(msg);
          this.callbacks?.onEvent?.(msg);
        });
      }
    })();
  }

  disconnect(id: string) {
    const src = this.sources.get(id);
    if (src) {
      src.close();
      this.sources.delete(id);
    }
    this.store.removeConnection(id);
  }

  disconnectAll() {
    for (const [id, src] of this.sources) {
      src.close();
    }
    this.sources.clear();
  }
}

interface CtxValue {
  store: Store;
  manager: SSEManager;
  connect: (cfg: ConnectionConfig) => void;
  disconnect: (id: string) => void;
}

const SSECtx = createContext<CtxValue | null>(null);

export function SSEProvider({ connections = [], maxEvents = 500, enabled = true, onEvent, onOpen, onError, children }: SSEProviderProps) {
  const storeRef = useRef<Store>(null);
  if (!storeRef.current) storeRef.current = new Store(maxEvents);
  const mgrRef = useRef<SSEManager>(null);
  if (!mgrRef.current) mgrRef.current = new SSEManager(storeRef.current, { onEvent, onOpen, onError });

  // Recreate manager when callbacks change
  useEffect(() => {
    mgrRef.current = new SSEManager(storeRef.current!, { onEvent, onOpen, onError });
  }, [onEvent, onOpen, onError]);

  const ctx = useMemo<CtxValue>(() => ({
    store: storeRef.current!,
    manager: mgrRef.current!,
    connect: (cfg) => enabled && mgrRef.current!.connect(cfg),
    disconnect: (id) => mgrRef.current!.disconnect(id),
  }), [enabled]);

  // Declarative connections
  useEffect(() => {
    if (!enabled) return;
    const toConnect = connections.filter((c) => c.connectOnMount !== false);
    toConnect.forEach((c) => ctx.connect(c));
    return () => { toConnect.forEach((c) => ctx.disconnect(c.id)); };
  }, [enabled, connections]);

  return React.createElement(SSECtx.Provider, { value: ctx }, children);
}

function useSSEContext() {
  const ctx = useContext(SSECtx);
  if (!ctx) throw new Error("useSSE* hooks must be used within <SSEProvider>");
  return ctx;
}

// Selectors
function useStoreSelector<T>(selector: (s: InternalState) => T): T {
  const { store } = useSSEContext();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}

export function useSSEConnection(id: string) {
  return useStoreSelector((s) => s.connections[id]);
}

export function useSSEConnections(ids?: string[]) {
  return useStoreSelector((s) => {
    if (!ids) return s.connections;
    const out: Record<string, SSEConnectionState> = {};
    for (const id of ids) if (s.connections[id]) out[id] = s.connections[id];
    return out;
  });
}

export type EventsFilter<T = unknown> = {
  connectionIds?: string[];
  types?: string[];
  predicate?: (m: SSEMessage<T>) => boolean;
  sinceTs?: number;
};

export function useSSEEvents<T = unknown>(filter?: EventsFilter<T>) {
  // Get a stable snapshot of the raw events array from the store.
  // IMPORTANT: useSyncExternalStore compares snapshots by reference,
  // so we must return the same reference when the store hasn't changed.
  const events = useStoreSelector((s) => s.events as SSEMessage<T>[]);

  // If no filter provided, return the raw events reference directly
  // to preserve referential stability and avoid extra renders.
  if (!filter) return events;

  // Apply filtering in a memo so that the snapshot from the store remains
  // referentially stable across renders when the store hasn't changed.
  const connIdsKey = filter.connectionIds?.join("|") ?? "";
  const typesKey = filter.types?.join("|") ?? "";
  return React.useMemo(() => {
    let out = events;
    if (filter.sinceTs) out = out.filter((e) => e.timestamp >= filter.sinceTs!);
    if (filter.connectionIds && filter.connectionIds.length) {
      const set = new Set(filter.connectionIds);
      out = out.filter((e) => set.has(e.connectionId));
    }
    if (filter.types && filter.types.length) {
      const set = new Set(filter.types);
      out = out.filter((e) => set.has(e.type));
    }
    if (filter.predicate) out = out.filter(filter.predicate);
    return out;
  }, [events, filter.sinceTs, connIdsKey, typesKey, filter.predicate]);
}

export function useSSEEvent<T = unknown>(connectionId: string, type?: string): SSEMessage<T> | undefined;
export function useSSEEvent<T = unknown>(connectionId: string[], type?: string | string[]): SSEMessage<T> | undefined;
export function useSSEEvent<T = unknown>(connectionId: string | string[], type?: string | string[]) {
  // Select the latest matching event by reference so the value is stable
  // across unrelated store updates. The component will only re-render when
  // a NEW matching event object is pushed into the store.
  return useStoreSelector((s) => {
    const arr = s.events as SSEMessage<T>[];
    const idSet = new Set(Array.isArray(connectionId) ? connectionId : [connectionId]);
    const typeSet = (type === undefined) ? undefined : new Set(Array.isArray(type) ? type : [type]);
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (!idSet.has(e.connectionId)) continue;
      if (typeSet && !typeSet.has(e.type)) continue;
      return e;
    }
    return undefined;
  });
}

export function useLiveSSEEvent<T = unknown>(connectionId: string, type?: string): SSEMessage<T> | undefined;
export function useLiveSSEEvent<T = unknown>(connectionId: string[], type?: string | string[]): SSEMessage<T> | undefined;
export function useLiveSSEEvent<T = unknown>(connectionId: string | string[], type?: string | string[]) {
  // Only emit events that arrive after this hook mounts. We record a mount
  // timestamp once, and then select the most recent matching event whose
  // timestamp is >= that value. Older (replayed) events will be ignored.
  const mountTsRef = useRef<number>(0);
  if (mountTsRef.current === 0) mountTsRef.current = Date.now();

  return useStoreSelector((s) => {
    const arr = s.events as SSEMessage<T>[];
    const idSet = new Set(Array.isArray(connectionId) ? connectionId : [connectionId]);
    const typeSet = (type === undefined) ? undefined : new Set(Array.isArray(type) ? type : [type]);
    const since = mountTsRef.current!;
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e.timestamp < since) break; // remaining are older than mount
      if (!idSet.has(e.connectionId)) continue;
      if (typeSet && !typeSet.has(e.type)) continue;
      return e;
    }
    return undefined;
  });
}

// Imperative helpers
export function useSSEManager() {
  const { connect, disconnect } = useSSEContext();
  return { connect, disconnect };
}
