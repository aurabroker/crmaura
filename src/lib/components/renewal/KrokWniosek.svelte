<script lang="ts">
	import { AlertTriangle, Search, X } from 'lucide-svelte';
	import {
		KLAUZULA_OCHRONY_PRAWNEJ,
		LICZBA_OSOB,
		OCHRONA_PRAWNA_SKLADKA,
		RODZAJE_GABINETU,
		SUMY,
		ZABIEGI_ANKIETA,
		ZABIEGI_LISTY,
		formatSuma,
		formatZl,
		type Decyzja
	} from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import WycenaInfo from './WycenaInfo.svelte';
	import { BTN_DRUGI, BTN_GLOWNY, BTN_LINK, ETYKIETA, INP, KARTA, LEGENDA, NAGLOWEK, OPCJA, ZNACZNIK, bezOgonkow, fmtData } from './klient';
	import type { Odnowienie } from './stan.svelte';

	// Krok 2: decyzja o odnowieniu (bez zmian / ze zmianami / rezygnacja) z orientacyjną składką.
	interface Props {
		s: Odnowienie;
		ondalej: () => void;
		onwstecz: () => void;
	}
	let { s, ondalej, onwstecz }: Props = $props();

	const w = $derived(s.widok);
	const koniecOchrony = $derived(w.okres_obecny.do ? fmtData(w.okres_obecny.do) : 'z końcem obecnego okresu ubezpieczenia');

	const DECYZJE: { key: Decyzja; tytul: string; opis: string }[] = $derived([
		{
			key: 'bez_zmian',
			tytul: 'TAK — odnawiam bez zmian',
			opis: `Ten sam zakres i suma gwarancyjna${w.skladka != null ? `, składka ${formatZl(w.skladka)} rocznie` : ''}.`
		},
		{ key: 'zmiany', tytul: 'TAK — odnawiam ze zmianami', opis: 'Np. wyższa suma, ochrona prawna, nowe zabiegi albo nowy adres.' },
		{ key: 'nie', tytul: 'NIE — nie odnawiam', opis: `Ochrona wygaśnie ${w.okres_obecny.do ? fmtData(w.okres_obecny.do) : 'z końcem obecnego okresu'}.` }
	]);

	let message = $state('');
	let bledy = $state<string[]>([]);
	let pokazKlauzule = $state(false);
	let szukaj = $state('');

	const zabiegiWidoczne = $derived.by(() => {
		const q = bezOgonkow(szukaj.trim());
		return q ? ZABIEGI_LISTY.filter((z) => bezOgonkow(z).includes(q)) : ZABIEGI_LISTY;
	});

	// Podpowiedzi z zapisanej APK — klient nie musi pamiętać, co tam zaznaczył.
	const apk = $derived(s.apkZapisana);
	const podpowiedzSumy = $derived.by(() => {
		const o = Number(apk?.suma_oczekiwana);
		return o && (w.suma == null || o > w.suma) ? `W analizie potrzeb wskazano oczekiwaną sumę ${formatSuma(o)}.` : '';
	});

	function usunZabieg(z: string) {
		s.zm.nowe_zabiegi = s.zm.nowe_zabiegi.filter((x) => x !== z);
	}

	// Kod pocztowy wpisywany cyframi — kreskę dostawiamy sami.
	function kodInput(e: Event & { currentTarget: HTMLInputElement }) {
		const c = e.currentTarget.value.replace(/\D/g, '').slice(0, 5);
		s.zm.kod = c.length > 2 ? `${c.slice(0, 2)}-${c.slice(2)}` : c;
	}

	function dalej() {
		message = '';
		bledy = [];
		// Osoby i dokumenty klient podaje w następnym kroku.
		const r = s.sprawdzWniosek(false);
		if (!r.ok) {
			bledy = r.bledy;
			return;
		}
		ondalej();
	}
</script>

