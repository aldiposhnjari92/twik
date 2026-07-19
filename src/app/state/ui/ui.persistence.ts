import type { ActionReducer, MetaReducer } from '@ngrx/store';
import { UiState, ViewMode } from './ui.model';

const STORAGE_KEY = 'twik.ui-state';

function isViewMode(value: unknown): value is ViewMode {
  return value === 'table' || value === 'cards';
}

/** Reads the persisted UI state, if any. Browser-only — call after hydration, not at store creation. */
export function readPersistedUiState(): Partial<UiState> | undefined {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<Record<keyof UiState, unknown>>;
    const state: Partial<UiState> = {};
    if (isViewMode(parsed.teamViewMode)) state.teamViewMode = parsed.teamViewMode;
    if (isViewMode(parsed.projectsViewMode)) state.projectsViewMode = parsed.projectsViewMode;
    return state;
  } catch {
    return undefined;
  }
}

function persistUiState(state: UiState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors (e.g. private browsing quota exceeded).
  }
}

interface RootState {
  ui: UiState;
}

function localStorageMetaReducer(reducer: ActionReducer<RootState>): ActionReducer<RootState> {
  return (state, action) => {
    const nextState = reducer(state, action);
    persistUiState(nextState.ui);
    return nextState;
  };
}

export const uiMetaReducers: MetaReducer<RootState>[] = [localStorageMetaReducer];
