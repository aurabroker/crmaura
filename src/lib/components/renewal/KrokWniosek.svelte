<script lang="ts">
	import { AlertTriangle } from 'lucide-svelte';
	import {
		KLAUZULA_OCHRONY_PRAWNEJ,
		LICZBA_OSOB,
		OCHRONA_PRAWNA_SKLADKA,
		RODZAJE_GABINETU,
		SUMA_NAJCZESCIEJ_WYBIERANA,
		SUMY,
		ZABIEGI_ANKIETA,
		formatSuma,
		formatZl,
		type Decyzja
	} from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import WycenaInfo from './WycenaInfo.svelte';
	import { BTN_DRUGI, BTN_GLOWNY, BTN_LINK, ETYKIETA, INP, KARTA, LEGENDA, NAGLOWEK, OPCJA, ZNACZNIK, fmtData } from './klient';
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
		{ key: 'zmiany', tytul: 'TAK — odnawiam ze zmianami', opis: 'Np. inna suma gwarancyjna, ochrona prawna, zabiegi z innej listy albo nowy adres.' },
		{ key: 'nie', tytul: 'NIE — nie odnawiam', opis: `Ochrona wygaśnie ${w.okres_obecny.do ? fmtData(w.okres_obecny.do) : 'z końcem obecnego okresu'}.` }
	]);

	let message = $state('');
	let bledy = $state<string[]>([]);
	let pokazKlauzule = $state(false);

	// Podpowiedź z zapisanej APK — klient nie musi pamiętać, co tam zaznaczył.
	const apk = $derived(s.apkZapisana);

	// Zabiegi z innej listy: działalność na nowy okres zaczyna się od tej z APK (klient dopisuje nową).
	function przelaczDzialalnosc(e: Event & { currentTarget: HTMLInputElement }) {
		s.zm.dzialalnosc = e.currentTarget.checked;
		if (s.zm.dzialalnosc && !s.zm.rodzaje.length && apk?.rodzaje.length) s.zm.rodzaje = [...apk.rodzaje];
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
					<!-- Suma gwarancyjna: wszystkie warianty programu z orientacyjną składką, bez rekomendacji -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.suma} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Inna suma gwarancyjna</span>
								<span class="block text-sm text-slate-600">
									Obecnie: {w.suma != null ? formatSuma(w.suma) : 'zgodnie z obecnym certyfikatem'}.
								</span>
							</span>
						</label>
						{#if s.zm.suma}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3 space-y-5">
								<fieldset>
									<legend class={ETYKIETA}>Suma gwarancyjna na nowy okres</legend>
									<div class="grid gap-2 sm:grid-cols-3" data-testid="warianty-sumy">
										{#each SUMY as suma (suma)}
											{@const obecna = suma === w.suma}
											{@const skladka = s.skladkiSum[suma]}
											<label class="{OPCJA} {obecna ? 'cursor-not-allowed opacity-60' : ''}" data-testid="suma-{suma}">
												<input type="radio" name="wyzsza-suma" value={suma} bind:group={s.zm.wyzsza_suma} disabled={obecna} class={ZNACZNIK} />
												<span class="min-w-0">
													<span class="block font-semibold text-slate-900">{formatSuma(suma)}</span>
													<span class="block text-sm text-slate-600">
														{#if obecna}obecna suma{:else if skladka != null}{formatZl(skladka)} rocznie{:else}składka do wyceny{/if}
													</span>
													{#if suma === SUMA_NAJCZESCIEJ_WYBIERANA}
														<span class="mt-1.5 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">najczęściej wybierany</span>
													{/if}
												</span>
											</label>
										{/each}
									</div>
									<p class="mt-2 text-xs text-slate-500">
										{#if s.zm.ankieta && s.zm.zabiegi_ankieta.length}
											Przy zabiegach wymagających ankiety składkę ustala indywidualnie ubezpieczyciel.
										{:else}
											Składki orientacyjne według taryfy programu{s.zm.ochrona_prawna || w.ochrona_prawna_obecnie ? ', z ochroną prawną' : ''}. Ostateczną składkę potwierdzimy przed wystawieniem certyfikatu.
										{/if}
									</p>
								</fieldset>
								{#if s.pytajODaneWyceny}
									<p class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
										Nie wypełniono analizy potrzeb — do wyceny nowej sumy potrzebujemy dwóch informacji.
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

					<!-- Zabiegi z innej listy programu = zmiana rodzaju działalności i składki (bez dokumentów) -->
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400" data-testid="zmiana-dzialalnosci">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" checked={s.zm.dzialalnosc} onchange={przelaczDzialalnosc} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Zabiegi z innej listy programu</span>
								<span class="block text-sm text-slate-600">Np. gabinet kosmetyczny, który zaczyna zabiegi kosmetologiczne — zmienia się rodzaj działalności i składka.</span>
							</span>
						</label>
						{#if s.zm.dzialalnosc}
							<div class="border-t border-slate-200 px-4 pb-4 pt-3 space-y-5">
								<fieldset>
									<legend class={ETYKIETA}>Jaką działalność prowadzisz od nowego okresu? (możesz zaznaczyć kilka)</legend>
									<div class="grid gap-2 sm:grid-cols-2">
										{#each RODZAJE_GABINETU as r (r.key)}
											<label class={OPCJA}>
												<input type="checkbox" name="dz-rodzaje" value={r.key} bind:group={s.zm.rodzaje} class={ZNACZNIK} />
												<span>{r.nazwa}</span>
											</label>
										{/each}
									</div>
								</fieldset>
								{#if s.pytajOOsobyDzialalnosci}
									<fieldset>
										<legend class={ETYKIETA}>Ile osób wykonuje zabiegi w gabinecie (łącznie z Tobą)?</legend>
										<div class="grid gap-2 sm:grid-cols-3">
											{#each LICZBA_OSOB as o (o.key)}
												<label class={OPCJA}>
													<input type="radio" name="dz-osoby" value={o.key} bind:group={s.zm.osoby} class={ZNACZNIK} />
													<span>{o.nazwa}</span>
												</label>
											{/each}
										</div>
									</fieldset>
								{/if}
								<p class="rounded-lg bg-[#2a3b69]/5 px-3 py-2 text-sm text-[#2a3b69]" role="status">
									Dopisanie zabiegów z innej listy zmienia rodzaj działalności i składkę według taryfy programu — nową składkę widzisz niżej.
									Dyplomów i certyfikatów nie dołączasz. Pojedyncze zabiegi dopisujesz tylko z listy ankietowej (pozycja poniżej).
								</p>
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
