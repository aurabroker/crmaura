<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { sb } from '$lib/supabase';
	import Badge from '$lib/components/Badge.svelte';
	import CrmRenewalBadge from './CrmRenewalBadge.svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { openStoredFile } from '$lib/utils/storageLink';
	import {
		APK_ODMOWA_TRESC, APK_ODPOWIEDZI, APK_PYTANIA, LICZBA_OSOB, OCHRONA_PRAWNA_SKLADKA, OSWIADCZENIE_ANKIETY,
		RODZAJE_GABINETU, TYPY_ZALACZNIKOW, formatSuma, formatZl, wycenaWniosku,
		type Ankieta, type Apk
	} from '$lib/renewals/program';
	import { ADRES_TESTOWY, DECYZJA_ETYKIETA, type OdnowienieUtworzone, type TrybWyslania } from '$lib/renewals/staffApi';
	import { appState } from '$lib/stores/app.svelte';
	import type { Policy, RenewalEvent, RenewalRow } from '$lib/types/database';
	import { czyLinkDziala, fmtData, fmtDataCzas, wariantDecyzji, wywolajApi } from './crmRenewals';
	import { ChevronDown, Copy, FileText, Paperclip, Ban, History, Link2 } from 'lucide-svelte';

	interface Props {
		policy: Policy;
		/** E-mail klienta z kartoteki — tylko do komunikatu po wysyłce. */
		email?: string | null;
		/** Polisa ma już następczynię w CRM — nowego wniosku nie wysyłamy. */
		odnowiona?: boolean;
	}
	let { policy, email = null, odnowiona = false }: Props = $props();

	const BUCKET = 'renewal-files';

	let renewals = $state<RenewalRow[]>([]);
	let events = $state<RenewalEvent[]>([]);
	// false, dopóki tabela nie odpowie — przed migracją (albo przy błędzie) panel się nie pokazuje.
	let dostepne = $state(false);
	let blad = $state('');
	// Link z ostatniego utworzenia/kopiowania — w bazie go nie ma (podpis zna tylko serwer).
	let link = $state('');
	let pracuje = $state<'' | TrybWyslania | 'kopiuj' | 'anuluj'>('');
	let apkOpen = $state(false);
	let ankietaOpen = $state(false);
	let zdarzeniaOpen = $state(false);
	let historiaOpen = $state(false);

	const latest = $derived(renewals[0] ?? null);
	const starsze = $derived(renewals.slice(1));
	// Tryb testowy firmy (SAAS Admin) albo wniosek utworzony w tym trybie (ma zapisany adres testowy).
	const trybTestowy = $derived(appState.tenantFeatures?.odnowienia_test === true);
	const wniosekTestowy = $derived(latest?.email?.trim().toLowerCase() === ADRES_TESTOWY);

	// Odpowiedzi spóźnione po zmianie polisy (nawigacja między kartami) są pomijane.
	let zapytanie = 0;
	async function zaladuj(polisaId = policy.id) {
		const nr = ++zapytanie;
		try {
			const { data, error } = await sb
				.from('crm_renewals')
				.select('*')
				.eq('polisa_id', polisaId)
				.order('created_at', { ascending: false });
			if (nr !== zapytanie) return;
			if (error) {
				dostepne = false;
				renewals = [];
				events = [];
				return;
			}
			renewals = (data ?? []) as RenewalRow[];
			dostepne = true;
			const r = renewals[0];
			if (!r) {
				events = [];
				return;
			}
			const { data: ev, error: e2 } = await sb
				.from('crm_renewal_events')
				.select('*')
				.eq('renewal_id', r.id)
				.order('at', { ascending: true });
			if (nr !== zapytanie) return;
			events = e2 ? [] : ((ev ?? []) as RenewalEvent[]);
		} catch {
			if (nr === zapytanie) dostepne = false;
		}
	}

	$effect(() => {
		const polisaId = policy.id;
		untrack(() => {
			blad = '';
			link = '';
			zaladuj(polisaId);
		});
	});

	// ClipboardItem z obietnicą pozwala Safari zapisać schowek mimo oczekiwania na serwer.
	async function zapiszDoSchowka(tekst: Promise<string>) {
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
			try {
				await navigator.clipboard.write([
					new ClipboardItem({ 'text/plain': tekst.then((t) => new Blob([t], { type: 'text/plain' })) })
				]);
				return;
			} catch {
				// niżej druga próba zwykłym zapisem tekstu
			}
		}
		await navigator.clipboard.writeText(await tekst);
	}

	async function kopiujDoSchowka(tekst: Promise<string>): Promise<boolean> {
		try {
			await zapiszDoSchowka(tekst);
			return true;
		} catch {
			return false;
		}
	}

	/** Nowy wniosek: e-mail do klienta albo sam link. Wywoływane z menu „Odnów polisę”. */
	export async function utworz(tryb: TrybWyslania) {
		if (pracuje) return;
		blad = '';
		pracuje = tryb;
		try {
			// Serwer odrzuca wysyłkę, gdy ekran pokazuje tryb testowy, a firma ma go już wyłączony.
			const body = { polisa_id: policy.id, tryb, oczekiwany_test: trybTestowy };
			let w = await wywolajApi<OdnowienieUtworzone>('POST', '/api/renewals', body);
			if (!w.ok && w.status === 409 && !w.aktywny) {
				const { data: t } = await sb.from('crm_tenants').select('features').eq('id', policy.tenant_id).maybeSingle();
				const f = (t as { features?: Record<string, boolean> | null } | null)?.features;
				if (t) appState.tenantFeatures = f ?? {};
			}
			if (!w.ok && w.status === 409 && w.aktywny) {
				const tak = await askConfirm({
					title: 'Ten certyfikat ma już aktywny wniosek.',
					message: 'Utworzyć nowy i unieważnić poprzedni link?',
					detail: 'Poprzedni link przestanie działać od razu.',
					confirmLabel: 'Utwórz nowy',
					cancelLabel: 'Zostaw obecny'
				});
				if (!tak) return;
				w = await wywolajApi<OdnowienieUtworzone>('POST', '/api/renewals', { ...body, zastap: true });
			}
			if (!w.ok) {
				blad = w.message;
				return;
			}
			link = w.data.link ?? '';
			if (tryb === 'email') {
				if (w.data.wyslano)
					ctxToast(
						w.data.test
							? `TEST: wniosek wysłany na adres testowy ${w.data.adres ?? ADRES_TESTOWY}`
							: email ? `Wysłano wniosek na adres ${email}` : 'Wysłano wniosek do klienta'
					);
				else blad = 'Wniosek utworzony, ale e-mail nie został wysłany. Skopiuj link poniżej i przekaż go klientowi.';
			} else if (link) {
				const ok = await kopiujDoSchowka(Promise.resolve(link));
				ctxToast(ok ? 'Skopiowano link do wniosku' : 'Link utworzony — skopiuj go poniżej');
			}
			await zaladuj();
		} finally {
			pracuje = '';
		}
	}

	async function kopiujLink(r: RenewalRow) {
		if (pracuje) return;
		blad = '';
		pracuje = 'kopiuj';
		const linkP = wywolajApi<{ link: string }>('POST', '/api/renewals/link', { id: r.id }).then((w) => {
			if (!w.ok) throw new Error(w.message);
			if (!w.data.link) throw new Error('Serwer nie zwrócił linku.');
			return w.data.link;
		});
		try {
			const ok = await kopiujDoSchowka(linkP);
			try {
				link = await linkP;
			} catch (e) {
				blad = (e as Error).message;
				return;
			}
			ctxToast(ok ? 'Skopiowano link do wniosku' : 'Nie udało się skopiować — link jest poniżej');
		} finally {
			pracuje = '';
		}
	}

	async function anuluj(r: RenewalRow) {
		if (pracuje) return;
		const tak = await askConfirm({
			title: 'Anulować wniosek o odnowienie?',
			message: 'Link wysłany klientowi przestanie działać.',
			detail: 'Nowy wniosek wyślesz z menu „Odnów polisę”.',
			confirmLabel: 'Anuluj wniosek',
			cancelLabel: 'Wróć'
		});
		if (!tak) return;
		blad = '';
		pracuje = 'anuluj';
		try {
			const w = await wywolajApi<{ ok: true }>('DELETE', '/api/renewals', { id: r.id });
			if (!w.ok) {
				blad = w.message;
				return;
			}
			link = '';
			ctxToast('Wniosek anulowany');
			await zaladuj();
		} finally {
			pracuje = '';
		}
	}

	async function otworzPlik(path: string | null, nazwa: string) {
		blad = '';
		try {
			await openStoredFile(BUCKET, path);
		} catch (e) {
			blad = `Nie udało się otworzyć: ${nazwa}. ${(e as { message?: string })?.message ?? ''}`.trim();
		}
	}

	async function kopiujPokazany() {
		const ok = await kopiujDoSchowka(Promise.resolve(link));
		ctxToast(ok ? 'Skopiowano link do wniosku' : 'Nie udało się skopiować');
	}

	// ---------- Opisy odpowiedzi klienta ----------

	const etykieta = (mapa: Record<string, string>, klucz: string | null | undefined) => (klucz ? mapa[klucz] ?? klucz : '—');
	const takNie = (v: string | null | undefined) => (v === 'tak' ? 'tak' : v === 'nie' ? 'nie' : '—');
	const rodzajeNazwy = (r: string[] | null | undefined) =>
		(r ?? []).map((k) => RODZAJE_GABINETU.find((x) => x.key === k)?.nazwa ?? k).join(', ') || '—';
	const osobyNazwa = (k: string | null | undefined) => (k ? LICZBA_OSOB.find((x) => x.key === k)?.nazwa ?? k : '—');

	type Wiersz = { k: string; v: string | string[] };

	function zmiany(r: RenewalRow): Wiersz[] {
		const w = r.wniosek;
		if (!w) return [];
		if (w.decyzja === 'nie') return [{ k: 'Powód rezygnacji', v: w.nie_powod || 'nie podano' }];
		const z = w.zmiany;
		if (w.decyzja !== 'zmiany' || !z) return [];
		const out: Wiersz[] = [];
		if (z.wyzsza_suma) {
			out.push({ k: 'Suma gwarancyjna', v: `${formatSuma(z.wyzsza_suma)}${r.suma ? ` (obecnie ${formatSuma(r.suma)})` : ''}` });
		}
		if (z.ochrona_prawna) out.push({ k: 'Ochrona prawna', v: `tak — klauzula 7, +${OCHRONA_PRAWNA_SKLADKA} zł rocznie` });
		if (z.adres) out.push({ k: 'Nowy adres działalności', v: `${z.adres.ulica}, ${z.adres.kod} ${z.adres.miasto}` });
		if (z.nowe_zabiegi?.length) out.push({ k: 'Nowe zabiegi', v: z.nowe_zabiegi });
		if (z.zabiegi_ankieta?.length) out.push({ k: 'Zabiegi wymagające ankiety', v: z.zabiegi_ankieta });
		if (z.rodzaje?.length) out.push({ k: 'Rodzaj działalności', v: rodzajeNazwy(z.rodzaje) });
		if (z.osoby) out.push({ k: 'Osoby wykonujące zabiegi', v: osobyNazwa(z.osoby) });
		if (z.inne) out.push({ k: 'Inne zmiany', v: z.inne });
		return out;
	}

	// Składka po odnowieniu: zapisana przez serwer albo „do wyceny”, gdy taryfa jej nie wyznacza.
	function skladka(r: RenewalRow): { kwota: string; opis: string } | null {
		const w = r.wniosek;
		if (r.status !== 'zlozony' || !w || w.decyzja === 'nie') return null;
		let wycena: ReturnType<typeof wycenaWniosku> = null;
		try {
			wycena = wycenaWniosku(w, r.apk, r.skladka);
		} catch {
			wycena = null;
		}
		if (r.skladka_nowa != null) {
			const opis = wycena?.rodzaj === 'kwota' ? wycena.opis : w.decyzja === 'bez_zmian' ? 'bez zmian' : '';
			return { kwota: formatZl(Number(r.skladka_nowa)), opis };
		}
		if (wycena?.rodzaj === 'indywidualna') return { kwota: 'do wyceny', opis: wycena.powod };
		if (!wycena && r.skladka != null) return { kwota: formatZl(Number(r.skladka)), opis: 'bez zmian' };
		return { kwota: 'do wyceny', opis: '' };
	}

	function apkWiersze(a: Apk): Wiersz[] {
		return [
			{ k: APK_PYTANIA.rodzaje, v: rodzajeNazwy(a.rodzaje) },
			{ k: APK_PYTANIA.osoby, v: osobyNazwa(a.osoby) },
			// Pytania o szkody i zabiegi spoza list były tylko w starszych APK.
			...(a.szkody ? [{ k: APK_PYTANIA.szkody, v: takNie(a.szkody) + (a.szkody === 'tak' && a.szkody_opis ? ` — ${a.szkody_opis}` : '') }] : []),
			...(a.spoza_listy ? [{ k: APK_PYTANIA.spoza_listy, v: takNie(a.spoza_listy) + (a.spoza_listy === 'tak' && a.spoza_listy_opis ? ` — ${a.spoza_listy_opis}` : '') }] : []),
			{ k: APK_PYTANIA.suma_oczekiwana, v: etykieta(APK_ODPOWIEDZI.suma_oczekiwana, a.suma_oczekiwana) },
			{ k: APK_PYTANIA.ochrona_prawna, v: etykieta(APK_ODPOWIEDZI.ochrona_prawna, a.ochrona_prawna) },
			{ k: APK_PYTANIA.szkolenia, v: takNie(a.szkolenia) },
			{ k: APK_PYTANIA.inne_ubezpieczenia, v: (a.inne_ubezpieczenia ?? []).map((x) => etykieta(APK_ODPOWIEDZI.inne_ubezpieczenia, x)).join(', ') || '—' },
			{ k: APK_PYTANIA.priorytet, v: etykieta(APK_ODPOWIEDZI.priorytet, a.priorytet) },
			{ k: APK_PYTANIA.uwagi, v: a.uwagi || '—' }
		];
	}

	function ankietaWiersze(a: Ankieta): Wiersz[] {
		return [
			{ k: 'Ubezpieczający', v: a.ubezpieczajacy || '—' },
			{ k: 'Ubezpieczony', v: a.ubezpieczony || '—' },
			{ k: 'Data rozpoczęcia działalności', v: a.data_rozpoczecia || '—' },
			{ k: 'Liczba zatrudnionych osób', v: a.liczba_zatrudnionych || '—' },
			{ k: 'Szkodowość z ostatnich 3 lat', v: a.szkodowosc || '—' },
			{ k: 'Od jak dawna zabiegi są wykonywane w gabinecie', v: a.jak_dlugo || '—' },
			{ k: 'Klienci podpisują formularz zgody na zabieg', v: takNie(a.zgoda_klientow) }
		];
	}

	const ZDARZENIA: Record<string, string> = {
		utworzenie: 'Utworzono wniosek',
		wyslanie: 'Wysłano e-mail do klienta',
		otwarcie: 'Klient otworzył link',
		apk: 'Klient wypełnił APK',
		apk_odmowa: 'Klient odmówił wypełnienia APK',
		zalacznik: 'Klient dodał załącznik',
		zalacznik_usun: 'Klient usunął załącznik',
		zlozenie: 'Klient złożył wniosek',
		przypomnienie: 'Wysłano przypomnienie',
		anulowanie: 'Anulowano wniosek',
		wygasniecie: 'Link wygasł'
	};
	const opisZdarzenia = (e: RenewalEvent) => {
		const powod = typeof e.szczegoly?.powod === 'string' ? ` (${e.szczegoly.powod})` : '';
		return (ZDARZENIA[e.zdarzenie] ?? e.zdarzenie) + powod;
	};

	const rozmiar = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

	function kroki(r: RenewalRow): { label: string; at: string | null; uwaga?: boolean }[] {
		return [
			{ label: 'Wysłano', at: r.wyslano_at },
			{ label: 'Otwarto', at: r.otwarto_at },
			{ label: r.apk_odmowa ? 'APK — odmowa' : r.apk_at ? 'APK — wypełniona' : 'APK', at: r.apk_at, uwaga: r.apk_odmowa },
			{ label: 'Złożono', at: r.zlozono_at },
			{ label: 'Przypomniano', at: r.przypomniano_at }
		];
	}

	const przyciskCls =
		'inline-flex items-center gap-1.5 text-xs border border-line rounded-lg px-2.5 py-1.5 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50';
