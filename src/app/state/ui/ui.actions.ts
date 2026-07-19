import { createAction, props } from '@ngrx/store';
import { UiState, ViewMode } from './ui.model';

export const setViewMode = createAction(
  '[UI] Set View Mode',
  props<{ page: 'team' | 'projects'; mode: ViewMode }>(),
);

/** Applies a persisted slice of UI state after hydration (browser-only, see ui.persistence.ts). */
export const hydrateUiState = createAction('[UI] Hydrate From Storage', props<{ state: Partial<UiState> }>());
