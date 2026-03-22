import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { PiClient } from "../core/pi-client";
import type { PiClientConfig } from "../types";

const PiClientContext = createContext<PiClient | null>(null);

export interface PiClientProviderProps {
  config: PiClientConfig;
  children: ReactNode;
}

export function PiClientProvider({ config, children }: PiClientProviderProps) {
  const clientRef = useRef<PiClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new PiClient(config);
  }

  const client = clientRef.current;

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  useEffect(() => {
    const tokenChanged = client.api.accessToken !== config.accessToken;
    client.updateToken(config.accessToken);
    // If the token changed while disconnected (e.g. after a refresh),
    // reconnect the SSE stream with the fresh token.
    if (tokenChanged && config.accessToken) {
      const conn = client.connectionSnapshot;
      if (conn.status === "disconnected" || conn.status === "idle") {
        client.reconnect();
      }
    }
  }, [client, config.accessToken]);

  return (
    <PiClientContext.Provider value={client}>
      {children}
    </PiClientContext.Provider>
  );
}

export function usePiClient(): PiClient {
  const client = useContext(PiClientContext);
  if (!client) {
    throw new Error("usePiClient must be used within a <PiClientProvider>");
  }
  return client;
}
