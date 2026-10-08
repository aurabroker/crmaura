<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { CalendarClock, CheckCircle2, Link2Off, Mail, RefreshCw, XCircle } from 'lucide-svelte';
	import type { WidokOdnowienia } from '$lib/renewals/api';
	import { DECYZJA_ETYKIETA } from '$lib/renewals/staffApi';
	import { PROGRAM_NAZWA, formatSuma, formatZl, nazwaUbezpieczyciela } from '$lib/renewals/program';
	import LogoBeautyPolisa from '$lib/components/renewal/LogoBeautyPolisa.svelte';
	import KrokAnkieta from '$lib/components/renewal/KrokAnkieta.svelte';
	import KrokApk from '$lib/components/renewal/KrokApk.svelte';
	import KrokPodsumowanie from '$lib/components/renewal/KrokPodsumowanie.svelte';
	import KrokWniosek from '$lib/components/renewal/KrokWniosek.svelte';
	import Postep from '$lib/components/renewal/Postep.svelte';
	import { Odnowienie, type Krok } from '$lib/components/renewal/stan.svelte';
	import {
		BTN_GLOWNY,
		KARTA,
		KONTAKT_EMAIL,
		NAGLOWEK,
		fmtData,
		fmtDataGodzina,
		fokusNaglowka,
		pobierzWidok
	} from '$lib/components/renewal/klient';

	// Publiczna strona odnowienia polisy OC beauty. Klient nie jest zalogowany — jedynym uprawnieniem
	// jest klucz z adresu, a wszystkie dane idą przez /api/odnowienie/[klucz].

	const klucz = $derived(page.params.klucz ?? '');

	let faza = $state<'ladowanie' | 'blad' | 'gotowe'>('ladowanie');
	let bladWczytania = $state('');
	let widok = $state.raw<WidokOdnowienia | null>(null);
	let s = $state.raw<Odnowienie | null>(null);
	let ankietaWyslana = $state(false);

	async function wczytaj() {
		faza = 'ladowanie';
		bladWczytania = '';
		const r = await pobierzWidok(klucz);
		if (!r.ok) {
			bladWczytania = r.message;
			faza = 'blad';
			return;
		}
		widok = r.widok;
		s = r.widok.stan === 'aktywny' ? new Odnowienie(klucz, r.widok) : null;
		faza = 'gotowe';
	}
	onMount(wczytaj);

	// Szkic odpowiedzi w sessionStorage przy każdej zmianie — przypadkowe odświeżenie niczego nie kasuje.
	$effect(() => {
		if (s && s.krok !== 'wyslano') s.zapiszSzkic();
	});

	function idz(k: Krok) {
		if (!s) return;
		s.krok = k;
		fokusNaglowka();
	}

	function poWyslaniu() {
		if (!s) return;
		ankietaWyslana = s.potrzebnaAnkieta;
		s.usunSzkic();
		idz('wyslano');
	}

	const w = $derived(s?.widok ?? null);
	const decyzjaWyniku = $derived(s?.wynik?.decyzja ?? s?.decyzja ?? '');
</script>

