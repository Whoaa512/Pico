import { createContext, useContext, useSyncExternalStore } from "react";

interface VisibleMessageStore {
  isVisible(messageId: string): boolean;
  setVisibleIds(nextVisibleIds: Set<string>): void;
  subscribe(listener: () => void): () => void;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export function createVisibleMessageStore(): VisibleMessageStore {
  let visibleIds = new Set<string>();
  const listeners = new Set<() => void>();

  return {
    isVisible(messageId) {
      return visibleIds.has(messageId);
    },
    setVisibleIds(nextVisibleIds) {
      if (areSetsEqual(visibleIds, nextVisibleIds)) {
        return;
      }
      visibleIds = nextVisibleIds;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const NOOP_VISIBLE_STORE: VisibleMessageStore = {
  isVisible: () => true,
  setVisibleIds: () => {},
  subscribe: () => () => {},
};

export const VisibleMessagesContext =
  createContext<VisibleMessageStore>(NOOP_VISIBLE_STORE);

export const MessageIdContext = createContext<string | null>(null);

export function useIsMessageVisible(): boolean {
  const store = useContext(VisibleMessagesContext);
  const messageId = useContext(MessageIdContext);
  return useSyncExternalStore(
    store.subscribe,
    () => (!messageId ? true : store.isVisible(messageId)),
    () => true,
  );
}

interface MobileDiffSheetContextValue {
  open(tabId?: string): void;
}

const NOOP_MOBILE_SHEET: MobileDiffSheetContextValue = { open: () => {} };

export const MobileDiffSheetContext =
  createContext<MobileDiffSheetContextValue>(NOOP_MOBILE_SHEET);

export function useMobileDiffSheet(): MobileDiffSheetContextValue {
  return useContext(MobileDiffSheetContext);
}
