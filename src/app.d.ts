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

	// Minimalny interfejs kubełka R2 (tylko używane metody) — bez zależności od @cloudflare/workers-types.
	interface R2Obiekt {
		body: ReadableStream;
		size: number;
		httpMetadata?: { contentType?: string };
		arrayBuffer(): Promise<ArrayBuffer>;
	}
	interface R2Kubelek {
		put(
			klucz: string,
			dane: ArrayBuffer | Uint8Array,
			opcje?: { httpMetadata?: { contentType?: string; contentDisposition?: string }; customMetadata?: Record<string, string> }
		): Promise<unknown>;
		get(klucz: string): Promise<R2Obiekt | null>;
		delete(klucz: string | string[]): Promise<void>;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// Cloudflare Pages: bindingi ustawiane w panelu (Workers & Pages → crmaura → Settings → Bindings), patrz README → Deployment.
		interface Platform {
			env?: {
				/** Kubełek R2 na pliki polis (PDF). Bez niego zapis plików jest wyłączony. */
				POLISY_PDF?: R2Kubelek;
				/** Zasoby statyczne aplikacji (czcionki do PDF generowanych na serwerze). */
				ASSETS?: { fetch(req: Request | string): Promise<Response> };
			};
			context?: { waitUntil(p: Promise<unknown>): void };
		}
	}
}

export {};
