<script lang="ts">
	import { onMount } from 'svelte';
	import { Info, Plus, Trash2 } from 'lucide-svelte';
	import { MAKS_WYKONAWCOW, ZALACZNIKI_MAX, ZALACZNIKI_MAX_LACZNIE, ZALACZNIK_MAX_BAJTOW, terminSzkolenia } from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import PlikSlot from './PlikSlot.svelte';
	import { BTN_DRUGI, BTN_GLOWNY, ETYKIETA, INP, KARTA, LEGENDA, NAGLOWEK, OPCJA, ZNACZNIK, fmtData, fmtRozmiar, wyslij } from './klient';
	import type { Zalacznik } from '$lib/renewals/api';
	import type { Wykonawca } from '$lib/renewals/program';
	import type { Odnowienie } from './stan.svelte';

	// Krok „Osoby i dokumenty” (gdy klient zgłasza nowe zabiegi): kto wykonuje które zabiegi,
	// dyplom kosmetologa każdej osoby i certyfikat ze szkolenia z każdego jej zabiegu.
	interface Props {
		s: Odnowienie;
		ondalej: () => void;
		onwstecz: () => void;
	}
	let { s, ondalej, onwstecz }: Props = $props();

	let bledy = $state<string[]>([]);
	const termin = $derived(fmtData(terminSzkolenia(s.widok.okres_nowy.od)));

	// Pierwsza osoba od razu — klient nie musi szukać przycisku.
	onMount(() => {
		if (!s.wykonawcy.length) s.dodajWykonawce();
	});

	function dodaj() {
		if (!s.dodajWykonawce()) return;
		const i = s.wykonawcy.length - 1;
		queueMicrotask(() => requestAnimationFrame(() => document.getElementById(`wyk-${i}-imie`)?.focus()));
	}

	// Usunięcie osoby usuwa też jej pliki (inaczej zajmowałyby limit wniosku).
	async function usun(i: number) {
		const w = s.wykonawcy[i];
		if (!w) return;
		const jej = s.zalaczniki.filter((z) => z.osoba === w.id);
		s.wykonawcy.splice(i, 1);
		s.zalaczniki = s.zalaczniki.filter((z) => z.osoba !== w.id);
		if (!s.wykonawcy.length) s.dodajWykonawce();
		await Promise.all(jej.map((z) => wyslij(s.klucz, { akcja: 'zalacznik_usun', id: z.id })));
	}

	function przelaczZabieg(w: Wykonawca, z: string, on: boolean) {
		const bez = w.zabiegi.filter((t) => t !== z);
		w.zabiegi = on ? [...bez, z] : bez;
	}

	// Pliki bez osoby (osoba usunięta w innej karcie, zabieg odznaczony) — do usunięcia, bo zajmują limit.
	let usuwane = $state<string[]>([]);
	async function usunPlik(z: Zalacznik) {
		usuwane.push(z.id);
		const r = await wyslij(s.klucz, { akcja: 'zalacznik_usun', id: z.id });
		usuwane = usuwane.filter((x) => x !== z.id);
		if (r.ok) s.zalaczniki = s.zalaczniki.filter((x) => x.id !== z.id);
	}

	function dalej() {
		bledy = s.sprawdzKwalifikacje();
		if (!bledy.length) ondalej();
	}
</script>

