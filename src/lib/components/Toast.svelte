<script lang="ts">
	// Komunikat na dole ekranu po zapisie, z opcjonalnym „Cofnij”. Znika sam po kilku sekundach.
	import { Check, X } from 'lucide-svelte';

	let {
		tekst,
		blad = false,
		oncofnij,
		onzamknij
	}: { tekst: string; blad?: boolean; oncofnij?: () => void; onzamknij: () => void } = $props();

	$effect(() => {
		void tekst;
		const t = setTimeout(onzamknij, oncofnij ? 8000 : 5000);
		return () => clearTimeout(t);
	});
</script>

<div
	role="status"
	aria-live="polite"
	class="fixed left-1/2 bottom-6 -translate-x-1/2 z-[70] max-w-[calc(100vw-32px)] flex items-center gap-3 pl-4 pr-2 py-2 rounded-lg bg-ink text-white shadow-2xl"
>
	{#if blad}
		<X size={16} class="text-red-300 shrink-0" />
	{:else}
		<Check size={16} class="text-emerald-300 shrink-0" />
	{/if}
	<span class="text-sm">{tekst}</span>
	{#if oncofnij}
		<button onclick={oncofnij} class="h-8 px-2 rounded-md text-sm font-semibold text-blue-200 hover:bg-white/10">Cofnij</button>
	{/if}
	<button onclick={onzamknij} aria-label="Zamknij" class="w-8 h-8 flex items-center justify-center rounded-md text-slate-300 hover:bg-white/10">
		<X size={14} />
	</button>
</div>
