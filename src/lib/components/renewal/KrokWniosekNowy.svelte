<script lang="ts">
	import { AlertTriangle, Info } from 'lucide-svelte';
	import {
		KLAUZULA_OCHRONY_PRAWNEJ,
		LICZBA_OSOB,
		NOWA_OCHRONA_OD_MAX_DNI,
		OCHRONA_PRAWNA_SKLADKA,
		OSWIADCZENIA_NOWEJ,
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

	// Krok 2 dla klienta bez certyfikatu: wniosek o zawarcie ubezpieczenia OC gabinetu — dane firmy (podpowiedziane
	// z kartoteki CRM), początek ochrony, suma gwarancyjna z orientacyjną składką, ochrona prawna, zabiegi wymagające
	// ankiety, uwagi i oświadczenia. Albo rezygnacja z podaniem powodu.
	interface Props {
		s: Odnowienie;
		ondalej: () => void;
		onwstecz: () => void;
	}
	let { s, ondalej, onwstecz }: Props = $props();

	const w = $derived(s.widok);
	const okno = $derived(w.ochrona_od);

	const DECYZJE: { key: Decyzja; tytul: string; opis: string }[] = [
		{ key: 'nowa', tytul: 'TAK — wnioskuję o ubezpieczenie OC gabinetu', opis: 'Podaj dane gabinetu, początek ochrony i sumę gwarancyjną — od razu zobaczysz orientacyjną składkę.' },
		{ key: 'nie', tytul: 'NIE — nie jestem zainteresowany/a', opis: 'Zapiszemy rezygnację. Możesz podać powód — pomoże nam to przygotować lepszą propozycję.' }
	];

	let message = $state('');
	let bledy = $state<string[]>([]);
	let pokazKlauzule = $state(false);
	const POMOC = 'mt-1 text-xs text-slate-500';

	// Podpowiedź z zapisanej APK — klient nie musi pamiętać, co tam zaznaczył.
	const apk = $derived(s.apkZapisana);
	const zKartoteki = $derived(!!w.firma?.nazwa);

	// Kod pocztowy wpisywany cyframi — kreskę dostawiamy sami.
	function kodInput(e: Event & { currentTarget: HTMLInputElement }) {
		const c = e.currentTarget.value.replace(/\D/g, '').slice(0, 5);
		s.nw.firma.kod = c.length > 2 ? `${c.slice(0, 2)}-${c.slice(2)}` : c;
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
	<h2 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Wniosek o ubezpieczenie OC gabinetu</h2>
	<p class="mt-2 text-slate-600">Pierwsza polisa w programie Beauty❤️Polisa (STU Ergo Hestia SA). Ochrona na 12 miesięcy od wybranego dnia.</p>

	<form
		class="mt-6"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			dalej();
		}}
	>
		<fieldset>
			<legend class={LEGENDA}>Czy chcesz ubezpieczyć gabinet w programie?</legend>
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

		{#if s.decyzja === 'nowa'}
			<!-- Dane firmy -->
			<fieldset class="mt-8">
				<legend class={LEGENDA}>Dane gabinetu (Ubezpieczający)</legend>
				{#if zKartoteki}
					<p class="mb-3 flex items-start gap-2 rounded-lg bg-[#2a3b69]/5 px-3 py-2 text-sm text-[#2a3b69]">
						<Info size={16} class="mt-0.5 shrink-0" aria-hidden="true" />
						<span>Wpisaliśmy dane z naszej kartoteki — sprawdź je i popraw, jeśli coś się zmieniło.</span>
					</p>
				{/if}
				<div class="grid gap-4 sm:grid-cols-6">
					<div class="sm:col-span-6">
						<label for="f-nazwa" class={ETYKIETA}>Nazwa firmy (albo imię i nazwisko przy działalności)</label>
						<input id="f-nazwa" bind:value={s.nw.firma.nazwa} class={INP} maxlength="300" autocomplete="organization" />
					</div>
					<div class="sm:col-span-3">
						<label for="f-nip" class={ETYKIETA}>NIP</label>
						<input id="f-nip" bind:value={s.nw.firma.nip} class={INP} inputmode="numeric" maxlength="20" autocomplete="off" aria-describedby="f-nip-pomoc" />
						<p id="f-nip-pomoc" class={POMOC}>10 cyfr (kreski i spacje nie przeszkadzają).</p>
					</div>
					<div class="sm:col-span-3">
						<label for="f-regon" class={ETYKIETA}>REGON (opcjonalnie)</label>
						<input id="f-regon" bind:value={s.nw.firma.regon} class={INP} inputmode="numeric" maxlength="20" autocomplete="off" />
					</div>
					<div class="sm:col-span-6">
						<label for="f-ulica" class={ETYKIETA}>Ulica i numer (adres gabinetu)</label>
						<input id="f-ulica" bind:value={s.nw.firma.ulica} class={INP} maxlength="200" autocomplete="street-address" />
					</div>
					<div class="sm:col-span-2">
						<label for="f-kod" class={ETYKIETA}>Kod pocztowy</label>
						<input id="f-kod" value={s.nw.firma.kod} oninput={kodInput} class={INP} inputmode="numeric" autocomplete="postal-code" placeholder="00-000" maxlength="6" />
					</div>
					<div class="sm:col-span-4">
						<label for="f-miasto" class={ETYKIETA}>Miejscowość</label>
						<input id="f-miasto" bind:value={s.nw.firma.miasto} class={INP} maxlength="100" autocomplete="address-level2" />
					</div>
					<div class="sm:col-span-3">
						<label for="f-email" class={ETYKIETA}>E-mail do dokumentów</label>
						<input id="f-email" type="email" bind:value={s.nw.firma.email} class={INP} maxlength="320" autocomplete="email" />
					</div>
					<div class="sm:col-span-3">
						<label for="f-tel" class={ETYKIETA}>Telefon</label>
						<input id="f-tel" type="tel" bind:value={s.nw.firma.telefon} class={INP} maxlength="40" autocomplete="tel" />
					</div>
				</div>
			</fieldset>

			<!-- Początek ochrony -->
			<fieldset class="mt-8">
				<legend class={LEGENDA}>Od kiedy ma zacząć się ochrona?</legend>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="f-od" class={ETYKIETA}>Początek ochrony</label>
						<input id="f-od" type="date" bind:value={s.nw.ochrona_od} min={okno?.min} max={okno?.max} class={INP} aria-describedby="f-od-pomoc" data-testid="ochrona-od" />
						<p id="f-od-pomoc" class={POMOC}>Najwcześniej jutro, najpóźniej za {NOWA_OCHRONA_OD_MAX_DNI} dni. Certyfikat wystawimy po sprawdzeniu wniosku.</p>
					</div>
					<div class="rounded-xl bg-rose-50/60 px-4 py-3">
						<p class="text-sm text-slate-500">Okres ubezpieczenia</p>
						<p class="font-semibold text-[#2a3b69]" data-testid="okres-nowy">{fmtData(s.okresNowy.od)} – {fmtData(s.okresNowy.do)}</p>
					</div>
				</div>
			</fieldset>

			<!-- Suma gwarancyjna -->
			<fieldset class="mt-8">
				<legend class={LEGENDA}>Suma gwarancyjna</legend>
				<div class="grid gap-2 sm:grid-cols-3" data-testid="warianty-sumy">
					{#each SUMY as suma (suma)}
						{@const skladka = s.skladkiSum[suma]}
						<label class={OPCJA} data-testid="suma-{suma}">
							<input type="radio" name="suma" value={suma} bind:group={s.zm.wyzsza_suma} class={ZNACZNIK} />
							<span class="min-w-0">
								<span class="block font-semibold text-slate-900">{formatSuma(suma)}</span>
								<span class="block text-sm text-slate-600">
									{#if skladka != null}{formatZl(skladka)} rocznie{:else}składka do wyceny{/if}
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
						Składki orientacyjne według taryfy programu{s.zm.ochrona_prawna ? ', z ochroną prawną' : ''}. Ostateczną składkę potwierdzimy przed wystawieniem certyfikatu.
					{/if}
				</p>
				{#if s.pytajODaneWyceny}
					<p class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Nie wypełniono analizy potrzeb — do wyceny potrzebujemy dwóch informacji.</p>
					<fieldset class="mt-3">
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
					<fieldset class="mt-3">
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
			</fieldset>

			<!-- Ochrona prawna i zabiegi wymagające ankiety -->
			<fieldset class="mt-8">
				<legend class={LEGENDA}>Zakres dodatkowy <span class="font-normal text-slate-500">(opcjonalnie)</span></legend>
				<div class="space-y-3">
					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
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
						<div class="px-4 pb-3 pl-12">
							<button type="button" class={BTN_LINK} aria-expanded={pokazKlauzule} aria-controls="klauzula-op" onclick={() => (pokazKlauzule = !pokazKlauzule)}>
								{pokazKlauzule ? 'Ukryj treść klauzuli' : 'Pokaż treść klauzuli'}
							</button>
							<div id="klauzula-op" hidden={!pokazKlauzule} class="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{KLAUZULA_OCHRONY_PRAWNEJ}</div>
						</div>
					</div>

					<div class="rounded-xl border border-slate-300 has-[>label>input:checked]:border-rose-400">
						<label class="flex items-start gap-3 p-4 min-h-12 cursor-pointer">
							<input type="checkbox" bind:checked={s.zm.ankieta} class={ZNACZNIK} />
							<span>
								<span class="block font-semibold text-slate-900">Wykonuję zabiegi wymagające ankiety Ergo Hestii</span>
								<span class="block text-sm text-slate-600">Np. toksyna botulinowa, wypełniacze, nici PDO, HIFU — podlegają ocenie ubezpieczyciela. Zabiegi z list programu są objęte ochroną bez ankiety.</span>
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
				</div>
			</fieldset>

			<div class="mt-8">
				<label for="f-uwagi" class={LEGENDA + ' block'}>Uwagi do wniosku <span class="font-normal text-slate-500">(opcjonalnie)</span></label>
				<textarea id="f-uwagi" rows="3" bind:value={s.nw.uwagi} class={INP} maxlength="3000" placeholder="np. zabiegi spoza list programu, pytania do doradcy"></textarea>
			</div>

			<div class="mt-6">
				{#if s.wycena}
					<WycenaInfo wycena={s.wycena} skladkaObecna={null} />
				{:else}
					<p class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" data-testid="wycena">Wybierz sumę gwarancyjną, żeby zobaczyć orientacyjną składkę.</p>
				{/if}
			</div>

			<fieldset class="mt-8">
				<legend class={LEGENDA}>Oświadczenia</legend>
				<label class="{OPCJA} border-[#2a3b69]/30" data-testid="oswiadczenia">
					<input type="checkbox" bind:checked={s.nw.oswiadczenia} class={ZNACZNIK} />
					<span class="text-sm text-slate-800">
						{#each OSWIADCZENIA_NOWEJ as t, i (i)}<span class="block {i ? 'mt-2' : ''}">{t}</span>{/each}
					</span>
				</label>
			</fieldset>
		{/if}

		{#if s.decyzja === 'nie'}
			<div class="mt-8 rounded-2xl border-2 border-red-600 bg-red-50 p-5" data-testid="ostrzezenie-nie">
				<p class="flex items-start gap-3 font-semibold text-red-800">
					<AlertTriangle size={22} class="mt-0.5 shrink-0" aria-hidden="true" />
					<span>Bez ubezpieczenia OC gabinet sam ponosi koszty roszczeń klientów. Jeśli zmienisz zdanie, napisz do nas — przygotujemy nowy wniosek.</span>
				</p>
				<div class="mt-4">
					<label for="nie-powod" class={ETYKIETA}>Powód rezygnacji (opcjonalnie)</label>
					<textarea id="nie-powod" rows="3" bind:value={s.niePowod} class={INP} maxlength="2000"></textarea>
				</div>
				<label class="mt-4 flex items-start gap-3 min-h-12 cursor-pointer rounded-xl bg-white px-4 py-3 ring-1 ring-red-300 has-focus-visible:ring-2 has-focus-visible:ring-red-600">
					<input type="checkbox" bind:checked={s.potwierdzenieNie} class="mt-0.5 size-5 shrink-0 accent-red-700" />
					<span class="font-medium text-slate-900">Potwierdzam, że nie wnioskuję o ubezpieczenie OC w programie</span>
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
