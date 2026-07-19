export type ViewMode = 'table' | 'cards';

export interface UiState {
  teamViewMode: ViewMode;
  projectsViewMode: ViewMode;
}

/**
 * Always the same on the server and on the client's first render, regardless of what's in
 * localStorage — diverging here would make Angular's hydration discard and rebuild the
 * table/cards subtree on load, which is what causes PrimeNG components to lose their styles.
 * The persisted value (if any) is applied after hydration via `hydrateUiState`, see ui.persistence.ts.
 */
export const initialUiState: UiState = {
  teamViewMode: 'table',
  projectsViewMode: 'table',
};
