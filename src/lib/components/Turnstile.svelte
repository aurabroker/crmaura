<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	interface Props {
		onToken: (token: string) => void;
		onError?: () => void;
		// Token wygasł (po ok. 5 minutach) — rodzic powinien go wyczyścić.
		onExpire?: () => void;
		theme?: 'light' | 'dark' | 'auto';
	}
	let { onToken, onError, onExpire, theme = 'light' }: Props = $props();

	// PUBLIC_TURNSTILE_SITE_KEY must be set in .env as VITE_TURNSTILE_SITE_KEY
	const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

	let container: HTMLDivElement;
	let widgetId: string | undefined;

	function renderWidget() {
		if (!container || !window.turnstile) return;
		widgetId = window.turnstile.render(container, {
			sitekey: siteKey,
			theme,
			callback: (token: string) => onToken(token),
			'error-callback': () => { if (onError) onError(); },
			'expired-callback': () => { if (onExpire) onExpire(); }
		});
	}

	// Token Turnstile jest jednorazowy: serwer zużywa go przy weryfikacji, niezależnie od tego,
	// czy logowanie się udało. Po każdej próbie rodzic woła reset(), żeby dostać nowy token.
	export function reset() {
		if (browser && widgetId !== undefined && window.turnstile) window.turnstile.reset(widgetId);
	}

	onMount(() => {
		if (!browser || !siteKey) return;
		if (window.turnstile) {
			renderWidget();
			return;
		}
		window.onTurnstileLoad = renderWidget;
		const script = document.createElement('script');
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
		script.async = true;
		script.defer = true;
		document.head.appendChild(script);
	});

	onDestroy(() => {
		if (browser && widgetId !== undefined && window.turnstile) {
			window.turnstile.remove(widgetId);
		}
	});
</script>

{#if siteKey}
<div bind:this={container} class="cf-turnstile my-2"></div>
{/if}
