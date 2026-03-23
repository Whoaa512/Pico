import { useEffect, useCallback, useRef, useMemo } from "react";
import { BehaviorSubject } from "rxjs";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type { SessionListItem } from "../types";

const PAGE_SIZE = 20;

export interface ChatSessionsState {
  sessions: SessionListItem[];
  total: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  isRefetching: boolean;
}

interface InternalState extends ChatSessionsState {
  page: number;
}

const INITIAL_STATE: InternalState = {
  sessions: [],
  total: 0,
  isLoading: true,
  isFetchingNextPage: false,
  hasNextPage: false,
  isRefetching: false,
  page: 0,
};

export interface ChatSessionsHandle extends ChatSessionsState {
  fetchNextPage: () => void;
  refetch: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  invalidate: () => void;
}

export function useChatSessions(): ChatSessionsHandle {
  const { api } = usePiClient();
  const state$ = useRef(new BehaviorSubject<InternalState>(INITIAL_STATE));

  const emit = useCallback(
    (patch: Partial<InternalState>) =>
      state$.current.next({ ...state$.current.value, ...patch }),
    [],
  );

  const loadPage = useCallback(
    async (page: number, append: boolean) => {
      try {
        const data = await api.listChatSessions({ page, limit: PAGE_SIZE });
        const items = data.items ?? [];
        const prev = append ? state$.current.value.sessions : [];
        emit({
          sessions: [...prev, ...items],
          total: data.total,
          page: data.page,
          hasNextPage: data.has_more,
          isLoading: false,
          isFetchingNextPage: false,
          isRefetching: false,
        });
      } catch {
        emit({
          isLoading: false,
          isFetchingNextPage: false,
          isRefetching: false,
        });
      }
    },
    [api, emit],
  );

  useEffect(() => {
    state$.current.next(INITIAL_STATE);
    loadPage(1, false);
  }, [loadPage]);

  const fetchNextPage = useCallback(() => {
    const s = state$.current.value;
    if (!s.hasNextPage || s.isFetchingNextPage) return;
    emit({ isFetchingNextPage: true });
    loadPage(s.page + 1, true);
  }, [loadPage, emit]);

  const refetch = useCallback(() => {
    emit({ isRefetching: true });
    loadPage(1, false);
  }, [loadPage, emit]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await api.deleteChatSession(sessionId);
      refetch();
    },
    [api, refetch],
  );

  const snapshot = useObservable(state$.current, INITIAL_STATE);
  const publicState = useMemo<ChatSessionsState>(
    () => ({
      sessions: snapshot.sessions,
      total: snapshot.total,
      isLoading: snapshot.isLoading,
      isFetchingNextPage: snapshot.isFetchingNextPage,
      hasNextPage: snapshot.hasNextPage,
      isRefetching: snapshot.isRefetching,
    }),
    [snapshot],
  );

  return { ...publicState, fetchNextPage, refetch, deleteSession, invalidate: refetch };
}
