import { DecimalPipe } from '@angular/common';
import { LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';

import { App } from './app';
import { appConfig } from './app.config';
import { FETCH } from './state/catalogue-store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...appConfig.providers,
        { provide: FETCH, useValue: () => Promise.reject(new Error('offline')) },
      ],
    }).compileComponents();
  });

  it('renders the Portuguese shell with the privacy statement and a polite live region', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('Luz Certa');
    expect(compiled.textContent).toContain('O ficheiro não sai do seu dispositivo');
    const live = compiled.querySelector('[aria-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(compiled.querySelector('a[href="/fontes"]')?.textContent).toContain('Fontes e pressupostos');
  });

  it('shows the upload screen with the guide and the privacy statement', async () => {
    const harness = await RouterTestingHarness.create('/');
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toContain(
      'Quanto teria pago com outra tarifa de eletricidade?',
    );
    expect(root.textContent).toContain('O ficheiro não sai do seu dispositivo.');
    expect(root.querySelectorAll('.guide li').length).toBe(4);
    const input = root.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe('.xlsx');
    expect(root.querySelector(`label[for="${input?.id}"]`)?.textContent).toContain('Escolher ficheiro');
  });

  it('uses the European Portuguese locale', () => {
    expect(TestBed.inject(LOCALE_ID)).toBe('pt-PT');
    const pipe = new DecimalPipe(TestBed.inject(LOCALE_ID));
    expect(pipe.transform(1234.5, '1.2-2')).toMatch(/^1\s?234,50$/);
  });
});
