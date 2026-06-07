<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	interface Props {
		onToken: (token: string) => void;
		onError?: () => void;
		theme?: 'light' | 'dark' | 'auto';
	}
	let { onToken, onError, theme = 'light' }: Props = $props();

	// PUBLIC_TURNSTILE_SITE_KEY must be set in .env as VITE_TURNSTILE_SITE_KEY
	const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

	let container: HTMLDivElement;
	let widgetId: string | undefined;

	declare global {
		interface Window {
			turnstile: {
				render: (el: HTMLElement, opts: Record<string, unknown>) => string;
				reset: (id: string) => void;
				remove: (id: string) => void;
			};
			onTurnstileLoad?: () => void;
		}
	}

	function renderWidget() {
		if (!container || !window.turnstile) return;
		widgetId = window.turnstile.render(container, {
			sitekey: siteKey,
			theme,
			callback: (token: string) => onToken(token),
			'error-callback': () => { if (onError) onError(); }
		});
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
