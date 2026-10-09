// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	// Wersja i build CRM (vite.config.ts → define).
	const __APP_VERSION__: string;
	const __APP_BUILD__: { data: string; commit: string };

	// Cloudflare Turnstile — skrypt ładowany przez src/lib/components/Turnstile.svelte.
	interface Window {
		turnstile: {
			render: (el: HTMLElement, opts: Record<string, unknown>) => string;
			reset: (id: string) => void;
			remove: (id: string) => void;
		};
		onTurnstileLoad?: () => void;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