<section class={KARTA} aria-labelledby="krok-naglowek">
	<h2 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Wniosek o odnowienie</h2>
	<p class="mt-2 text-slate-600">
		Nowy okres ubezpieczenia: <strong class="text-slate-900">{fmtData(w.okres_nowy.od)} – {fmtData(w.okres_nowy.do)}</strong>
	</p>

	<form
		class="mt-6"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			dalej();
		}}
	>
		<fieldset>
			<legend class={LEGENDA}>Czy odnawiasz ubezpieczenie OC gabinetu na kolejny rok?</legend>
			<div class="grid gap-3">
				{#each DECYZJE as d (d.key)}
					<label
						class="flex items-start gap-4 rounded-2xl border-2 border-slate-200 bg-white p-5 cursor-pointer transition-colors hover:border-slate-300
							has-focus-visible:ring-2 has-focus-visible:ring-rose-500
							{d.key === 'nie' ? 'has-checked:border-red-600 has-checked:bg-red-50' : 'has-checked:border-rose-500 has-checked:bg-rose-50'}"
						data-testid="decyzja-{d.key}"
					>
						<input type="radio" name="decyzja" value={d.key} bind:group={s.decyzja} class="mt-1 size-6 shrink-0 accent-rose-600" />
						<span>
							<span class="block text-lg font-bold {d.key === 'nie' ? 'text-red-800' : 'text-[#2a3b69]'}">{d.tytul}</span>
							<span class="mt-0.5 block text-sm text-slate-600">{d.opis}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if s.decyzja === 'zmiany'}
			<fieldset class="mt-8">
				<legend class={LEGENDA}>Co chcesz zmienić? <span class="font-normal text-slate-500">(zaznacz wszystko, co dotyczy)</span></legend>
				<div class="space-y-3">
					<!-- Wyższa suma gwarancyjna -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 {s.wyzszeSumy.length ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}">
							<input type="checkbox" bind:checked={s.zm.suma} disabled={!s.wyzszeSumy.length} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Wyższa suma gwarancyjna</span>
								<span class="block text-sm text-slate-600">
									{#if !s.wyzszeSumy.length}
										Masz już najwyższą sumę dostępną w programie ({formatSuma(SUMY[SUMY.length - 1])}).
									{:else}
										Obecnie: {w.suma != null ? formatSuma(w.suma) : 'zgodnie z obecnym certyfikatem'}.
										{podpowiedzSumy}
									{/if}
								</span>
							</span>
						</label>
						{#if s.zm.suma}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3 space-y-5">
								<fieldset>
									<legend class={ETYKIETA}>Nowa suma gwarancyjna</legend>
									<div class="grid gap-2 sm:grid-cols-3">
										{#each s.wyzszeSumy as suma (suma)}
											<label class={OPCJA}>
												<input type="radio" name="wyzsza-suma" value={suma} bind:group={s.zm.wyzsza_suma} class={ZNACZNIK} />
												<span class="font-medium">{formatSuma(suma)}</span>
											</label>
										{/each}
									</div>
								</fieldset>
								{#if s.pytajODaneWyceny}
									<p class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
										Nie wypełniono analizy potrzeb — do wyceny wyższej sumy potrzebujemy dwóch informacji.
									</p>
									<fieldset>
										<legend class={ETYKIETA}>Jaką działalność prowadzisz? (możesz zaznaczyć kilka)</legend>
										<div class="grid gap-2 sm:grid-cols-2">
											{#each RODZAJE_GABINETU as r (r.key)}
												<label class={OPCJA}>
													<input type="checkbox" name="wn-rodzaje" value={r.key} bind:group={s.zm.rodzaje} class={ZNACZNIK} />
													<span>{r.nazwa}</span>
												</label>
											{/each}
										</div>
									</fieldset>
									<fieldset>
										<legend class={ETYKIETA}>Ile osób wykonuje zabiegi w gabinecie (łącznie z Tobą)?</legend>
										<div class="grid gap-2 sm:grid-cols-3">
											{#each LICZBA_OSOB as o (o.key)}
												<label class={OPCJA}>
													<input type="radio" name="wn-osoby" value={o.key} bind:group={s.zm.osoby} class={ZNACZNIK} />
													<span>{o.nazwa}</span>
												</label>
											{/each}
										</div>
									</fieldset>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Klauzula ochrony prawnej -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						{#if w.ochrona_prawna_obecnie}
							<!-- Obecny certyfikat ma już klauzulę: zostaje w odnowieniu, bez dopłaty. -->
							<div class="flex items-start gap-3 p-4 pb-1 min-h-12" data-testid="op-obecnie">
								<span class="mt-0.5 text-emerald-600" aria-hidden="true">✓</span>
								<span>
									<span class="block font-semibold text-slate-900">Klauzula ochrony prawnej — masz ją w obecnym certyfikacie</span>
									<span class="block text-sm text-slate-600">Zostaje w odnowieniu, jest już w Twojej składce.</span>
								</span>
							</div>
						{:else}
						<label class="flex items-start gap-3 p-4 pb-1 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.ochrona_prawna} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Klauzula ochrony prawnej (+{OCHRONA_PRAWNA_SKLADKA} zł/rok)</span>
								<span class="block text-sm text-slate-600">
									Koszty obrony prawnej, np. w sporze z klientem, do 100.000 zł.
									{#if apk?.ochrona_prawna === 'tak'}W analizie potrzeb wskazano zainteresowanie ochroną prawną.{/if}
								</span>
							</span>
						</label>
						{/if}
						<div class="px-4 pb-3 pl-12">
							<button
								type="button"
								class={BTN_LINK}
								aria-expanded={pokazKlauzule}
								aria-controls="klauzula-op"
								onclick={() => (pokazKlauzule = !pokazKlauzule)}
							>
								{pokazKlauzule ? 'Ukryj treść klauzuli' : 'Pokaż treść klauzuli'}
							</button>
							<div id="klauzula-op" hidden={!pokazKlauzule} class="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
								{KLAUZULA_OCHRONY_PRAWNEJ}
							</div>
						</div>
					</div>

					<!-- Zmiana adresu -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.adres} class={ZNACZNIK} />
							<span class="font-semibold text-slate-900">Zmiana adresu działalności</span>
						</label>
						{#if s.zm.adres}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3 grid gap-3 sm:grid-cols-6">
								<div class="sm:col-span-6">
									<label for="adr-ulica" class={ETYKIETA}>Ulica i numer</label>
									<input id="adr-ulica" bind:value={s.zm.ulica} class={INP} autocomplete="street-address" maxlength="200" />
								</div>
								<div class="sm:col-span-2">
									<label for="adr-kod" class={ETYKIETA}>Kod pocztowy</label>
									<input
										id="adr-kod"
										value={s.zm.kod}
										oninput={kodInput}
										class={INP}
										inputmode="numeric"
										autocomplete="postal-code"
										placeholder="00-000"
										maxlength="6"
									/>
								</div>
								<div class="sm:col-span-4">
									<label for="adr-miasto" class={ETYKIETA}>Miejscowość</label>
									<input id="adr-miasto" bind:value={s.zm.miasto} class={INP} autocomplete="address-level2" maxlength="100" />
								</div>
							</div>
						{/if}
					</div>

					<!-- Nowe zabiegi z list programu -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.zabiegi} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Nowe zabiegi z list programu</span>
								<span class="block text-sm text-slate-600">Zabiegi z załączników do programu — bez dodatkowej ankiety.</span>
							</span>
						</label>
						{#if s.zm.zabiegi}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3">
								<label for="zabiegi-szukaj" class={ETYKIETA}>Szukaj zabiegu</label>
								<div class="relative">
									<Search size={18} class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
									<input id="zabiegi-szukaj" type="search" bind:value={szukaj} class="{INP} pl-11" placeholder="np. mezoterapia" autocomplete="off" />
								</div>
								<p class="mt-2 text-sm text-slate-600" aria-live="polite" data-testid="zabiegi-licznik">
									Wybrano: <strong>{s.zm.nowe_zabiegi.length}</strong>
									{#if szukaj.trim()}· pasujących do wyszukiwania: {zabiegiWidoczne.length}{/if}
								</p>
								{#if s.zm.nowe_zabiegi.length}
									<ul class="mt-2 flex flex-wrap gap-2" aria-label="Wybrane zabiegi">
										{#each s.zm.nowe_zabiegi as z (z)}
											<li class="inline-flex max-w-full items-center gap-1 rounded-full bg-rose-50 py-1 pl-3 pr-1 text-sm text-rose-900 ring-1 ring-rose-200">
												<span class="truncate">{z}</span>
												<button
													type="button"
													class="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
													aria-label="Usuń: {z}"
													onclick={() => usunZabieg(z)}
												>
													<X size={14} aria-hidden="true" />
												</button>
											</li>
										{/each}
									</ul>
								{/if}
								<fieldset class="mt-3">
									<legend class="sr-only">Zabiegi z list programu</legend>
									<div class="max-h-80 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100" data-testid="zabiegi-lista">
										{#each zabiegiWidoczne as z (z)}
											<label class="flex items-start gap-3 px-3 py-2.5 min-h-11 cursor-pointer hover:bg-slate-50 has-checked:bg-rose-50">
												<!-- Bez bind:group: lista jest filtrowana, a bind:group liczy wybór tylko z widocznych pól
													 — wyszukanie kolejnego zabiegu gubiło wcześniej zaznaczone. -->
												<input
													type="checkbox"
													value={z}
													checked={s.zm.nowe_zabiegi.includes(z)}
													onchange={(e) => {
														const bez = s.zm.nowe_zabiegi.filter((x) => x !== z);
														s.zm.nowe_zabiegi = e.currentTarget.checked ? [...bez, z] : bez;
													}}
													class={ZNACZNIK}
												/>
												<span class="text-sm text-slate-800">{z}</span>
											</label>
										{:else}
											<p class="px-3 py-4 text-sm text-slate-500">
												Brak zabiegu o tej nazwie na listach programu. Opisz go w polu „Inne zmiany” — doradca sprawdzi, czy da się go objąć ochroną.
											</p>
										{/each}
									</div>
								</fieldset>
							</div>
						{/if}
					</div>

					<!-- Zabiegi wymagające ankiety -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.ankieta} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Zabiegi wymagające ankiety Ergo Hestii</span>
								<span class="block text-sm text-slate-600">Np. toksyna botulinowa, wypełniacze, nici PDO, HIFU — podlegają ocenie ubezpieczyciela.</span>
							</span>
						</label>
						{#if s.zm.ankieta}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3">
								<fieldset>
									<legend class="sr-only">Zabiegi wymagające ankiety</legend>
									<div class="grid gap-2">
										{#each ZABIEGI_ANKIETA as z (z)}
											<label class={OPCJA}>
												<input type="checkbox" value={z} bind:group={s.zm.zabiegi_ankieta} class={ZNACZNIK} />
												<span class="text-sm">{z}</span>
											</label>
										{/each}
									</div>
								</fieldset>
								{#if s.zm.zabiegi_ankieta.length}
									<p class="mt-3 rounded-lg bg-[#2a3b69]/5 px-3 py-2 text-sm text-[#2a3b69]" role="status">
										Te zabiegi wymagają ankiety Ergo Hestii — wypełnisz ją w następnym kroku i dołączysz dyplom oraz certyfikat.
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Inne -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.inne_zaznaczone} class={ZNACZNIK} />
							<span class="font-semibold text-slate-900">Inne zmiany</span>
						</label>
						{#if s.zm.inne_zaznaczone}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3">
								<label for="zm-inne" class={ETYKIETA}>Opisz, co chcesz zmienić</label>
								<textarea id="zm-inne" rows="3" bind:value={s.zm.inne} class={INP} maxlength="3000"></textarea>
							</div>
						{/if}
					</div>
				</div>
			</fieldset>

			<div class="mt-6">
				<WycenaInfo wycena={s.wycena} skladkaObecna={w.skladka} />
			</div>
		{/if}

		{#if s.decyzja === 'nie'}
			<div class="mt-8 rounded-2xl border-2 border-red-600 bg-red-50 p-5" data-testid="ostrzezenie-nie">
				<p class="flex items-start gap-3 font-semibold text-red-800">
					<AlertTriangle size={22} class="mt-0.5 shrink-0" aria-hidden="true" />
					<span>Uwaga: ochrona ubezpieczeniowa wygaśnie {koniecOchrony}. Od tego dnia gabinet nie ma ubezpieczenia OC.</span>
				</p>
				<div class="mt-4">
					<label for="nie-powod" class={ETYKIETA}>Powód rezygnacji (opcjonalnie)</label>
					<textarea id="nie-powod" rows="3" bind:value={s.niePowod} class={INP} maxlength="2000"></textarea>
				</div>
				<label class="mt-4 flex items-start gap-3 min-h-12 cursor-pointer rounded-xl bg-white px-4 py-3 ring-1 ring-red-300 has-focus-visible:ring-2 has-focus-visible:ring-red-600">
					<input type="checkbox" bind:checked={s.potwierdzenieNie} class="mt-0.5 size-5 shrink-0 accent-red-700" />
					<span class="font-medium text-slate-900">Potwierdzam, że rezygnuję z odnowienia ubezpieczenia</span>
				</label>
			</div>
		{/if}

		<Bledy {message} {bledy} />

		<div class="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
			<button type="button" class={BTN_DRUGI} onclick={onwstecz}>Wstecz</button>
			<button type="submit" class={BTN_GLOWNY}>
				{s.potrzebneDokumenty ? 'Dalej: osoby i dokumenty' : 'Dalej: podsumowanie'}
			</button>
		</div>
	</form>
</section>
