<script lang="ts">
	import { tick } from 'svelte';
	import { CheckCircle2, Pencil } from 'lucide-svelte';
	import {
		APK_ODMOWA_TRESC,
		APK_ODPOWIEDZI,
		APK_PYTANIA,
		LICZBA_OSOB,
		RODZAJE_GABINETU,
		waliduj_apk,
		type Apk
	} from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import { BTN_DRUGI, BTN_GLOWNY, BTN_LINK, INP, KARTA, LEGENDA, NAGLOWEK, OPCJA, ZNACZNIK, fokusNaglowka, wyslij } from './klient';
	import { pustaApk, type ApkForm, type Odnowienie } from './stan.svelte';

	// Krok 1: analiza potrzeb (APK) dla OC gabinetu albo świadoma odmowa jej wypełnienia.
	// Zapisana APK pokazuje się jako skrót z „Popraw” — klient może ją zmienić aż do wysłania wniosku.
	interface Props {
		s: Odnowienie;
		ondalej: () => void;
		onwstecz: () => void;
	}
	let { s, ondalej, onwstecz }: Props = $props();

	type PoleRadio = 'osoby' | 'suma_oczekiwana' | 'ochrona_prawna' | 'szkolenia' | 'priorytet';
	type Inne = Apk['inne_ubezpieczenia'][number];

	const TAK_NIE: [string, string][] = [['tak', 'tak'], ['nie', 'nie']];
	const OSOBY = LICZBA_OSOB.map((o): [string, string] => [o.key, o.nazwa]);
	const SUMA = Object.entries(APK_ODPOWIEDZI.suma_oczekiwana);
	const OCHRONA = Object.entries(APK_ODPOWIEDZI.ochrona_prawna);
	const PRIORYTET = Object.entries(APK_ODPOWIEDZI.priorytet);
	const INNE = Object.entries(APK_ODPOWIEDZI.inne_ubezpieczenia) as [Inne, string][];

	let zajety = $state(false);
	let message = $state('');
	let bledy = $state<string[]>([]);
	let odmowaOtwarta = $state(false);
	let odmowaPotw = $state(false);
	let zapisanoTeraz = $state(false);

	// „Nie mam innych” wyklucza pozostałe odpowiedzi.
	function przelaczInne(k: Inne, on: boolean) {
		let l = s.apkForm.inne_ubezpieczenia.filter((x) => x !== k);
		if (on) l = k === 'brak' ? ['brak'] : [...l.filter((x) => x !== 'brak'), k];
		s.apkForm.inne_ubezpieczenia = l;
	}

	function wyczysc() {
		message = '';
		bledy = [];
	}

	async function zapisz() {
		wyczysc();
		const w = waliduj_apk(s.apkForm);
		if (!w.ok) {
			bledy = w.bledy;
			return;
		}
		zajety = true;
		const r = await wyslij(s.klucz, { akcja: 'apk', apk: w.value });
		zajety = false;
		if (!r.ok) {
			message = r.message;
			bledy = r.bledy;
			return;
		}
		s.apkZapisana = w.value;
		s.apkOdmowa = false;
		s.apkEdycja = false;
		zapisanoTeraz = true;
		fokusNaglowka();
	}

	async function zapiszOdmowe() {
		wyczysc();
		if (!odmowaPotw) {
			bledy = ['Zaznacz, że świadomie odmawiasz wypełnienia analizy potrzeb.'];
			return;
		}
		zajety = true;
		const r = await wyslij(s.klucz, { akcja: 'apk_odmowa', potwierdzenie: true });
		zajety = false;
		if (!r.ok) {
			message = r.message;
			bledy = r.bledy;
			return;
		}
		// Odpowiedzi z formularza zostają w pamięci — klient może jeszcze zmienić zdanie.
		s.apkOdmowa = true;
		s.apkZapisana = null;
		s.apkEdycja = false;
		odmowaOtwarta = false;
		odmowaPotw = false;
		zapisanoTeraz = true;
		fokusNaglowka();
	}

	let odmowaEl = $state<HTMLDivElement | null>(null);
	async function otworzOdmowe() {
		wyczysc();
		odmowaOtwarta = true;
		await tick();
		odmowaEl?.focus();
	}

	function popraw() {
		wyczysc();
		zapisanoTeraz = false;
		s.apkEdycja = true;
		odmowaOtwarta = false;
		odmowaPotw = false;
		fokusNaglowka();
	}

	function anulujPoprawki() {
		wyczysc();
		if (s.apkZapisana) s.apkForm = { ...pustaApk(), ...s.apkZapisana };
		s.apkEdycja = false;
		fokusNaglowka();
	}

	const etykieta = (mapa: Record<string, string>, k: string) => mapa[k] ?? k;
	const podsumowanie = $derived.by(() => {
		const a = s.apkZapisana;
		if (!a) return [] as [string, string][];
		const wiersze: [string, string][] = [
			[APK_PYTANIA.rodzaje, a.rodzaje.map((r) => RODZAJE_GABINETU.find((x) => x.key === r)?.nazwa ?? r).join(', ')],
			[APK_PYTANIA.osoby, LICZBA_OSOB.find((o) => o.key === a.osoby)?.nazwa ?? a.osoby],
			[APK_PYTANIA.suma_oczekiwana, etykieta(APK_ODPOWIEDZI.suma_oczekiwana, a.suma_oczekiwana)],
			[APK_PYTANIA.ochrona_prawna, etykieta(APK_ODPOWIEDZI.ochrona_prawna, a.ochrona_prawna)],
			[APK_PYTANIA.szkolenia, a.szkolenia],
			[APK_PYTANIA.inne_ubezpieczenia, a.inne_ubezpieczenia.map((k) => etykieta(APK_ODPOWIEDZI.inne_ubezpieczenia, k)).join(', ')],
			[APK_PYTANIA.priorytet, etykieta(APK_ODPOWIEDZI.priorytet, a.priorytet)]
		];
		if (a.uwagi) wiersze.push(['Dodatkowe informacje', a.uwagi]);
		return wiersze;
	});
