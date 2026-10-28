<script lang="ts">
	// APK w dwóch widokach: wnioski o odnowienie (program OC beauty — klient wypełnia APK i wniosek przez
	// link z e-maila, tabela crm_renewals) oraz formularze APK z linkiem /form (tabela apk_forms).
	import { wczytajFormularzeApk, wczytajKlientow } from '$lib/kolekcje';
	import { sb } from '$lib/supabase';
	import { page } from '$app/stores';
	import { appState } from '$lib/stores/app.svelte';
	import type { ApkForm, WniosekOdnowienia } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Kopiuj from '$lib/components/Kopiuj.svelte';
	import CrmRenewalBadge from '$lib/components/renewal/CrmRenewalBadge.svelte';
	import { BUCKET_ODNOWIEN, CYKL_DNI_WSTECZ, DNI_KONCA_WKROTCE, adresWniosku, dniDoKoncaOchrony, etapWniosku, koniecOchronyWkrotce, otworzPdfApk, podsumujWnioski, polisyKlientow, rangaWniosku, sortujWnioski, wniosekDoWystawienia, wniosekNowy, wniosekTestowy, wniosekZalatwiony, wniosekZamkniety, wnioskiZalatwioneZadaniem, type EtapWniosku } from '$lib/components/renewal/crmRenewals';
	import { dateDiffDays, fmtDzien, fmtTermin, odmiana, todayStr } from '$lib/utils';
	import { Plus, Copy, Check, ExternalLink, Search, ClipboardList, Download, User, Eye, FileText, X } from 'lucide-svelte';
	import { saveApkPdf } from '$lib/utils/apkPdf';
	import { apkTokenLink, apkOpenLink, newApkToken } from '$lib/utils/apkLink';
	import { openStoredFile, copyStoredFileLink } from '$lib/utils/storageLink';
	import { goto } from '$app/navigation';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, type CtxItem } from '$lib/stores/ctxmenu.svelte';

	// ---------- Widok: wnioski o odnowienie / formularze APK ----------
	type Widok = 'wnioski' | 'formularze';
	const dzis = todayStr();
	const zAdresu = $page.url.searchParams.get('widok');
	let wybrany = $state<Widok | null>(zAdresu === 'wnioski' || zAdresu === 'formularze' ? zAdresu : null);
	const wnioskiPrawdziwe = $derived(appState.wnioskiOdnowien.filter((w) => !wniosekTestowy(w)));
	// Bez parametru w adresie: wnioski, gdy firma ma choć jeden prawdziwy; inaczej formularze (jak dotąd).
	const widok = $derived<Widok>(wybrany ?? (wnioskiPrawdziwe.length ? 'wnioski' : 'formularze'));

	// ---------- Wnioski o odnowienie (crm_renewals) ----------
	const klientWg = $derived(new Map(appState.clients.map((c) => [c.id, c])));
	const nazwaKlienta = (w: WniosekOdnowienia) => {
		const c = klientWg.get(w.klient_id);
		return c?.nazwa_skrocona ?? c?.nazwa ?? w.klient_nazwa ?? '—';
	};
	const odnowione = $derived(new Set(appState.policies.filter((p) => p.renewal_of && !p.deleted_at).map((p) => p.renewal_of as string)));
	// Pierwsza polisa (wniosek bez certyfikatu) jest załatwiona, gdy klient dostał polisę po złożeniu wniosku.
	const polisyKl = $derived(polisyKlientow(appState.policies));
	// Wniosek zamknięty zadaniem z pulpitu („Załatwione”) liczy się jak załatwiony, choć polisa nie powstała w CRM.
	const zalatwioneZadaniem = $derived(wnioskiZalatwioneZadaniem(appState.tasks));
	const liczby = $derived(podsumujWnioski(appState.wnioskiOdnowien, odnowione, dzis, polisyKl, zalatwioneZadaniem));

	// Filtr etapu: testowe wnioski tylko pod „Nieaktywne” (klient ich nie dostał).
	type FiltrWn = 'wszystkie' | EtapWniosku;
	const FILTRY_WN: [FiltrWn, string][] = [['wszystkie', 'Wszystkie'], ['czeka', 'Czeka na klienta'], ['apk', 'APK wypełniona'], ['zlozony', 'Złożone'], ['nieaktywny', 'Nieaktywne']];
	let filtrWn = $state<FiltrWn>('wszystkie');
	let szukajWn = $state('');
	const etap = (w: WniosekOdnowienia): EtapWniosku => (wniosekTestowy(w) ? 'nieaktywny' : etapWniosku(w));
	const pasujeSzukaj = (w: WniosekOdnowienia) => {
		const q = szukajWn.trim().toLowerCase();
		return !q || nazwaKlienta(w).toLowerCase().includes(q) || (w.klient_nazwa ?? '').toLowerCase().includes(q) || (w.nr_polisy ?? '').toLowerCase().includes(q) || (wniosekNowy(w) && 'pierwsza polisa'.includes(q));
	};
	const wEtapie = (w: WniosekOdnowienia, f: FiltrWn) => (f === 'wszystkie' ? !wniosekTestowy(w) : etap(w) === f);
	// Kolejność: „do wystawienia” na górze (wiersz miga na zielono), potem wnioski w toku i nieaktywne; zamknięte
	// (polisa wystawiona, rezygnacja) na dole — domyślnie schowane, przełącznik „pokaż załatwione” je odsłania.
	const doWystawienia = (w: WniosekOdnowienia) => wniosekDoWystawienia(w, odnowione, polisyKl, zalatwioneZadaniem);
	const zamkniety = (w: WniosekOdnowienia) => wniosekZamkniety(w, odnowione, polisyKl, zalatwioneZadaniem);
	let pokazZalatwione = $state(false);
	const wnioskiPoSzukaniu = $derived(appState.wnioskiOdnowien.filter(pasujeSzukaj).filter((w) => pokazZalatwione || !zamkniety(w)));
	const liczZalatwione = $derived(appState.wnioskiOdnowien.filter((w) => pasujeSzukaj(w) && zamkniety(w) && wEtapie(w, filtrWn)).length);
	const liczDoWystawienia = $derived(appState.wnioskiOdnowien.filter(doWystawienia).length);
	const liczFiltr = $derived(Object.fromEntries(FILTRY_WN.map(([f]) => [f, wnioskiPoSzukaniu.filter((w) => wEtapie(w, f)).length])) as Record<FiltrWn, number>);
	const wnioskiWidoczne = $derived(sortujWnioski(wnioskiPoSzukaniu.filter((w) => wEtapie(w, filtrWn)), odnowione, polisyKl, zalatwioneZadaniem));
	// Wnioski w toku są ułożone chronologicznie wg końca ochrony certyfikatu; te, którym ochrona kończy się w ciągu
	// 7 dni (albo już się skończyła), są na górze, zaraz pod „do wystawienia”, i świecą na pomarańczowo.
	const wTokuWkrotce = (w: WniosekOdnowienia) => rangaWniosku(w, odnowione, polisyKl, zalatwioneZadaniem) === 1 && koniecOchronyWkrotce(w, dzis);
	const liczWkrotce = $derived(wnioskiWidoczne.filter(wTokuWkrotce).length);
	function opisKonca(w: WniosekOdnowienia): string {
		const d = dniDoKoncaOchrony(w, dzis);
		if (d == null) return '';
		if (d < 0) return `${odmiana(-d, 'dzień', 'dni', 'dni')} po końcu`;
		if (d === 0) return 'kończy się dziś';
		if (d === 1) return 'kończy się jutro';
		return `za ${odmiana(d, 'dzień', 'dni', 'dni')}`;
	}

	let bladWn = $state('');
	async function pdfApkWniosku(w: WniosekOdnowienia) {
		bladWn = await otworzPdfApk(w.id);
	}
	async function pdfWniosku(w: WniosekOdnowienia) {
		bladWn = '';
		try {
			await openStoredFile(BUCKET_ODNOWIEN, w.pdf_path);
		} catch (e) {
			bladWn = 'Nie udało się otworzyć PDF wniosku: ' + ((e as { message?: string })?.message ?? String(e));
		}
	}
	const maPdfApk = (w: WniosekOdnowienia) => !!w.apk_at && !w.apk_odmowa;
	// Ważność linku: tylko dla aktywnych, jeszcze niezłożonych wniosków.
	const waznosc = (w: WniosekOdnowienia) => {
		const e = etap(w);
		if (e !== 'czeka' && e !== 'apk') return null;
		const d = w.wazny_do.slice(0, 10);
		const n = dateDiffDays(dzis, d);
		return { tekst: n < 0 ? 'wygasa' : `ważny ${fmtTermin(d, dzis)}`, pilne: n <= 7 };
	};

	function wniosekMenu(w: WniosekOdnowienia): CtxItem[] {
		return [
			{ label: wniosekNowy(w) ? 'Karta klienta → APK (wniosek, dziennik, pliki)' : 'Karta polisy (wniosek, dziennik, pliki)', icon: Eye, onSelect: () => goto(adresWniosku(w)) },
			{ label: 'Karta klienta', icon: User, onSelect: () => goto(`/clients/${w.klient_id}`) },
			{ separator: true },
			{ label: 'Otwórz PDF APK', icon: FileText, disabled: !maPdfApk(w), onSelect: () => pdfApkWniosku(w) },
			{ label: 'Otwórz PDF wniosku', icon: Download, disabled: !w.pdf_path, onSelect: () => pdfWniosku(w) },
			{ separator: true },
			{ label: 'Kopiuj nr certyfikatu', icon: Copy, disabled: !w.nr_polisy, onSelect: () => ctxCopy(w.nr_polisy ?? '', 'nr certyfikatu') }
		];
	}

	// ---------- Formularze APK (apk_forms) ----------
	let pdfSaving = $state<string | null>(null); // form.id currently saving
	let pdfError = $state('');

	// Generuje PDF: pobiera go przeglądarką, zapisuje na serwerze i pokazuje link do zapisanego pliku.
	async function handlePdf(f: ApkForm) {
		pdfSaving = f.id; pdfError = '';
		try {
			const url = await saveApkPdf(f, { download: true });
			appState.apkForms = appState.apkForms.map(x => x.id === f.id ? { ...x, pdf_url: url } : x);
		} catch (e) {
			pdfError = 'Nie udało się zapisać PDF na serwerze: ' + ((e as { message?: string })?.message ?? String(e));
		} finally {
			pdfSaving = null;
		}
	}

	async function openPdf(f: ApkForm) {
		pdfError = '';
		try {
			await openStoredFile('apk-pdfs', f.pdf_url);
		} catch (e) {
			pdfError = 'Nie udało się otworzyć PDF: ' + ((e as { message?: string })?.message ?? String(e));
		}
	}

	let showNew = $state(false);
	let saving = $state(false);
	let err = $state('');

	// form state
	let fKlient = $state('');
	let fKlientSearch = $state('');
	let fKlientOpen = $state(false);
	let fAdvisor = $state(appState.profile?.imie_nazwisko ?? '');
	let fMode = $state<'client' | 'advisor'>('client');

	// RODO consent
	let rodoZgoda = $state(false);
	let rodoData = $state('');
	let rodoKanal = $state<'email' | 'papier' | 'telefon' | 'osobiscie'>('papier');

	// Client declined APK
	let clientDeclined = $state(false);
	let clientDeclinedReason = $state('');

	const filteredClients = $derived(
		fKlientSearch.trim()
			? appState.clients.filter(c => (c.nazwa + ' ' + (c.nazwa_skrocona ?? '')).toLowerCase().includes(fKlientSearch.toLowerCase()))
			: appState.clients
	);
	const selectedClientName = $derived(appState.clients.find(c => c.id === fKlient)?.nazwa ?? '');

	// result after create
	let createdToken = $state('');
	let createdFormId = $state('');
	let copied = $state(false);

	const tokenLink = $derived(createdToken ? apkTokenLink(createdToken) : '');

	function genRef(): string {
		return 'APK-' + Math.random().toString(36).slice(2, 10).toUpperCase();
	}

	async function createApk() {
		if (!fKlient) { err = 'Wybierz klienta'; return; }
		if (clientDeclined && !clientDeclinedReason.trim()) { err = 'Podaj powód odmowy klienta.'; return; }
		saving = true; err = '';
		const client = appState.clients.find(c => c.id === fKlient)!;
		const ref = genRef();
		const token = newApkToken();
		const today = todayStr();

		const { data: form, error: e1 } = await sb.from('apk_forms').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: fKlient,
			ref_number: ref,
			client_name: client.nazwa,
			advisor_name: fAdvisor || null,
			form_date: today,
			mode: fMode,
			status: clientDeclined ? 'submitted' : 'draft',
			submitted_at: clientDeclined ? new Date().toISOString() : null,
			client_declined: clientDeclined,
			client_declined_reason: clientDeclined ? clientDeclinedReason.trim() : null,
			form_data: {}
		}]).select('id').single();

		if (e1) { saving = false; err = e1.message; return; }

		if (!clientDeclined) {
			const expires = new Date(); expires.setDate(expires.getDate() + 30);
			const { error: e2 } = await sb.from('apk_tokens').insert([{
				tenant_id: appState.profile!.tenant_id,
				token,
				form_id: form!.id,
				advisor_name: fAdvisor || null,
				status: 'pending',
				expires_at: expires.toISOString()
			}]);
			if (e2) { saving = false; err = e2.message; return; }
		}

		// log audit
		await sb.from('apk_audit').insert([{ form_id: form!.id, event: clientDeclined ? 'client_declined' : 'created', actor: fAdvisor || 'system' }]);

		// refresh
		const { data } = await wczytajFormularzeApk();
		appState.apkForms = (data ?? []) as typeof appState.apkForms;

		// Jeśli zebrano RODO — zapisz na kliencie
		if (rodoZgoda && fKlient) {
			await sb.from('crm_clients').update({
				rodo_zgoda: true,
				rodo_data: rodoData || todayStr(),
				rodo_kanal: rodoKanal
			}).eq('id', fKlient);
			const { data: cls } = await wczytajKlientow();
			if (cls) appState.clients = cls as typeof appState.clients;
		}

		saving = false;
		createdFormId = form!.id;
		if (!clientDeclined) createdToken = token;
	}

	async function copyLink() {
		await navigator.clipboard.writeText(tokenLink);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function apkMenu(f: ApkForm): CtxItem[] {
		return [
			{
				label: 'Otwórz formularz APK',
				icon: ExternalLink,
				disabled: !apkOpenLink(f),
				onSelect: () => { const u = apkOpenLink(f); if (u) window.open(u, '_blank', 'noopener'); }
			},
			{
				label: 'Generuj PDF',
				icon: Download,
				disabled: pdfSaving === f.id,
				onSelect: () => handlePdf(f)
			},
			{
				label: 'Otwórz zapisany PDF',
				icon: Download,
				disabled: !f.pdf_url,
				onSelect: () => openPdf(f)
			},
			{ separator: true },
			{
				label: 'Karta klienta',
				icon: User,
				disabled: !f.klient_id,
				onSelect: () => goto(`/clients/${f.klient_id}`)
			},
			{ separator: true },
			{ label: 'Kopiuj nr referencyjny', icon: Copy, onSelect: () => ctxCopy(f.ref_number, 'nr referencyjny') },
			{
				label: 'Kopiuj link do PDF',
				icon: Copy,
				disabled: !f.pdf_url,
				onSelect: () => copyStoredFileLink('apk-pdfs', f.pdf_url, 'link do PDF')
			}
		];
	}

	function closeNew() {
		showNew = false;
		err = '';
		fKlient = '';
		fKlientSearch = '';
		fAdvisor = appState.profile?.imie_nazwisko ?? '';
		fMode = 'client';
		createdToken = '';
		createdFormId = '';
		rodoZgoda = false;
		rodoData = '';
		rodoKanal = 'papier';
		clientDeclined = false;
		clientDeclinedReason = '';
	}

	let search = $state('');
	let filterStatus = $state('all');

	const filtered = $derived(
		appState.apkForms
			.filter(f => filterStatus === 'all' || f.status === filterStatus)
			.filter(f => {
				if (!search) return true;
				return (f.client_name + ' ' + (f.ref_number ?? '')).toLowerCase().includes(search.toLowerCase());
			})
	);

	const statusVariant = (f: ApkForm) => f.client_declined ? 'warning' : f.status === 'submitted' ? 'success' : 'neutral';
	const statusLabel = (f: ApkForm) => f.client_declined ? 'Klient zrezygnował' : f.status === 'submitted' ? 'Złożony' : 'Szkic';

	const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>APK — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-5">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Analiza Potrzeb Klienta (APK)</h1>
		<p class="text-sm text-slate-500 mt-1">
			{widok === 'wnioski'
				? 'Wnioski klientów w programie OC beauty (odnowienia certyfikatów i pierwsze polisy) — klient wypełnia APK i wniosek przez link z e-maila'
				: 'Formularze APK zgodne z KNF art. 8 UDU'}
		</p>
	</div>
	{#if widok === 'formularze'}
		<button onclick={() => showNew = true}
			class="flex items-center gap-2 bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover">
			<Plus size={15} /> Nowy APK
		</button>
	{/if}
</div>

<!-- Widoki -->
<div role="tablist" aria-label="Widoki APK" class="flex gap-x-5 border-b border-line mb-4 overflow-x-auto">
	{#each [['wnioski', 'Wnioski klientów', wnioskiPrawdziwe.length], ['formularze', 'Formularze APK', appState.apkForms.length]] as [id, label, n] (id)}
		<button
			role="tab"
			aria-selected={widok === id}
			onclick={() => (wybrany = id as Widok)}
			class="h-10 -mb-px shrink-0 border-b-2 whitespace-nowrap text-sm transition-colors
				{widok === id ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 font-medium hover:text-ink'}"
		>
			{label} <span class="font-normal text-ink-3 tabular-nums">{n}</span>
		</button>
	{/each}
</div>

{#if widok === 'wnioski'}
	<!-- Podsumowanie bieżącego cyklu -->
	<section aria-label="Podsumowanie wniosków" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
		<button onclick={() => (filtrWn = 'czeka')} class="text-left bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm hover:border-amber-300">
			<p class="text-xs font-medium text-amber-600 mb-1">Czeka na klienta</p>
			<p class="text-2xl font-bold text-amber-700 tabular-nums">{liczby.czeka}</p>
			<p class="text-xs text-amber-600/80 mt-0.5">link wysłany, APK jeszcze nie ma</p>
		</button>
		<button onclick={() => (filtrWn = 'apk')} class="text-left bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm hover:border-emerald-300">
			<p class="text-xs font-medium text-emerald-600 mb-1">APK wypełniona</p>
			<p class="text-2xl font-bold text-emerald-700 tabular-nums">{liczby.apk}</p>
			<p class="text-xs text-emerald-600/80 mt-0.5">{liczby.odmowy ? `${odmiana(liczby.odmowy, 'świadoma odmowa', 'świadome odmowy', 'świadomych odmów')} APK` : 'bez odmów wypełnienia'}</p>
		</button>
		<button onclick={() => (filtrWn = 'zlozony')} class="text-left bg-white border border-line rounded-xl p-4 shadow-sm hover:border-slate-300">
			<p class="text-xs font-medium text-slate-500 mb-1">Wnioski złożone</p>
			<p class="text-2xl font-bold text-slate-900 tabular-nums">{liczby.zlozone}</p>
			<p class="text-xs mt-0.5 {liczby.doWystawienia ? 'text-warn font-semibold' : 'text-slate-400'}">{liczby.doWystawienia ? `${liczby.doWystawienia} do wystawienia nowej polisy` : 'wszystkie załatwione'}</p>
		</button>
		<button onclick={() => (filtrWn = 'nieaktywny')} class="text-left bg-white border border-line rounded-xl p-4 shadow-sm hover:border-slate-300">
			<p class="text-xs font-medium text-slate-500 mb-1">Nieaktywne</p>
			<p class="text-2xl font-bold text-slate-900 tabular-nums">{appState.wnioskiOdnowien.filter((w) => etap(w) === 'nieaktywny').length}</p>
			<p class="text-xs text-slate-400 mt-0.5">link wygasł, wniosek anulowany, testowy</p>
		</button>
	</section>
	<p class="text-xs text-slate-400 mb-5">Pierwsze trzy liczby to bieżący cykl: certyfikaty, które kończą się dopiero albo skończyły się najwyżej {CYKL_DNI_WSTECZ} dni temu, oraz wnioski o pierwszą polisę z ostatnich 120 dni — bez wniosków testowych. Odnowienie wysyłasz z karty polisy (albo robi to automat 45 dni przed końcem ochrony); link do APK i wniosku o pierwszą polisę — z karty klienta (zakładka APK) albo z karty leada.</p>

	<!-- Filtry -->
	<div class="flex flex-wrap items-center gap-2 mb-3">
		<label class="w-full sm:w-auto sm:flex-[1_1_260px] sm:max-w-[420px] h-9 flex items-center gap-2 px-2.5 border border-line rounded-lg bg-white focus-within:border-accent">
			<Search size={16} class="text-ink-3 shrink-0" />
			<span class="sr-only">Szukaj wniosku</span>
			<input bind:value={szukajWn} placeholder="Klient, nr certyfikatu…" class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
			{#if szukajWn}
				<button onclick={() => (szukajWn = '')} aria-label="Wyczyść wyszukiwanie" class="w-6 h-6 flex items-center justify-center rounded text-ink-3 hover:bg-surface-2"><X size={14} /></button>
			{/if}
		</label>
		<div role="group" aria-label="Etap wniosku" class="flex flex-wrap gap-1.5">
			{#each FILTRY_WN as [id, label] (id)}
				<button
					aria-pressed={filtrWn === id}
					onclick={() => (filtrWn = id)}
					class="h-9 px-3 rounded-xl text-[13px] font-medium border transition-colors
						{filtrWn === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-line hover:bg-slate-50'}"
				>{label} <span class="tabular-nums">{liczFiltr[id]}</span></button>
			{/each}
		</div>
		<label class="h-9 flex items-center gap-2 px-3 rounded-xl border border-line bg-white text-[13px] font-medium text-slate-600 cursor-pointer sm:ml-auto" title="Wnioski z wystawioną już polisą albo z rezygnacją klienta — domyślnie schowane">
			<input type="checkbox" bind:checked={pokazZalatwione} data-testid="pokaz-zalatwione" class="w-4 h-4 accent-blue-600" />
			Pokaż załatwione <span class="tabular-nums text-slate-400">{liczZalatwione}</span>
		</label>
	</div>
	{#if liczDoWystawienia}
		<p class="mb-1.5 text-[13px] text-emerald-700" data-testid="do-wystawienia-info">
			<span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle animate-pulse"></span>
			{odmiana(liczDoWystawienia, 'wniosek czeka', 'wnioski czekają', 'wniosków czeka')} na wystawienie polisy — {liczDoWystawienia === 1 ? 'jest' : 'są'} na górze listy. Po dodaniu polisy w CRM wiersz schodzi do załatwionych.
		</p>
	{/if}
	<p class="mb-3 text-[13px] {liczWkrotce ? 'text-orange-700' : 'text-slate-500'}" data-testid="wkrotce-info">
		<span class="inline-block w-2 h-2 rounded-full mr-1.5 align-middle {liczWkrotce ? 'bg-orange-500' : 'bg-slate-300'}"></span>
		{#if liczWkrotce}
			{odmiana(liczWkrotce, 'certyfikat kończy', 'certyfikaty kończą', 'certyfikatów kończy')} się w ciągu {DNI_KONCA_WKROTCE} dni — na pomarańczowo, na górze listy.
		{:else}
			Żaden certyfikat z wnioskiem w toku nie kończy się w ciągu {DNI_KONCA_WKROTCE} dni.
		{/if}
		Wnioski w toku są ułożone chronologicznie według końca ochrony.
	</p>

	{#if bladWn}
		<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{bladWn}</div>
	{/if}

	{#if wnioskiWidoczne.length === 0}
		<div class="bg-white border border-line rounded-xl p-10 text-center text-slate-400">
			<ClipboardList size={32} class="mx-auto mb-2 opacity-30" />
			{#if liczZalatwione}
				Wszystkie wnioski w tym widoku są załatwione (polisa wystawiona albo rezygnacja).
				<button onclick={() => (pokazZalatwione = true)} class="ml-1 font-semibold text-accent-text hover:underline">Pokaż załatwione ({liczZalatwione})</button>
			{:else}
				{appState.wnioskiOdnowien.length ? 'Brak wniosków dla wybranego filtra' : 'Jeszcze nie wysłano żadnego wniosku o odnowienie'}
			{/if}
		</div>
	{:else}
		<div class="bg-white border border-line rounded-xl shadow-sm overflow-x-auto">
			<table class="w-full min-w-[960px] text-sm text-left" data-testid="tabela-wnioskow">
				<thead class="bg-slate-50 border-b border-line">
					<tr>
						<th class="px-3 py-3 font-semibold text-slate-600">Koniec ochrony</th>
						<th class="px-3 py-3 font-semibold text-slate-600">Wysłano</th>
						<th class="px-3 py-3 font-semibold text-slate-600">Klient</th>
						<th class="px-3 py-3 font-semibold text-slate-600">Certyfikat</th>
						<th class="px-3 py-3 font-semibold text-slate-600">Status</th>
						<th class="px-3 py-3 font-semibold text-slate-600">APK</th>
						<th class="px-3 py-3 font-semibold text-slate-600">Złożono</th>
						<th class="px-3 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each wnioskiWidoczne as w (w.id)}
						{@const wz = waznosc(w)}
						{@const test = wniosekTestowy(w)}
						{@const pilny = doWystawienia(w)}
						{@const zamkn = zamkniety(w)}
						{@const wkrotce = wTokuWkrotce(w)}
						{@const blisko = !zamkn && !test && koniecOchronyWkrotce(w, dzis)}
						<tr use:ctxMenu={{ items: () => wniosekMenu(w), title: w.nr_polisy ?? 'Wniosek' }} data-testid="wniosek" data-ranga={pilny ? 'do_wystawienia' : zamkn ? 'zalatwiony' : wkrotce ? 'wkrotce' : 'w_toku'}
							class="border-t border-line-soft {pilny ? 'wniosek-do-wystawienia' : zamkn ? 'bg-slate-50/60 text-slate-500 hover:bg-slate-100/60' : wkrotce ? 'wniosek-wkrotce' : 'hover:bg-slate-50'} {test ? 'opacity-60' : ''}">
							<td class="px-3 py-3 whitespace-nowrap" data-testid="koniec-ochrony">
								{#if w.okres_do}
									<span class="block tabular-nums {blisko ? 'font-semibold text-orange-800' : 'text-slate-700'}">{fmtDzien(w.okres_do, true)}</span>
									<span class="block text-xs {blisko ? 'font-semibold text-orange-700' : 'text-slate-400'}">{opisKonca(w)}</span>
								{:else}
									<span class="text-xs text-slate-400">— pierwsza polisa</span>
								{/if}
							</td>
							<td class="px-3 py-3 whitespace-nowrap">
								<span class="block tabular-nums text-slate-700">{fmtDzien(w.wyslano_at ?? w.created_at, true)}</span>
								<span class="block text-xs text-slate-400">
									{#if test}wniosek testowy{:else if !w.wyslano_at}link przekazany ręcznie{:else if w.przypomniano_at}przypomnienie {fmtDzien(w.przypomniano_at, true)}{:else if wz}<span class={wz.pilne ? 'text-warn font-semibold' : ''}>{wz.tekst}</span>{/if}
								</span>
							</td>
							<td class="px-3 py-3 min-w-[150px] max-w-[220px]">
								<a href="/clients/{w.klient_id}" class="block truncate font-medium text-slate-900 hover:text-accent-text">{nazwaKlienta(w)}</a>
								{#if w.email && !test}<span class="block truncate text-xs text-slate-400" title={w.email}>{w.email}</span>{/if}
							</td>
							<td class="px-3 py-3 whitespace-nowrap">
								{#if wniosekNowy(w)}
									<a href={adresWniosku(w)} class="text-xs font-semibold text-rose-700 hover:underline">pierwsza polisa</a>
									<span class="block text-xs text-slate-400">klient bez certyfikatu</span>
								{:else if w.nr_polisy}
									<a href="/policies/{w.polisa_id}" class="font-mono text-xs font-medium text-accent-text hover:underline">{w.nr_polisy}</a>
									<Kopiuj tekst={w.nr_polisy} opis="nr certyfikatu" />
								{:else}
									<a href="/policies/{w.polisa_id}" class="text-xs text-accent-text hover:underline">polisa</a>
								{/if}
							</td>
							<td class="px-3 py-3 whitespace-nowrap">
								<CrmRenewalBadge status={w.status} decyzja={w.decyzja} rodzaj={w.rodzaj} />
								{#if pilny}
									<span class="block mt-1 w-fit h-5 leading-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold tracking-wide" data-testid="odznaka-do-wystawienia">DO WYSTAWIENIA</span>
								{/if}
							</td>
							<td class="px-3 py-3 whitespace-nowrap">
								{#if w.apk_odmowa}
									<Badge variant="warning">Odmowa</Badge>
									<span class="block text-xs text-slate-400">{fmtDzien(w.apk_at, true)}</span>
								{:else if w.apk_at}
									<Badge variant="success">Wypełniona</Badge>
									<span class="block text-xs text-slate-400">{fmtDzien(w.apk_at, true)}{w.podpis_apk_at ? ' · podpisana' : ''}</span>
								{:else if etap(w) === 'nieaktywny'}
									<span class="text-xs text-slate-400">—</span>
								{:else if w.otwarto_at}
									<span class="inline-flex items-center gap-1 text-xs text-amber-600 font-medium"><span class="w-2 h-2 rounded-full bg-amber-500 inline-block"></span> Link otwarty</span>
									<span class="block text-xs text-slate-400">{fmtDzien(w.otwarto_at, true)}</span>
								{:else}
									<span class="inline-flex items-center gap-1 text-xs text-slate-400"><span class="w-2 h-2 rounded-full bg-slate-300 inline-block"></span> Czeka</span>
								{/if}
							</td>
							<td class="px-3 py-3 text-xs whitespace-nowrap {w.zlozono_at ? 'text-slate-700' : 'text-slate-400'}">
								{w.zlozono_at ? fmtDzien(w.zlozono_at, true) : '—'}
								{#if w.status === 'zlozony' && w.decyzja !== 'nie'}
									{@const zalatwiony = wniosekZalatwiony(w, odnowione, polisyKl) || zalatwioneZadaniem.has(w.id)}
									<span class="block {zalatwiony ? 'text-emerald-600' : 'text-emerald-800 font-bold'}">{zalatwiony ? (wniosekNowy(w) ? 'polisa wystawiona' : 'nowa polisa wystawiona') : 'do wystawienia'}</span>
								{/if}
							</td>
							<td class="px-3 py-3">
								<div class="flex items-center gap-2">
									<a href={adresWniosku(w)} class="flex items-center gap-1 px-2 py-1 text-xs border border-line rounded-lg text-slate-600 hover:bg-slate-50" title={wniosekNowy(w) ? 'Karta klienta → APK — wniosek, dziennik zdarzeń, pliki' : 'Karta polisy — wniosek, dziennik zdarzeń, pliki'}>
										<Eye size={12} /> {wniosekNowy(w) ? 'Klient' : 'Polisa'}
									</a>
									{#if maPdfApk(w)}
										<button onclick={() => pdfApkWniosku(w)} class="flex items-center gap-1 px-2 py-1 text-xs border border-line rounded-lg text-slate-600 hover:bg-slate-50" title="PDF analizy potrzeb">
											<FileText size={12} /> APK
										</button>
									{/if}
									{#if w.pdf_path}
										<button onclick={() => pdfWniosku(w)} class="text-blue-500 hover:text-blue-700 flex items-center" title="PDF wniosku">
											<Download size={12} />
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-2 text-xs text-slate-400 tabular-nums">{odmiana(wnioskiWidoczne.length, 'wniosek', 'wnioski', 'wniosków')}</p>
	{/if}
{:else}
	<!-- Filtry -->
	<div class="flex gap-3 mb-5 flex-wrap">
		<div class="flex items-center gap-2 bg-white border border-line rounded-xl px-4 py-2">
			<Search size={15} class="text-slate-400" />
			<input bind:value={search} placeholder="Szukaj klienta / ref..." class="text-sm outline-none placeholder:text-slate-400 w-44" />
		</div>
		{#each [['all','Wszystkie'],['draft','Szkice'],['submitted','Złożone']] as [val, label]}
			<button onclick={() => filterStatus = val}
				class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
					{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-line hover:bg-slate-50'}">
				{label}
			</button>
		{/each}
	</div>

	<!-- Stats -->
	<div class="grid grid-cols-3 gap-4 mb-6">
		<div class="bg-white border border-line rounded-xl p-4 shadow-sm">
			<p class="text-xs font-medium text-slate-500 mb-1">Wszystkich APK</p>
			<p class="text-2xl font-bold text-slate-900">{appState.apkForms.length}</p>
		</div>
		<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
			<p class="text-xs font-medium text-emerald-600 mb-1">Złożone</p>
			<p class="text-2xl font-bold text-emerald-700">{appState.apkForms.filter(f => f.status === 'submitted').length}</p>
		</div>
		<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
			<p class="text-xs font-medium text-amber-600 mb-1">Szkice (oczekujące)</p>
			<p class="text-2xl font-bold text-amber-700">{appState.apkForms.filter(f => f.status === 'draft').length}</p>
		</div>
	</div>

	{#if pdfError}
		<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pdfError}</div>
	{/if}

	<!-- Lista -->
	{#if filtered.length === 0}
		<div class="bg-white border border-line rounded-xl p-10 text-center text-slate-400">
			<ClipboardList size={32} class="mx-auto mb-2 opacity-30" />
			Brak formularzy APK
		</div>
	{:else}
		<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-sm text-left">
				<thead class="bg-slate-50 border-b border-line">
					<tr>
						<th class="px-5 py-3 font-semibold text-slate-600">Ref</th>
						<th class="px-5 py-3 font-semibold text-slate-600">Klient</th>
						<th class="px-5 py-3 font-semibold text-slate-600">Doradca</th>
						<th class="px-5 py-3 font-semibold text-slate-600">Data</th>
						<th class="px-5 py-3 font-semibold text-slate-600">Status</th>
						<th class="px-5 py-3 font-semibold text-slate-600" title="Czy klient otworzył link">Odczyt</th>
						<th class="px-5 py-3 font-semibold text-slate-600">Złożony</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as f}
						<tr use:ctxMenu={{ items: () => apkMenu(f), title: f.ref_number }}
							class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-5 py-3 font-mono text-xs text-slate-500">{f.ref_number}</td>
							<td class="px-5 py-3 font-medium">{f.crm_clients?.nazwa_skrocona ?? f.crm_clients?.nazwa ?? f.client_name}</td>
							<td class="px-5 py-3 text-slate-500">{f.advisor_name ?? '—'}</td>
							<td class="px-5 py-3 text-slate-500">{f.form_date}</td>
							<td class="px-5 py-3"><Badge variant={statusVariant(f)}>{statusLabel(f)}</Badge></td>
							<td class="px-5 py-3">
								{#if f.apk_tokens?.[0]?.used_at}
									<span title="Klient otworzył link: {f.apk_tokens[0].used_at!.slice(0,16).replace('T',' ')}"
										class="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
										<span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
										Odczytano
									</span>
								{:else}
									<span class="inline-flex items-center gap-1 text-xs text-slate-400">
										<span class="w-2 h-2 rounded-full bg-slate-300 inline-block"></span>
										Nie odczytano
									</span>
								{/if}
							</td>
							<td class="px-5 py-3 text-slate-400 text-xs">{f.submitted_at ? f.submitted_at.slice(0,10) : '—'}</td>
							<td class="px-5 py-3">
								<div class="flex items-center gap-2">
									{#if apkOpenLink(f)}
										<a href={apkOpenLink(f)} target="_blank" rel="noopener"
											class="flex items-center gap-1 px-2 py-1 text-xs border border-line rounded-lg text-slate-600 hover:bg-slate-50">
											<ExternalLink size={12} /> Otwórz
										</a>
									{/if}
									<button onclick={() => handlePdf(f)} disabled={pdfSaving === f.id}
										class="flex items-center gap-1 px-2 py-1 text-xs border border-line rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
										<Download size={12} /> {pdfSaving === f.id ? '...' : 'PDF'}
									</button>
									{#if f.pdf_url}
										<button onclick={() => openPdf(f)} title="Ostatni zapisany PDF"
											class="text-blue-500 hover:text-blue-700 flex items-center">
											<Download size={12} />
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

<style>
	/* Wniosek do wystawienia miga na zielono — przy ograniczonej animacji zostaje stałe zielone tło. */
	@keyframes miga-zielono {
		0%, 100% { background-color: #ecfdf5; }
		50% { background-color: #a7f3d0; }
	}
	tr.wniosek-do-wystawienia { animation: miga-zielono 1.4s ease-in-out infinite; }
	@media (prefers-reduced-motion: reduce) {
		tr.wniosek-do-wystawienia { animation: none; background-color: #d1fae5; }
	}
	/* Wniosek w toku, którego certyfikat kończy się w ciągu 7 dni (albo już się skończył): pomarańczowe tło i pasek. */
	tr.wniosek-wkrotce { background-color: #ffedd5; box-shadow: inset 4px 0 0 #f97316; }
	tr.wniosek-wkrotce:hover { background-color: #fed7aa; }
</style>

<!-- Modal: Nowy APK -->
<Modal title="Nowy formularz APK" open={showNew} onclose={closeNew}>
	{#snippet footer()}
		{#if createdFormId}
			<button onclick={closeNew} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover">Gotowe</button>
		{:else}
			<button onclick={closeNew} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
			<button onclick={createApk} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
				{saving ? 'Tworzenie...' : (clientDeclined ? 'Zapisz odmowę' : 'Utwórz i wygeneruj link')}
			</button>
		{/if}
	{/snippet}

	{#if createdFormId && !createdToken}
		<!-- Sukces — klient zrezygnował -->
		<div class="space-y-4">
			<div class="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
				<Check size={20} class="text-amber-600 shrink-0" />
				<span class="text-sm text-amber-700 font-medium">Zarejestrowano odmowę klienta wykonania APK.</span>
			</div>
		</div>
	{:else if createdToken}
		<!-- Sukces — pokaż link -->
		<div class="space-y-4">
			<div class="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
				<Check size={20} class="text-emerald-600 shrink-0" />
				<span class="text-sm text-emerald-700 font-medium">APK utworzone pomyślnie!</span>
			</div>
			<div>
				<label class={lbl}>Link dla klienta (ważny 30 dni)</label>
				<div class="flex gap-2">
					<input readonly value={tokenLink} class="{inp} bg-slate-50 font-mono text-xs" />
					<button onclick={copyLink}
						class="flex items-center gap-1 px-3 py-2 text-sm border border-line rounded-lg hover:bg-slate-50 shrink-0 {copied ? 'text-emerald-600 border-emerald-300' : 'text-slate-600'}">
						{#if copied}<Check size={14} /> Skopiowano{:else}<Copy size={14} /> Kopiuj{/if}
					</button>
				</div>
				<p class="text-xs text-slate-400 mt-1">Wyślij ten link klientowi — wypełni formularz APK online</p>
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			{#if err}<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>{/if}

			<!-- Klient -->
			<div>
				<label class={lbl}>Klient *</label>
				<div class="relative"
					onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { fKlientOpen = false; fKlientSearch = ''; } }}>
					<input type="text"
						value={fKlientOpen ? fKlientSearch : selectedClientName}
						placeholder="— wpisz nazwę klienta —"
						oninput={(e) => fKlientSearch = (e.target as HTMLInputElement).value}
						onfocus={() => { fKlientOpen = true; fKlientSearch = ''; }}
						class={inp}
					/>
					{#if fKlientOpen}
						<div class="absolute z-[200] left-0 right-0 top-full mt-0.5 bg-white border border-line rounded-lg shadow-xl max-h-52 overflow-y-auto">
							{#each filteredClients as c}
								<button tabindex="0" type="button" onclick={() => { fKlient = c.id; fKlientOpen = false; fKlientSearch = ''; }}
									class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
									{c.nazwa_skrocona ?? c.nazwa}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if fKlient && !fKlientOpen}
					<p class="text-xs text-emerald-600 mt-1">✓ {selectedClientName}</p>
				{/if}
			</div>

			<!-- Doradca -->
			<div>
				<label class={lbl}>Doradca</label>
				<input bind:value={fAdvisor} class={inp} placeholder="Imię i nazwisko doradcy" />
			</div>

			<!-- Tryb -->
			<div>
				<label class={lbl}>Tryb wypełniania</label>
				<div class="flex gap-2">
					{#each [['client','Klient wypełnia sam'],['advisor','Doradca wypełnia z klientem']] as [val, label]}
						<button type="button" onclick={() => fMode = val as typeof fMode}
							class="flex-1 py-2 text-sm rounded-lg border transition-colors
								{fMode === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-line hover:bg-slate-50'}">
							{label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Klient zrezygnował -->
			<div class="border border-amber-200 rounded-xl p-4 bg-amber-50">
				<label class="flex items-center gap-2 text-sm cursor-pointer">
					<input type="checkbox" bind:checked={clientDeclined} class="w-4 h-4 accent-amber-600" />
					<span class="font-medium text-amber-800">Klient świadomie zrezygnował z wykonania Analizy Potrzeb Klienta</span>
				</label>
				{#if clientDeclined}
				<div class="mt-3">
					<label class="block text-xs font-medium text-amber-700 mb-1">Powód odmowy *</label>
					<input bind:value={clientDeclinedReason} class={inp} placeholder="np. klient odmówił podania danych" />
				</div>
				{/if}
			</div>

			<!-- RODO -->
			<div class="border border-line rounded-xl p-4 bg-slate-50">
				<p class="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Zgoda RODO (opcjonalnie)</p>
				<label class="flex items-center gap-2 text-sm cursor-pointer mb-3">
					<input type="checkbox" bind:checked={rodoZgoda} class="w-4 h-4 accent-blue-600" />
					<span class="font-medium text-slate-700">Klient wyraził zgodę na przetwarzanie danych</span>
				</label>
				{#if rodoZgoda}
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs font-medium text-slate-600 mb-1">Data zgody</label>
						<input type="date" bind:value={rodoData} class={inp} />
					</div>
					<div>
						<label class="block text-xs font-medium text-slate-600 mb-1">Kanał</label>
						<select bind:value={rodoKanal} class={inp}>
							<option value="papier">Papier</option>
							<option value="email">Email</option>
							<option value="telefon">Telefon</option>
							<option value="osobiscie">Osobiście</option>
						</select>
					</div>
				</div>
				<p class="text-xs text-slate-400 mt-2">Zgoda zostanie zapisana na karcie klienta.</p>
				{/if}
			</div>
		</div>
	{/if}
</Modal>
