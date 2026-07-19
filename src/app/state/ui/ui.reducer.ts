import { createReducer, on } from '@ngrx/store';
import { hydrateUiState, setViewMode } from './ui.actions';
import { initialUiState } from './ui.model';

export const uiReducer = createReducer(
  initialUiState,
  on(setViewMode, (state, { page, mode }) =>
    page === 'team' ? { ...state, teamViewMode: mode } : { ...state, projectsViewMode: mode },
  ),
  on(hydrateUiState, (state, { state: persisted }) => ({ ...state, ...persisted })),
);
