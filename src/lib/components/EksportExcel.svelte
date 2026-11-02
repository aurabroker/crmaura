<script lang="ts">
	// Przycisk „Excel” w nagłówku zakładki: pobiera to, co widać na liście (po filtrach, wyszukiwaniu
	// i sortowaniu), jako plik .xlsx — jeden albo kilka arkuszy. Każdy eksport trafia do dziennika zdarzeń.
	import { FileSpreadsheet } from 'lucide-svelte';
	import { nazwaPlikuExcela, pobierzExcel, type Arkusz } from '$lib/eksport';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { logAudit } from '$lib/utils/audit';
	import { odmiana } from '$lib/utils';

	interface Props {
		/** Początek nazwy pliku: 'polisy' → polisy-2026-11-02.xlsx */
		plik: string;
		/** Nazwa zakładki do dziennika zdarzeń, np. „Polisy”. */
		zakladka: string;
		/** Arkusze liczone dopiero po kliknięciu. */
		arkusze: () => Arkusz[];
		/** Liczba wierszy na liście; 0 wyłącza przycisk. */
		ile?: number;
		etykieta?: string;
		/** Mniejszy przycisk (pasek zaznaczenia). */
		maly?: boolean;
	}
	let { plik, zakladka, arkusze, ile, etykieta = 'Excel', maly = false }: Props = $props();

	let trwa = $state(false);

	async function eksportuj() {
		if (trwa) return;
		trwa = true;
		try {
			const a = arkusze().filter((x) => x.kolumny.length);
			const wierszy = a.reduce((s, x) => s + x.wiersze.length, 0);
			await pobierzExcel(nazwaPlikuExcela(plik), a);
			void logAudit('data_exported', 'export', null, `${zakladka}: ${odmiana(wierszy, 'wiersz', 'wiersze', 'wierszy')}`, {
				zakladka,
				format: 'xlsx',
				arkusze: a.map((x) => ({ nazwa: x.nazwa, wiersze: x.wiersze.length }))
			});
			ctxToast(`Pobrano plik Excel: ${odmiana(wierszy, 'wiersz', 'wiersze', 'wierszy')}`);
		} catch (e) {
			ctxToast(`Nie udało się przygotować pliku: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			trwa = false;
		}
	}
</script>

<button
	type="button"
	onclick={eksportuj}
	disabled={trwa || ile === 0}
	title={ile != null ? `Pobierz do Excela (${odmiana(ile, 'wiersz', 'wiersze', 'wierszy')})` : 'Pobierz do Excela'}
	data-testid="eksport-excel"
	class={maly
		? 'h-7 flex items-center gap-1.5 px-2.5 border border-blue-300 rounded-lg bg-white font-medium hover:bg-blue-50 disabled:opacity-50'
		: 'h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-50'}
>
	<FileSpreadsheet size={maly ? 14 : 16} class={maly ? '' : 'text-emerald-700'} />
	{trwa ? 'Przygotowuję…' : etykieta}
</button>
