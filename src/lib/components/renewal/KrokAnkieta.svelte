<script lang="ts">
	import { onMount } from 'svelte';
	import { Mail } from 'lucide-svelte';
	import { OSWIADCZENIE_ANKIETY } from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import Zalaczniki from './Zalaczniki.svelte';
	import { BTN_DRUGI, BTN_GLOWNY, ETYKIETA, INP, KARTA, LEGENDA, NAGLOWEK, OPCJA, ZNACZNIK } from './klient';
	import type { Odnowienie } from './stan.svelte';

	// Krok tylko przy zabiegach wymagających oceny ryzyka: ankieta Ergo Hestii — te same punkty co formularz
	// Ergo (1. informacje ogólne, 2. zabiegi, 3. osoby). Osoby wykonujące te zabiegi pochodzą z kroku
	// „Osoby i dokumenty” (tam są też ich dyplomy i certyfikaty). PDF ankiety klient dostaje e-mailem do podpisu.
	interface Props {
		s: Odnowienie;
		ondalej: () => void;
		onwstecz: () => void;
	}
	let { s, ondalej, onwstecz }: Props = $props();

	const dzis = new Date().toISOString().slice(0, 10);
	const POMOC = 'mt-1 text-xs text-slate-500';

	let bledy = $state<string[]>([]);
	// NIP podpowiedziany z kartoteki CRM — informacja przy polu, dopóki klient go nie zmieni.
	const nipZKartoteki = $derived(!!s.widok.nip && s.ankieta.nip === s.widok.nip);

	// Osoby z kroku „Osoby i dokumenty”, które wykonują zabiegi z ankiety.
	onMount(() => s.synchronizujOsobyAnkiety());

	function dalej() {
		bledy = s.sprawdzAnkiete();
		if (!bledy.length) ondalej();
	}
</script>

