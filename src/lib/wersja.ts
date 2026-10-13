// Wersja CRM i build (vite.config.ts → define): numer z package.json (podnoszony przy każdym wdrożeniu),
// data builda i skrót commita z Cloudflare Pages. Pokazywane w menu bocznym, na pulpicie i w /api/wersja.
export const WERSJA = __APP_VERSION__;
export const BUILD_COMMIT = __APP_BUILD__.commit;
export const BUILD_DATA = new Date(__APP_BUILD__.data).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });
/** „v1.51.0 · build 13.10.2026, 14:05 · 3adc4cd” */
export const OPIS_WERSJI = `v${WERSJA} · build ${BUILD_DATA}${BUILD_COMMIT ? ` · ${BUILD_COMMIT}` : ''}`;
