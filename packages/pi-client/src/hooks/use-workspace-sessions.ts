import { useEffect, useCallback, useRef, useMemo } from "react";
import { BehaviorSubject } from "rxjs";
import { usePiClient } from "./context";
import { useObservable } from "./use-observable";
import type { SessionListItem } from "../types";

const PAGE_SIZE = 20;

export interface WorkspaceSessionsState {
  sessions: SessionListItem[];
  total: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  isRefetching: boolean;
  error: string | null;
}

interface InternalState extends WorkspaceSessionsState {
  page: number;
}

const INITIAL_STATE: InternalState = {
  sessions: [],
  total: 0,
  isLoading: true,
  isFetchingNextPage: false,
  hasNextPage: false,
  isRefetching: false,
  error: null,
  page: 0,
};

export interface WorkspaceSessionsHandle extends WorkspaceSessionsState {
  fetchNextPage: () => void;
  refetch: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
}

export function useWorkspaceSessions(
  workspaceId: string | null,
): WorkspaceSessionsHandle {
  const { api } = usePiClient();
  const state$ = useRef(new BehaviorSubject<InternalState>(INITIAL_STATE));
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  const emit = useCallback(
    (patch: Partial<InternalState>) =>
      state$.current.next({ ...state$.current.value, ...patch }),
    [],
  );

  const loadPage = useCallback(
    async (page: number, append: boolean) => {
      const wid = workspaceIdRef.current;
      if (!wid) return;
      try {
        const data = await api.listWorkspaceSessions(wid, {
          page,
          limit: PAGE_SIZE,
        });
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
          error: null,
        });
      } catch (e: any) {
        emit({
          isLoading: false,
          isFetchingNextPage: false,
          isRefetching: false,
          error: e?.message ?? "Failed to fetch sessions",
        });
      }
    },
    [api, emit],
  );

  useEffect(() => {
    state$.current.next(INITIAL_STATE);
    if (!workspaceId) return;
    loadPage(1, false);
  }, [workspaceId, loadPage]);

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
      const wid = workspaceIdRef.current;
      if (!wid) return;
      await api.deleteWorkspaceSession(wid, sessionId);
      refetch();
    },
    [api, refetch],
  );

  const snapshot = useObservable(state$.current, INITIAL_STATE);
  const publicState = useMemo<WorkspaceSessionsState>(
    () => ({
      sessions: snapshot.sessions,
      total: snapshot.total,
      isLoading: snapshot.isLoading,
      isFetchingNextPage: snapshot.isFetchingNextPage,
      hasNextPage: snapshot.hasNextPage,
      isRefetching: snapshot.isRefetching,
      error: snapshot.error,
    }),
    [snapshot],
  );

  return { ...publicState, fetchNextPage, refetch, deleteSession };
}
