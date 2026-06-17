<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	// Dodawanie gwarancji odbywa się teraz w hubie /bonds (modal). Stara trasa przekierowuje.
	onMount(() => { goto('/bonds', { replaceState: true }); });
</script>

<div class="text-sm text-slate-400 py-12 text-center">Przekierowanie do modułu Gwarancje…</div>