<section class={KARTA} aria-labelledby="krok-naglowek">
	<h2 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Osoby i dokumenty</h2>
	<p class="mt-2 text-slate-600">
		Zgłaszasz nowe zabiegi. Podaj osoby, które będą je wykonywać, zaznacz, które zabiegi wykonuje każda z nich, i dołącz dokumenty.
	</p>

	<div class="mt-4 rounded-xl border border-[#2a3b69]/20 bg-[#2a3b69]/5 p-4 text-sm text-[#2a3b69]" data-testid="dokumenty-info">
		<p class="flex items-center gap-2 font-semibold"><Info size={18} aria-hidden="true" /> Jakie dokumenty są potrzebne</p>
		<ul class="mt-2 list-disc space-y-1.5 pl-5 text-slate-800">
			<li>
				<strong>Dyplom kosmetologa</strong> dla każdej osoby — <strong>tylko dyplom ukończenia studiów licencjackich lub magisterskich</strong>
				(kierunek kosmetologia). Świadectwa kursów i szkół policealnych nie są dyplomem.
			</li>
			<li>
				<strong>Certyfikat ze szkolenia</strong> z każdego zabiegu, który wykonuje dana osoba — szkolenie ukończone najpóźniej
				<strong>{termin}</strong> (co najmniej 12 miesięcy przed początkiem ochrony).
			</li>
			<li>
				Pliki PDF albo zdjęcia (JPG, PNG, WEBP, HEIC), do {fmtRozmiar(ZALACZNIK_MAX_BAJTOW)} każdy; na cały wniosek najwyżej {ZALACZNIKI_MAX} plików i
				{fmtRozmiar(ZALACZNIKI_MAX_LACZNIE)}.
			</li>
		</ul>
	</div>

	<p class="mt-5 text-sm font-semibold text-slate-700">Zgłaszane zabiegi:</p>
	<ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-800" data-testid="zabiegi-zgloszone">
		{#each s.zabiegiZgloszone as z (z)}<li class="break-words">{z}</li>{/each}
	</ul>

	<form
		class="mt-6 space-y-5"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			dalej();
		}}
	>
		{#each s.wykonawcy as w, i (w.id)}
			<fieldset class="rounded-2xl border border-slate-200 p-4 sm:p-5" data-testid="wykonawca-{i}">
				<legend class="px-1 text-base font-semibold text-[#2a3b69]">Osoba {i + 1}</legend>
				<div class="flex items-end gap-2">
					<div class="min-w-0 flex-1">
						<label for="wyk-{i}-imie" class={ETYKIETA}>Imię i nazwisko</label>
						<input id="wyk-{i}-imie" class={INP} bind:value={w.imie_nazwisko} maxlength="200" autocomplete="off" />
					</div>
					{#if s.wykonawcy.length > 1}
						<button
							type="button"
							class="flex size-12 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
							aria-label="Usuń osobę {i + 1}{w.imie_nazwisko ? `: ${w.imie_nazwisko}` : ''}"
							onclick={() => usun(i)}
						>
							<Trash2 size={18} aria-hidden="true" />
						</button>
					{/if}
				</div>

				<fieldset class="mt-4">
					<legend class={LEGENDA}>Które zabiegi wykonuje?</legend>
					<div class="grid gap-2">
						{#each s.zabiegiZgloszone as z (z)}
							<label class={OPCJA}>
								<!-- Bez bind:group: po usunięciu osoby ze środka listy grupy wiązań mieszały się między osobami. -->
								<input
									type="checkbox"
									value={z}
									checked={w.zabiegi.includes(z)}
									onchange={(e) => przelaczZabieg(w, z, e.currentTarget.checked)}
									class={ZNACZNIK}
									data-testid="wyk-{i}-zabieg"
								/>
								<span class="break-words">{z}</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<div class="mt-4 space-y-3">
					<PlikSlot {s} typ="dyplom" osoba={w.id} osobaNazwa={w.imie_nazwisko} etykieta="Dyplom kosmetologa (studia licencjackie lub magisterskie)" wymagany testid="dyplom-{i}" />
					{#each w.zabiegi.filter((z) => s.zabiegiZgloszone.includes(z)) as z, j (z)}
						<PlikSlot {s} typ="certyfikat" osoba={w.id} osobaNazwa={w.imie_nazwisko} zabieg={z} etykieta="Certyfikat ze szkolenia: {z}" wymagany testid="cert-{i}-{j}" />
					{/each}
				</div>
			</fieldset>
		{/each}

		{#if s.wykonawcy.length < MAKS_WYKONAWCOW}
			<button type="button" class={BTN_DRUGI} onclick={dodaj} data-testid="dodaj-osobe">
				<Plus size={18} aria-hidden="true" /> Dodaj osobę
			</button>
		{/if}

		{#if s.plikiBezOsoby.length}
			<div class="rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="pliki-bez-osoby">
				<p class="text-sm font-semibold text-amber-900">Pliki niepowiązane z żadną osobą ani zabiegiem</p>
				<p class="mt-1 text-sm text-amber-900">Nie trafią do wniosku, ale zajmują limit plików. Usuń je albo przypisz osobie właściwy zabieg.</p>
				<ul class="mt-2 space-y-2">
					{#each s.plikiBezOsoby as z (z.id)}
						<li class="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-amber-200">
							<span class="min-w-0 flex-1 truncate text-sm text-slate-900">{z.nazwa}</span>
							<button
								type="button"
								class="flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50"
								aria-label="Usuń plik {z.nazwa}"
								disabled={usuwane.includes(z.id)}
								onclick={() => usunPlik(z)}
							>
								<Trash2 size={17} aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<Bledy {bledy} />

		<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
			<button type="button" class={BTN_DRUGI} onclick={onwstecz}>Wstecz</button>
			<button type="submit" class={BTN_GLOWNY}>{s.potrzebnaAnkieta ? 'Dalej: ankieta' : 'Dalej: podsumowanie'}</button>
		</div>
	</form>
</section>