<section class={KARTA} aria-labelledby="krok-naglowek">
	<h2 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Ankieta Ergo Hestii</h2>
	<p class="mt-2 text-slate-600">
		Wybrane zabiegi wymagają oceny ryzyka przez ubezpieczyciela. Odpowiedzi trafią do ankiety ubezpieczeniowej ERGO Hestii do Programu
		Ubezpieczenia OC.
	</p>
	<p class="mt-4 flex items-start gap-3 rounded-xl bg-[#2a3b69]/5 px-4 py-3 text-sm text-[#2a3b69]">
		<Mail size={18} class="mt-0.5 shrink-0" aria-hidden="true" />
		<span>Po wysłaniu otrzymasz e-mail z PDF ankiety — wydrukuj ją, podpisz i odeślij.</span>
	</p>

	<form
		class="mt-6 space-y-8"
		novalidate
		onsubmit={(e) => {
			e.preventDefault();
			dalej();
		}}
	>
		<fieldset>
			<legend class={LEGENDA}>1. Informacje ogólne</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label for="ank-ubezpieczajacy" class={ETYKIETA}>Ubezpieczający (imię i nazwisko albo nazwa firmy)</label>
					<input id="ank-ubezpieczajacy" bind:value={s.ankieta.ubezpieczajacy} class={INP} maxlength="300" autocomplete="organization" />
				</div>
				<div class="sm:col-span-2">
					<label for="ank-ubezpieczony" class={ETYKIETA}>Ubezpieczony</label>
					<input id="ank-ubezpieczony" bind:value={s.ankieta.ubezpieczony} class={INP} maxlength="300" />
				</div>
				<div>
					<label for="ank-data" class={ETYKIETA}>Data rozpoczęcia działalności</label>
					<input id="ank-data" type="date" max={dzis} bind:value={s.ankieta.data_rozpoczecia} class={INP} />
				</div>
				<div>
					<label for="ank-zatrudnieni" class={ETYKIETA}>Liczba zatrudnionych osób</label>
					<input id="ank-zatrudnieni" inputmode="numeric" bind:value={s.ankieta.liczba_zatrudnionych} class={INP} maxlength="20" />
				</div>
				<div>
					<label for="ank-nip" class={ETYKIETA}>NIP</label>
					<input
						id="ank-nip"
						inputmode="numeric"
						autocomplete="off"
						bind:value={s.ankieta.nip}
						class={INP}
						maxlength="20"
						aria-describedby="ank-nip-pomoc"
					/>
					<!-- Spacja jawnie: Svelte obcina białe znaki na początku bloku {#if}. -->
					<p id="ank-nip-pomoc" class={POMOC}>
						10 cyfr (kreski, spacje i prefiks PL nie przeszkadzają).{#if nipZKartoteki}{' '}Wpisaliśmy NIP z naszej kartoteki — sprawdź, czy jest aktualny.{/if}
					</p>
				</div>
				<div>
					<label for="ank-regon" class={ETYKIETA}>REGON (opcjonalnie)</label>
					<input
						id="ank-regon"
						inputmode="numeric"
						autocomplete="off"
						bind:value={s.ankieta.regon}
						class={INP}
						maxlength="20"
						aria-describedby="ank-regon-pomoc"
					/>
					<p id="ank-regon-pomoc" class={POMOC}>9 albo 14 cyfr.</p>
				</div>
				<div class="sm:col-span-2">
					<label for="ank-szkodowosc" class={ETYKIETA}>Szkodowość OC z ostatnich 3 lat</label>
					<textarea
						id="ank-szkodowosc"
						rows="3"
						bind:value={s.ankieta.szkodowosc}
						class={INP}
						maxlength="3000"
						aria-describedby="ank-szkodowosc-pomoc"
					></textarea>
					<p id="ank-szkodowosc-pomoc" class={POMOC}>
						Wypłacone odszkodowania, zgłoszone roszczenia i okoliczności, z których mogą powstać roszczenia w przyszłości. Jeśli ich nie
						było, wpisz „brak”.
					</p>
				</div>
			</div>
		</fieldset>

		<fieldset>
			<legend class={LEGENDA}>2. Zabiegi kosmetologiczne</legend>
			<p class="text-sm text-slate-600">Zabiegi wykonywane w gabinecie (zaznaczone we wniosku):</p>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800" data-testid="ankieta-zabiegi">
				{#each s.zm.zabiegi_ankieta as z (z)}<li>{z}</li>{/each}
			</ul>
			<div class="mt-4 space-y-4">
				<div>
					<label for="ank-inne-zabiegi" class={ETYKIETA}>Inne zabiegi wymagające oceny ryzyka (opcjonalnie)</label>
					<textarea
						id="ank-inne-zabiegi"
						rows="2"
						bind:value={s.ankieta.inne_zabiegi}
						class={INP}
						maxlength="1000"
						aria-describedby="ank-inne-zabiegi-pomoc"
					></textarea>
					<p id="ank-inne-zabiegi-pomoc" class={POMOC}>
						Tylko zabiegi o podobnym ryzyku jak powyższe (np. iniekcyjne, laserowe, z użyciem urządzeń), których nie ma na liście — pozycja
						„Inny – prosimy opisać” w ankiecie. Zabiegów z list programu tu nie wpisuj.
					</p>
				</div>
				<div>
					<label for="ank-jak-dlugo" class={ETYKIETA}>Prosimy o podanie, jak długo wybrane zabiegi są wykonywane w gabinecie</label>
					<input id="ank-jak-dlugo" bind:value={s.ankieta.jak_dlugo} class={INP} maxlength="1000" placeholder="np. od 2022 r." />
				</div>
				<fieldset>
					<legend class={ETYKIETA}>Czy przed wykonaniem zabiegów klienci otrzymują i podpisują formularz zgody na zabieg?</legend>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each ['tak', 'nie'] as v (v)}
							<label class={OPCJA}>
								<input type="radio" name="ank-zgoda" value={v} bind:group={s.ankieta.zgoda_klientow} class={ZNACZNIK} />
								<span>{v}</span>
							</label>
						{/each}
					</div>
					{#if s.ankieta.zgoda_klientow === 'tak'}
						<p class="mt-2 text-sm text-slate-600">
							Prosimy o załączenie stosowanych w gabinecie wzorów formularzy zgody na zabieg — dodaj je w dokumentach poniżej.
						</p>
					{/if}
				</fieldset>
			</div>
		</fieldset>

		<fieldset>
			<legend class={LEGENDA}>3. Osoby wykonujące te zabiegi</legend>
			<div class="space-y-4">
				{#each s.ankieta.osoby as o, i (i)}
					<fieldset class="rounded-2xl border border-slate-200 p-4" data-testid="osoba-{i}">
						<legend class="px-1 text-sm font-semibold text-slate-700">Osoba {i + 1}</legend>
						<div class="space-y-3">
							<p class="font-medium text-slate-900" data-testid="osoba-{i}-imie">{o.imie_nazwisko}</p>
							<div>
								<label for="os-{i}-kwal" class={ETYKIETA}>Kwalifikacje: wykształcenie, ukończone kursy i szkolenia</label>
								<textarea
									id="os-{i}-kwal"
									rows="3"
									bind:value={o.kwalifikacje}
									class={INP}
									maxlength="3000"
									aria-describedby="os-{i}-kwal-pomoc"
								></textarea>
								<!-- Formularz Ergo: certyfikaty, dyplomy ze wskazaniem przedmiotu, czasu trwania i instytucji. -->
								<p id="os-{i}-kwal-pomoc" class={POMOC}>
									Przy studiach, kursach i szkoleniach podaj przedmiot (czego dotyczyły), czas trwania i nazwę instytucji, która je
									prowadziła.
								</p>
							</div>
							<div>
								<label for="os-{i}-dosw" class={ETYKIETA}>Doświadczenie — jak długo ta osoba wykonuje te zabiegi</label>
								<input id="os-{i}-dosw" bind:value={o.doswiadczenie} class={INP} maxlength="1000" placeholder="np. 3 lata" />
							</div>
						</div>
					</fieldset>
				{/each}
			</div>
			<p class="mt-2 text-sm text-slate-500">Osoby, ich dyplomy i certyfikaty zmienisz w kroku „Osoby i dokumenty”.</p>
		</fieldset>

		<Zalaczniki {s} />

		<label class="{OPCJA} border-[#2a3b69]/30">
			<input type="checkbox" bind:checked={s.ankieta.oswiadczenie} class={ZNACZNIK} />
			<span class="text-sm text-slate-800">{OSWIADCZENIE_ANKIETY}</span>
		</label>

		<Bledy {bledy} />

		<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
			<button type="button" class={BTN_DRUGI} onclick={onwstecz}>Wstecz</button>
			<button type="submit" class={BTN_GLOWNY}>Dalej: podsumowanie</button>
		</div>
	</form>
</section>
