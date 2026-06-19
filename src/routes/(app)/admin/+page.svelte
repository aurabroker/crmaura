<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	// Administracja została scalona z Ustawieniami (jedna strona /settings z zakładkami).
	// Zachowujemy stare linki: /admin?tab=... -> /settings?tab=...
	onMount(() => {
		const tab = $page.url.searchParams.get('tab') ?? 'system';
		goto(`/settings?tab=${tab}`, { replaceState: true });
	});
</script>

<svelte:head><title>Ustawienia — przekierowanie</title></svelte:head>

<div class="py-16 text-center text-slate-400 text-sm">Przenoszę do Ustawień…</div>