</script>

{#snippet radia(pole: PoleRadio, legenda: string, opcje: [string, string][], kolumny = true)}
	<fieldset>
		<legend class={LEGENDA}>{legenda}</legend>
		<div class="grid gap-2 {kolumny ? 'sm:grid-cols-2' : ''}">
			{#each opcje as [wartosc, nazwa] (wartosc)}
				<label class={OPCJA}>
					<input type="radio" name="apk-{pole}" value={wartosc} bind:group={s.apkForm[pole]} class={ZNACZNIK} />
					<span>{nazwa}</span>
				</label>
			{/each}
		</div>
	</fieldset>
{/snippet}

<section class={KARTA} aria-labelledby="krok-naglowek">
	<h2 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Analiza potrzeb (APK)</h2>

	{#if !s.apkEdycja && s.apkGotowa}
		<!-- Skrót zapisanej APK albo odmowy -->
		{#if zapisanoTeraz}
			<p class="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700" role="status">
				<CheckCircle2 size={18} aria-hidden="true" />
				{s.apkOdmowa ? 'Odmowa wypełnienia APK została zapisana.' : 'Analiza potrzeb została zapisana.'}
			</p>
		{/if}
		{#if s.apkOdmowa}
			<div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="apk-skrot">
				<p class="font-semibold text-slate-900">Świadomie odmówiono wypełnienia APK</p>
				<p class="mt-1 text-sm text-slate-600">{APK_ODMOWA_TRESC}</p>
			</div>
		{:else}
			<dl class="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200" data-testid="apk-skrot">
				{#each podsumowanie as [pytanie, odp] (pytanie)}
					<div class="px-4 py-2.5 sm:grid sm:grid-cols-2 sm:gap-4">
						<dt class="text-sm text-slate-500">{pytanie}</dt>
						<dd class="text-sm font-medium text-slate-900 break-words">{odp}</dd>
					</div>
				{/each}
			</dl>
		{/if}
		<p class="mt-3 text-sm text-slate-500">Możesz to zmienić aż do wysłania wniosku.</p>
		<div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
			<button type="button" class={BTN_DRUGI} onclick={popraw}><Pencil size={16} aria-hidden="true" /> Popraw</button>
			<button type="button" class={BTN_GLOWNY} onclick={ondalej}>Dalej: wniosek</button>
		</div>
	{:else}
		<p class="mt-2 text-slate-600">
			Kilka pytań o Twój gabinet. Dzięki nim sprawdzimy, czy ubezpieczenie odpowiada Twoim potrzebom. Zajmie to około 2 minut.
		</p>

		<form
			class="mt-6 space-y-7"
			novalidate
			onsubmit={(e) => {
				e.preventDefault();
				zapisz();
			}}
		>
			<fieldset>
				<legend class={LEGENDA}>{APK_PYTANIA.rodzaje} <span class="font-normal text-slate-500">(możesz zaznaczyć kilka)</span></legend>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each RODZAJE_GABINETU as r (r.key)}
						<label class={OPCJA}>
							<input type="checkbox" name="apk-rodzaje" value={r.key} bind:group={s.apkForm.rodzaje} class={ZNACZNIK} />
							<span>{r.nazwa}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			{@render radia('osoby', APK_PYTANIA.osoby, OSOBY)}

			{@render radia('suma_oczekiwana', APK_PYTANIA.suma_oczekiwana, SUMA)}
			{@render radia('ochrona_prawna', APK_PYTANIA.ochrona_prawna, OCHRONA)}
			{@render radia('szkolenia', APK_PYTANIA.szkolenia, TAK_NIE)}

			<fieldset>
				<legend class={LEGENDA}>{APK_PYTANIA.inne_ubezpieczenia}</legend>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each INNE as [k, nazwa] (k)}
						<label class={OPCJA}>
							<input
								type="checkbox"
								name="apk-inne"
								value={k}
								checked={s.apkForm.inne_ubezpieczenia.includes(k)}
								onchange={(e) => przelaczInne(k, e.currentTarget.checked)}
								class={ZNACZNIK}
							/>
							<span>{nazwa}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			{@render radia('priorytet', APK_PYTANIA.priorytet, PRIORYTET)}

			<div>
				<label for="apk-uwagi" class={LEGENDA + ' block'}>{APK_PYTANIA.uwagi}</label>
				<textarea id="apk-uwagi" rows="3" bind:value={s.apkForm.uwagi} class={INP} maxlength="3000"></textarea>
			</div>

			<label class="{OPCJA} border-[#2a3b69]/30">
				<input type="checkbox" bind:checked={s.apkForm.oswiadczenie} class={ZNACZNIK} />
				<span class="font-medium">Oświadczam, że podane informacje są zgodne z prawdą.</span>
			</label>

			{#if !odmowaOtwarta}
				<Bledy {message} {bledy} />
			{/if}

			<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
				{#if s.apkGotowa}
					<button type="button" class={BTN_DRUGI} onclick={anulujPoprawki}>Anuluj poprawki</button>
				{:else}
					<button type="button" class={BTN_DRUGI} onclick={onwstecz}>Wstecz</button>
				{/if}
				<button type="submit" class={BTN_GLOWNY} disabled={zajety}>
					{zajety && !odmowaOtwarta ? 'Zapisywanie…' : 'Zapisz analizę potrzeb'}
				</button>
			</div>
		</form>

		<!-- Odmowa APK — wyraźnie oddzielona od formularza -->
		<div class="mt-10 border-t-2 border-dashed border-slate-200 pt-6">
			<h3 class="text-base font-semibold text-slate-900">Nie chcesz wypełniać analizy potrzeb?</h3>
			{#if !odmowaOtwarta}
				<p class="mt-1 text-sm text-slate-600">Możesz świadomie odmówić — wniosek złożysz także bez APK.</p>
				<button type="button" class="{BTN_LINK} mt-2" onclick={otworzOdmowe}>
					Świadomie odmawiam wypełnienia APK
				</button>
			{:else}
				<div id="apk-odmowa" bind:this={odmowaEl} tabindex="-1" class="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 focus:outline-none">
					<p class="text-sm text-slate-800">{APK_ODMOWA_TRESC}</p>
					<label class="mt-4 flex items-start gap-3 cursor-pointer min-h-12">
						<input type="checkbox" bind:checked={odmowaPotw} class={ZNACZNIK} />
						<span class="font-medium text-slate-900">Potwierdzam: świadomie odmawiam wypełnienia APK.</span>
					</label>
					<Bledy {message} {bledy} />
					<div class="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
						<button
							type="button"
							class={BTN_DRUGI}
							onclick={() => {
								wyczysc();
								odmowaOtwarta = false;
								odmowaPotw = false;
							}}
						>
							Jednak wypełnię APK
						</button>
						<button type="button" class={BTN_GLOWNY} disabled={zajety} onclick={zapiszOdmowe}>
							{zajety ? 'Zapisywanie…' : 'Zapisz odmowę'}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</section>