<svelte:head>
	<title>Odnowienie ubezpieczenia OC — BeautyPolisa</title>
	<meta name="robots" content="noindex, nofollow" />
	<!-- Adres zawiera klucz dostępu — nie wysyłamy go w nagłówku Referer. -->
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="min-h-screen flex flex-col bg-slate-100 text-slate-900">
	<header class="bg-[#2a3b69] text-white">
		<div class="mx-auto flex max-w-2xl items-center gap-2.5 px-4 py-4">
			<LogoBeautyPolisa />
			<span class="text-white/50" aria-hidden="true">·</span>
			<p class="text-base text-white/90 sm:text-lg">odnowienie ubezpieczenia OC</p>
		</div>
	</header>

	<main class="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
		{#if faza === 'ladowanie'}
			<div class="{KARTA} text-center" aria-busy="true">
				<div class="mx-auto size-8 animate-spin rounded-full border-4 border-slate-200 border-t-rose-600" aria-hidden="true"></div>
				<p class="mt-4 text-slate-600" role="status">Wczytywanie wniosku…</p>
			</div>
		{:else if faza === 'blad'}
			<div class="{KARTA} text-center" role="alert">
				<XCircle size={36} class="mx-auto text-red-500" aria-hidden="true" />
				<h1 class="mt-3 text-xl font-bold text-[#2a3b69]">Nie udało się wczytać wniosku</h1>
				<p class="mt-2 text-slate-600">{bladWczytania}</p>
				<button type="button" class="{BTN_GLOWNY} mt-6" onclick={wczytaj}>
					<RefreshCw size={18} aria-hidden="true" /> Spróbuj ponownie
				</button>
			</div>
		{:else if widok && widok.stan !== 'aktywny'}
			<!-- Link nieprawidłowy, wygasły, anulowany albo wniosek już złożony -->
			<div class="{KARTA} text-center" data-testid="stan-{widok.stan}">
				{#if widok.stan === 'nieznany'}
					<Link2Off size={36} class="mx-auto text-slate-400" aria-hidden="true" />
					<h1 class="mt-3 text-xl font-bold text-[#2a3b69]">Ten link jest nieprawidłowy</h1>
					<p class="mt-2 text-slate-600">
						Sprawdź, czy adres został skopiowany z wiadomości w całości. Jeśli problem się powtarza, napisz do nas.
					</p>
				{:else if widok.stan === 'wygasl'}
					<CalendarClock size={36} class="mx-auto text-amber-500" aria-hidden="true" />
					<h1 class="mt-3 text-xl font-bold text-[#2a3b69]">Link wygasł</h1>
					<p class="mt-2 text-slate-600">
						Termin złożenia wniosku przez ten link minął. Jeśli chcesz odnowić ubezpieczenie, napisz do nas — przygotujemy nowy wniosek.
					</p>
				{:else if widok.stan === 'anulowany'}
					<XCircle size={36} class="mx-auto text-slate-400" aria-hidden="true" />
					<h1 class="mt-3 text-xl font-bold text-[#2a3b69]">Ten wniosek został anulowany</h1>
					<p class="mt-2 text-slate-600">
						Link przestał działać — zwykle dlatego, że wysłaliśmy nowszy. Sprawdź skrzynkę e-mail albo napisz do nas.
					</p>
				{:else if widok.stan === 'zlozony'}
					<CheckCircle2 size={36} class="mx-auto text-emerald-600" aria-hidden="true" />
					<h1 class="mt-3 text-xl font-bold text-[#2a3b69]">Wniosek został już złożony {fmtDataGodzina(widok.zlozono_at)}</h1>
					<p class="mt-2 text-slate-700">
						Decyzja: <strong>{DECYZJA_ETYKIETA[widok.decyzja] ?? widok.decyzja}</strong>
					</p>
					<p class="mt-1 text-sm text-slate-500">
						{widok.klient}{#if widok.nr_polisy}, certyfikat {widok.nr_polisy}{/if}
					</p>
					<p class="mt-4 text-slate-600">Jeśli chcesz coś zmienić, napisz do nas.</p>
				{/if}
				<a href="mailto:{KONTAKT_EMAIL}" class="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-rose-700 underline underline-offset-2">
					<Mail size={18} aria-hidden="true" />{KONTAKT_EMAIL}
				</a>
			</div>
		{:else if s && w}
			{#if s.krok !== 'start' && s.krok !== 'wyslano'}
				<p class="mb-4 truncate text-center text-sm text-slate-500">
					{w.klient}{#if w.nr_polisy} · certyfikat {w.nr_polisy}{/if}
				</p>
			{/if}
			{#if s.krok !== 'wyslano'}
				<Postep kroki={s.kroki} aktualny={s.krok} onwybierz={idz} />
			{/if}

			{#if s.krok === 'start'}
				<section class={KARTA} aria-labelledby="krok-naglowek" data-testid="intro">
					<h1 id="krok-naglowek" tabindex="-1" class={NAGLOWEK}>Odnowienie ubezpieczenia OC gabinetu</h1>
					<p class="mt-2 text-slate-600">
						Twoje ubezpieczenie kończy się {fmtData(w.okres_obecny.do)}. Sprawdź dane i zdecyduj, czy odnawiasz je na kolejny rok.
					</p>

					<dl class="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200">
						{#each [
							['Ubezpieczający', w.klient],
							['Numer certyfikatu', w.nr_polisy ?? '—'],
							['Ubezpieczyciel', nazwaUbezpieczyciela(w.ubezpieczyciel)],
							['Program', w.program ?? PROGRAM_NAZWA],
							['Obecny okres', `${fmtData(w.okres_obecny.od)} – ${fmtData(w.okres_obecny.do)}`]
						] as [k, v] (k)}
							<div class="px-4 py-3 sm:grid sm:grid-cols-5 sm:gap-4">
								<dt class="text-sm text-slate-500 sm:col-span-2">{k}</dt>
								<dd class="font-medium text-slate-900 break-words sm:col-span-3">{v}</dd>
							</div>
						{/each}
						<div class="bg-rose-50/60 px-4 py-3 sm:grid sm:grid-cols-5 sm:gap-4">
							<dt class="text-sm text-slate-500 sm:col-span-2">Nowy okres</dt>
							<dd class="font-semibold text-[#2a3b69] sm:col-span-3" data-testid="okres-nowy">
								{fmtData(w.okres_nowy.od)} – {fmtData(w.okres_nowy.do)}
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-5 sm:gap-4">
							<dt class="text-sm text-slate-500 sm:col-span-2">Suma gwarancyjna</dt>
							<dd class="font-medium text-slate-900 sm:col-span-3" data-testid="suma">
								{w.suma != null ? formatSuma(w.suma) : 'zgodnie z obecnym certyfikatem'}
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-5 sm:gap-4">
							<dt class="text-sm text-slate-500 sm:col-span-2">Składka roczna</dt>
							<dd class="sm:col-span-3" data-testid="skladka">
								<span class="font-medium text-slate-900">{w.skladka != null ? formatZl(w.skladka) : 'zgodnie z obecnym certyfikatem'}</span>
								<span class="block text-sm text-slate-500">Przy odnowieniu bez zmian składka pozostaje taka sama.</span>
							</dd>
						</div>
						<div class="px-4 py-3 sm:grid sm:grid-cols-5 sm:gap-4">
							<dt class="text-sm text-slate-500 sm:col-span-2">Link ważny do</dt>
							<dd class="font-medium text-slate-900 sm:col-span-3" data-testid="wazny-do">{fmtData(w.wazny_do)}</dd>
						</div>
					</dl>

					<h2 class="mt-8 text-base font-semibold text-[#2a3b69]">Jak to działa</h2>
					<ol class="mt-3 space-y-3">
						{#each [
							['Analiza potrzeb (APK)', 'kilka pytań o gabinet, około 2 minut. Możesz też świadomie odmówić.'],
							['Wniosek', 'odnawiasz bez zmian, ze zmianami albo rezygnujesz. Przy zmianach od razu zobaczysz orientacyjną składkę.'],
							['Podsumowanie i wysłanie', 'sprawdzasz odpowiedzi i wysyłasz wniosek. Potwierdzenie w PDF przyjdzie e-mailem.']
						] as [t, o], i (t)}
							<li class="flex gap-3">
								<span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2a3b69] text-sm font-bold text-white">{i + 1}</span>
								<p class="pt-1 text-slate-700"><strong class="text-slate-900">{t}</strong> — {o}</p>
							</li>
						{/each}
					</ol>
					<p class="mt-4 text-sm text-slate-500">
						Jeśli zgłosisz zabiegi wymagające oceny ubezpieczyciela (np. toksyna botulinowa, wypełniacze), dojdzie krótka ankieta Ergo Hestii z
						dokumentami kwalifikacji.
					</p>

					<button type="button" class="{BTN_GLOWNY} mt-8 w-full sm:w-auto" onclick={() => idz('apk')}>
						{s.apkGotowa ? 'Kontynuuj' : 'Rozpocznij'}
					</button>
				</section>
			{:else if s.krok === 'apk'}
				<KrokApk {s} ondalej={() => idz('wniosek')} onwstecz={() => idz('start')} />
			{:else if s.krok === 'wniosek'}
				<KrokWniosek {s} ondalej={() => idz(s?.potrzebnaAnkieta ? 'ankieta' : 'podsumowanie')} onwstecz={() => idz('apk')} />
			{:else if s.krok === 'ankieta'}
				<KrokAnkieta {s} ondalej={() => idz('podsumowanie')} onwstecz={() => idz('wniosek')} />
			{:else if s.krok === 'podsumowanie'}
				<KrokPodsumowanie {s} onidz={idz} onwyslano={poWyslaniu} />
			{:else if s.krok === 'wyslano'}
				<section class={KARTA} aria-labelledby="krok-naglowek" data-testid="wyslano-{decyzjaWyniku}">
					{#if decyzjaWyniku === 'nie'}
						<CheckCircle2 size={40} class="text-slate-500" aria-hidden="true" />
						<h1 id="krok-naglowek" tabindex="-1" class="{NAGLOWEK} mt-3">Rezygnacja została zapisana</h1>
						<p class="mt-3 text-slate-700">
							Zapisaliśmy, że nie odnawiasz ubezpieczenia. Ochrona ubezpieczeniowa wygaśnie
							<strong>{w.okres_obecny.do ? fmtData(w.okres_obecny.do) : 'z końcem obecnego okresu'}</strong>.
						</p>
						<p class="mt-3 text-slate-700">Jeśli zmienisz zdanie przed tym dniem, napisz do nas — przygotujemy odnowienie.</p>
					{:else}
						<CheckCircle2 size={40} class="text-emerald-600" aria-hidden="true" />
						<h1 id="krok-naglowek" tabindex="-1" class="{NAGLOWEK} mt-3">Dziękujemy! Wniosek został wysłany</h1>
						<p class="mt-3 text-slate-700">
							Przygotujemy odnowienie ubezpieczenia{decyzjaWyniku === 'zmiany' ? ' z wybranymi zmianami' : ''} na okres
							<strong>{fmtData(w.okres_nowy.od)} – {fmtData(w.okres_nowy.do)}</strong>.
						</p>
						{#if decyzjaWyniku === 'zmiany'}
							<p class="mt-3 text-slate-700" data-testid="wynik-skladka">
								{#if s.wynik?.wycena_indywidualna}
									Składka zostanie wyceniona indywidualnie — doradca skontaktuje się z Tobą.
								{:else if s.wynik?.skladka_nowa != null}
									Składka orientacyjna: <strong>{formatZl(s.wynik.skladka_nowa)}</strong>. Doradca potwierdzi ostateczną składkę.
								{:else}
									Doradca potwierdzi składkę i zakres zmian.
								{/if}
							</p>
						{/if}
						<p class="mt-3 text-slate-700">Potwierdzenie złożenia wniosku (PDF) wyślemy na Twój adres e-mail.</p>
						{#if ankietaWyslana}
							<div class="mt-5 flex items-start gap-3 rounded-xl border border-[#2a3b69]/20 bg-[#2a3b69]/5 p-4 text-[#2a3b69]">
								<Mail size={20} class="mt-0.5 shrink-0" aria-hidden="true" />
								<p>
									<strong>Ankieta Ergo Hestii:</strong> sprawdź skrzynkę e-mail — wyślemy PDF ankiety. Wydrukuj ją, podpisz i odeślij zgodnie z
									instrukcją w wiadomości.
								</p>
							</div>
						{/if}
					{/if}
					<p class="mt-6 text-sm text-slate-500">
						Pytania? Napisz:
						<a href="mailto:{KONTAKT_EMAIL}" class="font-semibold text-rose-700 underline underline-offset-2">{KONTAKT_EMAIL}</a>
					</p>
				</section>
			{/if}
		{/if}
	</main>

	<footer class="py-6 text-center text-xs text-slate-500">
		Beauty<span class="text-rose-600" aria-label="serce">❤️</span>Polisa ·
		<a href="https://auraexpert.pl/" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 hover:text-slate-700">Aura Expert sp. z o.o.</a>
	</footer>
</div>