</script>

{#snippet wiersze(lista: Wiersz[])}
	<dl class="divide-y divide-line-soft text-sm">
		{#each lista as w}
			<div class="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-6 gap-y-0.5 py-1.5">
				<dt class="text-slate-500">{w.k}</dt>
				<dd class="text-slate-800">
					{#if Array.isArray(w.v)}
						<ul class="list-disc pl-4 space-y-0.5">
							{#each w.v as x}<li>{x}</li>{/each}
						</ul>
					{:else}
						{w.v}
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#snippet rozwijany(tytul: string, otwarty: boolean, przelacz: () => void, tresc: Snippet)}
	<div class="border border-line rounded-lg overflow-hidden">
		<button
			type="button"
			onclick={przelacz}
			aria-expanded={otwarty}
			class="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide hover:bg-slate-100"
		>
			{tytul}
			<ChevronDown size={14} class="ml-auto text-slate-400 transition-transform {otwarty ? 'rotate-180' : ''}" />
		</button>
		{#if otwarty}
			<div class="px-3 py-2">{@render tresc()}</div>
		{/if}
	</div>
{/snippet}

{#if blad}
	<div class="mb-3 flex items-start gap-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="renewal-error">
		<span class="flex-1">{blad}</span>
		<button type="button" onclick={() => (blad = '')} class="text-red-400 hover:text-red-700" aria-label="Zamknij">✕</button>
	</div>
{/if}

{#if link}
	<div class="mb-3 flex flex-wrap items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
		<Link2 size={14} class="text-blue-600 shrink-0" />
		<span class="text-xs font-semibold text-blue-700 uppercase tracking-wide">Link do wniosku</span>
		<input
			readonly
			value={link}
			onfocus={(e) => e.currentTarget.select()}
			class="flex-1 min-w-[240px] border border-blue-200 bg-white rounded-md px-2 py-1 text-xs font-mono text-slate-700"
			data-testid="renewal-link"
		/>
		<button type="button" onclick={kopiujPokazany} class={przyciskCls}><Copy size={12} /> Kopiuj</button>
		<button type="button" onclick={() => (link = '')} class="text-blue-400 hover:text-blue-700" aria-label="Ukryj link">✕</button>
	</div>
{/if}

{#if dostepne}
	<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden mb-5" data-testid="renewal-panel">
		<div class="px-5 py-3 border-b border-line-soft bg-slate-50 flex flex-wrap items-center gap-3">
			<p class="text-sm font-semibold text-slate-700">Wniosek o odnowienie — program OC beauty</p>
			{#if trybTestowy || wniosekTestowy}
				<span class="text-[11px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-300 rounded px-2 py-0.5" data-testid="renewal-test-mode">
					{trybTestowy ? `Tryb testowy — e-maile idą na ${ADRES_TESTOWY}, nie do klienta` : 'Wniosek testowy'}
				</span>
			{/if}
			{#if latest}
				<CrmRenewalBadge status={latest.status} />
				{#if pracuje === 'email' || pracuje === 'link'}
					<span class="text-xs text-slate-400">{pracuje === 'email' ? 'Wysyłanie nowego wniosku…' : 'Tworzenie nowego linku…'}</span>
				{/if}
				<div class="ml-auto flex flex-wrap items-center gap-2">
					{#if czyLinkDziala(latest.status)}
						<button type="button" onclick={() => kopiujLink(latest!)} disabled={!!pracuje} class={przyciskCls}>
							<Copy size={12} /> {pracuje === 'kopiuj' ? 'Kopiowanie…' : 'Kopiuj link'}
						</button>
					{/if}
					{#if latest.pdf_path}
						<button type="button" onclick={() => otworzPlik(latest!.pdf_path, 'PDF wniosku')} class={przyciskCls}>
							<FileText size={12} /> PDF wniosku
						</button>
					{/if}
					{#if czyLinkDziala(latest.status)}
						<button
							type="button"
							onclick={() => anuluj(latest!)}
							disabled={!!pracuje}
							class="inline-flex items-center gap-1.5 text-xs border border-red-200 rounded-lg px-2.5 py-1.5 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"
						>
							<Ban size={12} /> {pracuje === 'anuluj' ? 'Anulowanie…' : 'Anuluj wniosek'}
						</button>
					{/if}
				</div>
			{/if}
		</div>

		{#if !latest}
			<p class="px-5 py-4 text-sm text-slate-500">
				{#if pracuje}
					Tworzenie wniosku…
				{:else if odnowiona}
					Polisa jest już odnowiona w CRM — wniosek nie jest potrzebny.
				{:else}
					Nie wysłano jeszcze wniosku. Wyślij go klientowi z menu „Odnów polisę”{email ? '' : ' (klient nie ma adresu e-mail — utwórz link i przekaż go sam)'}.
				{/if}
			</p>
		{:else}
			{@const r = latest}
			{@const listaZmian = zmiany(r)}
			{@const sk = skladka(r)}
			<div class="p-5 space-y-4">
				<!-- Przebieg -->
				<ol class="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="renewal-timeline">
					{#each kroki(r) as k}
						<li class="rounded-lg border px-3 py-2 {k.at ? (k.uwaga ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50') : 'border-line bg-white'}">
							<p class="text-[11px] font-semibold uppercase tracking-wide {k.at ? (k.uwaga ? 'text-amber-700' : 'text-emerald-700') : 'text-slate-400'}">{k.label}</p>
							<p class="text-xs {k.at ? 'text-slate-800' : 'text-slate-400'}">{fmtDataCzas(k.at)}</p>
						</li>
					{/each}
				</ol>
				<p class="text-xs text-slate-500">
					Utworzono {fmtDataCzas(r.created_at)}{r.email ? ` · e-mail: ${r.email}` : ''}
					{#if czyLinkDziala(r.status)} · link ważny do {fmtData(r.wazny_do)}{/if}
					{#if r.suma != null} · suma: {formatSuma(Number(r.suma))}{/if}
					{#if r.skladka != null} · składka: {formatZl(Number(r.skladka))}{/if}
				</p>

				<!-- Decyzja klienta -->
				{#if r.decyzja}
					<div class="rounded-lg border border-line p-4 space-y-3" data-testid="renewal-decision">
						<div class="flex flex-wrap items-center gap-3">
							<span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Decyzja klienta</span>
							<Badge variant={wariantDecyzji(r.decyzja)}>{DECYZJA_ETYKIETA[r.decyzja] ?? r.decyzja}</Badge>
							{#if r.zlozono_at}<span class="text-xs text-slate-400">{fmtDataCzas(r.zlozono_at)}</span>{/if}
							{#if sk}
								<span class="ml-auto text-sm text-slate-600" data-testid="renewal-premium">
									Nowa składka:
									<strong class={sk.kwota === 'do wyceny' ? 'text-amber-700' : 'text-slate-900'}>{sk.kwota}</strong>
									{#if sk.opis}<span class="block text-[11px] text-slate-400 text-right">{sk.opis}</span>{/if}
								</span>
							{/if}
						</div>
						{#if listaZmian.length}
							{@render wiersze(listaZmian)}
						{/if}
					</div>
				{/if}

				<!-- Załączniki od klienta -->
				{#if r.zalaczniki?.length}
					<div data-testid="renewal-attachments">
						<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Załączniki ({r.zalaczniki.length})</p>
						<ul class="divide-y divide-line-soft border border-line rounded-lg">
							{#each r.zalaczniki as z (z.id)}
								<li class="flex items-center gap-3 px-3 py-2 text-sm">
									<Paperclip size={13} class="text-slate-400 shrink-0" />
									<div class="min-w-0 flex-1">
										<button type="button" onclick={() => otworzPlik(z.path, z.nazwa)} class="text-blue-700 hover:underline truncate max-w-full text-left">
											{z.nazwa}
										</button>
										<p class="text-[11px] text-slate-400">
											{(TYPY_ZALACZNIKOW as Record<string, string>)[z.typ] ?? z.typ} · {rozmiar(z.rozmiar)}{z.at ? ` · ${fmtDataCzas(z.at)}` : ''}
										</p>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- APK, ankieta, dziennik -->
				{#if r.apk || r.apk_odmowa}
					{#snippet apkTresc()}
						{#if r.apk_odmowa}
							<p class="text-sm text-slate-700">{APK_ODMOWA_TRESC}</p>
							<p class="text-xs text-slate-400 mt-1">Odmowa złożona {fmtDataCzas(r.apk_at)}.</p>
						{:else if r.apk}
							{@render wiersze(apkWiersze(r.apk))}
							<p class="text-xs text-slate-400 mt-1">
								Wypełniona {fmtDataCzas(r.apk_at)}{r.apk.oswiadczenie ? ' · klient potwierdził zgodność informacji z prawdą' : ''}.
							</p>
						{/if}
					{/snippet}
					{@render rozwijany(r.apk_odmowa ? 'APK — odmowa wypełnienia' : 'Odpowiedzi APK', apkOpen, () => (apkOpen = !apkOpen), apkTresc)}
				{/if}

				{#if r.ankieta}
					{#snippet ankietaTresc()}
						{@const a = r.ankieta!}
						{@render wiersze(ankietaWiersze(a))}
						{#if a.osoby?.length}
							<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-3 mb-1">Osoby wykonujące zabiegi</p>
							<ul class="space-y-1.5 text-sm">
								{#each a.osoby as o}
									<li class="border border-line-soft rounded-md px-2.5 py-1.5">
										<p class="font-medium text-slate-800">{o.imie_nazwisko}</p>
										<p class="text-xs text-slate-500">Kwalifikacje: {o.kwalifikacje}</p>
										<p class="text-xs text-slate-500">Doświadczenie: {o.doswiadczenie}</p>
									</li>
								{/each}
							</ul>
						{/if}
						{#if a.oswiadczenie}
							<p class="text-xs text-slate-400 mt-2">Klient złożył oświadczenie: „{OSWIADCZENIE_ANKIETY}”</p>
						{/if}
					{/snippet}
					{@render rozwijany('Ankieta Ergo Hestii (zabiegi wymagające oceny ryzyka)', ankietaOpen, () => (ankietaOpen = !ankietaOpen), ankietaTresc)}
				{/if}

				{#if events.length}
					{#snippet zdarzeniaTresc()}
						<table class="w-full text-sm">
							<thead>
								<tr class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-left">
									<th class="py-1 pr-3">Zdarzenie</th>
									<th class="py-1 pr-3">Kiedy</th>
									<th class="py-1">IP</th>
								</tr>
							</thead>
							<tbody>
								{#each events as e (e.id)}
									<tr class="border-t border-line-soft" title={e.user_agent ?? ''}>
										<td class="py-1.5 pr-3 text-slate-800">{opisZdarzenia(e)}</td>
										<td class="py-1.5 pr-3 text-slate-600 whitespace-nowrap">{fmtDataCzas(e.at)}</td>
										<td class="py-1.5 text-slate-500 font-mono text-xs">{e.ip ?? '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/snippet}
					{@render rozwijany(`Dziennik zdarzeń (${events.length})`, zdarzeniaOpen, () => (zdarzeniaOpen = !zdarzeniaOpen), zdarzeniaTresc)}
				{/if}
			</div>
		{/if}

		{#if starsze.length}
			<div class="border-t border-line-soft">
				<button
					type="button"
					onclick={() => (historiaOpen = !historiaOpen)}
					aria-expanded={historiaOpen}
					class="w-full flex items-center gap-2 px-5 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hover:bg-slate-50"
				>
					<History size={13} /> Historia ({starsze.length})
					<ChevronDown size={14} class="ml-auto text-slate-400 transition-transform {historiaOpen ? 'rotate-180' : ''}" />
				</button>
				{#if historiaOpen}
					<ul class="divide-y divide-line-soft border-t border-line-soft" data-testid="renewal-history">
						{#each starsze as h (h.id)}
							<li class="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
								<span class="text-slate-500 w-24">{fmtData(h.created_at)}</span>
								<CrmRenewalBadge status={h.status} />
								{#if h.decyzja}<Badge variant={wariantDecyzji(h.decyzja)}>{DECYZJA_ETYKIETA[h.decyzja] ?? h.decyzja}</Badge>{/if}
								<span class="text-xs text-slate-400">
									wysłano {fmtData(h.wyslano_at)}{h.zlozono_at ? ` · złożono ${fmtData(h.zlozono_at)}` : ''}
								</span>
								{#if h.pdf_path}
									<button type="button" onclick={() => otworzPlik(h.pdf_path, 'PDF wniosku')} class="{przyciskCls} ml-auto">
										<FileText size={12} /> PDF
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
{/if}
