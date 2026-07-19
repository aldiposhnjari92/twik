import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideStore } from '@ngrx/store';
import { providePrimeNG } from 'primeng/config';
import { MessageService } from 'primeng/api';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { UI_FEATURE_KEY } from './state/ui/ui.selectors';
import { uiReducer } from './state/ui/ui.reducer';
import { uiMetaReducers } from './state/ui/ui.persistence';

const TwikPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',
      500: '{blue.500}',
      600: '{blue.600}',
      700: '{blue.700}',
      800: '{blue.800}',
      900: '{blue.900}',
      950: '{blue.950}',
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideStore({ [UI_FEATURE_KEY]: uiReducer }, { metaReducers: uiMetaReducers }),
    FormsModule,
    ReactiveFormsModule,
    MessageService,
    providePrimeNG({
      theme: {
        preset: TwikPreset,
        options: {
          darkModeSelector: false,
        },
      },
    }),
  ]
};
