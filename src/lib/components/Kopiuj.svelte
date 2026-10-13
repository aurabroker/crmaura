<script lang="ts">
	// Ikonka „kopiuj” obok numeru polisy, NIP-u, konta itp. Kopiuje do schowka i nie przepuszcza kliknięcia
	// dalej (wiersz tabeli czy karta pod spodem się nie otwiera). Nie wstawiaj jej do środka <a> — obok linku.
	import { Check, Copy } from 'lucide-svelte';
	import { ctxCopy } from '$lib/stores/ctxmenu.svelte';

	// skrot: litera skrótu klawiszowego (np. „c” na karcie polisy) — patrz shell/Skroty.svelte
	let { tekst, opis = 'numer', rozmiar = 13, skrot }: { tekst: string | null | undefined; opis?: string; rozmiar?: number; skrot?: string } = $props();

	let skopiowano = $state(false);
	let zegar: ReturnType<typeof setTimeout> | undefined;

	async function kopiuj(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		await ctxCopy(tekst, `${opis}: ${tekst}`);
		skopiowano = true;
		clearTimeout(zegar);
		zegar = setTimeout(() => (skopiowano = false), 1200);
	}
</script>

{#if tekst}
	<button
		type="button"
		onclick={kopiuj}
		title="Kopiuj {opis}{skrot ? ` (${skrot.toUpperCase()})` : ''}"
		aria-label="Kopiuj {opis}: {tekst}"
		data-skrot={skrot}
		data-skrot-opis={skrot ? `Kopiuj ${opis}` : undefined}
		class="inline-flex shrink-0 items-center justify-center w-5 h-5 -my-0.5 rounded align-middle text-ink-3/70 hover:text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
	>
		{#if skopiowano}<Check size={rozmiar} class="text-ok" />{:else}<Copy size={rozmiar} />{/if}
	</button>
{/if}
