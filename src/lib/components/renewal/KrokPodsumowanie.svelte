<script lang="ts">
	import { tick } from 'svelte';
	import { AlertTriangle, Send } from 'lucide-svelte';
	import type { OdpowiedzZloz } from '$lib/renewals/api';
	import { DECYZJA_ETYKIETA } from '$lib/renewals/staffApi';
	import { LICZBA_OSOB, OCHRONA_PRAWNA_SKLADKA, RODZAJE_GABINETU, formatSuma, waliduj_ankiete, type Ankieta } from '$lib/renewals/program';
	import Bledy from './Bledy.svelte';
	import WycenaInfo from './WycenaInfo.svelte';
	import { BTN_CZERWONY, BTN_DRUGI, BTN_GLOWNY, BTN_LINK, KARTA, NAGLOWEK, fmtData, wyslij } from './klient';
	import type { Krok, Odnowienie } from './stan.svelte';

	// Krok końcowy: przegląd odpowiedzi i wysłanie wniosku. Rezygnacja wymaga drugiego potwierdzenia.
	interface Props {
		s: Odnowienie;
		onidz: (k: Krok) => void;
		onwyslano: () => void;
	}
	let { s, onidz, onwyslano }: Props = $props();

	const w = $derived(s.widok);
	const z = $derived(s.wniosek.zmiany);
	const koniecOchrony = $derived(w.okres_obecny.do ? fmtData(w.okres_obecny.do) : 'z końcem obecnego okresu ubezpieczenia');

	let zajety = $state(false);
	let message = $state('');
	let bledy = $state<string[]>([]);
	let potwierdzRezygnacje = $state(false);
	let potwierdzEl = $state<HTMLDivElement | null>(null);

	const zmianyOpis = $derived.by(() => {
		if (!z) return [] as string[];
		const l: string[] = [];
		if (z.wyzsza_suma) l.push(`Wyższa suma gwarancyjna: ${formatSuma(z.wyzsza_suma)}`);
		if (z.ochrona_prawna) l.push(`Klauzula ochrony prawnej (+${OCHRONA_PRAWNA_SKLADKA} zł/rok)`);
		if (z.adres) l.push(`Nowy adres działalności: ${z.adres.ulica}, ${z.adres.kod} ${z.adres.miasto}`);
		if (z.nowe_zabiegi.length) l.push(`Nowe zabiegi z list programu: ${z.nowe_zabiegi.join(', ')}`);
		if (z.zabiegi_ankieta.length) l.push(`Zabiegi wymagające ankiety: ${z.zabiegi_ankieta.join(', ')}`);
		if (z.inne.trim()) l.push(`Inne: ${z.inne.trim()}`);
		if (z.rodzaje.length) l.push(`Działalność: ${z.rodzaje.map((r) => RODZAJE_GABINETU.find((x) => x.key === r)?.nazwa ?? r).join(', ')}`);
		if (z.osoby) l.push(`Osoby wykonujące zabiegi: ${LICZBA_OSOB.find((o) => o.key === z.osoby)?.nazwa ?? z.osoby}`);
		return l;
	});

	// Ostatnie sprawdzenie całości tymi samymi regułami co serwer; przy brakach — link do kroku.
	function sprawdzWszystko(): { bledy: string[]; krok: Krok | null; ankieta: Ankieta | null; wniosek: ReturnType<Odnowienie['sprawdzWniosek']> } {
		const wn = s.sprawdzWniosek();
		if (!s.apkGotowa) return { bledy: ['Wypełnij analizę potrzeb (APK) albo świadomie odmów jej wypełnienia.'], krok: 'apk', ankieta: null, wniosek: wn };
		if (!s.sprawdzWniosek(false).ok) return { bledy: wn.ok ? [] : wn.bledy, krok: 'wniosek', ankieta: null, wniosek: wn };
		if (s.potrzebneDokumenty) {
			const braki = s.sprawdzKwalifikacje();
			if (braki.length) return { bledy: braki, krok: 'kwalifikacje', ankieta: null, wniosek: wn };
		}
		if (!wn.ok) return { bledy: wn.bledy, krok: 'wniosek', ankieta: null, wniosek: wn };
		if (!s.potrzebnaAnkieta) return { bledy: [], krok: null, ankieta: null, wniosek: wn };
		const braki = s.sprawdzAnkiete();
		if (braki.length) return { bledy: braki, krok: 'ankieta', ankieta: null, wniosek: wn };
		const a = waliduj_ankiete(s.ankieta);
		return { bledy: [], krok: null, ankieta: a.ok ? a.value : null, wniosek: wn };
	}

	let krokZBledem = $state<Krok | null>(null);

	async function wyslijWniosek() {
		message = '';
		bledy = [];
		krokZBledem = null;
		const spr = sprawdzWszystko();
		if (spr.bledy.length || !spr.wniosek.ok) {
			bledy = spr.bledy;
			krokZBledem = spr.krok;
			potwierdzRezygnacje = false;
			return;
		}
		// Rezygnacja: najpierw wyraźne „na pewno?”, dopiero drugie kliknięcie wysyła.
		if (s.decyzja === 'nie' && !potwierdzRezygnacje) {
			potwierdzRezygnacje = true;
			await tick();
			potwierdzEl?.focus();
			potwierdzEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		zajety = true;
		const r = await wyslij<OdpowiedzZloz>(s.klucz, { akcja: 'zloz', wniosek: spr.wniosek.value, ankieta: s.potrzebnaAnkieta ? spr.ankieta : null });
		zajety = false;
		if (!r.ok) {
			// Odpowiedzi zostają w formularzu — klient poprawia i wysyła ponownie.
			message = r.message;
			bledy = r.bledy;
			potwierdzRezygnacje = false;
			return;
		}
		s.wynik = r.data;
		onwyslano();
	}
</script>

{#snippet wiersz(etykieta: string, krok: Krok | null)}
	<div class="flex items-center justify-between gap-3">
		<dt class="text-sm font-semibold uppercase tracking-wide text-slate-500">{etykieta}</dt>
		{#if krok}
			<button type="button" class={BTN_LINK} aria-label="Zmień: {etykieta}" onclick={() => onidz(krok)}>Zmień</button>
		{/if}
	</div>
{/snippet}

<section class={KARTA} aria-labelledby="krok-naglowek">
	<h2 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Podsumowanie</h2>
	<p class="mt-2 text-slate-600">Sprawdź odpowiedzi przed wysłaniem. Po wysłaniu wniosku nie można go już zmienić przez ten link.</p>

	<dl class="mt-6 space-y-5" data-testid="podsumowanie">
		<div>
			{@render wiersz('Ubezpieczenie', null)}
			<dd class="mt-1 text-slate-900">
				{w.klient}{#if w.nr_polisy}, certyfikat {w.nr_polisy}{/if}
				<span class="block text-sm text-slate-600">Nowy okres: {fmtData(w.okres_nowy.od)} – {fmtData(w.okres_nowy.do)}</span>
			</dd>
		</div>

		<div>
			{@render wiersz('Analiza potrzeb (APK)', 'apk')}
			<dd class="mt-1 text-slate-900">
				{s.apkOdmowa ? 'Świadomie odmówiono wypełnienia APK' : s.apkZapisana ? 'Wypełniona' : 'Nie wypełniono'}
			</dd>
		</div>

		<div>
			{@render wiersz('Decyzja', 'wniosek')}
			<dd class="mt-1 text-lg font-semibold {s.decyzja === 'nie' ? 'text-red-800' : 'text-[#2a3b69]'}">
				{s.decyzja ? DECYZJA_ETYKIETA[s.decyzja] : '—'}
			</dd>
			{#if zmianyOpis.length}
				<dd class="mt-2">
					<ul class="list-disc space-y-1 pl-5 text-sm text-slate-800">
						{#each zmianyOpis as l, i (i)}<li class="break-words">{l}</li>{/each}
					</ul>
				</dd>
			{/if}
			{#if s.decyzja === 'nie' && s.niePowod.trim()}
				<dd class="mt-2 text-sm text-slate-700">Powód: {s.niePowod.trim()}</dd>
			{/if}
		</div>

		{#if s.decyzja === 'zmiany'}
			<div>
				{@render wiersz('Składka', null)}
				<dd class="mt-2"><WycenaInfo wycena={s.wycena} skladkaObecna={w.skladka} /></dd>
			</div>
		{/if}

		{#if s.potrzebneDokumenty}
			<div>
				{@render wiersz('Osoby i dokumenty', 'kwalifikacje')}
				<dd class="mt-1">
					<ul class="space-y-1 text-sm text-slate-800" data-testid="podsumowanie-osoby">
						{#each s.wykonawcy as w (w.id)}
							{@const dok = s.zalaczniki.filter((z) => z.osoba === w.id).length}
							<li class="break-words">
								<strong>{w.imie_nazwisko || '—'}</strong>: {w.zabiegi.filter((z) => s.zabiegiZgloszone.includes(z)).join(', ') || '—'}
								<span class="text-slate-500">· dokumenty: {dok}</span>
							</li>
						{/each}
					</ul>
				</dd>
			</div>
		{/if}

		{#if s.potrzebnaAnkieta}
			<div>
				{@render wiersz('Ankieta Ergo Hestii', 'ankieta')}
				<dd class="mt-1 text-slate-900" data-testid="podsumowanie-ankieta">
					<span class="block">NIP: {s.ankieta.nip.trim() || '—'} · REGON: {s.ankieta.regon.trim() || '—'}</span>
					Osoby wykonujące zabiegi: {s.ankieta.osoby.filter((o) => o.imie_nazwisko.trim()).length}, załączniki: {s.zalaczniki.length}
					{#if s.ankieta.inne_zabiegi.trim()}
						<span class="block break-words text-sm text-slate-700">Inne zabiegi: {s.ankieta.inne_zabiegi.trim()}</span>
					{/if}
					<span class="block text-sm text-slate-600">PDF ankiety przyjdzie e-mailem — wydrukuj go, podpisz i odeślij.</span>
				</dd>
			</div>
		{/if}
	</dl>

	{#if s.decyzja === 'nie'}
		<div class="mt-6 rounded-2xl border-2 border-red-600 bg-red-50 p-4">
			<p class="flex items-start gap-3 font-semibold text-red-800">
				<AlertTriangle size={22} class="mt-0.5 shrink-0" aria-hidden="true" />
				<span>Uwaga: ochrona ubezpieczeniowa wygaśnie {koniecOchrony}. Od tego dnia gabinet nie ma ubezpieczenia OC.</span>
			</p>
		</div>
	{/if}

	<Bledy {message} {bledy} />
	{#if krokZBledem}
		<button type="button" class="{BTN_LINK} mt-2" onclick={() => krokZBledem && onidz(krokZBledem)}>Przejdź do kroku z brakami</button>
	{/if}

	{#if potwierdzRezygnacje}
		<div
			bind:this={potwierdzEl}
			tabindex="-1"
			role="group"
			aria-labelledby="potwierdz-nie-tytul"
			class="mt-6 rounded-2xl border-2 border-red-700 bg-white p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
			data-testid="potwierdz-nie"
		>
			<p id="potwierdz-nie-tytul" class="text-lg font-bold text-red-800">Na pewno rezygnujesz z odnowienia?</p>
			<p class="mt-1 text-slate-700">Po wysłaniu ochrona wygaśnie {koniecOchrony} i gabinet zostanie bez ubezpieczenia OC.</p>
			<div class="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
				<button type="button" class={BTN_DRUGI} onclick={() => (potwierdzRezygnacje = false)}>Nie, wracam</button>
				<button type="button" class={BTN_CZERWONY} disabled={zajety} onclick={wyslijWniosek}>
					{zajety ? 'Wysyłanie…' : 'Tak, rezygnuję z odnowienia'}
				</button>
			</div>
		</div>
	{:else}
		<div class="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
			<button type="button" class={BTN_DRUGI} onclick={() => onidz(s.kroki[s.kroki.length - 2])}>Wstecz</button>
			<button type="button" class={s.decyzja === 'nie' ? BTN_CZERWONY : BTN_GLOWNY} disabled={zajety} onclick={wyslijWniosek}>
				<Send size={18} aria-hidden="true" />
				{zajety ? 'Wysyłanie…' : s.decyzja === 'nie' ? 'Wyślij rezygnację' : 'Wyślij wniosek'}
			</button>
		</div>
	{/if}
</section>
