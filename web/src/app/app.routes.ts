import { Routes } from '@angular/router';

import { HomePage } from './pages/home/home-page';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'Luz Certa' },
  {
    path: 'fontes',
    loadComponent: () => import('./pages/sources/sources-page').then((m) => m.SourcesPage),
    title: 'Fontes e pressupostos | Luz Certa',
  },
  { path: '**', redirectTo: '' },
];
