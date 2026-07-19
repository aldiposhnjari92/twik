import { createFeatureSelector, createSelector } from '@ngrx/store';
import { UiState } from './ui.model';

export const UI_FEATURE_KEY = 'ui';

export const selectUiState = createFeatureSelector<UiState>(UI_FEATURE_KEY);

export const selectTeamViewMode = createSelector(selectUiState, (state) => state.teamViewMode);
export const selectProjectsViewMode = createSelector(selectUiState, (state) => state.projectsViewMode);
