import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import pkg from './package.json';

// Numer wersji CRM (package.json — podnoszony przy każdym wdrożeniu) oraz data i commit builda,
// pokazywane przy „Pulpit …”. Cloudflare Pages podaje commit w CF_PAGES_COMMIT_SHA.
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_BUILD__: JSON.stringify({ data: new Date().toISOString(), commit: (env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 7) })
	}
});
