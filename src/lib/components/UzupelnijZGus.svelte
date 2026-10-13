<script lang="ts">
	// Zbiorowe uzupełnianie klientów z GUS (Klienci → „Uzupełnij z GUS”, tylko administrator).
	// Serwer przetwarza paczki po kilku klientów; okno woła kolejne paczki, pokazuje postęp i raport.
	// Zamknięcie okna albo „Zatrzymaj” przerywa po bieżącej paczce — wznowienie zaczyna od kolejnych klientów.
	import Modal from '$lib/components/Modal.svelte';
	import { sb } from '$lib/supabase';
	import { odmiana } from '$lib/utils';
	import { Database, Play, Pause } from 'lucide-svelte';

	let { open, onclose, onzmiany }: { open: boolean; onclose: () => void; onzmiany: () => void } = $props();

	type Wynik = 'uzupelniono' | 'bez_zmian' | 'nie_znaleziono' | 'zakonczona' | 'zly_nip';
	type WynikKlienta = { id: string; nazwa: string; wynik: Wynik; zmiany: string[]; gus_nazwa: string | null; data_zakonczenia: string | null };
	type Stan = { klucz: boolean; do_sprawdzenia: number; wyniki: Record<Wynik, number> };

	const ETYKIETA: Record<Wynik, { tekst: string; cls: string }> = {
		uzupelniono: { tekst: 'Uzupełniono', cls: 'bg-ok-soft text-ok' },
		bez_zmian: { tekst: 'Bez zmian', cls: 'bg-surface-2 text-ink-2' },
		nie_znaleziono: { tekst: 'Nie ma w GUS', cls: 'bg-warn-soft text-warn' },
		zakonczona: { tekst: 'Działalność zakończona', cls: 'bg-danger-soft text-danger' },
		zly_nip: { tekst: 'Błędny NIP', cls: 'bg-danger-soft text-danger' }
	};

	const W_ZDANIU: Record<Wynik, string> = {
		uzupelniono: 'uzupełniono',
		bez_zmian: 'bez zmian',
		nie_znaleziono: 'nie ma w GUS',
		zakonczona: 'działalność zakończona',
		zly_nip: 'błędny NIP'
	};

	let stan = $state<Stan | null>(null);
	let blad = $state('');
	let trwa = $state(false);
	let zatrzymaj = false;
	let naStarcie = $state(0);
	let sesja = $state<WynikKlienta[]>([]);
	const licznik = $derived(Object.fromEntries((Object.keys(ETYKIETA) as Wynik[]).map((w) => [w, sesja.filter((s) => s.wynik === w).length])) as Record<Wynik, number>);
	const doUwagi = $derived(sesja.filter((s) => s.wynik === 'nie_znaleziono' || s.wynik === 'zakonczona' || s.wynik === 'zly_nip'));
	const dotad = $derived.by(() => {
		const w = stan?.wyniki;
		if (!w) return '';
		const czesci = (Object.keys(ETYKIETA) as Wynik[]).filter((k) => w[k]).map((k) => `${W_ZDANIU[k]} ${w[k]}`);
		return czesci.length ? `Dotąd: ${czesci.join(' · ')}` : '';
	});
	const postep = $derived(naStarcie ? Math.min(100, Math.round((sesja.length / naStarcie) * 100)) : 0);

	async function naglowki(): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
	}
	async function komunikat(res: Response) {
		const d = (await res.json().catch(() => null)) as { message?: string } | null;
		return d?.message ?? `Błąd ${res.status}`;
	}

	async function wczytajStan() {
		blad = '';
		try {
			const res = await fetch('/api/gus/uzupelnij', { headers: await naglowki() });
			if (!res.ok) throw new Error(await komunikat(res));
			stan = (await res.json()) as Stan;
		} catch (e) {
			blad = (e as Error).message;
		}
	}
	$effect(() => {
		if (open) void wczytajStan();
		else zatrzymaj = true;
	});

	async function start() {
		if (!stan || trwa) return;
		blad = '';
		trwa = true;
		zatrzymaj = false;
		naStarcie = stan.do_sprawdzenia;
		sesja = [];
		let zmieniono = false;
		try {
			while (!zatrzymaj) {
				const res = await fetch('/api/gus/uzupelnij', { method: 'POST', headers: await naglowki(), body: '{}' });
				if (!res.ok) throw new Error(await komunikat(res));
				const d = (await res.json()) as { wyniki: WynikKlienta[]; pozostalo: number; przerwano: string | null };
				sesja = [...sesja, ...d.wyniki];
				if (d.wyniki.some((w) => w.zmiany.length)) zmieniono = true;
				if (stan) stan = { ...stan, do_sprawdzenia: d.pozostalo };
				if (d.przerwano) throw new Error(d.przerwano);
				if (d.pozostalo === 0 || d.wyniki.length === 0) break;
			}
		} catch (e) {
			blad = (e as Error).message;
		} finally {
			trwa = false;
			if (zmieniono) onzmiany();
			void wczytajStan();
		}
	}
