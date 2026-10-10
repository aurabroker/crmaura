<script lang="ts">
	import { wczytajFormularzeApk, wczytajKlientow, wczytajKontakty, wczytajPojazdy, wczytajPolisy, wczytajSzkody } from '$lib/kolekcje';
	import { untrack } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { sb, SB_URL } from '$lib/supabase';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus, dateDiffDays, validateVin, assignedPolicyFor, fmtDzien, fmtTermin, odmiana, inicjaly, miastoZAdresu } from '$lib/utils';
	import { ROZLICZONE, poTerminie, ugBezRozliczania } from '$lib/platnosci';
	import { statusPolisy as statusPolisyWspolny, nazwaRodzaju, nazwaTu } from '$lib/statusPolisy';
	import EmailKlienta from '$lib/components/EmailKlienta.svelte';
	import type { Szablon } from '$lib/szablonyEmail';
	import { logAudit } from '$lib/utils/audit';
	import type { Claim, Vehicle, ClientContact, CrmTask, Policy, RenewalEvent, RenewalRow } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import { Pencil, Plus, Car, FileText, UserPlus, Trash2, ClipboardList, Copy, Check, Download, CheckCircle2, Circle, Clock, AlertCircle, Link, RefreshCw, Mail, MailCheck, Send, History, Paperclip, Phone, Ellipsis, ShieldCheck, ShieldAlert, Users, AlertTriangle } from 'lucide-svelte';
	import { todayStr } from '$lib/utils';
	import { saveApkPdf } from '$lib/utils/apkPdf';
	import { apkTokenLink, apkOpenLink, apkCopyLink, newApkToken } from '$lib/utils/apkLink';
	import { openStoredFile } from '$lib/utils/storageLink';
	import type { ApkForm } from '$lib/types/database';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import CrmRenewalBadge from '$lib/components/renewal/CrmRenewalBadge.svelte';
	import { ANKIETA_PDF, APK_PDF, BUCKET_ODNOWIEN, folderWniosku, opisPrzegladarki, opisZdarzenia, otworzPdfApk, rozmiarPliku, wProgramieOcBeauty } from '$lib/components/renewal/crmRenewals';
	import { opisZalacznika } from '$lib/renewals/program';

	let pdfSaving = $state<string | null>(null);
	let pdfError = $state('');

	// Generuje PDF: pobiera go przeglądarką, zapisuje na serwerze i aktualizuje adres w liście.
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

	// --- Panel Klienta: dostęp (logowanie e-mail + hasło) ---
	let showPortal = $state(false);
	let portalEmail = $state('');
	let portalPass = $state('');
	let portalSaving = $state(false);
	let portalError = $state('');
	let portalDone = $state('');

	async function authHeaders(): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` };
	}
	function genPass(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
		const b = new Uint8Array(12); crypto.getRandomValues(b);
		return Array.from(b, (x) => chars[x % chars.length]).join('');
	}
	function openPortal() {
		portalError = ''; portalDone = '';
		portalEmail = client?.email ?? '';
		portalPass = genPass();
		showPortal = true;
	}
	async function savePortalAccess() {
		portalError = ''; portalDone = '';
		if (!portalEmail.trim() || portalPass.length < 8) { portalError = 'Podaj e-mail i hasło (min. 8 znaków).'; return; }
		portalSaving = true;
		try {
			const res = await fetch('/api/portal/access', {
				method: 'POST', headers: await authHeaders(),
				body: JSON.stringify({ klient_id: clientId, email: portalEmail.trim(), password: portalPass })
			});
			const d = await res.json();
			if (!res.ok) { portalError = d.message ?? 'Nie udało się zapisać dostępu.'; return; }
			if (client) client.auth_user_id = client.auth_user_id ?? 'set';
			if (client) client.email = portalEmail.trim();
			portalDone = d.mode === 'updated' ? 'Hasło zaktualizowane.' : 'Konto klienta utworzone.';
		} catch {
			portalError = 'Błąd połączenia.';
		} finally {
			portalSaving = false;
		}
	}
	async function revokePortalAccess() {
		if (!confirm('Odebrać klientowi dostęp do panelu? Konto logowania zostanie usunięte.')) return;
		portalSaving = true; portalError = '';
		try {
			const res = await fetch('/api/portal/access', {
				method: 'DELETE', headers: await authHeaders(),
				body: JSON.stringify({ klient_id: clientId })
			});
			const d = await res.json();
			if (!res.ok) { portalError = d.message ?? 'Nie udało się odebrać dostępu.'; return; }
			if (client) client.auth_user_id = null;
			portalDone = 'Dostęp odebrany.';
		} finally {
			portalSaving = false;
		}
	}

	const clientId = $derived($page.params.id);
	const client = $derived(appState.clients.find(c => c.id === clientId));
	// Polisy, których klient jest właścicielem (ubezpieczającym) — podstawa rozliczeń finansowych.
	const ownPolicies = $derived(appState.policies.filter(p => p.klient_id === clientId));
	// Wszystkie polisy powiązane z klientem: jako ubezpieczający LUB jako ubezpieczony (Dodaj ubezpieczonego).
	const clientPolicies = $derived(appState.policies.filter(p => p.klient_id === clientId || p.ubezpieczony_id === clientId));
	const clientVehicles = $derived(appState.vehicles.filter(v => v.klient_id === clientId));
	const clientClaims = $derived(appState.claims.filter(c => c.klient_id === clientId));
	const clientContacts = $derived(appState.clientContacts.filter(cc => cc.klient_id === clientId));
	const clientApk = $derived(appState.apkForms.filter(f => f.klient_id === clientId));
	const hasPortal = $derived(!!client?.auth_user_id);

	const totalPrzyp = $derived(ownPolicies.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const totalOpl = $derived(ownPolicies.reduce((s, p) => s + Number(p.skladka_zainkasowana ?? 0), 0));
	const activeClaims = $derived(clientClaims.filter(c => c.status === 'Zgłoszona' || c.status === 'W toku'));

	const renewedPolicyIds = $derived(
		new Set(appState.policies
			.filter(p => p.renewal_of !== null && !p.deleted_at)
			.map(p => p.renewal_of as string))
	);

	const grupowePolicies = $derived(clientPolicies.filter(p =>
		p.rodzaj === 'grupowe_medyczne' || p.rodzaj === 'grupowe_życie'
	));
	const hasGrupowe = $derived(grupowePolicies.length > 0);
	const hasVehicles = $derived(clientVehicles.length > 0);
	const hasClaims = $derived(clientClaims.length > 0);

	const isAuraTenant = $derived(appState.tenantNazwa.toLowerCase().includes('aura'));

	// Gwarancje klienta: UG gwarancyjne + polisy gwarancyjne (limit + lista).
	const clientGwarancje = $derived(clientPolicies.filter(p =>
		p.ug_podtyp === 'gwarancje' || p.gwarancja_typ != null || (p.rodzaj ?? '').includes('gwarancj')
	));
	const showGwarancje = $derived(!!client?.gwarancje || clientGwarancje.length > 0);

	// Zakładka Polisy: aktywne i archiwum — sortowanie po kliknięciu w nagłówek kolumny.
	const dzisPolisy = new Date().toISOString().slice(0, 10);
	const activePolicies = $derived(clientPolicies.filter(p => p.data_do === null || p.data_do >= dzisPolisy));
	const archivedPolicies = $derived(clientPolicies.filter(p => p.data_do !== null && p.data_do < dzisPolisy && p.deleted_at === null));
	const kolumnyPolis = {
		nr: (p: Policy) => p.nr_polisy,
		tu: (p: Policy) => p.crm_insurers?.skrot || p.crm_insurers?.nazwa,
		rodzaj: (p: Policy) => p.rodzaj,
		od: (p: Policy) => p.data_od,
		do: (p: Policy) => p.data_do,
		skladka: (p: Policy) => Number(p.skladka_przypisana ?? 0),
		status: (p: Policy) => p.data_do
	};
	const sortAktywne = new Sortowanie<Policy>(kolumnyPolis, { klucz: 'nr' }, 'klient-polisy-aktywne');
	const sortArchiwum = new Sortowanie<Policy>(kolumnyPolis, { klucz: 'nr' }, 'klient-polisy-archiwum');
	const aktywneWiersze = $derived(sortAktywne.sortuj(activePolicies));
	const archiwumWiersze = $derived(sortArchiwum.sortuj(archivedPolicies));

	const sortGwarancje = new Sortowanie<Policy>({
		nr: (g) => g.nr_polisy,
		typ: (g) => g.gwarancja_typ ?? (g.ug_podtyp === 'gwarancje' ? 'Umowa generalna (gwarancje)' : null),
		beneficjent: (g) => g.gwarancja_beneficjent_nazwa ?? g.gwarancja_kontrakt,
		od: (g) => g.data_od,
		do: (g) => g.data_do,
		limit: (g) => (g.ug_limit != null ? Number(g.ug_limit) : null)
	}, { klucz: 'nr' }, 'klient-gwarancje');
	const gwarancjeWiersze = $derived(sortGwarancje.sortuj(clientGwarancje));

	// Okno „Składki klienta" — lista polis ze składką.
	const sortSkladki = new Sortowanie<Policy>({
		nr: (p) => p.nr_polisy,
		skladka: (p) => Number(p.skladka_przypisana ?? 0)
	}, { klucz: 'nr' }, 'klient-skladki-polisy');
	const skladkiWiersze = $derived(sortSkladki.sortuj(clientPolicies));

	type TabKey = 'przeglad' | 'polisy' | 'pojazdy' | 'gwarancje' | 'szkody' | 'saldo' | 'kontakty' | 'apk' | 'zalaczniki' | 'dziennik' | 'zadania' | 'emaile' | 'mailing';
	// ?tab=zalaczniki itp. (np. link z e-maila do biura o złożonym wniosku) — tylko znane zakładki.
	let activeTab = $state<TabKey>('przeglad');
	$effect(() => {
		const t = $page.url.searchParams.get('tab');
		if (t && untrack(() => (tabs as string[]).includes(t))) untrack(() => (activeTab = t as TabKey));
	});
	const tabs = $derived(
		['przeglad', 'polisy', 'pojazdy', ...(showGwarancje ? ['gwarancje'] : []), 'szkody', 'saldo', 'kontakty', 'apk', 'zalaczniki', 'dziennik', 'zadania', 'emaile', ...(isAuraTenant ? ['mailing'] : [])] as TabKey[]
	);

	// ── Mailing GetResponse (tylko Aura Expert) ───────────────────────────────
	type GrMessage = { id: string; subject: string; sentOn: string | null; openedOn: string | null; opened: boolean; openCount: number };
	type GrResult =
		| { matched: true; contact: { contactId: string; email: string | null; name: string | null }; messages: GrMessage[] }
		| { matched: false; reason: 'no_email' | 'not_found'; email?: string };

	let grLoading = $state(false);
	let grError = $state('');
	let grResult = $state<GrResult | null>(null);
	let grLink = $state<{ gr_email: string | null; ignored: boolean } | null>(null);
	let grEditEmail = $state(false);
	let grEmailInput = $state('');
	let grSaving = $state(false);
	// in-memory cache per client (email -> { at, result }) — krótki cache na żywo
	const grCache = new Map<string, { at: number; result: GrResult }>();
	const GR_CACHE_MS = 5 * 60 * 1000;
	let grLoadedFor = '';

	function fmtDateTime(s: string | null): string {
		if (!s) return '—';
		const d = new Date(s);
		if (isNaN(d.getTime())) return s;
		return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// adres używany do dopasowania w GetResponse: override > email klienta
	const grMatchEmail = $derived((grLink?.gr_email ?? client?.email ?? '').trim());

	async function loadGrLink() {
		if (!clientId) return;
		const { data } = await sb
			.from('crm_getresponse_links')
			.select('gr_email, ignored')
			.eq('klient_id', clientId)
			.maybeSingle();
		grLink = data ?? { gr_email: null, ignored: false };
	}

	async function loadMailing(force = false) {
		if (!isAuraTenant || !clientId) return;
		if (!grLink) await loadGrLink();
		if (grLink?.ignored && !force) { grResult = null; return; }

		const email = grMatchEmail.toLowerCase();
		if (!email) { grResult = { matched: false, reason: 'no_email' }; return; }

		const cached = grCache.get(email);
		if (!force && cached && Date.now() - cached.at < GR_CACHE_MS) {
			grResult = cached.result;
			return;
		}

		grLoading = true;
		grError = '';
		try {
			const { data: { session } } = await sb.auth.getSession();
			const res = await fetch(`${SB_URL}/functions/v1/getresponse-client-activities`, {
				method: 'POST',
				headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			const payload = await res.json();
			if (!res.ok) { grError = payload?.error ?? 'Błąd pobierania danych z GetResponse'; grResult = null; return; }
			grResult = payload as GrResult;
			grCache.set(email, { at: Date.now(), result: grResult });
		} catch (e) {
			grError = e instanceof Error ? e.message : String(e);
			grResult = null;
		} finally {
			grLoading = false;
		}
	}

	async function saveGrEmail() {
		if (!clientId) return;
		grSaving = true;
		try {
			const value = grEmailInput.trim() || null;
			await sb.from('crm_getresponse_links').upsert({
				tenant_id: appState.profile?.tenant_id,
				klient_id: clientId,
				gr_email: value,
				ignored: false,
				updated_at: new Date().toISOString()
			}, { onConflict: 'klient_id' });
			grLink = { gr_email: value, ignored: false };
			grEditEmail = false;
			grCache.clear();
			await loadMailing(true);
		} finally {
			grSaving = false;
		}
	}

	async function ignoreMismatch() {
		if (!clientId) return;
		grSaving = true;
		try {
			await sb.from('crm_getresponse_links').upsert({
				tenant_id: appState.profile?.tenant_id,
				klient_id: clientId,
				gr_email: grLink?.gr_email ?? null,
				ignored: true,
				updated_at: new Date().toISOString()
			}, { onConflict: 'klient_id' });
			grLink = { gr_email: grLink?.gr_email ?? null, ignored: true };
			grResult = null;
		} finally {
			grSaving = false;
		}
	}

	async function undoIgnore() {
		if (!clientId) return;
		grSaving = true;
		try {
			await sb.from('crm_getresponse_links').upsert({
				tenant_id: appState.profile?.tenant_id,
				klient_id: clientId,
				gr_email: grLink?.gr_email ?? null,
				ignored: false,
				updated_at: new Date().toISOString()
			}, { onConflict: 'klient_id' });
			grLink = { gr_email: grLink?.gr_email ?? null, ignored: false };
			await loadMailing(true);
		} finally {
			grSaving = false;
		}
	}

	// ── E-maile wysłane klientowi z CRM (przypomnienia o płatnościach, odnowienia) ──
	type EmailKlienta = {
		id: string; rodzaj: string; adres: string; temat: string; tresc: string | null; wyslano_at: string; polisa_ids: string[]; autor_id?: string | null; zalaczniki?: string[] | null;
		dostawa?: string | null; dostawa_at?: string | null; otwarto_at?: string | null; dostawa_blad?: string | null;
	};
	/** Stan dostawy z webhooka Resend; null — brak danych (starszy e-mail albo webhook nieustawiony). */
	const DOSTAWA: Record<string, { tekst: string; cls: string; problem?: boolean }> = {
		wyslany: { tekst: 'Wysłany', cls: 'bg-surface-2 text-ink-2' },
		opozniony: { tekst: 'Opóźniony', cls: 'bg-warn-soft text-warn' },
		dostarczony: { tekst: 'Dostarczony', cls: 'bg-ok-soft text-ok' },
		otwarty: { tekst: 'Otwarty', cls: 'bg-accent-soft text-accent-text' },
		klikniety: { tekst: 'Otwarty', cls: 'bg-accent-soft text-accent-text' },
		odbity: { tekst: 'Odrzucony', cls: 'bg-danger-soft text-danger', problem: true },
		spam: { tekst: 'Zgłoszony jako spam', cls: 'bg-danger-soft text-danger', problem: true },
		blad: { tekst: 'Błąd wysyłki', cls: 'bg-danger-soft text-danger', problem: true }
	};
	const RODZAJ_EMAILA: Record<string, string> = { przypomnienie_platnosci: 'Przypomnienie o płatności', odnowienie: 'Odnowienie', recznie: 'Wysłany z CRM', inne: 'Inne' };
	const autorEmaila = (e: EmailKlienta) => (e.autor_id ? appState.brokers.find((b) => b.id === e.autor_id)?.imie_nazwisko ?? null : null);

	// „Napisz e-mail” (okno z szablonami); szablon i polisa ustawiane np. z przypomnienia o racie.
	let pisanieEmaila = $state(false);
	let emailSzablon = $state<Szablon>('wlasny');
	let emailPolisa = $state<string | null>(null);
	const adresyEmail = $derived(!!client?.email || clientContacts.some((c) => !!c.email));
	function napiszEmail(szablon: Szablon = 'wlasny', polisaId: string | null = null) {
		emailSzablon = szablon;
		emailPolisa = polisaId;
		pisanieEmaila = true;
	}
	let emaile = $state<EmailKlienta[]>([]);
	let emaileLadowanie = $state(false);
	let emaileBlad = $state('');
	let emaileDla = '';
	let emailOtwarty = $state<string | null>(null);
	const sortEmaile = new Sortowanie<EmailKlienta>({
		data: (e) => e.wyslano_at,
		rodzaj: (e) => RODZAJ_EMAILA[e.rodzaj] ?? e.rodzaj,
		temat: (e) => e.temat,
		adres: (e) => e.adres
	}, { klucz: 'data', kierunek: 'desc' }, 'klient-emaile');
	const emaileWiersze = $derived(sortEmaile.sortuj(emaile));
	const nrPolisy = $derived(new Map(appState.policies.map(p => [p.id, p.nr_polisy])));

	async function wczytajEmaile() {
		const dla = clientId ?? '';
		emaileLadowanie = true; emaileBlad = '';
		const { data, error } = await sb.from('crm_client_emails')
			.select('id, rodzaj, adres, temat, tresc, wyslano_at, polisa_ids, autor_id, zalaczniki, dostawa, dostawa_at, otwarto_at, dostawa_blad')
			.eq('klient_id', dla)
			.order('wyslano_at', { ascending: false })
			.limit(200);
		if (dla !== clientId) return; // w międzyczasie otwarto innego klienta
		emaileLadowanie = false;
		if (error) {
			emaileBlad = error.code === '42P01' || /crm_client_emails/.test(error.message)
				? 'Historia e-maili będzie dostępna po aktualizacji bazy danych.'
				: `Nie udało się wczytać e-maili: ${error.message}`;
			emaile = [];
			return;
		}
		emaile = (data ?? []) as EmailKlienta[];
	}

	$effect(() => {
		// Przegląd też pokazuje wysłane e-maile na osi zdarzeń.
		if ((activeTab === 'emaile' || activeTab === 'przeglad') && clientId && emaileDla !== clientId) {
			emaileDla = clientId;
			emaile = []; emailOtwarty = null;
			wczytajEmaile();
		}
	});

	// lazy-load przy wejściu w zakładkę (oszczędza limity API)
	$effect(() => {
		if (activeTab === 'mailing' && isAuraTenant && clientId && grLoadedFor !== clientId) {
			grLoadedFor = clientId;
			loadMailing();
		}
	});

	// ── Wnioski o odnowienie (program OC beauty): dziennik zdarzeń, pliki, APK z wniosków ──
	// Lista wniosków klienta to jedno zapytanie przy otwarciu karty — z niej liczy się zakładka APK.
	// Dziennik i pliki w magazynie dopiero po wejściu w zakładkę. Pracownik tylko czyta (RLS).
	type WniosekKlienta = Pick<RenewalRow, 'id' | 'tenant_id' | 'polisa_id' | 'status' | 'decyzja' | 'nr_polisy' | 'apk_at' | 'apk_odmowa' | 'zalaczniki' | 'pdf_path' | 'created_at' | 'zlozono_at' | 'wniosek'>;
	// wniosek — osoby wykonujące zabiegi (opis dyplomów i certyfikatów: czyje są).
	const WNIOSKI_KOLUMNY = 'id, tenant_id, polisa_id, status, decyzja, nr_polisy, apk_at, apk_odmowa, zalaczniki, wniosek, pdf_path, created_at, zlozono_at';
	let wnioski = $state<WniosekKlienta[]>([]);
	let wnioskiDla = '';
	let wnioskiNr = 0;
	let wnioskiP: Promise<WniosekKlienta[]> | null = null;

	// Wspólne dla zakładek; force = „Odśwież”. Odpowiedź spóźniona (inny klient, nowsze zapytanie) jest pomijana.
	function wczytajWnioski(force = false): Promise<WniosekKlienta[]> {
		const dla = clientId ?? '';
		if (!force && wnioskiP && wnioskiDla === dla) return wnioskiP;
		if (wnioskiDla !== dla) wnioski = [];
		wnioskiDla = dla;
		const nr = ++wnioskiNr;
		wnioskiP = (async () => {
			const { data, error } = await sb.from('crm_renewals')
				.select(WNIOSKI_KOLUMNY)
				.eq('klient_id', dla)
				.order('created_at', { ascending: false });
			// Przed migracją odnowień (albo przy błędzie) karta działa jak dotąd — bez wniosków.
			const lista = error ? [] : ((data ?? []) as unknown as WniosekKlienta[]);
			if (nr === wnioskiNr && dla === clientId) wnioski = lista;
			return lista;
		})();
		return wnioskiP;
	}

	const wniosekPoId = $derived(new Map(wnioski.map(w => [w.id, w])));
	const nrCertyfikatu = (w: WniosekKlienta) => w.nr_polisy ?? nrPolisy.get(w.polisa_id) ?? 'certyfikat';
	// APK wypełniona albo świadomie odrzucona na stronie wniosku (apk_at = chwila odpowiedzi).
	const apkWnioski = $derived(wnioski.filter(w => !!w.apk_at || w.apk_odmowa));

	// Dziennik zdarzeń wszystkich wniosków klienta, od najnowszych.
	let zdarzenia = $state<RenewalEvent[]>([]);
	let dziennikLadowanie = $state(false);
	let dziennikBlad = $state('');
	let dziennikDla = '';
	let dziennikNr = 0;

	async function wczytajDziennik(force = false) {
		const dla = clientId ?? '';
		const nr = ++dziennikNr;
		dziennikLadowanie = true; dziennikBlad = '';
		const lista = await wczytajWnioski(force);
		if (nr !== dziennikNr || dla !== clientId) return;
		if (!lista.length) { zdarzenia = []; dziennikLadowanie = false; return; }
		const { data, error } = await sb.from('crm_renewal_events')
			.select('*')
			.in('renewal_id', lista.map(w => w.id))
			.order('at', { ascending: false })
			.order('id', { ascending: false })
			.limit(1000);
		if (nr !== dziennikNr || dla !== clientId) return;
		dziennikLadowanie = false;
		if (error) { dziennikBlad = `Nie udało się wczytać dziennika: ${error.message}`; zdarzenia = []; return; }
		zdarzenia = (data ?? []) as RenewalEvent[];
	}

	// Pliki wniosków w magazynie: PDF APK (apk.pdf — starsze wnioski go nie mają) i rozmiary PDF-ów.
	// Klucz: id wniosku → nazwa pliku w folderze <tenant>/<wniosek> → rozmiar w bajtach.
	let plikiWBuckecie = $state<Record<string, Record<string, number | null>>>({});
	let plikiGotowe = $state(false);
	let plikiLadowanie = $state(false);
	let plikiBlad = $state('');
	let plikiDla = '';
	let plikiNr = 0;

	async function wczytajPliki(force = false) {
		const dla = clientId ?? '';
		const nr = ++plikiNr;
		plikiLadowanie = true; plikiBlad = '';
		const lista = await wczytajWnioski(force);
		const wyniki = await Promise.all(lista.map(async (w) => {
			try {
				const { data, error } = await sb.storage.from(BUCKET_ODNOWIEN).list(folderWniosku(w), { limit: 1000 });
				if (error) return [w.id, null] as const;
				const m: Record<string, number | null> = {};
				// Podfoldery wracają bez id — pomijamy.
				for (const f of data ?? []) if (f.id) m[f.name] = typeof f.metadata?.size === 'number' ? f.metadata.size : null;
				return [w.id, m] as const;
			} catch {
				return [w.id, null] as const;
			}
		}));
		if (nr !== plikiNr || dla !== clientId) return;
		plikiWBuckecie = Object.fromEntries(wyniki.map(([id, m]) => [id, m ?? {}]));
		if (wyniki.some(([, m]) => m === null)) plikiBlad = 'Nie udało się sprawdzić plików wszystkich wniosków — PDF APK może nie być widoczny. Odśwież za chwilę.';
		plikiGotowe = true;
		plikiLadowanie = false;
	}

	const maPdfApk = (w: WniosekKlienta) => APK_PDF in (plikiWBuckecie[w.id] ?? {});

	type PlikWniosku = { klucz: string; tytul: string; opis: string; path: string; rozmiar: number | null; at: string | null; zalacznik: boolean };
	function plikiWniosku(w: WniosekKlienta): PlikWniosku[] {
		const folder = folderWniosku(w);
		const wBuckecie = plikiWBuckecie[w.id] ?? {};
		const out: PlikWniosku[] = [];
		if (maPdfApk(w)) {
			out.push({ klucz: 'apk', tytul: 'Analiza potrzeb (APK) — PDF', opis: w.apk_odmowa ? 'świadoma odmowa' : '', path: `${folder}/${APK_PDF}`, rozmiar: wBuckecie[APK_PDF] ?? null, at: w.apk_at, zalacznik: false });
		}
		if (w.pdf_path) {
			const nazwa = w.pdf_path.split('/').pop() ?? '';
			const rozmiar = w.pdf_path.startsWith(`${folder}/`) ? wBuckecie[nazwa] ?? null : null;
			out.push({ klucz: 'wniosek', tytul: 'Wniosek o odnowienie — PDF', opis: '', path: w.pdf_path, rozmiar, at: w.zlozono_at, zalacznik: false });
		}
		// Ankieta Ergo Hestii: osobny PDF do podpisu klienta (tylko wnioski z zabiegami wymagającymi ankiety).
		if (ANKIETA_PDF in wBuckecie) {
			out.push({ klucz: 'ankieta', tytul: 'Ankieta ERGO Hestia — PDF do podpisu', opis: '', path: `${folder}/${ANKIETA_PDF}`, rozmiar: wBuckecie[ANKIETA_PDF] ?? null, at: w.zlozono_at, zalacznik: false });
		}
		for (const z of w.zalaczniki ?? []) {
			// Rodzaj + osoba (+ zabieg przy certyfikacie), jak w panelu polisy i e-mailu do biura.
			out.push({ klucz: z.id, tytul: opisZalacznika(z, w.wniosek?.zmiany?.wykonawcy), opis: z.nazwa, path: z.path, rozmiar: z.rozmiar ?? null, at: z.at ?? null, zalacznik: true });
		}
		return out;
	}
	// Licznik w zakładce dopiero po sprawdzeniu magazynu (PDF APK jest tylko tam).
	const liczbaPlikow = $derived(plikiGotowe ? wnioski.reduce((s, w) => s + plikiWniosku(w).length, 0) : null);

	let plikBlad = $state('');
	async function otworzPlikWniosku(path: string, nazwa: string) {
		plikBlad = '';
		try {
			await openStoredFile(BUCKET_ODNOWIEN, path);
		} catch (e) {
			plikBlad = `Nie udało się otworzyć: ${nazwa}. ${(e as { message?: string })?.message ?? ''}`.trim();
		}
	}

	// Nowy klient na tej samej stronie: czyścimy stan i od razu pytamy o jego wnioski.
	$effect(() => {
		const dla = clientId;
		untrack(() => {
			if (!dla || wnioskiDla === dla) return;
			zdarzenia = []; dziennikBlad = ''; dziennikLadowanie = false; dziennikDla = '';
			plikiWBuckecie = {}; plikiGotowe = false; plikiLadowanie = false; plikiBlad = ''; plikBlad = ''; plikiDla = '';
			wczytajWnioski();
		});
	});

	$effect(() => {
		if (activeTab === 'dziennik' && clientId && dziennikDla !== clientId) {
			dziennikDla = clientId;
			untrack(() => wczytajDziennik());
		}
	});

	// Magazyn sprawdzamy dla zakładki Załączniki albo APK (link do PDF APK przy wnioskach).
	$effect(() => {
		const potrzebne = activeTab === 'zalaczniki' || (activeTab === 'apk' && apkWnioski.length > 0);
		if (potrzebne && clientId && plikiDla !== clientId) {
			plikiDla = clientId;
			untrack(() => wczytajPliki());
		}
	});

	// APK
	let showNewApk = $state(false);
	let savingApk = $state(false);
	let apkErr = $state('');
	let apkAdvisor = $state('');
	let apkMode = $state<'client'|'advisor'>('client');
	let apkToken = $state('');
	let apkCopied = $state(false);
	const apkLink = $derived(apkToken ? apkTokenLink(apkToken) : '');
	let apkLinkPopover = $state<string | null>(null);
	let deletingApk = $state<string | null>(null);

	function genRef() { return 'APK-' + Math.random().toString(36).slice(2,10).toUpperCase(); }

	async function createApk() {
		savingApk = true; apkErr = '';
		const ref = genRef(); const token = newApkToken();
		const { data: form, error: e1 } = await sb.from('apk_forms').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: clientId,
			ref_number: ref,
			client_name: client!.nazwa,
			advisor_name: apkAdvisor || null,
			form_date: todayStr(),
			mode: apkMode,
			status: 'draft',
			form_data: {}
		}]).select('id').single();
		if (e1) { savingApk = false; apkErr = e1.message; return; }
		const expires = new Date(); expires.setDate(expires.getDate() + 30);
		const { error: e2 } = await sb.from('apk_tokens').insert([{
			tenant_id: appState.profile!.tenant_id,
			token, form_id: form!.id,
			advisor_name: apkAdvisor || null,
			status: 'pending', expires_at: expires.toISOString()
		}]);
		if (e2) { savingApk = false; apkErr = e2.message; return; }
		await sb.from('apk_audit').insert([{ form_id: form!.id, event: 'created', actor: apkAdvisor || 'system' }]);
		const { data } = await wczytajFormularzeApk();
		appState.apkForms = (data ?? []) as typeof appState.apkForms;
		savingApk = false; apkToken = token;
	}

	async function copyApkLink() {
		await navigator.clipboard.writeText(apkLink);
		apkCopied = true; setTimeout(() => apkCopied = false, 2000);
	}

	function closeApkModal() {
		showNewApk = false; apkToken = ''; apkErr = '';
		apkAdvisor = appState.profile?.imie_nazwisko ?? ''; apkMode = 'client';
	}

	// Link do skopiowania: token, który jeszcze działa, a w razie braku — pierwszy znany
	// (strona formularza wyjaśni wtedy klientowi, co się stało). Brak tokenu = brak linku.
	function apkFormLink(f: typeof clientApk[0]): string {
		return apkCopyLink(f) ?? '';
	}

	async function deleteApk(id: string) {
		if (!confirm('Na pewno usunąć ten formularz APK? Operacja jest nieodwracalna.')) return;
		deletingApk = id;
		await sb.from('apk_tokens').delete().eq('form_id', id);
		await sb.from('apk_audit').delete().eq('form_id', id);
		await sb.from('apk_forms').delete().eq('id', id);
		const { data } = await wczytajFormularzeApk();
		appState.apkForms = (data ?? []) as typeof appState.apkForms;
		deletingApk = null;
	}

	// Contact persons
	let showContact = $state(false);
	let editingContact = $state<ClientContact | null>(null);
	let ccImie = $state(''); let ccStanowisko = $state('');
	let ccTelefon = $state(''); let ccEmail = $state('');
	let ccNotatki = $state(''); let savingCC = $state(false); let ccError = $state('');

	function openNewContact() { editingContact = null; ccImie = ''; ccStanowisko = ''; ccTelefon = ''; ccEmail = ''; ccNotatki = ''; ccError = ''; showContact = true; }
	function openEditContact(cc: ClientContact) { editingContact = cc; ccImie = cc.imie_nazwisko; ccStanowisko = cc.stanowisko ?? ''; ccTelefon = cc.telefon ?? ''; ccEmail = cc.email ?? ''; ccNotatki = cc.notatki ?? ''; ccError = ''; showContact = true; }

	async function saveContact() {
		if (!ccImie.trim()) { ccError = 'Imię i nazwisko jest wymagane.'; return; }
		savingCC = true; ccError = '';
		const payload = { imie_nazwisko: ccImie.trim(), stanowisko: ccStanowisko.trim() || null, telefon: ccTelefon.trim() || null, email: ccEmail.trim() || null, notatki: ccNotatki.trim() || null };
		let error;
		if (editingContact) {
			({ error } = await sb.from('crm_client_contacts').update(payload).eq('id', editingContact.id));
		} else {
			({ error } = await sb.from('crm_client_contacts').insert([{ tenant_id: appState.profile!.tenant_id, klient_id: clientId, ...payload }]));
		}
		savingCC = false;
		if (error) { ccError = error.message; return; }
		showContact = false;
		const { data } = await wczytajKontakty();
		appState.clientContacts = (data ?? []) as typeof appState.clientContacts;
	}

	async function deleteContact(cc: ClientContact) {
		await sb.from('crm_client_contacts').delete().eq('id', cc.id);
		const { data } = await wczytajKontakty();
		appState.clientContacts = (data ?? []) as typeof appState.clientContacts;
	}

	// Dashboard modals
	let dashModal = $state<'grupowe' | 'skladki' | null>(null);

	// Claim edit
	let editingClaim = $state<Claim | null>(null);
	let claimStatus = $state('');
	let savingClaim = $state(false);
	const CLAIM_STATUSES = ['Zgłoszona', 'W toku', 'Wypłacona', 'Zakończona', 'Odmowa'];

	function openEditClaim(cl: Claim) { editingClaim = cl; claimStatus = cl.status; }

	async function saveClaim() {
		if (!editingClaim) return;
		savingClaim = true;
		await sb.from('crm_claims').update({ status: claimStatus }).eq('id', editingClaim.id);
		savingClaim = false; editingClaim = null;
		const { data } = await wczytajSzkody();
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	// Vehicle modal
	let showVehicle = $state(false);
	let editingVehicle = $state<Vehicle | null>(null);
	let vRej = $state(''); let vMarka = $state('');
	let vVin = $state(''); let vRok = $state('');
	let savingV = $state(false); let vError = $state('');

	function openNewVehicle() { editingVehicle = null; vRej = ''; vMarka = ''; vVin = ''; vRok = ''; vError = ''; showVehicle = true; }
	function openEditVehicle(v: Vehicle) { editingVehicle = v; vRej = v.nr_rejestracyjny; vMarka = v.marka_model; vVin = v.vin ?? ''; vRok = v.rok_produkcji?.toString() ?? ''; vError = ''; showVehicle = true; }

	async function saveVehicle() {
		if (!vRej.trim() || !vMarka.trim()) { vError = 'Nr rejestracyjny i marka są wymagane.'; return; }
		const vinErr = validateVin(vVin, true);
		if (vinErr) { vError = vinErr; return; }
		savingV = true; vError = '';
		const payload = { nr_rejestracyjny: vRej.trim(), marka_model: vMarka.trim(), vin: vVin.trim().toUpperCase(), rok_produkcji: vRok ? parseInt(vRok) : null };
		let error;
		if (editingVehicle) {
			({ error } = await sb.from('crm_vehicles').update(payload).eq('id', editingVehicle.id));
		} else {
			({ error } = await sb.from('crm_vehicles').insert([{ tenant_id: appState.profile!.tenant_id, klient_id: clientId, ...payload }]));
		}
		savingV = false;
		if (error) { vError = error.message; return; }
		showVehicle = false;
		const { data } = await wczytajPojazdy();
		appState.vehicles = (data ?? []) as typeof appState.vehicles;
	}

	// Link vehicle to existing policy
	let linkingVehicleId = $state<string | null>(null);
	let linkPolicyId = $state('');
	let linkingSaving = $state(false);

	async function linkVehicleToPolicy(vehicleId: string) {
		if (!linkPolicyId) return;
		if (linkPolicyId === '__new__') {
			const veh = clientVehicles.find(v => v.id === vehicleId);
			const przedmiot = veh ? veh.nr_rejestracyjny + (veh.vin ? ' / ' + veh.vin : '') : '';
			goto(`/policies/new?klient=${clientId}&rodzaj=komunikacja&przedmiot=${encodeURIComponent(przedmiot)}&pojazd_id=${vehicleId}`);
			return;
		}
		linkingSaving = true;
		await sb.from('crm_policies').update({ pojazd_id: vehicleId }).eq('id', linkPolicyId);
		const { data, error: bladPolis } = await wczytajPolisy();
		if (!bladPolis && data) appState.policies = data as typeof appState.policies;
		linkingSaving = false;
		linkingVehicleId = null;
		linkPolicyId = '';
	}

	// Tasks
	let clientTasks = $state<CrmTask[]>([]);
	let showTaskModal = $state(false);
	let editingTask = $state<CrmTask | null>(null);

	const todayTask = new Date().toISOString().slice(0, 10);

	async function loadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.eq('klient_id', clientId)
			.order('termin', { ascending: true, nullsFirst: false });
		clientTasks = (data ?? []) as CrmTask[];
	}

	loadTasks();

	function openNewTask() {
		editingTask = null;
		showTaskModal = true;
	}

	function openEditTask(t: CrmTask) {
		editingTask = t;
		showTaskModal = true;
	}

	async function toggleTaskStatus(t: CrmTask) {
		const next = t.status === 'zakonczone' ? 'otwarte' : 'zakonczone';
		await sb.from('crm_tasks').update({ status: next }).eq('id', t.id);
		await loadTasks();
	}

	async function deleteTask(t: CrmTask) {
		const ok = await askConfirm({
			title: 'Usunąć zadanie?',
			message: t.tytul,
			detail: 'Zadania nie da się przywrócić z Kosza.',
			confirmLabel: 'Usuń zadanie'
		});
		if (!ok) return;
		await sb.from('crm_tasks').delete().eq('id', t.id);
		await loadTasks();
	}

	function isOverdue(t: CrmTask) {
		return (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < todayTask;
	}

	const priorityDotMap: Record<CrmTask['priorytet'], string> = {
		pilny: 'bg-red-500', wysoki: 'bg-orange-400', normalny: 'bg-blue-400', niski: 'bg-slate-300'
	};

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	// Opiekun klienta
	let editingOpiekun = $state(false);
	let selectedOpiekun = $state(client?.opiekun_id ?? '');
	let savingOpiekun = $state(false);

	const opiekunNazwa = $derived(() => {
		const id = client?.opiekun_id;
		if (!id) return null;
		const p = appState.brokers.find(b => b.id === id);
		return p?.imie_nazwisko ?? p?.email ?? null;
	});

	async function saveOpiekun() {
		savingOpiekun = true;
		await sb.from('crm_clients').update({ opiekun_id: selectedOpiekun || null }).eq('id', clientId);
		await logAudit('clients_owner_assigned', 'client', clientId, client?.nazwa ?? null, { ids: [clientId], opiekun_id: selectedOpiekun || null });
		void wczytajAudyt();
		const { data } = await wczytajKlientow();
		appState.clients = (data ?? []) as typeof appState.clients;
		savingOpiekun = false;
		editingOpiekun = false;
	}

	// ── Pasek podsumowania i zakładka Przegląd ──────────────────────────────────
	const dzis = todayStr();
	const ugBez = $derived(ugBezRozliczania(appState.policies));
	const wlasneIds = $derived(new Set(ownPolicies.map(p => p.id)));
	const polisaPoId = $derived(new Map(appState.policies.map(p => [p.id, p])));
	// Raty polis, których klient jest ubezpieczającym (bez umów generalnych rozliczanych bez rat) — jak w Płatnościach.
	const ratyNieoplacone = $derived(
		appState.payments
			.filter(r => wlasneIds.has(r.polisa_id) && !ugBez.has(r.polisa_id) && !ROZLICZONE.includes(r.status))
			.sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci))
	);
	const ratyPoTerminie = $derived(ratyNieoplacone.filter(r => poTerminie(r, dzis, ugBez)));
	const doZaplaty = $derived(ratyNieoplacone.reduce((s, r) => s + Number(r.kwota ?? 0), 0));
	const polisyZZaleglaRata = $derived(new Set(ratyPoTerminie.map(r => r.polisa_id)));

	const aktywneWlasne = $derived(ownPolicies.filter(p => p.data_do === null || p.data_do >= dzis));
	const skladkaAktywnych = $derived(aktywneWlasne.reduce((s, p) => s + Number(p.skladka_przypisana ?? 0), 0));
	const prowizjaAktywnych = $derived(aktywneWlasne.reduce((s, p) => s + Number(p.prowizja_przypisana ?? 0), 0));
	const najblizszeOdnowienie = $derived(
		aktywneWlasne
			.filter(p => p.data_do && !renewedPolicyIds.has(p.id))
			.sort((a, b) => a.data_do.localeCompare(b.data_do))[0] ?? null
	);
	const rodzajeAktywnych = $derived([...new Set(activePolicies.map(p => nazwaRodzaju(p.rodzaj)).filter(Boolean))].join(', '));
	const blisko = (d: string | null, dni = 14) => !!d && dateDiffDays(dzis, d) <= dni;

	/** Status polisy do chipów (Przegląd i zakładka Polisy) — reguły wspólne z listą Polis. */
	const statusPolisy = (p: Policy) => statusPolisyWspolny(p, { dzis, odnowione: renewedPolicyIds, zZaleglaRata: polisyZZaleglaRata });
	const aktywneNaPrzeglad = $derived(
		[...activePolicies].sort((a, b) => (a.data_do ?? '9999').localeCompare(b.data_do ?? '9999')).slice(0, 5)
	);
	const otwarteZadania = $derived(
		clientTasks
			.filter(t => t.status === 'otwarte' || t.status === 'w_toku')
			.sort((a, b) => (a.termin ?? '9999').localeCompare(b.termin ?? '9999'))
	);
	const opisRaty = (r: { polisa_id: string; nr_raty: number }) => {
		const p = polisaPoId.get(r.polisa_id);
		return `rata ${r.nr_raty}${p?.ilosc_rat && Number(p.ilosc_rat) > 1 ? `/${p.ilosc_rat}` : ''}`;
	};

	// Oś zdarzeń: dane już wczytane (polisy, szkody, zadania, APK, wnioski, e-maile) + dziennik audytu klienta.
	type WpisAudytu = { id: string; action: string; user_name: string | null; user_email: string | null; entity_label: string | null; details: Record<string, unknown> | null; created_at: string };
	let audyt = $state<WpisAudytu[]>([]);
	let audytDla = '';
	async function wczytajAudyt() {
		const dla = clientId ?? '';
		const kolumny = 'id, action, user_name, user_email, entity_label, details, created_at';
		const [a, b] = await Promise.all([
			sb.from('crm_audit_log').select(kolumny).eq('entity_type', 'client').eq('entity_id', dla).order('created_at', { ascending: false }).limit(30),
			// Akcje zbiorcze z listy klientów zapisują identyfikatory w details.ids.
			sb.from('crm_audit_log').select(kolumny).in('action', ['clients_owner_assigned', 'clients_exported']).contains('details', { ids: [dla] }).order('created_at', { ascending: false }).limit(30)
		]);
		if (dla !== clientId) return;
		const wpisy = new Map<string, WpisAudytu>();
		for (const w of [...((a.data ?? []) as unknown as WpisAudytu[]), ...((b.data ?? []) as unknown as WpisAudytu[])]) wpisy.set(w.id, w);
		audyt = [...wpisy.values()];
	}
	$effect(() => {
		if (activeTab === 'przeglad' && clientId && audytDla !== clientId) {
			audytDla = clientId;
			audyt = [];
			untrack(() => wczytajAudyt());
		}
	});

	function opisAudytu(w: WpisAudytu): string | null {
		switch (w.action) {
			case 'client_created': return 'Dodano klienta do CRM';
			case 'client_updated': return 'Zmieniono dane klienta';
			case 'clients_merged': return `Scalono duplikaty klienta${w.entity_label ? ` (${w.entity_label})` : ''}`;
			case 'clients_owner_assigned': {
				const id = w.details?.opiekun_id as string | null | undefined;
				const kto = id ? appState.brokers.find(b => b.id === id) : null;
				return id ? `Opiekun klienta: ${kto?.imie_nazwisko || kto?.email || 'zmieniony'}` : 'Usunięto opiekuna klienta';
			}
			case 'clients_exported': return 'Dane klienta wyeksportowane do CSV';
			default: return null;
		}
	}

	type Zdarzenie = { klucz: string; at: string; tekst: string; kto: string | null; ton: 'danger' | 'accent' | 'neutral'; href?: string };
	const zdarzeniaKlienta = $derived.by(() => {
		const teraz = new Date().toISOString();
		const out: Zdarzenie[] = [];
		const dodaj = (z: Zdarzenie) => { if (z.at && z.at.slice(0, 10) <= teraz.slice(0, 10)) out.push(z); };
		for (const p of clientPolicies) {
			const at = p.data_zawarcia ?? p.created_at ?? p.data_od;
			dodaj({ klucz: `p-${p.id}`, at, tekst: `${p.renewal_of ? 'Odnowiono' : 'Zawarto'} polisę ${p.nr_polisy} · ${nazwaRodzaju(p.rodzaj)}, ${nazwaTu(p)}`, kto: null, ton: 'accent', href: `/policies/${p.id}` });
			if (p.data_do && p.data_do < dzis && !renewedPolicyIds.has(p.id)) {
				dodaj({ klucz: `pk-${p.id}`, at: p.data_do, tekst: `Polisa ${p.nr_polisy} wygasła bez odnowienia`, kto: null, ton: 'neutral', href: `/policies/${p.id}` });
			}
		}
		for (const c of clientClaims) {
			dodaj({ klucz: `s-${c.id}`, at: c.data_szkody, tekst: `Szkoda ${c.nr_szkody ?? '(zgłoszenie)'}${c.opis_szkody ? ` — ${c.opis_szkody}` : ''} · ${c.status}`, kto: null, ton: 'neutral' });
		}
		for (const t of clientTasks) {
			const kto = t.assigned_profile?.imie_nazwisko ?? t.assigned_profile?.email ?? null;
			if (t.created_at) dodaj({ klucz: `t-${t.id}`, at: t.created_at, tekst: `Nowe zadanie: ${t.tytul}`, kto, ton: 'neutral' });
			if (t.zakonczone_at) dodaj({ klucz: `tz-${t.id}`, at: t.zakonczone_at, tekst: `Zakończono zadanie: ${t.tytul}`, kto, ton: 'neutral' });
		}
		for (const f of clientApk) {
			dodaj({ klucz: `a-${f.id}`, at: f.created_at, tekst: `Utworzono formularz APK ${f.ref_number}`, kto: f.advisor_name, ton: 'accent' });
			if (f.submitted_at) dodaj({ klucz: `as-${f.id}`, at: f.submitted_at, tekst: f.client_declined ? `Klient odmówił wypełnienia APK ${f.ref_number}` : `Klient wypełnił APK ${f.ref_number}`, kto: null, ton: 'accent' });
		}
		for (const w of wnioski) {
			dodaj({ klucz: `w-${w.id}`, at: w.created_at, tekst: `Wniosek o odnowienie ${nrCertyfikatu(w)} wysłany klientowi`, kto: null, ton: 'accent', href: `/policies/${w.polisa_id}` });
			if (w.zlozono_at) dodaj({ klucz: `wz-${w.id}`, at: w.zlozono_at, tekst: `Klient złożył wniosek o odnowienie ${nrCertyfikatu(w)}`, kto: null, ton: 'accent', href: `/policies/${w.polisa_id}` });
		}
		for (const e of emaile) {
			{
				const problem = e.dostawa ? DOSTAWA[e.dostawa]?.problem : false;
				dodaj({ klucz: `e-${e.id}`, at: e.wyslano_at, tekst: `E-mail do klienta: ${e.temat}${e.zalaczniki?.length ? ` (załączniki: ${e.zalaczniki.length})` : ''}${problem ? ` — nie doszedł (${DOSTAWA[e.dostawa!].tekst.toLowerCase()})` : ''}`, kto: autorEmaila(e) ?? RODZAJ_EMAILA[e.rodzaj] ?? null, ton: problem ? 'danger' : 'accent' });
			}
		}
		for (const w of audyt) {
			const tekst = opisAudytu(w);
			if (tekst) dodaj({ klucz: `l-${w.id}`, at: w.created_at, tekst, kto: w.user_name ?? w.user_email, ton: 'neutral' });
		}
		return out.sort((a, b) => b.at.localeCompare(a.at));
	});
	let zdarzeniaLimit = $state(8);
	function fmtKiedy(at: string): string {
		if (at.length <= 10) return fmtDzien(at);
		const d = new Date(at);
		if (isNaN(d.getTime())) return fmtDzien(at);
		return `${fmtDzien(at.slice(0, 10))}, ${d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
	}

	let wiecejMenu = $state(false);
	function wyslijApk() {
		apkAdvisor = appState.profile?.imie_nazwisko ?? '';
		showNewApk = true;
	}
