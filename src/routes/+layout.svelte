<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/state';
	let { children } = $props();

	// Nowa wersja na serwerze: przejście w aplikacji robi pełne przeładowanie (świeże pliki).
	// Aplikacja wystartowała — skrypt z app.html przestaje przeładowywać stronę przy błędach modułów.
	onMount(() => {
		(window as unknown as { __crmStart?: boolean }).__crmStart = true;
	});

	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}
