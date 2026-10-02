import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt-PT';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { provideEngineWorker } from './worker/engine-client';

registerLocaleData(localePt, 'pt-PT');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    { provide: LOCALE_ID, useValue: 'pt-PT' },
    provideEngineWorker(),
  ]
};