</script>

<Modal title="Uzupełnij dane klientów z GUS" {open} onclose={() => { zatrzymaj = true; onclose(); }}>
	{#snippet footer()}
		<button onclick={() => { zatrzymaj = true; onclose(); }} class="h-9 px-4 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Zamknij</button>
		{#if trwa}
			<button onclick={() => (zatrzymaj = true)} class="h-9 flex items-center gap-1.5 px-4 text-sm font-semibold border border-line rounded-lg bg-white text-ink hover:bg-surface-2"><Pause size={15} /> Zatrzymaj</button>
		{:else}
			<button onclick={start} disabled={!stan?.klucz || !stan?.do_sprawdzenia} class="h-9 flex items-center gap-1.5 px-4 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50">
				<Play size={15} /> {sesja.length ? 'Wznów' : 'Rozpocznij'}
			</button>
		{/if}
	{/snippet}

	<div class="flex flex-col gap-4 text-sm">
		<p class="text-ink-2">
			Dla klientów, którzy mają NIP, a brakuje im adresu albo REGON, CRM pobierze dane z rejestru REGON (GUS).
			Uzupełniane są tylko <strong class="text-ink">puste pola</strong> — danych poprawionych w CRM nic nie nadpisze.
			Każdy klient jest sprawdzany raz; firmy wykreślone z rejestru zostaną oznaczone.
		</p>

		{#if blad}<p class="text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}

		{#if !stan}
			<p class="text-ink-3">Sprawdzam, ilu klientów czeka…</p>
		{:else if !stan.klucz}
			<p class="text-[13px] text-warn bg-warn-soft rounded-lg px-3 py-2">Serwer nie ma klucza GUS (GUS_API_KEY) — uzupełnianie jest niedostępne.</p>
		{:else}
			<div class="flex items-center gap-3 bg-surface-2 rounded-lg px-4 py-3">
				<Database size={18} class="text-ink-3 shrink-0" />
				<span class="flex-1">
					<span class="block font-semibold text-ink tabular-nums">{stan.do_sprawdzenia ? odmiana(stan.do_sprawdzenia, 'klient czeka', 'klientów czeka', 'klientów czeka') : 'Wszyscy klienci z NIP są sprawdzeni'}</span>
					<span class="block text-xs text-ink-3 tabular-nums">{dotad || 'Nikt jeszcze nie był sprawdzany w GUS'}</span>
				</span>
			</div>

			{#if trwa || sesja.length}
				<div>
					<div class="flex justify-between text-xs text-ink-3 mb-1 tabular-nums">
						<span>{trwa ? 'Sprawdzam w GUS…' : 'Zatrzymano'}</span>
						<span>{sesja.length} z {naStarcie}</span>
					</div>
					<div class="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={postep} aria-label="Postęp uzupełniania">
						<div class="h-full bg-accent transition-all" style="width: {postep}%"></div>
					</div>
					<div class="flex flex-wrap gap-1.5 mt-2.5">
						{#each Object.entries(ETYKIETA) as [w, e]}
							{#if licznik[w as Wynik]}
								<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold tabular-nums {e.cls}">{e.tekst}: {licznik[w as Wynik]}</span>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			{#if doUwagi.length}
				<div>
					<p class="text-[13px] font-semibold text-ink mb-1">Do sprawdzenia ręcznie ({doUwagi.length})</p>
					<ul class="max-h-56 overflow-y-auto border border-line-soft rounded-lg">
						{#each doUwagi as w (w.id)}
							<li class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 border-t border-line-soft first:border-t-0">
								<a href="/clients/{w.id}" class="flex-1 min-w-[9rem] truncate text-[13px] font-medium text-accent-text hover:underline">{w.nazwa}</a>
								<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {ETYKIETA[w.wynik].cls}">{ETYKIETA[w.wynik].tekst}{w.data_zakonczenia ? ` ${w.data_zakonczenia.split('-').reverse().join('.')}` : ''}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	</div>
</Modal>