</script>

<svelte:head><title>{client?.nazwa ?? 'Klient'} — AuraCRM</title></svelte:head>
<svelte:window onclick={() => (wiecejMenu = false)} />

{#if !client}
	<p class="text-slate-400">Klient nie istnieje lub nie masz dostępu.</p>
{:else}
	{@const nazwa = client.nazwa_skrocona ?? client.nazwa}
	{@const miasto = miastoZAdresu(client.ulica)}
	{@const opiekun = opiekunNazwa()}

	<nav aria-label="Ścieżka" class="flex items-center gap-1.5 text-[13px] text-ink-3 mb-3 min-w-0">
		<a href="/clients" class="text-accent-text hover:underline">Klienci</a>
		<span aria-hidden="true">/</span>
		<span class="truncate">{nazwa}</span>
	</nav>

	<!-- Nagłówek -->
	<div class="flex flex-wrap items-start gap-4 mb-4">
		<span aria-hidden="true" class="hidden sm:flex w-12 h-12 shrink-0 rounded-xl bg-accent-soft text-accent-text font-semibold text-base items-center justify-center">{inicjaly(nazwa)}</span>
		<div class="flex-[1_1_420px] min-w-0 flex flex-col gap-1.5">
			<div>
				<h1 class="text-2xl font-semibold text-ink leading-tight">{nazwa}</h1>
				{#if client.nazwa_skrocona && client.nazwa_skrocona !== client.nazwa}<p class="text-[13px] text-ink-3">{client.nazwa}</p>{/if}
			</div>
			<div class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2">
				{#if client.nip}<span class="font-mono text-xs">NIP {client.nip}</span>{/if}
				{#if client.krs}<span class="font-mono text-xs">KRS {client.krs}</span>{/if}
				{#if client.pesel}<span class="font-mono text-xs">PESEL {client.pesel}</span>{/if}
				<span>{client.typ === 'osoba' ? 'Osoba' : 'Firma'}{miasto ? ` · ${miasto}` : ''}{client.beauty_id != null ? ' · import BEAUTY' : ''}</span>
				{#if client.rodo_zgoda}
					<span class="flex items-center gap-1.5 text-ok font-semibold">
						<ShieldCheck size={14} aria-hidden="true" />
						RODO: zgoda{client.rodo_kanal ? ` ${client.rodo_kanal}` : ''}{client.rodo_data ? ` · ${fmtDzien(client.rodo_data, true)}` : ''}
					</span>
				{:else}
					<a href="/clients/{clientId}/edit" class="flex items-center gap-1.5 text-danger font-semibold hover:underline">
						<ShieldAlert size={14} aria-hidden="true" /> Brak zgody RODO
					</a>
				{/if}
				<span class="flex items-center gap-1.5">
					{#if editingOpiekun}
						<label class="sr-only" for="opiekun-klienta">Opiekun klienta</label>
						<select id="opiekun-klienta" bind:value={selectedOpiekun} class="h-8 border border-line rounded-lg px-2 text-[13px] bg-white">
							<option value="">— bez opiekuna —</option>
							{#each appState.brokers as b}
								<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>
							{/each}
						</select>
						<button onclick={saveOpiekun} disabled={savingOpiekun} class="h-8 px-2.5 text-[13px] font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-60">{savingOpiekun ? 'Zapisywanie…' : 'Zapisz'}</button>
						<button onclick={() => (editingOpiekun = false)} class="h-8 px-2.5 text-[13px] border border-line rounded-lg text-ink-2 hover:bg-surface-2">Anuluj</button>
					{:else}
						<span aria-hidden="true" class="w-[22px] h-[22px] rounded-full bg-surface-2 text-xs font-semibold flex items-center justify-center">{inicjaly(opiekun)}</span>
						Opiekun: {#if opiekun}<span class="text-ink font-medium">{opiekun}</span>{:else}<span class="italic text-ink-3">brak</span>{/if}
						<button onclick={() => { selectedOpiekun = client.opiekun_id ?? ''; editingOpiekun = true; }} class="font-semibold text-accent-text hover:underline">zmień</button>
					{/if}
				</span>
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if client.telefon}
				<a href="tel:{client.telefon}" aria-label="Zadzwoń: {client.telefon}" title="Zadzwoń: {client.telefon}" class="w-9 h-9 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2"><Phone size={16} /></a>
			{/if}
			{#if adresyEmail}
				<button onclick={() => napiszEmail()} aria-label="Napisz e-mail do klienta" title="Napisz e-mail" class="w-9 h-9 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2"><Mail size={16} /></button>
			{/if}
			<button onclick={wyslijApk} class="h-9 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Wyślij APK</button>
			<button onclick={() => goto(`/policies/new?klient=${clientId}`)} class="h-9 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">
				<Plus size={16} /> Nowa polisa
			</button>
			<div class="relative">
				<button
					onclick={(e) => { e.stopPropagation(); wiecejMenu = !wiecejMenu; }}
					aria-label="Więcej akcji"
					aria-expanded={wiecejMenu}
					aria-haspopup="menu"
					class="w-9 h-9 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2"
				><Ellipsis size={16} /></button>
				{#if wiecejMenu}
					<div role="menu" class="absolute right-0 top-full mt-1 w-60 bg-white border border-line rounded-xl shadow-xl z-50 py-1">
						<button role="menuitem" onclick={() => goto(`/clients/${clientId}/edit`)} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Pencil size={15} class="text-ink-3" /> Edytuj dane klienta</button>
						<button role="menuitem" onclick={openPortal} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Link size={15} class="text-ink-3" /> {hasPortal ? 'Panel klienta — dostęp' : 'Nadaj dostęp do panelu klienta'}</button>
						{#if adresyEmail}
							<button role="menuitem" onclick={() => napiszEmail()} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Mail size={15} class="text-ink-3" /> Napisz e-mail</button>
						{/if}
						<div class="my-1 border-t border-line-soft"></div>
						<button role="menuitem" onclick={openNewTask} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><CheckCircle2 size={15} class="text-ink-3" /> Nowe zadanie</button>
						<button role="menuitem" onclick={openNewContact} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><UserPlus size={15} class="text-ink-3" /> Dodaj osobę kontaktową</button>
						<button role="menuitem" onclick={() => goto(`/vehicles/new?klient=${clientId}`)} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Car size={15} class="text-ink-3" /> Dodaj pojazd</button>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Podsumowanie -->
	<section aria-label="Podsumowanie klienta" class="grid grid-cols-2 lg:grid-cols-4 bg-white border border-line rounded-xl overflow-hidden mb-4">
		<button onclick={() => (activeTab = 'polisy')} class="text-left px-4 py-3.5 flex flex-col gap-0.5 border-r border-b lg:border-b-0 border-line-soft hover:bg-bg">
			<span class="text-xs text-ink-3">Aktywne polisy</span>
			<span class="text-xl font-semibold tabular-nums text-ink">{activePolicies.length} <span class="text-[13px] font-normal text-ink-3">z {clientPolicies.length}</span></span>
			<span class="text-xs text-ink-2 truncate">{rodzajeAktywnych || 'brak aktywnych polis'}</span>
		</button>
		<button onclick={() => (dashModal = 'skladki')} class="text-left px-4 py-3.5 flex flex-col gap-0.5 border-b lg:border-b-0 lg:border-r border-line-soft hover:bg-bg" title="Suma składek przypisanych aktywnych polis, w których klient jest ubezpieczającym">
			<span class="text-xs text-ink-3">Składka aktywnych polis</span>
			<span class="text-xl font-semibold tabular-nums text-ink whitespace-nowrap">{fmtPln(skladkaAktywnych)} zł</span>
			<span class="text-xs text-ink-2 tabular-nums">prowizja {fmtPln(prowizjaAktywnych)} zł</span>
		</button>
		<button onclick={() => (activeTab = 'saldo')} class="text-left px-4 py-3.5 flex flex-col gap-0.5 border-r border-line-soft hover:bg-bg">
			<span class="text-xs text-ink-3">Do zapłaty</span>
			<span class="text-xl font-semibold tabular-nums text-ink whitespace-nowrap">{fmtPln(doZaplaty)} zł</span>
			{#if ratyPoTerminie.length > 0}
				<span class="text-xs font-semibold text-danger">{odmiana(ratyPoTerminie.length, 'rata', 'raty', 'rat')} po terminie</span>
			{:else}
				<span class="text-xs text-ink-2">{ratyNieoplacone.length ? odmiana(ratyNieoplacone.length, 'rata oczekująca', 'raty oczekujące', 'rat oczekujących') : 'brak nieopłaconych rat'}</span>
			{/if}
		</button>
		{#if najblizszeOdnowienie}
			<a href="/policies/{najblizszeOdnowienie.id}" class="px-4 py-3.5 flex flex-col gap-0.5 hover:bg-bg">
				<span class="text-xs text-ink-3">Najbliższe odnowienie</span>
				<span class="text-xl font-semibold text-ink whitespace-nowrap">{fmtDzien(najblizszeOdnowienie.data_do)} <span class="text-[13px] {blisko(najblizszeOdnowienie.data_do) ? 'text-warn font-semibold' : 'text-ink-3 font-normal'}">· {fmtTermin(najblizszeOdnowienie.data_do, dzis)}</span></span>
				<span class="text-xs text-ink-2 truncate">{nazwaTu(najblizszeOdnowienie)} · {nazwaRodzaju(najblizszeOdnowienie.rodzaj)}</span>
			</a>
		{:else}
			<div class="px-4 py-3.5 flex flex-col gap-0.5">
				<span class="text-xs text-ink-3">Najbliższe odnowienie</span>
				<span class="text-xl font-semibold text-ink-3">—</span>
				<span class="text-xs text-ink-2">brak polis do odnowienia</span>
			</div>
		{/if}
	</section>

	<!-- Zakładki -->
	<div role="tablist" aria-label="Sekcje klienta" class="flex gap-x-5 border-b border-line mb-4 overflow-x-auto">
		{#each tabs as tab}
			{@const n = tab === 'polisy' ? clientPolicies.length : tab === 'pojazdy' ? clientVehicles.length : tab === 'gwarancje' ? clientGwarancje.length : tab === 'szkody' ? clientClaims.length : tab === 'kontakty' ? clientContacts.length : tab === 'apk' ? clientApk.length + apkWnioski.length : tab === 'zalaczniki' ? liczbaPlikow : tab === 'zadania' ? otwarteZadania.length : null}
			<button
				role="tab"
				aria-selected={activeTab === tab}
				onclick={() => (activeTab = tab)}
				class="h-10 -mb-px shrink-0 border-b-2 whitespace-nowrap text-sm transition-colors
					{activeTab === tab ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 font-medium hover:text-ink'}"
			>
				{tab === 'przeglad' ? 'Przegląd' : tab === 'polisy' ? 'Polisy' : tab === 'pojazdy' ? 'Flota' : tab === 'gwarancje' ? 'Gwarancje' : tab === 'szkody' ? 'Szkody' : tab === 'kontakty' ? 'Kontakty' : tab === 'apk' ? 'APK' : tab === 'zalaczniki' ? 'Załączniki' : tab === 'dziennik' ? 'Dziennik wniosków' : tab === 'zadania' ? 'Zadania' : tab === 'emaile' ? 'E-maile' : tab === 'mailing' ? 'Mailing' : 'Rozliczenia'}
				{#if tab === 'saldo' && ratyPoTerminie.length > 0}
					<span class="ml-0.5 px-1.5 rounded-full bg-danger-soft text-danger text-xs font-semibold leading-5 tabular-nums">{ratyPoTerminie.length}</span>
				{:else if n != null && n > 0}
					<span class="font-normal text-ink-3 tabular-nums">{n}</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if activeTab === 'przeglad'}
		<div class="flex flex-wrap items-start gap-4">
			<div class="flex-[2_1_560px] min-w-0 flex flex-col gap-4">
				<!-- Aktywne polisy -->
				<section aria-labelledby="przeglad-polisy" class="bg-white border border-line rounded-xl overflow-hidden">
					<div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-soft">
						<h2 id="przeglad-polisy" class="text-[15px] font-semibold text-ink">Aktywne polisy</h2>
						{#if hasGrupowe}
							<button onclick={() => (dashModal = 'grupowe')} class="ml-2 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-surface-2 text-xs font-semibold text-ink-2 hover:bg-line-soft"><Users size={12} /> grupowe {grupowePolicies.length}</button>
						{/if}
						<button onclick={() => (activeTab = 'polisy')} class="ml-auto h-7 px-1.5 text-[13px] font-semibold text-accent-text hover:underline">Wszystkie {clientPolicies.length} →</button>
					</div>
					{#if aktywneNaPrzeglad.length === 0}
						<div class="px-4 py-8 text-center">
							<p class="text-sm text-ink-3">Klient nie ma aktywnych polis.</p>
							<a href="/policies/new?klient={clientId}" class="mt-2 inline-block text-[13px] font-semibold text-accent-text hover:underline">Dodaj polisę →</a>
						</div>
					{:else}
						<ul>
							{#each aktywneNaPrzeglad as p (p.id)}
								{@const st = statusPolisy(p)}
								<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-t border-line-soft first:border-t-0">
									<a href="/policies/{p.id}" class="flex-[1_1_220px] min-w-0 group">
										<span class="block font-medium text-ink truncate group-hover:text-accent-text">{nazwaRodzaju(p.rodzaj)} <span class="font-normal text-ink-3">· {nazwaTu(p)}</span></span>
										<span class="block font-mono text-xs text-ink-2 truncate">{p.nr_polisy}</span>
									</a>
									<!-- Telefon: termin, składka i status w jednym wierszu pod nazwą; od sm — osobne kolumny. -->
									<span class="w-full sm:w-auto flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
										<span class="sm:w-[170px] text-[13px] whitespace-nowrap">
											{#if p.data_do}do {fmtDzien(p.data_do)}{#if blisko(p.data_do, 45) && !renewedPolicyIds.has(p.id)}<span class={blisko(p.data_do) ? 'text-warn font-semibold' : 'text-ink-2'}>{` · ${fmtTermin(p.data_do, dzis)}`}</span>{/if}{:else}bezterminowo{/if}
										</span>
										<span class="sm:w-[120px] sm:text-right text-[13px] tabular-nums whitespace-nowrap">{fmtPln(p.skladka_przypisana)} zł</span>
										<span class="ml-auto sm:ml-0 h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {st.cls}">{st.tekst}</span>
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<!-- Oś zdarzeń -->
				<section aria-labelledby="przeglad-os" class="bg-white border border-line rounded-xl px-4 pt-3.5 pb-1.5">
					<h2 id="przeglad-os" class="text-[15px] font-semibold text-ink mb-1">Oś zdarzeń</h2>
					{#if ratyPoTerminie.length > 0 || zdarzeniaKlienta.length > 0}
						<ol>
							{#each ratyPoTerminie.slice(0, 3) as r (r.id)}
								{@const pol = polisaPoId.get(r.polisa_id)}
								<li class="flex gap-3 py-2.5 border-t border-line-soft first:border-t-0">
									<span aria-hidden="true" class="w-2 h-2 mt-1.5 rounded-full shrink-0 bg-danger"></span>
									<span class="flex-1 min-w-0">
										<span class="block text-[13px] text-ink">
											<span class="font-semibold text-danger">Po terminie:</span>
											{opisRaty(r)} polisy <a href="/policies/{r.polisa_id}" class="font-mono text-xs text-accent-text hover:underline">{pol?.nr_polisy ?? '—'}</a> — {fmtPln(r.kwota)} zł, {fmtTermin(r.data_platnosci, dzis)}
										</span>
										<span class="block text-xs text-ink-3">
											System · termin {fmtDzien(r.data_platnosci)}
											{#if adresyEmail}· <button onclick={() => napiszEmail('rata', r.polisa_id)} class="font-semibold text-accent-text hover:underline">Przypomnij e-mailem</button>{/if}
										</span>
									</span>
								</li>
							{/each}
							{#if ratyPoTerminie.length > 3}
								<li class="py-2 border-t border-line-soft">
									<button onclick={() => (activeTab = 'saldo')} class="text-[13px] font-semibold text-accent-text hover:underline">i {odmiana(ratyPoTerminie.length - 3, 'rata', 'raty', 'rat')} więcej po terminie →</button>
								</li>
							{/if}
							{#each zdarzeniaKlienta.slice(0, zdarzeniaLimit) as z (z.klucz)}
								<li class="flex gap-3 py-2.5 border-t border-line-soft first:border-t-0">
									<span aria-hidden="true" class="w-2 h-2 mt-1.5 rounded-full shrink-0 {z.ton === 'danger' ? 'bg-danger' : z.ton === 'accent' ? 'bg-accent' : 'bg-[#9AA3B2]'}"></span>
									<span class="flex-1 min-w-0">
										{#if z.href}
											<a href={z.href} class="block text-[13px] text-ink hover:text-accent-text">{z.tekst}</a>
										{:else}
											<span class="block text-[13px] text-ink">{z.tekst}</span>
										{/if}
										<span class="block text-xs text-ink-3">{z.kto ? `${z.kto} · ` : ''}{fmtKiedy(z.at)}</span>
									</span>
								</li>
							{/each}
						</ol>
						{#if zdarzeniaKlienta.length > zdarzeniaLimit}
							<button onclick={() => (zdarzeniaLimit += 15)} class="mb-2 mt-1 text-[13px] font-semibold text-accent-text hover:underline">Pokaż starsze ({zdarzeniaKlienta.length - zdarzeniaLimit})</button>
						{/if}
					{:else}
						<p class="py-6 text-center text-sm text-ink-3">Brak zdarzeń — pojawią się tu polisy, szkody, zadania, APK i e-maile klienta.</p>
					{/if}
				</section>
			</div>

			<aside class="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
				<!-- Kontakty -->
				<section aria-labelledby="przeglad-kontakty" class="bg-white border border-line rounded-xl px-4 py-3.5">
					<div class="flex items-center mb-2">
						<h2 id="przeglad-kontakty" class="text-[15px] font-semibold text-ink">Kontakty</h2>
						<button onclick={openNewContact} class="ml-auto h-7 px-1.5 text-[13px] font-semibold text-accent-text hover:underline">Dodaj</button>
					</div>
					{#if clientContacts.length === 0}
						<p class="text-[13px] text-ink-3">Brak osób kontaktowych.</p>
					{:else}
						<div class="flex flex-col">
							{#each clientContacts.slice(0, 3) as cc (cc.id)}
								<div class="py-2.5 border-t border-line-soft first:border-t-0 first:pt-0">
									<button onclick={() => openEditContact(cc)} class="block font-medium text-ink text-left hover:text-accent-text">{cc.imie_nazwisko}</button>
									{#if cc.stanowisko || cc.notatki}<span class="block text-xs text-ink-3">{[cc.stanowisko, cc.notatki].filter(Boolean).join(' · ')}</span>{/if}
									{#if cc.telefon || cc.email}
										<span class="flex flex-wrap gap-x-3 text-[13px]">
											{#if cc.telefon}<a href="tel:{cc.telefon}" class="text-accent-text hover:underline">{cc.telefon}</a>{/if}
											{#if cc.email}<a href="mailto:{cc.email}" class="text-accent-text hover:underline break-all">{cc.email}</a>{/if}
										</span>
									{/if}
								</div>
							{/each}
						</div>
						{#if clientContacts.length > 3}
							<button onclick={() => (activeTab = 'kontakty')} class="mt-1 text-[13px] font-semibold text-accent-text hover:underline">Wszystkie {clientContacts.length} →</button>
						{/if}
					{/if}
				</section>

				<!-- Zadania -->
				<section aria-labelledby="przeglad-zadania" class="bg-white border border-line rounded-xl px-4 py-3.5">
					<div class="flex items-center mb-2">
						<h2 id="przeglad-zadania" class="text-[15px] font-semibold text-ink">Zadania</h2>
						<button onclick={openNewTask} class="ml-auto h-7 px-1.5 text-[13px] font-semibold text-accent-text hover:underline">Nowe</button>
					</div>
					{#if otwarteZadania.length === 0}
						<p class="text-[13px] text-ink-3">Brak otwartych zadań.</p>
					{:else}
						<ul class="flex flex-col gap-2.5">
							{#each otwarteZadania.slice(0, 4) as t (t.id)}
								{@const po = isOverdue(t)}
								<li class="flex items-start gap-2.5">
									<input type="checkbox" checked={false} onchange={() => toggleTaskStatus(t)} aria-label="Oznacz jako zakończone: {t.tytul}" class="mt-0.5 w-4 h-4 accent-accent shrink-0 cursor-pointer" />
									<span class="min-w-0">
										<button onclick={() => openEditTask(t)} class="block text-left text-[13px] font-medium text-ink hover:text-accent-text">{t.tytul}</button>
										<span class="block text-xs {po ? 'text-danger font-semibold' : t.termin && blisko(t.termin, 1) ? 'text-warn font-semibold' : 'text-ink-2'}">
											{t.termin ? fmtTermin(t.termin, dzis) : 'bez terminu'}{t.assigned_profile ? ` · ${t.assigned_profile.imie_nazwisko ?? t.assigned_profile.email}` : ''}
										</span>
									</span>
								</li>
							{/each}
						</ul>
						{#if otwarteZadania.length > 4}
							<button onclick={() => (activeTab = 'zadania')} class="mt-2 text-[13px] font-semibold text-accent-text hover:underline">Wszystkie {otwarteZadania.length} →</button>
						{/if}
					{/if}
				</section>

				<!-- Dane klienta -->
				<section aria-labelledby="przeglad-dane" class="bg-white border border-line rounded-xl px-4 py-3.5">
					<div class="flex items-center mb-2">
						<h2 id="przeglad-dane" class="text-[15px] font-semibold text-ink">{client.typ === 'osoba' ? 'Dane osoby' : 'Dane firmy'}</h2>
						<a href="/clients/{clientId}/edit" class="ml-auto h-7 px-1.5 inline-flex items-center text-[13px] font-semibold text-accent-text hover:underline">Edytuj</a>
					</div>
					<dl class="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
						<dt class="text-ink-3">Adres</dt><dd class={client.ulica ? 'text-ink' : 'text-ink-3'}>{client.ulica ?? '—'}</dd>
						<dt class="text-ink-3">Telefon</dt><dd>{#if client.telefon}<a href="tel:{client.telefon}" class="text-accent-text hover:underline">{client.telefon}</a>{:else}<span class="text-ink-3">—</span>{/if}</dd>
						<dt class="text-ink-3">E-mail</dt><dd class="break-all">{#if client.email}<a href="mailto:{client.email}" class="text-accent-text hover:underline">{client.email}</a>{:else}<span class="text-ink-3">—</span>{/if}</dd>
						{#if client.typ !== 'osoba'}
							<dt class="text-ink-3">REGON</dt><dd class="font-mono text-xs leading-[18px] {client.regon ? '' : 'text-ink-3'}">{client.regon ?? '—'}</dd>
						{/if}
						<dt class="text-ink-3">Źródło</dt><dd>{client.beauty_id != null ? 'import BEAUTY' : 'dodany w CRM'}{client.created_at ? ` · ${fmtDzien(client.created_at.slice(0, 10), true)}` : ''}</dd>
						{#if showGwarancje}
							<dt class="text-ink-3">Gwarancje</dt><dd>tak — {odmiana(clientGwarancje.length, 'umowa', 'umowy', 'umów')}</dd>
						{/if}
						<dt class="text-ink-3">Panel klienta</dt>
						<dd>
							{#if hasPortal}
								<button onclick={openPortal} class="font-semibold text-ok hover:underline">aktywny</button>
							{:else}
								<span class="text-ink-3">brak dostępu ·</span> <button onclick={openPortal} class="font-semibold text-accent-text hover:underline">nadaj</button>
							{/if}
						</dd>
					</dl>
				</section>
			</aside>
		</div>

	{:else if activeTab === 'polisy'}
		{@const today = new Date().toISOString().slice(0,10)}
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<table class="w-full min-w-[720px] text-left text-sm">
				<thead>
					<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
						<SortTh wersaliki={false} s={sortAktywne} k="nr" class="px-4 py-2.5">Nr polisy</SortTh>
						<SortTh wersaliki={false} s={sortAktywne} k="tu" class="px-4 py-2.5">TU</SortTh>
						<SortTh wersaliki={false} s={sortAktywne} k="rodzaj" class="px-4 py-2.5">Rodzaj</SortTh>
						<SortTh wersaliki={false} s={sortAktywne} k="od" class="px-4 py-2.5">Od</SortTh>
						<SortTh wersaliki={false} s={sortAktywne} k="do" class="px-4 py-2.5">Do</SortTh>
						<SortTh wersaliki={false} s={sortAktywne} k="skladka" class="px-4 py-2.5 text-right" align="right">Składka</SortTh>
						<SortTh wersaliki={false} s={sortAktywne} k="status" class="px-4 py-2.5">Status</SortTh>
					</tr>
				</thead>
				<tbody>
					{#each aktywneWiersze as p}
						{@const st = statusPolisy(p)}
						{@const daysLeft = p.data_do ? dateDiffDays(today, p.data_do) : 999}
						{@const isRenewed = renewedPolicyIds.has(p.id)}
						{@const canRenew = !isRenewed && daysLeft >= 0 && daysLeft <= 45}
						<tr class="border-t border-line-soft hover:bg-bg text-[13px]">
							<td class="px-4 py-2.5">
								<div class="flex items-center gap-1.5 flex-wrap">
									<a href="/policies/{p.id}" class="font-mono text-xs font-medium text-accent-text hover:underline">{p.nr_polisy}</a>
									{#if p.klient_id !== clientId && p.ubezpieczony_id === clientId}
										<span class="text-xs font-semibold text-violet-700 bg-violet-50 rounded-full px-2 leading-5" title="Klient jest ubezpieczonym; ubezpieczający: {p.crm_clients?.nazwa ?? '—'}">jako ubezpieczony</span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-2.5 whitespace-nowrap" title={p.crm_insurers?.nazwa ?? undefined}>{nazwaTu(p)}</td>
							<td class="px-4 py-2.5">{nazwaRodzaju(p.rodzaj)}</td>
							<td class="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtDzien(p.data_od, true)}</td>
							<td class="px-4 py-2.5 whitespace-nowrap tabular-nums">{p.data_do ? fmtDzien(p.data_do, true) : 'bezterminowo'}</td>
							<td class="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(p.skladka_przypisana)} zł</td>
							<td class="px-4 py-2.5">
								<div class="flex flex-col gap-1 items-start">
									<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {st.cls}">{st.tekst}</span>
									{#if canRenew}
										<!-- Certyfikat OC beauty: karta polisy z otwartym menu odnowienia (wniosek dla klienta);
										     pozostałe polisy — formularz z przeniesionymi danymi. -->
										<a href={wProgramieOcBeauty(p, appState.policies)
												? `/policies/${p.id}?odnow=1`
												: `/policies/new?klient=${p.klient_id}&rodzaj=${encodeURIComponent(p.rodzaj)}&przedmiot=${encodeURIComponent(p.przedmiot ?? '')}&renewal_of=${p.id}${p.pojazd_id ? `&pojazd_id=${p.pojazd_id}` : ''}`}
										   class="inline-flex items-center gap-1 text-xs font-semibold text-accent-text hover:underline">
											<RefreshCw size={12} /> Odnów polisę
										</a>
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="px-4 py-8 text-center text-ink-3">Brak aktywnych polis</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if archivedPolicies.length > 0}
		<div class="mt-4">
			<details class="group">
				<summary class="cursor-pointer text-sm font-semibold text-ink-2 flex items-center gap-2 py-2">
					<span class="group-open:rotate-90 transition-transform">▶</span>
					Archiwum polis ({archivedPolicies.length})
				</summary>
				<div class="mt-2 bg-white border border-line rounded-xl overflow-x-auto">
					<table class="w-full min-w-[720px] text-left text-sm">
						<thead>
							<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
								<SortTh wersaliki={false} s={sortArchiwum} k="nr" class="px-4 py-2.5">Nr polisy</SortTh>
								<SortTh wersaliki={false} s={sortArchiwum} k="tu" class="px-4 py-2.5">TU</SortTh>
								<SortTh wersaliki={false} s={sortArchiwum} k="rodzaj" class="px-4 py-2.5">Rodzaj</SortTh>
								<SortTh wersaliki={false} s={sortArchiwum} k="od" class="px-4 py-2.5">Od</SortTh>
								<SortTh wersaliki={false} s={sortArchiwum} k="do" class="px-4 py-2.5">Do</SortTh>
								<SortTh wersaliki={false} s={sortArchiwum} k="skladka" class="px-4 py-2.5 text-right" align="right">Składka</SortTh>
								<SortTh wersaliki={false} s={sortArchiwum} k="status" class="px-4 py-2.5">Status</SortTh>
							</tr>
						</thead>
						<tbody>
							{#each archiwumWiersze as p}
								{@const st = statusPolisy(p)}
								<tr class="border-t border-line-soft hover:bg-bg text-[13px] text-ink-2">
									<td class="px-4 py-2.5">
										<div class="flex items-center gap-1.5 flex-wrap">
											<a href="/policies/{p.id}" class="font-mono text-xs font-medium text-ink-2 hover:text-accent-text hover:underline">{p.nr_polisy}</a>
											{#if p.klient_id !== clientId && p.ubezpieczony_id === clientId}
												<span class="text-xs font-semibold text-violet-700 bg-violet-50 rounded-full px-2 leading-5" title="Klient jest ubezpieczonym; ubezpieczający: {p.crm_clients?.nazwa ?? '—'}">jako ubezpieczony</span>
											{/if}
										</div>
									</td>
									<td class="px-4 py-2.5 whitespace-nowrap" title={p.crm_insurers?.nazwa ?? undefined}>{nazwaTu(p)}</td>
									<td class="px-4 py-2.5">{nazwaRodzaju(p.rodzaj)}</td>
									<td class="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtDzien(p.data_od, true)}</td>
									<td class="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtDzien(p.data_do, true)}</td>
									<td class="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtPln(p.skladka_przypisana)} zł</td>
									<td class="px-4 py-2.5">
										<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {st.cls}">{st.tekst}</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</div>
		{/if}

	{:else if activeTab === 'pojazdy'}
		<div class="flex justify-end mb-3">
			<button onclick={() => goto(`/vehicles/new?klient=${clientId}`)} class="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
				<Plus size={14} /> Dodaj pojazd
			</button>
		</div>
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<table class="w-full min-w-[720px] text-left text-sm">
				<thead>
					<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
						<th class="px-5 py-3">Nr Rejestracyjny</th>
						<th class="px-5 py-3">Marka / Model</th>
						<th class="px-5 py-3">VIN</th>
						<th class="px-5 py-3">Rok</th>
						<th class="px-5 py-3">Status</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each clientVehicles as v}
						{@const assigned = assignedPolicyFor(v.id, appState.policies)}
						{@const unlinkedPolicies = clientPolicies.filter(p => (p.rodzaj === 'komunikacja' || p.rodzaj === 'flota') && !p.pojazd_id && !p.deleted_at)}
						<tr class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{v.nr_rejestracyjny}</td>
							<td class="px-5 py-3">{v.marka_model}</td>
							<td class="px-5 py-3 text-slate-500">{v.vin ?? '—'}</td>
							<td class="px-5 py-3">{v.rok_produkcji ?? '—'}</td>
							<td class="px-5 py-3">
								{#if assigned}
									<a href="/policies/{assigned.id}" class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5 hover:bg-emerald-100">
										Przypisany: {assigned.nr_polisy}
									</a>
								{:else}
									<span class="text-xs text-slate-400">Wolny</span>
								{/if}
							</td>
							<td class="px-5 py-3">
								<div class="flex items-center gap-2 flex-wrap">
									<button onclick={() => openEditVehicle(v)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
									{#if !assigned}
										{#if linkingVehicleId === v.id}
											<div class="flex items-center gap-1.5">
												<select bind:value={linkPolicyId} class="border border-line rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
													<option value="">— wybierz polisę —</option>
													{#each unlinkedPolicies as p}
														<option value={p.id}>{p.nr_polisy} ({p.rodzaj})</option>
													{/each}
													<option value="__new__">➕ Utwórz nową polisę</option>
												</select>
												<button onclick={() => linkVehicleToPolicy(v.id)} disabled={!linkPolicyId || linkingSaving} class="px-2 py-1 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
													{linkingSaving ? '...' : 'OK'}
												</button>
												<button onclick={() => { linkingVehicleId = null; linkPolicyId = ''; }} class="px-2 py-1 text-xs border border-line rounded-lg text-slate-500 hover:bg-slate-50">✕</button>
											</div>
										{:else}
											<button onclick={() => { linkingVehicleId = v.id; linkPolicyId = ''; }}
												class="text-xs text-blue-600 hover:underline flex items-center gap-1">
												<Link size={11} /> Powiąż z polisą
											</button>
										{/if}
									{/if}
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak pojazdów</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'gwarancje'}
		{@const limitTotal = clientGwarancje.reduce((s, p) => s + Number(p.ug_limit ?? 0), 0)}
		{#if limitTotal > 0}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
			<div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
				<p class="text-xs font-medium text-blue-600 mb-1">Łączny limit gwarancyjny</p>
				<p class="text-xl font-semibold text-blue-700">{fmtPln(limitTotal)} PLN</p>
			</div>
			<div class="bg-white border border-line rounded-xl p-4">
				<p class="text-xs font-medium text-slate-500 mb-1">Liczba gwarancji / umów</p>
				<p class="text-xl font-semibold text-slate-900">{clientGwarancje.length}</p>
			</div>
		</div>
		{/if}
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<table class="w-full min-w-[720px] text-left text-sm">
				<thead>
					<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
						<SortTh wersaliki={false} s={sortGwarancje} k="nr">Nr / Umowa</SortTh>
						<SortTh wersaliki={false} s={sortGwarancje} k="typ">Typ</SortTh>
						<SortTh wersaliki={false} s={sortGwarancje} k="beneficjent">Beneficjent / Kontrakt</SortTh>
						<SortTh wersaliki={false} s={sortGwarancje} k="od">OD</SortTh>
						<SortTh wersaliki={false} s={sortGwarancje} k="do">DO</SortTh>
						<SortTh wersaliki={false} s={sortGwarancje} k="limit" class="px-5 py-3 text-right" align="right">Limit / Suma</SortTh>
					</tr>
				</thead>
				<tbody>
					{#each gwarancjeWiersze as g}
						<tr class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-5 py-3 font-medium text-blue-700"><a href="/policies/{g.id}" class="hover:underline">{g.nr_polisy}</a></td>
							<td class="px-5 py-3 text-slate-600">{g.gwarancja_typ ?? (g.ug_podtyp === 'gwarancje' ? 'Umowa generalna (gwarancje)' : '—')}</td>
							<td class="px-5 py-3 text-xs text-slate-500">{g.gwarancja_beneficjent_nazwa ?? g.gwarancja_kontrakt ?? '—'}</td>
							<td class="px-5 py-3">{g.data_od}</td>
							<td class="px-5 py-3">{g.data_do}</td>
							<td class="px-5 py-3 text-right font-semibold text-slate-800">{g.ug_limit != null ? `${fmtPln(g.ug_limit)} PLN` : '—'}</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-8 text-center text-slate-400">Brak gwarancji. Dodaj umowę generalną gwarancyjną i powiązane gwarancje w module Ubezpieczenia → Umowy Generalne.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'szkody'}
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<table class="w-full min-w-[720px] text-left text-sm">
				<thead>
					<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
						<th class="px-5 py-3">Nr Szkody</th>
						<th class="px-5 py-3">Data</th>
						<th class="px-5 py-3">Z polisy</th>
						<th class="px-5 py-3">Opis</th>
						<th class="px-5 py-3">Status</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each clientClaims as cl}
						<tr class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{cl.nr_szkody ?? 'Zgłoszenie'}</td>
							<td class="px-5 py-3">{cl.data_szkody}</td>
							<td class="px-5 py-3">{cl.crm_policies?.nr_polisy ?? '—'}</td>
							<td class="px-5 py-3 text-xs text-slate-500">{cl.opis_szkody ?? '—'}</td>
							<td class="px-5 py-3">
								{#if editingClaim?.id === cl.id}
									<select bind:value={claimStatus} class="border border-line rounded-lg px-2 py-1 text-xs">
										{#each CLAIM_STATUSES as s}<option>{s}</option>{/each}
									</select>
								{:else}
									<Badge variant={cl.status === 'Wypłacona' || cl.status === 'Zakończona' ? 'success' : cl.status === 'Odmowa' ? 'error' : 'warning'}>{cl.status}</Badge>
								{/if}
							</td>
							<td class="px-5 py-3">
								{#if editingClaim?.id === cl.id}
									<div class="flex gap-1">
										<button onclick={saveClaim} disabled={savingClaim} class="px-2 py-1 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-60">{savingClaim ? '...' : 'Zapisz'}</button>
										<button onclick={() => editingClaim = null} class="px-2 py-1 text-xs border border-line rounded-lg hover:bg-slate-50">Anuluj</button>
									</div>
								{:else}
									<button onclick={() => openEditClaim(cl)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak szkód</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'kontakty'}
		<div class="flex justify-end mb-3">
			<button onclick={openNewContact} class="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
				<UserPlus size={14} /> Dodaj osobę kontaktową
			</button>
		</div>
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<table class="w-full min-w-[720px] text-left text-sm">
				<thead>
					<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
						<th class="px-5 py-3">Imię i Nazwisko</th>
						<th class="px-5 py-3">Stanowisko</th>
						<th class="px-5 py-3">Telefon</th>
						<th class="px-5 py-3">E-mail</th>
						<th class="px-5 py-3">Notatki</th>
						<th class="px-5 py-3"></th>
					</tr>
				</thead>
				<tbody>
					{#each clientContacts as cc}
						<tr class="border-t border-line-soft hover:bg-slate-50">
							<td class="px-5 py-3 font-medium">{cc.imie_nazwisko}</td>
							<td class="px-5 py-3 text-slate-500">{cc.stanowisko ?? '—'}</td>
							<td class="px-5 py-3">{cc.telefon ?? '—'}</td>
							<td class="px-5 py-3">{cc.email ?? '—'}</td>
							<td class="px-5 py-3 text-xs text-slate-400">{cc.notatki ?? ''}</td>
							<td class="px-5 py-3">
								<div class="flex gap-1">
									<button onclick={() => openEditContact(cc)} class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={14} /></button>
									<button onclick={() => deleteContact(cc)} class="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
								</div>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-6 text-center text-slate-400">Brak osób kontaktowych</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

	{:else if activeTab === 'saldo'}
		{@const zaleglosc = totalPrzyp - totalOpl}
		<section aria-label="Saldo składek" class="grid grid-cols-1 sm:grid-cols-3 bg-white border border-line rounded-xl overflow-hidden mb-4">
			<div class="px-4 py-3.5 border-b sm:border-b-0 sm:border-r border-line-soft">
				<p class="text-xs text-ink-3">Składka przypisana</p>
				<p class="text-xl font-semibold tabular-nums text-ink">{fmtPln(totalPrzyp)} zł</p>
				<p class="text-xs text-ink-2">polisy, w których klient jest ubezpieczającym</p>
			</div>
			<div class="px-4 py-3.5 border-b sm:border-b-0 sm:border-r border-line-soft">
				<p class="text-xs text-ink-3">Składka zainkasowana</p>
				<p class="text-xl font-semibold tabular-nums text-ok">{fmtPln(totalOpl)} zł</p>
			</div>
			<div class="px-4 py-3.5">
				<p class="text-xs text-ink-3">Różnica</p>
				<p class="text-xl font-semibold tabular-nums {zaleglosc > 0 ? 'text-danger' : 'text-ink'}">{fmtPln(zaleglosc)} zł</p>
				<p class="text-xs text-ink-2">przypisana minus zainkasowana</p>
			</div>
		</section>

		<section aria-labelledby="raty-klienta" class="bg-white border border-line rounded-xl overflow-hidden">
			<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 border-b border-line-soft">
				<h2 id="raty-klienta" class="text-[15px] font-semibold text-ink">Raty do zapłaty</h2>
				<span class="text-[13px] text-ink-2 tabular-nums">{odmiana(ratyNieoplacone.length, 'rata', 'raty', 'rat')} · {fmtPln(doZaplaty)} zł</span>
				<a href="/payments" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Płatności →</a>
			</div>
			{#if ratyNieoplacone.length === 0}
				<p class="px-4 py-8 text-center text-sm text-ink-3">Wszystkie raty klienta są rozliczone.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[640px] text-[13px] text-left">
						<thead>
							<tr class="bg-surface-2 text-ink-2">
								<th class="px-4 py-2.5 font-semibold">Termin</th>
								<th class="px-4 py-2.5 font-semibold">Polisa</th>
								<th class="px-4 py-2.5 font-semibold">Rata</th>
								<th class="px-4 py-2.5 font-semibold text-right">Kwota</th>
								<th class="px-4 py-2.5 font-semibold">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each ratyNieoplacone as r (r.id)}
								{@const po = poTerminie(r, dzis, ugBez)}
								{@const pol = polisaPoId.get(r.polisa_id)}
								<tr class="border-t border-line-soft">
									<td class="px-4 py-2 whitespace-nowrap">
										<span class="block">{fmtDzien(r.data_platnosci)}</span>
										<span class="block text-xs {po ? 'text-danger font-semibold' : 'text-ink-2'}">{fmtTermin(r.data_platnosci, dzis)}</span>
									</td>
									<td class="px-4 py-2">
										<a href="/policies/{r.polisa_id}" class="font-mono text-xs text-accent-text hover:underline">{pol?.nr_polisy ?? '—'}</a>
										{#if pol}<span class="block text-xs text-ink-3">{nazwaRodzaju(pol.rodzaj)} · {nazwaTu(pol)}</span>{/if}
									</td>
									<td class="px-4 py-2 tabular-nums whitespace-nowrap">{opisRaty(r)}</td>
									<td class="px-4 py-2 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(r.kwota)} zł</td>
									<td class="px-4 py-2">
										<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {po ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-2'}">{po ? 'Po terminie' : 'Oczekująca'}</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

	{:else if activeTab === 'apk'}
		<div class="flex items-center justify-between mb-4">
			<p class="text-sm text-slate-500">Formularze APK dla tego klienta</p>
			<button onclick={() => { apkAdvisor = appState.profile?.imie_nazwisko ?? ''; showNewApk = true; }}
				class="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover">
				<Plus size={14} /> Nowy APK
			</button>
		</div>

		{#if pdfError}
			<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pdfError}</div>
		{/if}

		{#if clientApk.length === 0}
			<div class="bg-white border border-line rounded-xl p-8 text-center text-slate-400">
				<ClipboardList size={28} class="mx-auto mb-2 opacity-30" />
				Brak formularzy APK dla tego klienta
			</div>
		{:else}
			<div class="bg-white border border-line rounded-xl overflow-x-auto">
				<table class="w-full min-w-[720px] text-sm text-left">
					<thead class="bg-slate-50 border-b border-line">
						<tr>
							<th class="px-5 py-3 font-semibold text-slate-600">Ref</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Doradca</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Data</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Status</th>
							<th class="px-5 py-3 font-semibold text-slate-600">Złożony</th>
							<th class="px-5 py-3"></th>
						</tr>
					</thead>
					<tbody>
						{#each clientApk as f}
							<tr class="border-t border-line-soft hover:bg-slate-50">
								<td class="px-5 py-3 font-mono text-xs text-slate-500">{f.ref_number}</td>
								<td class="px-5 py-3 text-slate-600">{f.advisor_name ?? '—'}</td>
								<td class="px-5 py-3 text-slate-500">{f.form_date}</td>
								<td class="px-5 py-3">
									<Badge variant={f.status === 'submitted' ? 'success' : 'neutral'}>
										{f.status === 'submitted' ? 'Złożony' : 'Szkic'}
									</Badge>
								</td>
								<td class="px-5 py-3 text-slate-400 text-xs">{f.submitted_at ? f.submitted_at.slice(0,10) : '—'}</td>
								<td class="px-5 py-3">
									<div class="flex items-center gap-2 flex-wrap">
										{#if apkOpenLink(f)}
											<a href={apkOpenLink(f)} target="_blank" rel="noopener"
												class="text-xs text-blue-600 hover:underline flex items-center gap-1">
												<ClipboardList size={12} /> Otwórz
											</a>
										{/if}
										<button
											onclick={() => apkLinkPopover = apkLinkPopover === f.id ? null : f.id}
											title="Pokaż link dla klienta"
											class="flex items-center gap-1 px-2 py-1 text-xs border border-line rounded-lg text-slate-600 hover:bg-slate-50">
											<Link size={12} /> Link
										</button>
										<button onclick={() => handlePdf(f)} disabled={pdfSaving === f.id}
											class="flex items-center gap-1 px-2 py-1 text-xs border border-line rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
											<Download size={12} /> {pdfSaving === f.id ? '...' : 'PDF'}
										</button>
										{#if f.pdf_url}
											<button onclick={() => openPdf(f)} title="Ostatni zapisany PDF"
												class="text-blue-500 hover:text-blue-700">
												<Download size={12} />
											</button>
										{/if}
										{#if appState.profile?.rola === 'ADMIN GOD'}
											<button onclick={() => deleteApk(f.id)} disabled={deletingApk === f.id}
												class="flex items-center gap-1 px-2 py-1 text-xs border border-red-200 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50">
												<Trash2 size={12} /> {deletingApk === f.id ? '...' : 'Usuń'}
											</button>
										{/if}
									</div>
									{#if apkLinkPopover === f.id}
										{@const link = apkFormLink(f)}
										{#if link}
											<div class="mt-2 flex gap-1.5 items-center">
												<input readonly value={link} class="text-xs font-mono bg-slate-50 border border-line rounded px-2 py-1 flex-1 min-w-0" />
												<button onclick={async () => { await navigator.clipboard.writeText(link); }}
													class="shrink-0 px-2 py-1 text-xs border border-line rounded hover:bg-slate-50 text-slate-600">
													<Copy size={11} />
												</button>
											</div>
										{:else}
											<p class="mt-2 text-xs text-slate-400">Brak linku — ten formularz nie ma tokenu (np. klient odmówił APK albo token nie został utworzony).</p>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if apkWnioski.length}
			<div class="mt-6" data-testid="apk-odnowienia">
				<div class="flex items-center gap-2 mb-2">
					<RefreshCw size={14} class="text-slate-400" />
					<span class="text-sm font-semibold text-slate-700">APK z wniosków o odnowienie</span>
					<span class="text-xs text-slate-400">— program OC beauty, klient odpowiada na stronie wniosku</span>
				</div>
				{#if plikBlad}
					<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{plikBlad}</div>
				{/if}
				<div class="bg-white border border-line rounded-xl overflow-x-auto">
					<table class="w-full min-w-[720px] text-sm text-left">
						<thead class="bg-slate-50 border-b border-line">
							<tr>
								<th class="px-5 py-3 font-semibold text-slate-600">Data</th>
								<th class="px-5 py-3 font-semibold text-slate-600">Certyfikat</th>
								<th class="px-5 py-3 font-semibold text-slate-600">APK</th>
								<th class="px-5 py-3"></th>
							</tr>
						</thead>
						<tbody>
							{#each apkWnioski as w (w.id)}
								<tr class="border-t border-line-soft hover:bg-slate-50">
									<td class="px-5 py-3 text-slate-500 whitespace-nowrap">{fmtDateTime(w.apk_at)}</td>
									<td class="px-5 py-3 font-medium text-slate-800">{nrCertyfikatu(w)}</td>
									<td class="px-5 py-3">
										<Badge variant={w.apk_odmowa ? 'warning' : 'success'}>{w.apk_odmowa ? 'Świadoma odmowa' : 'Wypełniona'}</Badge>
									</td>
									<td class="px-5 py-3">
										<div class="flex items-center justify-end gap-3 flex-wrap">
											{#if maPdfApk(w)}
												<button type="button" onclick={() => otworzPlikWniosku(`${folderWniosku(w)}/${APK_PDF}`, 'PDF APK')}
													class="text-xs text-blue-600 hover:underline flex items-center gap-1">
													<FileText size={12} /> PDF APK
												</button>
											{:else if plikiGotowe}
												<!-- Wniosek sprzed osobnego PDF APK: serwer tworzy PDF z zapisanych odpowiedzi. -->
												<button type="button" onclick={async () => { plikBlad = await otworzPdfApk(w.id); }}
													class="text-xs text-blue-600 hover:underline flex items-center gap-1" title="Wniosek sprzed zapisywania PDF APK — PDF powstanie teraz z zapisanych odpowiedzi">
													<FileText size={12} /> Utwórz PDF APK
												</button>
											{/if}
											<a href="/policies/{w.polisa_id}" class="text-xs text-blue-600 hover:underline">Karta polisy →</a>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{:else if activeTab === 'zalaczniki'}
		<div class="flex items-center justify-between mb-3">
			<p class="text-sm text-slate-500">Pliki z wniosków o odnowienie: PDF APK, PDF wniosku i dokumenty dodane przez klienta</p>
			<button onclick={() => wczytajPliki(true)} disabled={plikiLadowanie}
				class="flex items-center gap-1.5 text-xs text-slate-500 border border-line rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50">
				<RefreshCw size={12} class={plikiLadowanie ? 'animate-spin' : ''} /> Odśwież
			</button>
		</div>
		{#if plikBlad}
			<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{plikBlad}</div>
		{/if}
		{#if plikiBlad}
			<div class="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{plikiBlad}</div>
		{/if}
		{#if !plikiGotowe}
			<div class="bg-white border border-line rounded-xl p-8 text-center text-sm text-slate-400">Wczytywanie…</div>
		{:else if !wnioski.length}
			<div class="bg-white border border-line rounded-xl p-8 text-center text-slate-400">
				<Paperclip size={28} class="mx-auto mb-2 opacity-30" />
				Klient nie ma wniosków o odnowienie — nie ma też plików od niego.
			</div>
		{:else}
			<div class="space-y-4" data-testid="client-renewal-files">
				{#each wnioski as w (w.id)}
					{@const lista = plikiWniosku(w)}
					<div class="bg-white border border-line rounded-xl overflow-x-auto" data-testid="renewal-files-group">
						<div class="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line-soft bg-slate-50">
							<a href="/policies/{w.polisa_id}" class="text-sm font-semibold text-blue-700 hover:underline">{nrCertyfikatu(w)}</a>
							<CrmRenewalBadge status={w.status} decyzja={w.decyzja} />
							<span class="text-xs text-slate-400">{w.zlozono_at ? `złożono ${fmtDateTime(w.zlozono_at)}` : `utworzono ${fmtDateTime(w.created_at)}`}</span>
						</div>
						{#if lista.length}
							<ul class="divide-y divide-line-soft">
								{#each lista as f (f.klucz)}
									<li class="flex items-center gap-3 px-5 py-2.5 text-sm">
										{#if f.zalacznik}
											<Paperclip size={14} class="text-slate-400 shrink-0" />
										{:else}
											<FileText size={14} class="text-slate-400 shrink-0" />
										{/if}
										<div class="min-w-0 flex-1">
											<p class="text-slate-800 truncate">{f.tytul}</p>
											<p class="text-xs text-slate-400 truncate">{[f.opis, rozmiarPliku(f.rozmiar), f.at ? fmtDateTime(f.at) : ''].filter(Boolean).join(' · ')}</p>
										</div>
										<button type="button" onclick={() => otworzPlikWniosku(f.path, f.zalacznik ? f.opis : f.tytul)}
											class="shrink-0 inline-flex items-center gap-1.5 text-xs border border-line rounded-lg px-2.5 py-1.5 text-slate-600 bg-white hover:bg-slate-50">
											<Download size={12} /> Otwórz
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-5 py-3 text-sm text-slate-400">Brak plików do tego wniosku.</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{:else if activeTab === 'dziennik'}
		<div class="bg-white border border-line rounded-xl overflow-x-auto" data-testid="client-renewal-log">
			<div class="flex items-center justify-between px-5 py-3 border-b border-line-soft">
				<div class="flex items-center gap-2">
					<History size={16} class="text-slate-400" />
					<span class="text-sm font-semibold text-slate-700">Dziennik zdarzeń</span>
					<span class="text-xs text-slate-400">— wnioski o odnowienie: wysyłka, otwarcie linku, APK, załączniki, złożenie</span>
				</div>
				<button onclick={() => wczytajDziennik(true)} disabled={dziennikLadowanie}
					class="flex items-center gap-1.5 text-xs text-slate-500 border border-line rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50">
					<RefreshCw size={12} class={dziennikLadowanie ? 'animate-spin' : ''} /> Odśwież
				</button>
			</div>
			{#if dziennikBlad}
				<div class="m-5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{dziennikBlad}</div>
			{:else if dziennikLadowanie && !zdarzenia.length}
				<p class="text-sm text-slate-400 text-center py-8">Wczytywanie…</p>
			{:else if !zdarzenia.length}
				<p class="text-sm text-slate-400 text-center py-8">
					{wnioski.length ? 'Brak zdarzeń w dzienniku wniosków tego klienta.' : 'Klient nie ma wniosków o odnowienie — dziennik jest pusty.'}
				</p>
			{:else}
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
							<th class="px-4 py-2">Kiedy</th>
							<th class="px-4 py-2">Certyfikat</th>
							<th class="px-4 py-2">Zdarzenie</th>
						</tr>
					</thead>
					<tbody>
						{#each zdarzenia as e (e.id)}
							{@const w = wniosekPoId.get(e.renewal_id)}
							{@const przegladarka = opisPrzegladarki(e.user_agent)}
							<tr class="border-t border-line-soft hover:bg-slate-50 align-top">
								<td class="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDateTime(e.at)}</td>
								<td class="px-4 py-2.5 whitespace-nowrap">
									{#if w}
										<a href="/policies/{w.polisa_id}" class="text-blue-700 hover:underline">{nrCertyfikatu(w)}</a>
									{:else}
										<span class="text-slate-400">—</span>
									{/if}
								</td>
								<td class="px-4 py-2.5">
									<p class="text-slate-800">{opisZdarzenia(e)}</p>
									{#if e.ip || przegladarka}
										<p class="text-xs text-slate-400" title={e.user_agent ?? ''}>
											{#if e.ip}IP <span class="font-mono">{e.ip}</span>{/if}{#if e.ip && przegladarka}&nbsp;·&nbsp;{/if}{przegladarka}
										</p>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{:else if activeTab === 'zadania'}
		<div class="flex justify-end mb-3">
			<button onclick={openNewTask} class="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors">
				<Plus size={14} /> Nowe zadanie
			</button>
		</div>
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			{#if clientTasks.length === 0}
				<div class="px-5 py-10 text-center text-slate-400 text-sm">Brak zadań dla tego klienta</div>
			{:else}
				<ul class="divide-y divide-line-soft">
					{#each clientTasks as t}
						{@const done = t.status === 'zakonczone'}
						{@const overdue = isOverdue(t)}
						<li class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 group {done ? 'opacity-60' : ''}">
							<button onclick={() => toggleTaskStatus(t)} class="shrink-0 text-slate-400 hover:text-emerald-600 transition-colors">
								{#if done}
									<CheckCircle2 size={16} class="text-emerald-500" />
								{:else if t.status === 'w_toku'}
									<Clock size={16} class="text-blue-400" />
								{:else}
									<Circle size={16} />
								{/if}
							</button>
							<span class="w-2 h-2 rounded-full shrink-0 {priorityDotMap[t.priorytet]}"></span>
							<div class="flex-1 min-w-0">
								<span class="text-sm font-medium text-slate-900 {done ? 'line-through text-slate-400' : ''}">{t.tytul}</span>
								{#if t.opis}<p class="text-xs text-slate-400 truncate">{t.opis}</p>{/if}
								{#if t.postep_pct !== undefined && t.czas_trwania_dni}
									{@const pct = t.postep_pct ?? 0}
									<div class="flex items-center gap-2 mt-1">
										<div class="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
											<div class="h-full rounded-full bg-blue-500" style="width:{pct}%"></div>
										</div>
										<span class="text-xs text-slate-400">{pct}%</span>
									</div>
								{/if}
							</div>
							{#if t.termin}
								<span class="text-xs shrink-0 {overdue ? 'text-red-500 font-semibold' : 'text-slate-400'}">
									{#if overdue}<AlertCircle size={11} class="inline mr-0.5" />{/if}
									{t.termin}
								</span>
							{/if}
							{#if t.assigned_profile}
								<span class="text-xs text-slate-400 shrink-0">{t.assigned_profile.imie_nazwisko ?? t.assigned_profile.email}</span>
							{/if}
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
								<button onclick={() => openEditTask(t)} class="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"><Pencil size={12} /></button>
								<button onclick={() => deleteTask(t)} class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

	{:else if activeTab === 'emaile'}
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<div class="flex items-center justify-between px-5 py-3 border-b border-line-soft">
				<div class="flex items-center gap-2">
					<Mail size={16} class="text-slate-400" />
					<span class="text-sm font-semibold text-slate-700">E-maile wysłane z CRM</span>
					<span class="text-xs text-slate-400">— przypomnienia, odnowienia i wiadomości wysłane z CRM</span>
				</div>
				<button onclick={wczytajEmaile} disabled={emaileLadowanie}
					class="flex items-center gap-1.5 text-xs text-slate-500 border border-line rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50">
					<RefreshCw size={12} class={emaileLadowanie ? 'animate-spin' : ''} /> Odśwież
				</button>
			</div>
			{#if emaileBlad}
				<div class="m-5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{emaileBlad}</div>
			{:else if emaileLadowanie && !emaile.length}
				<p class="text-sm text-slate-400 text-center py-8">Wczytywanie…</p>
			{:else if !emaile.length}
				<p class="text-sm text-slate-400 text-center py-8">Do tego klienta nie wysłano jeszcze żadnego e-maila z CRM.</p>
			{:else}
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
							<SortTh wersaliki={false} s={sortEmaile} k="data" class="px-4 py-2">Wysłano</SortTh>
							<SortTh wersaliki={false} s={sortEmaile} k="rodzaj" class="px-4 py-2">Rodzaj</SortTh>
							<SortTh wersaliki={false} s={sortEmaile} k="temat" class="px-4 py-2">Temat</SortTh>
							<SortTh wersaliki={false} s={sortEmaile} k="adres" class="px-4 py-2">Do</SortTh>
							<th class="px-4 py-2">Polisy</th>
							<th class="px-4 py-2">Dostawa</th>
						</tr>
					</thead>
					<tbody>
						{#each emaileWiersze as e (e.id)}
							<tr class="border-t border-line-soft hover:bg-slate-50 cursor-pointer"
								onclick={(ev) => { if ((ev.target as Element).closest('a,button')) return; emailOtwarty = emailOtwarty === e.id ? null : e.id; }}>
								<td class="px-4 py-2.5 text-slate-500 whitespace-nowrap"><span class="inline-flex items-center gap-1"><Send size={12} class="text-slate-300" />{fmtDateTime(e.wyslano_at)}</span></td>
								<td class="px-4 py-2.5 text-slate-600">{RODZAJ_EMAILA[e.rodzaj] ?? e.rodzaj}</td>
								<td class="px-4 py-2.5 font-medium text-slate-800">
									<button type="button" class="text-left hover:text-blue-700" aria-expanded={emailOtwarty === e.id}
										onclick={() => (emailOtwarty = emailOtwarty === e.id ? null : e.id)}>{e.temat}</button>
								</td>
								<td class="px-4 py-2.5 text-slate-500">{e.adres}</td>
								<td class="px-4 py-2.5 text-xs">
									{#each e.polisa_ids as pid, i (pid)}{#if i > 0}, {/if}<a href="/policies/{pid}" class="text-blue-700 hover:underline">{nrPolisy.get(pid) ?? 'polisa'}</a>{/each}
								</td>
								<td class="px-4 py-2.5 whitespace-nowrap">
									{#if e.dostawa && DOSTAWA[e.dostawa]}
										<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold {DOSTAWA[e.dostawa].cls}" title={e.dostawa_blad ?? (e.dostawa_at ? fmtDateTime(e.dostawa_at) : undefined)}>{DOSTAWA[e.dostawa].tekst}</span>
									{:else}
										<span class="text-xs text-ink-3" title="Brak informacji od dostawcy — starszy e-mail albo webhook Resend nieustawiony w SAAS Admin">—</span>
									{/if}
								</td>
							</tr>
							{#if emailOtwarty === e.id && e.tresc}
								<tr class="bg-slate-50/70">
									<td colspan="6" class="px-4 py-3">
										{#if e.dostawa && DOSTAWA[e.dostawa]?.problem}
											<p class="mb-2 text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{DOSTAWA[e.dostawa].tekst}{e.dostawa_at ? ` · ${fmtDateTime(e.dostawa_at)}` : ''}{e.dostawa_blad ? ` — ${e.dostawa_blad}` : ''}. Sprawdź adres klienta.</p>
										{:else if e.otwarto_at}
											<p class="mb-2 text-xs text-ink-3">Otwarty po raz pierwszy: {fmtDateTime(e.otwarto_at)}</p>
										{/if}
										{#if autorEmaila(e) || e.zalaczniki?.length}
											<p class="mb-2 text-xs text-ink-3">{autorEmaila(e) ? `Wysłał(a): ${autorEmaila(e)}` : ''}{autorEmaila(e) && e.zalaczniki?.length ? ' · ' : ''}{e.zalaczniki?.length ? `Załączniki: ${e.zalaczniki.join(', ')}` : ''}</p>
										{/if}
										<pre class="whitespace-pre-wrap font-sans text-sm text-slate-700">{e.tresc}</pre>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{:else if activeTab === 'mailing'}
		<div class="bg-white border border-line rounded-xl overflow-x-auto">
			<div class="flex items-center justify-between px-5 py-3 border-b border-line-soft">
				<div class="flex items-center gap-2">
					<Mail size={16} class="text-slate-400" />
					<span class="text-sm font-semibold text-slate-700">Mailing GetResponse</span>
					<span class="text-xs text-slate-400">— informacyjnie, tylko podgląd</span>
				</div>
				<button onclick={() => loadMailing(true)} disabled={grLoading}
					class="flex items-center gap-1.5 text-xs text-slate-500 border border-line rounded-lg px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50">
					<RefreshCw size={12} class={grLoading ? 'animate-spin' : ''} /> Odśwież
				</button>
			</div>

			<div class="p-5">
				{#if grLoading}
					<p class="text-sm text-slate-400 text-center py-6">Pobieranie z GetResponse…</p>
				{:else if grError}
					<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{grError}</div>
				{:else if grLink?.ignored}
					<div class="flex items-center justify-between text-sm bg-slate-50 border border-line rounded-lg px-3 py-2">
						<span class="text-slate-500">Mailing dla tego klienta jest pominięty (ignorowany).</span>
						<button onclick={undoIgnore} disabled={grSaving} class="text-blue-600 hover:underline">Przywróć</button>
					</div>
				{:else if grResult?.matched}
					<div class="flex items-center gap-2 text-xs text-slate-400 mb-3">
						Kontakt GetResponse: <span class="font-medium text-slate-600">{grResult.contact.email}</span>
						{#if grResult.contact.name}<span>· {grResult.contact.name}</span>{/if}
					</div>
					{#if grResult.messages.length === 0}
						<p class="text-sm text-slate-400 text-center py-6">Brak wysłanych wiadomości w ostatnim okresie.</p>
					{:else}
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
									<th class="px-4 py-2">Temat</th>
									<th class="px-4 py-2">Wysłano</th>
									<th class="px-4 py-2">Otwarcie</th>
								</tr>
							</thead>
							<tbody>
								{#each grResult.messages as m}
									<tr class="border-t border-line-soft">
										<td class="px-4 py-2.5 font-medium text-slate-800">{m.subject}</td>
										<td class="px-4 py-2.5 text-slate-500"><span class="inline-flex items-center gap-1"><Send size={12} class="text-slate-300" />{fmtDateTime(m.sentOn)}</span></td>
										<td class="px-4 py-2.5">
											{#if m.opened}
												<span class="inline-flex items-center gap-1 text-emerald-600"><MailCheck size={13} /> {fmtDateTime(m.openedOn)}{#if m.openCount > 1}<span class="text-xs text-slate-400 ml-1">({m.openCount}×)</span>{/if}</span>
											{:else}
												<span class="text-slate-400">nie otwarto</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				{:else if grResult && !grResult.matched}
					<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
						<div class="flex items-start gap-2 text-amber-800">
							<AlertTriangle size={15} class="mt-0.5 shrink-0" />
							<div>
								<p class="font-medium">Dane w CRM różne od GetResponse</p>
								{#if grResult.reason === 'no_email'}
									<p class="text-amber-700 mt-0.5">Ten klient nie ma adresu e-mail w CRM, więc nie można dopasować kontaktu w GetResponse.</p>
								{:else}
									<p class="text-amber-700 mt-0.5">Nie znaleziono kontaktu w GetResponse dla adresu <span class="font-mono">{grResult.email ?? grMatchEmail}</span> (rekord klienta: {client.nazwa}).</p>
								{/if}
							</div>
						</div>
						{#if grEditEmail}
							<div class="flex items-center gap-2 mt-3">
								<input type="email" bind:value={grEmailInput} placeholder="adres e-mail w GetResponse" class="flex-1 border border-line rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
								<button onclick={saveGrEmail} disabled={grSaving} class="px-3 py-1.5 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">Zapisz</button>
								<button onclick={() => grEditEmail = false} class="px-3 py-1.5 text-sm border border-line rounded-lg text-slate-500 hover:bg-slate-50">Anuluj</button>
							</div>
						{:else}
							<div class="flex items-center gap-3 mt-3">
								<button onclick={() => { grEmailInput = grLink?.gr_email ?? client.email ?? ''; grEditEmail = true; }} class="text-sm font-medium text-blue-600 hover:underline">Uzupełnij adres</button>
								<button onclick={ignoreMismatch} disabled={grSaving} class="text-sm text-slate-500 hover:underline">Ignoruj</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<!-- Modal: Osoba kontaktowa -->
<Modal title={editingContact ? 'Edytuj Kontakt' : 'Dodaj Osobę Kontaktową'} open={showContact} onclose={() => { showContact = false; editingContact = null; }}>
	{#snippet footer()}
		<button onclick={() => { showContact = false; editingContact = null; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveContact} disabled={savingCC} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{savingCC ? 'Zapisywanie...' : editingContact ? 'Zapisz zmiany' : 'Dodaj kontakt'}
		</button>
	{/snippet}
	{#if ccError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{ccError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<div class="col-span-2"><label class={labelCls}>Imię i Nazwisko *</label><input bind:value={ccImie} class={inputCls} /></div>
		<div><label class={labelCls}>Stanowisko</label><input bind:value={ccStanowisko} class={inputCls} /></div>
		<div><label class={labelCls}>Telefon</label><input bind:value={ccTelefon} class={inputCls} /></div>
		<div class="col-span-2"><label class={labelCls}>E-mail</label><input type="email" bind:value={ccEmail} class={inputCls} /></div>
		<div class="col-span-2"><label class={labelCls}>Notatki</label><textarea bind:value={ccNotatki} rows="2" class={inputCls}></textarea></div>
	</div>
</Modal>

<!-- Modal: Pojazd -->
<Modal title={editingVehicle ? 'Edytuj Pojazd' : 'Dodaj Pojazd'} open={showVehicle} onclose={() => { showVehicle = false; editingVehicle = null; }}>
	{#snippet footer()}
		<button onclick={() => { showVehicle = false; editingVehicle = null; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveVehicle} disabled={savingV} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
			{savingV ? 'Zapisywanie...' : editingVehicle ? 'Zapisz zmiany' : 'Dodaj pojazd'}
		</button>
	{/snippet}
	{#if vError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{vError}</div>{/if}
	<div class="grid grid-cols-2 gap-3">
		<div><label class={labelCls}>Nr Rejestracyjny *</label><input bind:value={vRej} class={inputCls} /></div>
		<div><label class={labelCls}>Marka i Model *</label><input bind:value={vMarka} class={inputCls} /></div>
		<div><label class={labelCls}>VIN</label><input bind:value={vVin} class={inputCls} /></div>
		<div><label class={labelCls}>Rok Produkcji</label><input type="number" bind:value={vRok} class={inputCls} /></div>
	</div>
</Modal>

<!-- Dashboard Modals -->
<Modal title="Składki klienta" open={dashModal === 'skladki'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-3">
		<div class="grid grid-cols-3 gap-3">
			<div class="bg-slate-50 rounded-xl p-4">
				<p class="text-xs text-slate-500 mb-1">Przypisana</p>
				<p class="text-lg font-bold text-slate-900">{fmtPln(totalPrzyp)}</p>
			</div>
			<div class="bg-emerald-50 rounded-xl p-4">
				<p class="text-xs text-slate-500 mb-1">Zainkasowana</p>
				<p class="text-lg font-bold text-emerald-700">{fmtPln(totalOpl)}</p>
			</div>
			<div class="bg-red-50 rounded-xl p-4">
				<p class="text-xs text-slate-500 mb-1">Zaległość</p>
				<p class="text-lg font-bold text-red-600">{fmtPln(totalPrzyp - totalOpl)}</p>
			</div>
		</div>
		<table class="w-full text-sm">
			<thead><tr class="text-[13px] font-semibold text-ink-2"><SortTh wersaliki={false} s={sortSkladki} k="nr" class="py-2 text-left">Polisa</SortTh><SortTh wersaliki={false} s={sortSkladki} k="skladka" class="py-2 text-right" align="right">Składka</SortTh></tr></thead>
			<tbody>
				{#each skladkiWiersze as p}
					<tr class="border-t border-line-soft">
						<td class="py-2"><a href="/policies/{p.id}" class="text-blue-700 hover:underline">{p.nr_polisy}</a></td>
						<td class="py-2 text-right font-medium">{fmtPln(p.skladka_przypisana)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Modal>

<Modal title="Ubezpieczenia grupowe ({grupowePolicies.length})" open={dashModal === 'grupowe'} onclose={() => dashModal = null}>
	{#snippet footer()}<button onclick={() => dashModal = null} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Zamknij</button>{/snippet}
	<div class="space-y-2">
		{#each grupowePolicies as p}
			{@const st = policyStatus(p.data_do)}
			<div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
				<div>
					<a href="/policies/{p.id}" class="font-medium text-blue-700 hover:underline">{p.nr_polisy}</a>
					<p class="text-xs text-slate-500">{p.rodzaj} · {p.data_od} – {p.data_do}</p>
				</div>
				<div class="text-right">
					<p class="font-medium text-sm">{fmtPln(p.skladka_przypisana)}</p>
					<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
				</div>
			</div>
		{/each}
	</div>
</Modal>

<!-- Okno: e-mail do klienta -->
{#if client}
	<EmailKlienta
		open={pisanieEmaila}
		klient={client}
		polisy={clientPolicies}
		kontakty={clientContacts}
		szablonStartowy={emailSzablon}
		polisaStartowa={emailPolisa}
		onclose={() => (pisanieEmaila = false)}
		onwyslano={() => { emaileDla = clientId ?? ''; void wczytajEmaile(); }}
	/>
{/if}

<!-- Modal: Zadanie -->
<TaskModal
	open={showTaskModal}
	onclose={() => { showTaskModal = false; }}
	onsaved={loadTasks}
	editingTask={editingTask}
	presetKlientId={clientId}
	presetKlientNazwa={client?.nazwa ?? ''}
/>

<!-- Modal: Nowy APK -->
<Modal title="Nowy formularz APK" open={showNewApk} onclose={closeApkModal}>
	{#snippet footer()}
		{#if apkToken}
			<button onclick={closeApkModal} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover">Gotowe</button>
		{:else}
			<button onclick={closeApkModal} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
			<button onclick={createApk} disabled={savingApk} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
				{savingApk ? 'Tworzenie...' : 'Utwórz i wygeneruj link'}
			</button>
		{/if}
	{/snippet}
	{#if apkToken}
		<div class="space-y-4">
			<div class="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
				<Check size={20} class="text-emerald-600 shrink-0" />
				<span class="text-sm text-emerald-700 font-medium">APK utworzone pomyślnie!</span>
			</div>
			<div>
				<label class={labelCls}>Link dla klienta (ważny 30 dni)</label>
				<div class="flex gap-2">
					<input readonly value={apkLink} class="{inputCls} bg-slate-50 font-mono text-xs" />
					<button onclick={copyApkLink}
						class="flex items-center gap-1 px-3 py-2 text-sm border border-line rounded-lg hover:bg-slate-50 shrink-0 {apkCopied ? 'text-emerald-600 border-emerald-300' : 'text-slate-600'}">
						{#if apkCopied}<Check size={14} /> Skopiowano{:else}<Copy size={14} /> Kopiuj{/if}
					</button>
				</div>
				<p class="text-xs text-slate-400 mt-1">Wyślij ten link klientowi — wypełni formularz APK online</p>
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			{#if apkErr}<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{apkErr}</div>{/if}
			<div>
				<label class={labelCls}>Doradca</label>
				<input bind:value={apkAdvisor} class={inputCls} placeholder="Imię i nazwisko doradcy" />
			</div>
			<div>
				<label class={labelCls}>Tryb wypełniania</label>
				<div class="flex gap-2">
					{#each [['client','Klient wypełnia sam'],['advisor','Doradca wypełnia z klientem']] as [val, label]}
						<button type="button" onclick={() => apkMode = val as typeof apkMode}
							class="flex-1 py-2 text-sm rounded-lg border transition-colors
								{apkMode === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-line hover:bg-slate-50'}">
							{label}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</Modal>

<!-- Panel Klienta: dostęp -->
<Modal open={showPortal} title="Dostęp do Panelu Klienta" onclose={() => (showPortal = false)}>
	<div class="space-y-4">
		<p class="text-sm text-slate-500">
			Klient zaloguje się na <span class="font-mono text-slate-700">/portal</span> e-mailem i hasłem i zobaczy swoje polisy, płatności, szkody i pojazdy.
		</p>
		{#if portalError}<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{portalError}</div>{/if}
		{#if portalDone}<div class="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{portalDone}</div>{/if}
		<div>
			<label class={labelCls}>E-mail logowania</label>
			<input bind:value={portalEmail} type="email" class={inputCls} placeholder="klient@example.com" />
		</div>
		<div>
			<label class={labelCls}>{hasPortal ? 'Nowe hasło' : 'Hasło'}</label>
			<div class="flex gap-2">
				<input bind:value={portalPass} class="{inputCls} font-mono" placeholder="min. 8 znaków" />
				<button type="button" onclick={() => (portalPass = genPass())}
					class="flex items-center gap-1 px-3 py-2 text-sm border border-line rounded-lg hover:bg-slate-50 shrink-0 text-slate-600">
					<RefreshCw size={14} /> Losuj
				</button>
			</div>
			<p class="text-xs text-slate-400 mt-1">Przekaż klientowi e-mail i hasło bezpiecznym kanałem.</p>
		</div>
	</div>
	{#snippet footer()}
		{#if hasPortal}
			<button onclick={revokePortalAccess} disabled={portalSaving}
				class="mr-auto flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-semibold disabled:opacity-50">
				<Trash2 size={14} /> Odbierz dostęp
			</button>
		{/if}
		<button onclick={() => (showPortal = false)} class="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Zamknij</button>
		<button onclick={savePortalAccess} disabled={portalSaving}
			class="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-60">
			{portalSaving ? 'Zapisywanie…' : hasPortal ? 'Zmień hasło' : 'Utwórz dostęp'}
		</button>
	{/snippet}
</Modal>
