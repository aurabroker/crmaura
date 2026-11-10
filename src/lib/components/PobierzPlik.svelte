<script lang="ts">
	// Przycisk „Pobierz” przy pliku: zapisuje plik na dysk pod jego nazwą (otwieranie w nowej karcie to osobna akcja).
	// `pobierz` robi resztę — rzuca wyjątek albo zwraca tekst błędu; błąd trafia do `onblad`, a bez niego do dymka.
	import { Download, LoaderCircle } from 'lucide-svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';

	interface Props {
		pobierz: () => Promise<unknown>;
		/** Nazwa pliku do podpowiedzi i czytnika ekranu. */
		nazwa?: string | null;
		/** Sama ikona (przy wąskich wierszach i obok przycisku „Otwórz”). */
		ikona?: boolean;
		etykieta?: string;
		rozmiar?: number;
		class?: string;
		onblad?: (tekst: string) => void;
	}
	let { pobierz, nazwa = null, ikona = false, etykieta = 'Pobierz', rozmiar = 12, class: klasa, onblad }: Props = $props();

	let trwa = $state(false);
	const opis = $derived(nazwa ? `Pobierz: ${nazwa}` : 'Pobierz plik');
	const domyslna = $derived(
		ikona
			? 'w-8 h-8 inline-flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2 disabled:opacity-60'
			: 'shrink-0 inline-flex items-center gap-1.5 text-xs border border-line rounded-lg px-2.5 py-1.5 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-60'
	);

	async function klik() {
		if (trwa) return;
		trwa = true;
		try {
			const w = await pobierz();
			if (typeof w === 'string' && w) throw new Error(w);
		} catch (e) {
			const powod = (e as { message?: string })?.message ?? '';
			const tekst = `Nie udało się pobrać${nazwa ? `: ${nazwa}` : ' pliku'}. ${powod}`.trim();
			if (onblad) onblad(tekst);
			else ctxToast(tekst);
		} finally {
			trwa = false;
		}
	}
</script>

<button type="button" onclick={klik} disabled={trwa} title={opis} aria-label={opis} aria-busy={trwa} class={klasa ?? domyslna} data-testid="pobierz-plik">
	{#if trwa}<LoaderCircle size={rozmiar} class="animate-spin" />{:else}<Download size={rozmiar} />{/if}
	{#if !ikona}{trwa ? 'Pobieranie…' : etykieta}{/if}
</button>
