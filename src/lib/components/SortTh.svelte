<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-svelte';

	// Nagłówek kolumny z sortowaniem (patrz $lib/utils/sortowanie.svelte.ts).
	interface Props {
		s: { klucz: string | null; kierunek: 'asc' | 'desc'; przelacz(k: string): void; aria(k: string): 'ascending' | 'descending' | 'none' };
		k: string;
		class?: string;
		align?: 'left' | 'right';
		/** Wersaliki w nagłówku (starsze tabele); ekrany w stylu B mają zwykłą pisownię. */
		wersaliki?: boolean;
		children: Snippet;
	}
	let { s, k, class: cls = 'px-5 py-3', align = 'left', wersaliki = true, children }: Props = $props();
	const aktywna = $derived(s.klucz === k);
</script>

<th class={cls} aria-sort={s.aria(k)}>
	<button
		type="button"
		onclick={() => s.przelacz(k)}
		class="group inline-flex items-center gap-1 {wersaliki ? 'uppercase tracking-wide' : ''} hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded {align === 'right' ? 'flex-row-reverse' : ''} {aktywna ? 'text-slate-800' : ''}"
		title="Sortuj"
	>
		{@render children()}
		{#if aktywna && s.kierunek === 'asc'}
			<ArrowUp size={12} aria-hidden="true" />
		{:else if aktywna}
			<ArrowDown size={12} aria-hidden="true" />
		{:else}
			<ArrowUpDown size={12} class="opacity-30 group-hover:opacity-70" aria-hidden="true" />
		{/if}
	</button>
</th>
