<script lang="ts">
	import { wczytajAneksy, wczytajPlatnosci, wczytajPodzialProwizji, wczytajPolisy } from '$lib/kolekcje';
	import { tick } from 'svelte';
	import { page } from '$app/stores';
	import { goto, replaceState } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, fmtDzien, fmtTermin, inicjaly, odmiana } from '$lib/utils';
	import Modal from '$lib/components/Modal.svelte';
	import EmailKlienta from '$lib/components/EmailKlienta.svelte';
	import { Pencil, FilePlus2, Users, Trash2, UserRound, RefreshCw, Plus, FileText, ChevronDown, Upload, Mail, Link2, Ellipsis, Building2, Wallet } from 'lucide-svelte';
	import { dateDiffDays, todayStr } from '$lib/utils';
	import { logAudit } from '$lib/utils/audit';
	import type { PolicyAnnex, PolicyBroker, PolicyPayment } from '$lib/types/database';
	import { nazwaRodzaju, nazwaTu, odnowionePolisy, statusPolisy } from '$lib/statusPolisy';
	import { ROZLICZONE, poTerminie, ugBezRozliczania } from '$lib/platnosci';
	import type { Szablon } from '$lib/szablonyEmail';
	import { umowaObowiazujaca, umowyProgramu } from '$lib/policyImport/umowaGeneralna';
	import { Sortowanie } from '$lib/utils/sortowanie.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import CrmRenewalPanel from '$lib/components/renewal/CrmRenewalPanel.svelte';
	import DokumentyPolisy from '$lib/components/DokumentyPolisy.svelte';
	import { wProgramieOcBeauty } from '$lib/components/renewal/crmRenewals';
	import { ADRES_TESTOWY } from '$lib/renewals/staffApi';

	const policyId = $derived($page.params.id);
	const policy = $derived(appState.policies.find(p => p.id === policyId));
	const annexes = $derived(appState.annexes.filter(a => a.polisa_id === policyId));
	const payments = $derived(appState.payments.filter(p => p.polisa_id === policyId));
	const polisaBrokers = $derived(appState.policyBrokers.filter(pb => pb.polisa_id === policyId));
	// Child policies (certyfikaty) for UG
	const childPolicies = $derived(appState.policies.filter(p => p.parent_id === policyId));
	const childSkladka = $derived(childPolicies.reduce((s, p) => s + (p.skladka_przypisana ?? 0), 0));
	const childProwizja = $derived(childPolicies.reduce((s, p) => s + (p.prowizja_przypisana ?? 0), 0));
	// Sortowanie tabeli „Polisy w ramach UG” po kliknięciu w nagłówek
	type PolisaUg = (typeof appState.policies)[number];
	const sortUg = new Sortowanie<PolisaUg>({
		nr: (p) => p.nr_polisy,
		klient: (p) => p.crm_clients?.nazwa,
		od: (p) => p.data_od,
		do: (p) => p.data_do,
		skladka: (p) => Number(p.skladka_przypisana ?? 0),
		prowizja: (p) => Number(p.prowizja_przypisana ?? 0)
	}, { klucz: 'nr' }, 'polisa-ug-polisy');
	const childWiersze = $derived(sortUg.sortuj(childPolicies));

	const ugPodtypLabel: Record<string, string> = {
		flota: 'Flota',
		gwarancje: 'Gwarancje',
		cpm: 'CPM',
		car_ear: 'CAR/EAR',
		beauty_tax: 'BeautyTAX',
		oc_beauty: 'OC Beauty'
	};

	// Policy brokers management
	// Parametry odczytane z pliku polisy — rozwinięte domyślnie, bo to główny
	// powód, dla którego import jest wart zachodu.
	let importOpen = $state(true);

	// Menu odnowienia (ręcznie / z pliku) — zamykane kliknięciem poza nim.
	let renewMenuOpen = $state(false);
	$effect(() => {
		if (!renewMenuOpen) return;
		const close = () => (renewMenuOpen = false);
		window.addEventListener('click', close, { once: true });
	});
	// ?odnow=1 (np. „Odnów polisę” na karcie klienta przy certyfikacie OC beauty): menu otwiera się
	// samo, gdy polisa jest już wczytana i przycisk widoczny — raz na dany adres.
	let renewMenuEl = $state<HTMLDivElement | null>(null);
	let odnowOtwartoDla = '';
	$effect(() => {
		const adres = $page.url.href;
		const el = renewMenuEl;
		if (!el || $page.url.searchParams.get('odnow') !== '1' || odnowOtwartoDla === adres) return;
		odnowOtwartoDla = adres;
		renewMenuOpen = true;
		// Parametr znika z adresu — powrót „Wstecz” albo odświeżenie nie otwiera menu ponownie.
		const bez = new URL($page.url);
		bez.searchParams.delete('odnow');
		replaceState(bez, $page.state);
		tick().then(() => (el.querySelector('[data-renew-menu]') ?? el).scrollIntoView({ block: 'nearest' }));
	});
	let showBrokers = $state(false);
	let pbBrokerId = $state('');
	let pbRola = $state<'akwizycja' | 'obsługa' | 'opiekun'>('akwizycja');
	let pbUdzial = $state('100');
	let savingPB = $state(false);
	let pbError = $state('');

	async function reloadPolicyBrokers() {
		const { data } = await wczytajPodzialProwizji();
		appState.policyBrokers = (data ?? []) as typeof appState.policyBrokers;
	}

	async function addBroker() {
		if (!pbBrokerId) { pbError = 'Wybierz brokera.'; return; }
		savingPB = true; pbError = '';
		const { error } = await sb.from('crm_policy_brokers').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: policyId,
			broker_id: pbBrokerId,
			rola: pbRola,
			udzial_pct: parseFloat(pbUdzial) || 100
		}]);
		savingPB = false;
		if (error) { pbError = error.message; return; }
		pbBrokerId = ''; pbRola = 'akwizycja'; pbUdzial = '100';
		await reloadPolicyBrokers();
	}

	async function removeBroker(pb: PolicyBroker) {
		await sb.from('crm_policy_brokers').delete().eq('id', pb.id);
		await reloadPolicyBrokers();
	}

	const rolaLabel: Record<string, string> = {
		akwizycja: 'Akwizycja',
		obsługa: 'Obsługa',
		opiekun: 'Opiekun'
	};
	const rolaCls: Record<string, string> = {
		akwizycja: 'bg-ok-soft text-ok',
		obsługa: 'bg-accent-soft text-accent-text',
		opiekun: 'bg-surface-2 text-ink-2'
	};

	const today = todayStr();
	const renewalPolicy = $derived(
		policy ? appState.policies.find(q => q.renewal_of === policy!.id && !q.deleted_at) : undefined
	);
	const daysLeft = $derived(policy?.data_do ? dateDiffDays(today, policy.data_do) : 999);
	const canRenew = $derived(!!policy && !renewalPolicy && daysLeft >= 0 && daysLeft <= 45);
	const isPendingRenewal = $derived(!!policy?.renewal_of && policy.data_od > today);
	// Odnowienie polisy z programu idzie pod umowę programu obowiązującą w dniu startu odnowienia
	// (program przedłużany z tym samym numerem ma w CRM kolejną Umowę Generalną). Gdy żadna umowa
	// programu wtedy nie obowiązuje, odnowienie startuje bez UG — broker wybiera ją sam.
	const ugOdnowienia = $derived.by(() => {
		const ug = policy?.parent_id ? appState.policies.find(p => p.id === policy!.parent_id) : null;
		if (!ug || !policy?.data_do) return null;
		const startOdnowienia = dodajDzien(policy.data_do);
		return umowaObowiazujaca(umowyProgramu(appState.policies, ug.nr_polisy), startOdnowienia > today ? startOdnowienia : today);
	});
	function dodajDzien(data: string): string {
		const d = new Date(`${data}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + 1);
		return d.toISOString().slice(0, 10);
	}
	// Certyfikat z programu OC beauty: wniosek o odnowienie wysyłany klientowi (e-mail albo link).
	const wProgramie = $derived(wProgramieOcBeauty(policy, appState.policies));
	const klientEmail = $derived(
		policy ? (appState.clients.find(c => c.id === policy!.klient_id)?.email ?? '').trim() || null : null
	);
	let renewalPanel = $state<ReturnType<typeof CrmRenewalPanel> | null>(null);

	const renewalUrl = $derived(policy
		? `/policies/new?klient=${policy.klient_id}&rodzaj=${encodeURIComponent(policy.rodzaj)}&przedmiot=${encodeURIComponent(policy.przedmiot ?? '')}&renewal_of=${policy.id}${policy.pojazd_id ? `&pojazd_id=${policy.pojazd_id}` : ''}${ugOdnowienia ? `&parent_id=${ugOdnowienia.id}` : ''}`
		: '');

	// UG default commission inline edit
	let ugEditOpen = $state(false);
	let ugEditVal = $state('');
	let ugEditSaving = $state(false);
	let ugEditUpdatedCount = $state(0);
	async function saveUgDefault() {
		ugEditSaving = true;
		const pct = parseFloat(ugEditVal) || null;
		const currentPolicyId = policyId; // capture derived value

		// Save default on UG
		await sb.from('crm_policies').update({ ug_default_prowizja_pct: pct }).eq('id', currentPolicyId);

		// Apply to child policies without commission — query from DB directly
		if (pct) {
			const { data: children } = await sb.from('crm_policies')
				.select('id, skladka_przypisana, prowizja_pct')
				.eq('parent_id', currentPolicyId);

			const toUpdate = (children ?? []).filter(c => !c.prowizja_pct || parseFloat(String(c.prowizja_pct)) === 0);
			ugEditUpdatedCount = toUpdate.length;

			for (const child of toUpdate) {
				const prowizja_przypisana = (Number(child.skladka_przypisana) * pct) / 100;
				await sb.from('crm_policies').update({ prowizja_pct: pct, prowizja_przypisana }).eq('id', child.id);
			}
		} else {
			ugEditUpdatedCount = 0;
		}

		await odswiezPolisy();
		ugEditOpen = false; ugEditSaving = false;
	}

	// Annex modal
	let showAnnex = $state(false);
	let axNr = $state(''); let axTyp = $state<'korekta'|'doubezpieczenie'|'zmiana_zakresu'|'inne'>('korekta');
	let axData = $state(''); let axOpis = $state('');
	let axDeltaSkladka = $state('0'); let axNewDataDo = $state('');
	let axNewSkladka = $state(''); let axNewProwizjaPct = $state('');
	let savingAx = $state(false); let axError = $state('');

	async function saveAnnex() {
		if (!policy) return;
		if (!axNr.trim() || !axData) { axError = 'Podaj nr aneksu i datę.'; return; }
		savingAx = true; axError = '';
		const { error } = await sb.from('crm_policy_annexes').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: policy.id,
			nr_aneksu: axNr.trim(), typ: axTyp, data_aneksu: axData,
			opis: axOpis || null,
			delta_skladka: parseFloat(axDeltaSkladka) || 0,
			delta_prowizja: 0,
			new_data_do: axNewDataDo || null,
			new_skladka_przypisana: axNewSkladka ? parseFloat(axNewSkladka) : null,
			new_prowizja_pct: axNewProwizjaPct ? parseFloat(axNewProwizjaPct) : null
		}]);
		if (!error && axTyp === 'korekta') {
			const updates: Record<string, unknown> = {};
			if (axNewDataDo) updates.data_do = axNewDataDo;
			if (axNewSkladka) updates.skladka_przypisana = parseFloat(axNewSkladka);
			if (axNewProwizjaPct) updates.prowizja_pct = parseFloat(axNewProwizjaPct);
			if (Object.keys(updates).length) await sb.from('crm_policies').update(updates).eq('id', policy.id);
		}
		savingAx = false;
		if (error) { axError = error.message; return; }
		showAnnex = false;
		axNr = ''; axTyp = 'korekta'; axData = ''; axOpis = ''; axDeltaSkladka = '0';
		axNewDataDo = ''; axNewSkladka = ''; axNewProwizjaPct = '';
		const [, rA] = await Promise.all([
			odswiezPolisy(),
			wczytajAneksy()
		]);
		if (!rA.error && rA.data) appState.annexes = rA.data as typeof appState.annexes;
	}

	// --- Delete (soft) ---
	let showDelete = $state(false);
	let deletionReason = $state('');
	let deleting = $state(false);
	let deleteError = $state('');

	async function softDelete() {
		if (!deletionReason.trim()) { deleteError = 'Podaj uzasadnienie usunięcia.'; return; }
		deleting = true; deleteError = '';
		const { error } = await sb.from('crm_policies')
			.update({ deleted_at: new Date().toISOString(), deletion_reason: deletionReason.trim() })
			.eq('id', policyId);
		deleting = false;
		if (error) { deleteError = error.message; return; }
		await logAudit('policy_deleted', 'policy', policyId, policy?.nr_polisy, { reason: deletionReason.trim() });
		// Remove from local state
		appState.policies = appState.policies.filter(p => p.id !== policyId);
		goto('/policies');
	}

	// --- TU Contact ---
	let showContact = $state(false);
	let contactBranchId = $state('');
	let contactPersonId = $state('');
	let savingContact = $state(false);
	let contactError = $state('');

	const tuBranches = $derived(
		appState.insurerBranches.filter(b => b.tu_id === policy?.tu_id)
	);
	const branchContacts = $derived(
		contactBranchId
			? appState.insurerContacts.filter(c => c.branch_id === contactBranchId)
			: appState.insurerContacts.filter(c => c.tu_id === policy?.tu_id && !c.branch_id)
	);

	// Opiekun UG sprzed zmiany — ustalany przy otwarciu okna, żeby ponowna próba po błędzie nadal go znała.
	let poprzedniOpiekunUg = $state<string | null>(null);

	// Odświeżenie listy polis po zmianie; przy błędzie zostaje dotychczasowa lista.
	async function odswiezPolisy() {
		const { data, error } = await wczytajPolisy();
		if (!error && data) appState.policies = data as typeof appState.policies;
	}

	async function saveContact() {
		if (!contactPersonId) { contactError = 'Wybierz osobę.'; return; }
		savingContact = true; contactError = '';
		const poprzedni = poprzedniOpiekunUg;
		const { error } = await sb.from('crm_policies')
			.update({ tu_contact_id: contactPersonId })
			.eq('id', policyId);
		if (!error && policy?.typ_umowy === 'generalna') {
			// Polisy w UG bez opiekuna albo z dotychczasowym opiekunem UG dostają nowego opiekuna z UG.
			const q = sb.from('crm_policies')
				.update({ tu_contact_id: contactPersonId })
				.eq('parent_id', policyId ?? '')
				.eq('tu_id', policy.tu_id)
				.is('deleted_at', null);
			const { error: eDzieci } = poprzedni
				? await q.or(`tu_contact_id.is.null,tu_contact_id.eq.${poprzedni}`)
				: await q.is('tu_contact_id', null);
			if (eDzieci) contactError = `Opiekun UG zapisany, ale nie przepisany na polisy w UG: ${eDzieci.message}`;
		}
		savingContact = false;
		if (error) { contactError = error.message; return; }
		await odswiezPolisy();
		if (contactError) return;
		poprzedniOpiekunUg = contactPersonId;
		showContact = false;
		contactBranchId = ''; contactPersonId = '';
	}

	async function removeContact() {
		await sb.from('crm_policies').update({ tu_contact_id: null }).eq('id', policyId);
		await odswiezPolisy();
	}

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent';
	const labelCls = 'block text-[13px] font-medium text-ink-2 mb-1';
	const btnGlowny = 'h-9 px-4 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-60';
	const btnDrugi = 'h-9 px-4 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2';
	const bladCls = 'mb-3 text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2';

	// Płatności: live sum + edit/add
	const sumaPlatnosci = $derived(payments.reduce((s, p) => s + (p.kwota ?? 0), 0));

	let showEditPayment = $state(false);
	let editingPayment = $state<typeof payments[number] | null>(null);
	let epData = $state(''); let epKwota = $state(''); let epStatus = $state<'Oczekująca'|'Opłacona'|'Zaległa'|'Częściowo opłacona'>('Oczekująca');
	let savingEp = $state(false); let epError = $state('');

	function openEditPayment(pay: typeof payments[number]) {
		editingPayment = pay;
		epData = pay.data_platnosci;
		epKwota = String(pay.kwota);
		epStatus = pay.status;
		epError = '';
		showEditPayment = true;
	}

	async function reloadPayments() {
		const { data, error } = await wczytajPlatnosci();
		if (!error && data) appState.payments = data as typeof appState.payments;
	}

	async function saveEditPayment() {
		if (!editingPayment) return;
		if (!epData || epKwota === '') { epError = 'Podaj datę i kwotę.'; return; }
		savingEp = true; epError = '';
		const { error } = await sb.from('crm_policy_payments')
			.update({ data_platnosci: epData, kwota: parseFloat(epKwota), status: epStatus })
			.eq('id', editingPayment.id);
		savingEp = false;
		if (error) { epError = error.message; return; }
		showEditPayment = false; editingPayment = null;
		await reloadPayments();
	}

	let showAddPayment = $state(false);
	let apData = $state(''); let apKwota = $state(''); let apPowod = $state('');
	let savingAp = $state(false); let apError = $state('');

	function openAddPayment() {
		apData = ''; apKwota = ''; apPowod = ''; apError = '';
		showAddPayment = true;
	}

	async function saveAddPayment() {
		if (!policy) return;
		if (!apData || apKwota === '') { apError = 'Podaj datę i kwotę.'; return; }
		if (!apPowod.trim()) { apError = 'Podaj powód nowej płatności.'; return; }
		savingAp = true; apError = '';
		const nextNr = payments.length > 0 ? Math.max(...payments.map(p => p.nr_raty)) + 1 : 1;
		const { error } = await sb.from('crm_policy_payments').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: policy.id,
			nr_raty: nextNr,
			data_platnosci: apData,
			kwota: parseFloat(apKwota),
			status: 'Oczekująca',
			powod: apPowod.trim()
		}]);
		savingAp = false;
		if (error) { apError = error.message; return; }
		showAddPayment = false;
		await reloadPayments();
	}

	// ── Nagłówek, podsumowanie i sekcje boczne ──────────────────────────────────
	const ugBez = $derived(ugBezRozliczania(appState.policies));
	const odnowione = $derived(odnowionePolisy(appState.policies));
	const raty = $derived([...payments].sort((a, b) => a.nr_raty - b.nr_raty || a.data_platnosci.localeCompare(b.data_platnosci)));
	const ratyOtwarte = $derived(raty.filter((r) => !ROZLICZONE.includes(r.status)));
	const ratyPoTerminie = $derived(ratyOtwarte.filter((r) => poTerminie(r, today, ugBez)));
	const doZaplaty = $derived(ratyOtwarte.reduce((s, r) => s + Number(r.kwota ?? 0), 0));
	/** Status jak na liście Polis i w Panelu 360° (wspólne reguły). */
	const status = $derived(
		policy ? statusPolisy(policy, { dzis: today, odnowione, zZaleglaRata: new Set(ratyPoTerminie.map((r) => r.polisa_id)) }) : null
	);
	const iloscRat = $derived(Number(policy?.ilosc_rat) || 0);
	const opiekun = $derived(polisaBrokers.find((pb) => pb.rola === 'opiekun') ?? null);
	const nazwaOpiekuna = $derived(opiekun ? (opiekun.crm_profiles?.imie_nazwisko ?? opiekun.crm_profiles?.email ?? null) : null);
	const ugNadrzedna = $derived(policy?.parent_id ? (appState.policies.find((p) => p.id === policy!.parent_id) ?? null) : null);
	const poprzednia = $derived(policy?.renewal_of ? (appState.policies.find((p) => p.id === policy!.renewal_of) ?? null) : null);
	const ubezpieczony = $derived(
		policy?.ubezpieczony_id && policy.ubezpieczony_id !== policy.klient_id
			? (appState.clients.find((c) => c.id === policy!.ubezpieczony_id) ?? null)
			: null
	);
	const pojazd = $derived(policy?.pojazd_id ? (appState.vehicles.find((v) => v.id === policy!.pojazd_id) ?? null) : null);
	const kontaktTu = $derived(policy?.tu_contact_id ? (appState.insurerContacts.find((c) => c.id === policy!.tu_contact_id) ?? null) : null);
	/** Przedmiot zapisany jako JSON z sumami (umowy UD) albo zwykły tekst. */
	const przedmiotUd = $derived.by(() => {
		if (!policy?.przedmiot) return null;
		try {
			const p = JSON.parse(policy.przedmiot);
			return p && p.__ud ? (p as { ctn?: number; ctc?: number; si?: number }) : null;
		} catch {
			return null;
		}
	});
	const koniecOchrony = $derived.by(() => {
		if (!policy?.data_do) return { tekst: 'bezterminowo', cls: 'text-ink-2' };
		if (renewalPolicy) return { tekst: 'odnowiona', cls: 'text-ink-2' };
		const n = dateDiffDays(today, policy.data_do);
		if (n < 0) return { tekst: `zakończona ${odmiana(-n, 'dzień', 'dni', 'dni')} temu`, cls: 'text-ink-2' };
		return { tekst: fmtTermin(policy.data_do, today), cls: n <= 30 ? 'text-warn font-semibold' : 'text-ink-2' };
	});

	const TYP_ANEKSU: Record<PolicyAnnex['typ'], string> = {
		korekta: 'Korekta',
		doubezpieczenie: 'Doubezpieczenie',
		zmiana_zakresu: 'Zmiana zakresu',
		inne: 'Inne'
	};

	function chipRaty(r: PolicyPayment): { tekst: string; cls: string } {
		if (r.status === 'Opłacona') return { tekst: 'Opłacona', cls: 'bg-ok-soft text-ok' };
		if (r.status === 'Częściowo opłacona') return { tekst: 'Częściowo opłacona', cls: 'bg-warn-soft text-warn' };
		if (poTerminie(r, today, ugBez)) return { tekst: 'Po terminie', cls: 'bg-danger-soft text-danger' };
		return { tekst: r.status, cls: 'bg-surface-2 text-ink-2' };
	}

	// Menu „Więcej akcji” — zamykane kliknięciem poza nim albo klawiszem Esc.
	let wiecejMenu = $state(false);
	$effect(() => {
		if (!wiecejMenu) return;
		const zamknij = () => (wiecejMenu = false);
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') zamknij(); };
		window.addEventListener('click', zamknij);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('click', zamknij);
			window.removeEventListener('keydown', esc);
		};
	});

	// E-mail do klienta (to samo okno co w Panelu 360°, z tą polisą wybraną na starcie).
	const klient = $derived(policy ? (appState.clients.find((c) => c.id === policy!.klient_id) ?? null) : null);
	const kontaktyKlienta = $derived(policy ? appState.clientContacts.filter((c) => c.klient_id === policy!.klient_id) : []);
	const polisyKlienta = $derived(
		policy ? appState.policies.filter((p) => p.klient_id === policy!.klient_id || p.ubezpieczony_id === policy!.klient_id) : []
	);
	const adresyEmail = $derived(!!klient?.email || kontaktyKlienta.some((c) => !!c.email));
	let pisanieEmaila = $state(false);
	let emailSzablon = $state<Szablon>('wlasny');
	function napiszEmail(s: Szablon = 'wlasny') {
		emailSzablon = s;
		pisanieEmaila = true;
	}

	// Historia polisy z dziennika audytu.
	type WpisHistorii = { id: string; action: string; user_name: string | null; user_email: string | null; details: Record<string, unknown> | null; created_at: string };
	let historia = $state<WpisHistorii[]>([]);
	let historiaLimit = $state(6);
	async function wczytajHistorie(id: string) {
		const { data } = await sb
			.from('crm_audit_log')
			.select('id, action, user_name, user_email, details, created_at')
			.eq('entity_type', 'policy')
			.eq('entity_id', id)
			.order('created_at', { ascending: false })
			.limit(30);
		if (id === policyId) historia = (data ?? []) as WpisHistorii[];
	}
	$effect(() => {
		const id = policyId;
		historia = [];
		historiaLimit = 6;
		if (id) void wczytajHistorie(id);
	});
	function opisHistorii(w: WpisHistorii): string {
		const d = w.details ?? {};
		const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
		switch (w.action) {
			case 'policy_created': return s('zrodlo') ? `Dodano polisę (${s('zrodlo')})` : 'Dodano polisę';
			case 'policy_imported': return s('plik') ? `Zaimportowano z pliku ${s('plik')}` : 'Zaimportowano z pliku PDF';
			case 'policy_commission_changed': {
				const pct = Array.isArray(d.prowizja_pct) ? (d.prowizja_pct as number[]) : null;
				return `Zmieniono prowizję${pct?.length === 2 ? ` z ${pct[0]}% na ${pct[1]}%` : ''}${s('powod') ? ` — ${s('powod')}` : ''}`;
			}
			case 'policy_file_added': return `Dodano dokument: ${s('plik')}`;
			case 'policy_file_deleted': return `Usunięto dokument: ${s('plik')}`;
			case 'policy_deleted': return `Przeniesiono do kosza${s('reason') ? ` — ${s('reason')}` : ''}`;
			case 'policy_restored': return 'Przywrócono z kosza';
			default: return w.action.replace(/_/g, ' ');
		}
	}
	const fmtKiedy = (iso: string) =>
		`${fmtDzien(iso.slice(0, 10), true)}, ${new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
</script>

<svelte:head><title>{policy?.nr_polisy ?? 'Polisa'} — AuraCRM</title></svelte:head>

{#if !policy}
	<div class="bg-white border border-line rounded-xl px-6 py-12 text-center">
		<p class="text-sm text-ink-3">Polisa nie istnieje albo nie masz do niej dostępu.</p>
		<a href="/policies" class="mt-2 inline-block text-[13px] font-semibold text-accent-text hover:underline">← Wróć do listy polis</a>
	</div>
{:else}
	{@const ug = policy.typ_umowy === 'generalna'}
	{@const sumaGw = policy.suma_gwarancyjna != null ? Number(policy.suma_gwarancyjna) : null}
	{@const ugNierozliczana = ugBez.has(policy.id)}

	<nav aria-label="Ścieżka" class="flex items-center gap-1.5 text-[13px] text-ink-3 mb-3 min-w-0">
		<a href="/policies" class="text-accent-text hover:underline">Polisy</a>
		{#if ugNadrzedna}
			<span aria-hidden="true">/</span>
			<a href="/policies/{ugNadrzedna.id}" class="font-mono text-xs text-accent-text hover:underline truncate">{ugNadrzedna.nr_polisy}</a>
		{/if}
		<span aria-hidden="true">/</span>
		<span class="font-mono text-xs truncate">{policy.nr_polisy}</span>
	</nav>

	<!-- Nagłówek -->
	<div class="flex flex-wrap items-start gap-4 mb-4">
		<div class="flex-[1_1_420px] min-w-0 flex flex-col gap-1.5">
			<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
				<h1 class="text-2xl font-semibold text-ink leading-tight break-all">{policy.nr_polisy}</h1>
				{#if status}<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {status.cls}">{status.tekst}</span>{/if}
				{#if ug}<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap bg-accent-soft text-accent-text">Umowa generalna{policy.ug_podtyp ? ` · ${ugPodtypLabel[policy.ug_podtyp] ?? policy.ug_podtyp}` : ''}</span>{/if}
			</div>
			<p class="text-[15px] text-ink-2">{nazwaRodzaju(policy.rodzaj)} · {policy.crm_insurers?.nazwa ?? nazwaTu(policy)}</p>
			<div class="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2">
				<a href="/clients/{policy.klient_id}" class="flex items-center gap-1.5 font-medium text-accent-text hover:underline min-w-0">
					<UserRound size={14} aria-hidden="true" class="shrink-0" /> <span class="truncate">{policy.crm_clients?.nazwa ?? '—'}</span>
				</a>
				{#if ubezpieczony}
					<span>ubezpieczony: <a href="/clients/{ubezpieczony.id}" class="font-medium text-accent-text hover:underline">{ubezpieczony.nazwa_skrocona ?? ubezpieczony.nazwa}</a></span>
				{/if}
				<span class="flex items-center gap-1.5">
					<span aria-hidden="true" class="w-[22px] h-[22px] rounded-full bg-surface-2 text-xs font-semibold flex items-center justify-center">{inicjaly(nazwaOpiekuna)}</span>
					Opiekun: {#if nazwaOpiekuna}<span class="text-ink font-medium">{nazwaOpiekuna}</span>{:else}<span class="italic text-ink-3">brak</span>{/if}
					<button onclick={() => { showBrokers = true; pbError = ''; }} class="font-semibold text-accent-text hover:underline">zmień</button>
				</span>
				{#if renewalPolicy}
					<a href="/policies/{renewalPolicy.id}" class="text-accent-text hover:underline">Odnowiona → <span class="font-mono text-xs">{renewalPolicy.nr_polisy}</span></a>
				{/if}
				{#if poprzednia}
					<a href="/policies/{poprzednia.id}" class="text-accent-text hover:underline">Odnowienie polisy <span class="font-mono text-xs">{poprzednia.nr_polisy}</span></a>
				{/if}
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if adresyEmail}
				<button onclick={() => napiszEmail()} aria-label="Napisz e-mail do klienta" title="Napisz e-mail do klienta" class="w-9 h-9 flex items-center justify-center border border-line rounded-lg bg-white text-ink-2 hover:bg-surface-2"><Mail size={16} /></button>
			{/if}
			{#if !renewalPolicy && !ug}
				<!-- Odnowienie: ręcznie, z pliku polisy albo (program OC beauty) wnioskiem klienta. Wyróżnione, gdy termin blisko. -->
				<div class="relative" bind:this={renewMenuEl}>
					<button
						onclick={(e) => { e.stopPropagation(); renewMenuOpen = !renewMenuOpen; }}
						aria-expanded={renewMenuOpen}
						aria-haspopup="menu"
						class="h-9 flex items-center gap-1.5 pl-2.5 pr-2 rounded-lg text-sm font-semibold transition-colors
							{canRenew ? 'bg-accent text-white hover:bg-accent-hover' : 'border border-line bg-white text-ink hover:bg-surface-2'}"
					>
						<RefreshCw size={15} /> Odnów <ChevronDown size={14} />
					</button>
					{#if renewMenuOpen}
						<div data-renew-menu role="menu" class="absolute right-0 top-full mt-1 bg-white border border-line rounded-xl shadow-xl {wProgramie ? 'w-80' : 'w-72'} max-w-[calc(100vw-2rem)] overflow-hidden z-50 py-1">
							<a role="menuitem" href={renewalUrl} onclick={() => (renewMenuOpen = false)} class="flex items-start gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2">
								<Pencil size={15} class="mt-0.5 shrink-0 text-ink-3" />
								<span>Ręcznie<span class="block text-xs text-ink-3">formularz z przeniesionymi danymi</span></span>
							</a>
							<a role="menuitem" href="/policies/import?renewal_of={policy.id}" onclick={() => (renewMenuOpen = false)} class="flex items-start gap-2.5 px-4 py-2.5 text-sm text-ink hover:bg-surface-2">
								<Upload size={15} class="mt-0.5 shrink-0 text-ink-3" />
								<span>Z pliku polisy<span class="block text-xs text-ink-3">wgraj PDF nowej polisy</span></span>
							</a>
							{#if adresyEmail}
								<button role="menuitem" onclick={() => { renewMenuOpen = false; napiszEmail('odnowienie'); }} class="w-full flex items-start gap-2.5 px-4 py-2.5 text-sm text-left text-ink hover:bg-surface-2">
									<Mail size={15} class="mt-0.5 shrink-0 text-ink-3" />
									<span>E-mail do klienta o odnowieniu<span class="block text-xs text-ink-3">szablon z datą końca ochrony — przed wysyłką możesz go zmienić</span></span>
								</button>
							{/if}
							{#if wProgramie}
								<!-- Program OC beauty: klient sam wypełnia APK i wniosek pod linkiem. -->
								<div class="my-1 border-t border-line-soft"></div>
								<button
									role="menuitem"
									type="button"
									disabled={!klientEmail}
									onclick={() => { renewMenuOpen = false; renewalPanel?.utworz('email'); }}
									class="w-full flex items-start gap-2.5 px-4 py-2.5 text-sm text-left text-ink hover:bg-surface-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white"
								>
									<Mail size={15} class="mt-0.5 shrink-0 text-ink-3" />
									<span class="min-w-0">
										Wyślij klientowi wniosek o odnowienie (e-mail)
										<span class="block text-xs {klientEmail && !appState.tenantFeatures?.odnowienia_test ? 'text-ink-3' : 'text-warn'} break-all">
											{!klientEmail
												? 'Klient nie ma adresu e-mail — uzupełnij go w karcie klienta albo utwórz link'
												: appState.tenantFeatures?.odnowienia_test
													? `TRYB TESTOWY — na adres ${ADRES_TESTOWY}, nie do klienta`
													: `na adres ${klientEmail}`}
										</span>
									</span>
								</button>
								<button role="menuitem" type="button" onclick={() => { renewMenuOpen = false; renewalPanel?.utworz('link'); }} class="w-full flex items-start gap-2.5 px-4 py-2.5 text-sm text-left text-ink hover:bg-surface-2">
									<Link2 size={15} class="mt-0.5 shrink-0 text-ink-3" />
									<span>Utwórz link do wniosku<span class="block text-xs text-ink-3">skopiujesz go i przekażesz klientowi sam</span></span>
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			{#if ug}
				<a href="/policies/new?parent_id={policyId}&klient={policy.klient_id}" class="h-9 flex items-center gap-1.5 pl-2.5 pr-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover">
					<Plus size={16} /> Dodaj polisę do UG
				</a>
			{/if}
			<a href="/policies/{policyId}/edit" class="h-9 flex items-center gap-1.5 px-3 border border-line rounded-lg bg-white text-sm font-medium text-ink hover:bg-surface-2">
				<Pencil size={15} /> Edytuj
			</a>
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
						<button role="menuitem" onclick={() => { showAnnex = true; axError = ''; }} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><FilePlus2 size={15} class="text-ink-3" /> Dodaj aneks</button>
						<button role="menuitem" onclick={openAddPayment} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Wallet size={15} class="text-ink-3" /> Dodaj płatność</button>
						<button role="menuitem" onclick={() => { showBrokers = true; pbError = ''; }} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Users size={15} class="text-ink-3" /> Opiekun i podział prowizji</button>
						<button role="menuitem" onclick={() => { showContact = true; contactBranchId = ''; contactPersonId = ''; contactError = ''; poprzedniOpiekunUg = policy?.tu_contact_id ?? null; }} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Building2 size={15} class="text-ink-3" /> Kontakt w towarzystwie</button>
						{#if adresyEmail}
							<button role="menuitem" onclick={() => napiszEmail()} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-ink hover:bg-surface-2"><Mail size={15} class="text-ink-3" /> Napisz e-mail do klienta</button>
						{/if}
						<div class="my-1 border-t border-line-soft"></div>
						<button role="menuitem" onclick={() => { showDelete = true; deletionReason = ''; deleteError = ''; }} class="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-danger hover:bg-danger-soft"><Trash2 size={15} /> Usuń polisę</button>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Podsumowanie -->
	<section aria-label="Podsumowanie polisy" class="grid grid-cols-2 lg:grid-cols-4 bg-white border border-line rounded-xl overflow-hidden mb-4">
		<div class="px-4 py-3.5 flex flex-col gap-0.5 border-r border-b lg:border-b-0 border-line-soft min-w-0">
			<span class="text-xs text-ink-3">{ug ? 'Składka polis w UG' : 'Składka'}</span>
			<span class="text-xl font-semibold tabular-nums text-ink whitespace-nowrap">{fmtPln(ug ? childSkladka : policy.skladka_przypisana)} zł</span>
			<span class="text-xs text-ink-2 truncate">{ug ? odmiana(childPolicies.length, 'polisa', 'polisy', 'polis') : iloscRat > 1 ? `${iloscRat} raty` : 'jednorazowo'}</span>
		</div>
		<div class="px-4 py-3.5 flex flex-col gap-0.5 border-b lg:border-b-0 lg:border-r border-line-soft min-w-0">
			<span class="text-xs text-ink-3">{ug ? 'Prowizja z polis w UG' : 'Prowizja'}</span>
			<span class="text-xl font-semibold tabular-nums text-ink whitespace-nowrap">{fmtPln(ug ? childProwizja : policy.prowizja_przypisana)} zł</span>
			<span class="text-xs text-ink-2 truncate">
				{#if ug}{policy.ug_default_prowizja_pct != null ? `domyślnie ${policy.ug_default_prowizja_pct}%` : childPolicies.length ? `średnio ${fmtPln(childProwizja / childPolicies.length)} zł na polisę` : 'brak polis'}{:else}{policy.prowizja_pct}% składki{/if}
			</span>
		</div>
		<div class="px-4 py-3.5 flex flex-col gap-0.5 border-r border-line-soft min-w-0">
			<span class="text-xs text-ink-3">Okres ochrony</span>
			<span class="text-xl font-semibold text-ink whitespace-nowrap">{policy.data_do ? `do ${fmtDzien(policy.data_do, true)}` : 'bezterminowo'}</span>
			<span class="text-xs {koniecOchrony.cls}"><span class="font-normal text-ink-2">od {fmtDzien(policy.data_od, true)}</span>{policy.data_do ? ` · ${koniecOchrony.tekst}` : ''}</span>
		</div>
		<div class="px-4 py-3.5 flex flex-col gap-0.5 min-w-0">
			<span class="text-xs text-ink-3">Do zapłaty</span>
			{#if ugNierozliczana}
				<span class="text-xl font-semibold text-ink-3">—</span>
				<span class="text-xs text-ink-2 truncate">składki rozliczane na polisach w UG</span>
			{:else}
				<span class="text-xl font-semibold tabular-nums text-ink whitespace-nowrap">{fmtPln(doZaplaty)} zł</span>
				{#if ratyPoTerminie.length > 0}
					<span class="text-xs font-semibold text-danger truncate">{odmiana(ratyPoTerminie.length, 'rata', 'raty', 'rat')} po terminie</span>
				{:else}
					<span class="text-xs text-ink-2 truncate">{ratyOtwarte.length ? odmiana(ratyOtwarte.length, 'rata oczekująca', 'raty oczekujące', 'rat oczekujących') : raty.length ? 'wszystkie raty opłacone' : 'brak rat'}</span>
				{/if}
			{/if}
		</div>
	</section>

	<div class="flex flex-wrap items-start gap-4">
		<div class="flex-[2_1_560px] min-w-0 flex flex-col gap-4">
			<!-- Wniosek o odnowienie (program OC beauty) -->
			{#if wProgramie}
				<CrmRenewalPanel bind:this={renewalPanel} {policy} email={klientEmail} odnowiona={!!renewalPolicy} />
			{/if}

			<!-- Płatności -->
			{#if !(ug && raty.length === 0)}
			<section aria-labelledby="raty-polisy" class="bg-white border border-line rounded-xl overflow-hidden">
				<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 border-b border-line-soft">
					<h2 id="raty-polisy" class="text-[15px] font-semibold text-ink">Płatności</h2>
					<span class="text-[13px] text-ink-2 tabular-nums">{odmiana(raty.length, 'rata', 'raty', 'rat')} · {fmtPln(sumaPlatnosci)} zł</span>
					{#if ugNierozliczana}<span class="text-xs text-ink-3">informacyjnie — UG bez rozliczania płatności</span>{/if}
					<button onclick={openAddPayment} class="ml-auto h-7 flex items-center gap-1 px-1.5 text-[13px] font-semibold text-accent-text hover:underline"><Plus size={14} /> Dodaj płatność</button>
				</div>
				{#if raty.length === 0}
					<p class="px-4 py-8 text-center text-sm text-ink-3">Brak płatności.</p>
				{:else}
					<ul>
						{#each raty as r (r.id)}
							{@const chip = chipRaty(r)}
							{@const otwarta = !ROZLICZONE.includes(r.status)}
							{@const po = poTerminie(r, today, ugBez)}
							<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-t border-line-soft first:border-t-0">
								<span class="w-[76px] shrink-0 text-[13px] font-medium text-ink tabular-nums">Rata {r.nr_raty}{iloscRat > 1 ? `/${iloscRat}` : ''}</span>
								<span class="flex-[1_1_160px] min-w-0 text-[13px]">
									<span class="block text-ink">{fmtDzien(r.data_platnosci, true)}</span>
									{#if otwarta}
										<span class="block text-xs {po ? 'text-danger font-semibold' : 'text-ink-3'}">{fmtTermin(r.data_platnosci, today)}</span>
									{:else if r.data_oplacenia}
										<span class="block text-xs text-ink-3">opłacona {fmtDzien(r.data_oplacenia, true)}</span>
									{/if}
									{#if r.powod}<span class="block text-xs text-ink-3">{r.powod}</span>{/if}
									{#if r.prowizja_z_noty != null}<span class="block text-xs text-ink-3">prowizja z noty {fmtPln(r.prowizja_z_noty)} zł</span>{/if}
								</span>
								<!-- Telefon: kwota, status i akcje w drugim wierszu; od sm — kolumny w jednym wierszu. -->
								<span class="w-full sm:w-auto flex items-center gap-x-3 sm:contents">
									<span class="sm:w-[110px] sm:text-right text-[13px] font-medium tabular-nums whitespace-nowrap {r.kwota < 0 ? 'text-danger' : 'text-ink'}">{fmtPln(r.kwota)} zł</span>
									<span class="sm:w-[132px] flex sm:justify-end"><span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {chip.cls}">{chip.tekst}</span></span>
									<span class="ml-auto sm:w-[68px] flex items-center justify-end">
										{#if po && adresyEmail}
											<button onclick={() => napiszEmail('rata')} title="Przypomnij e-mailem" aria-label="Przypomnij e-mailem o racie {r.nr_raty}" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><Mail size={15} /></button>
										{/if}
										<button onclick={() => openEditPayment(r)} title="Edytuj ratę" aria-label="Edytuj ratę {r.nr_raty}" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><Pencil size={15} /></button>
									</span>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
			{/if}

			<!-- Polisy w ramach UG -->
			{#if childPolicies.length > 0}
				<section aria-labelledby="polisy-ug" class="bg-white border border-line rounded-xl overflow-hidden">
					<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 border-b border-line-soft">
						<h2 id="polisy-ug" class="text-[15px] font-semibold text-ink">Polisy w ramach UG</h2>
						<span class="text-[13px] text-ink-2 tabular-nums">{childPolicies.length}</span>
					</div>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[600px] text-[13px] text-left">
							<thead>
								<tr class="bg-surface-2 text-ink-2">
									<SortTh s={sortUg} k="nr" wersaliki={false} class="px-4 py-2.5 font-semibold">Polisa</SortTh>
									<SortTh s={sortUg} k="klient" wersaliki={false} class="px-4 py-2.5 font-semibold">Klient</SortTh>
									<SortTh s={sortUg} k="do" wersaliki={false} class="px-4 py-2.5 font-semibold">Koniec ochrony</SortTh>
									<SortTh s={sortUg} k="skladka" wersaliki={false} align="right" class="px-4 py-2.5 font-semibold text-right">Składka</SortTh>
									<SortTh s={sortUg} k="prowizja" wersaliki={false} align="right" class="px-4 py-2.5 font-semibold text-right">Prowizja</SortTh>
									<th class="px-4 py-2.5 font-semibold">Status</th>
								</tr>
							</thead>
							<tbody>
								{#each childWiersze as cp (cp.id)}
									{@const cst = statusPolisy(cp, { dzis: today, odnowione })}
									<tr class="border-t border-line-soft hover:bg-bg">
										<td class="px-4 py-2"><a href="/policies/{cp.id}" class="font-mono text-xs text-accent-text hover:underline">{cp.nr_polisy}</a></td>
										<td class="px-4 py-2 max-w-[200px]"><a href="/clients/{cp.klient_id}" class="block truncate text-ink hover:text-accent-text">{cp.crm_clients?.nazwa ?? '—'}</a></td>
										<td class="px-4 py-2 whitespace-nowrap text-ink-2">{cp.data_do ? fmtDzien(cp.data_do, true) : 'bezterminowo'}</td>
										<td class="px-4 py-2 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(cp.skladka_przypisana)} zł</td>
										<td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">{fmtPln(cp.prowizja_przypisana)} zł</td>
										<td class="px-4 py-2"><span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {cst.cls}">{cst.tekst}</span></td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr class="border-t border-line bg-surface-2 font-semibold text-ink">
									<td colspan="3" class="px-4 py-2">Razem</td>
									<td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">{fmtPln(childSkladka)} zł</td>
									<td class="px-4 py-2 text-right tabular-nums whitespace-nowrap">{fmtPln(childProwizja)} zł</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					</div>
				</section>
			{/if}

			<!-- Aneksy -->
			{#if annexes.length > 0}
				<section aria-labelledby="aneksy-polisy" class="bg-white border border-line rounded-xl overflow-hidden">
					<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3 border-b border-line-soft">
						<h2 id="aneksy-polisy" class="text-[15px] font-semibold text-ink">Aneksy</h2>
						<span class="text-[13px] text-ink-2 tabular-nums">{annexes.length}</span>
						<button onclick={() => { showAnnex = true; axError = ''; }} class="ml-auto h-7 flex items-center gap-1 px-1.5 text-[13px] font-semibold text-accent-text hover:underline"><Plus size={14} /> Dodaj aneks</button>
					</div>
					<ul>
						{#each annexes as ax (ax.id)}
							<li class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 border-t border-line-soft first:border-t-0">
								<span class="flex-[1_1_240px] min-w-0">
									<span class="block text-[13px] font-medium text-ink">Aneks {ax.nr_aneksu} <span class="font-normal text-ink-3">· {TYP_ANEKSU[ax.typ] ?? ax.typ} · {fmtDzien(ax.data_aneksu, true)}</span></span>
									{#if ax.opis}<span class="block text-xs text-ink-2">{ax.opis}</span>{/if}
								</span>
								{#if Number(ax.delta_skladka) !== 0}
									<span class="text-[13px] font-medium tabular-nums whitespace-nowrap {ax.delta_skladka > 0 ? 'text-ok' : 'text-danger'}">{ax.delta_skladka > 0 ? '+' : ''}{fmtPln(ax.delta_skladka)} zł</span>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!-- Dokumenty polisy (PDF w Cloudflare R2) -->
			<DokumentyPolisy polisaId={policy.id} />

			<!-- Parametry odczytane z pliku polisy (import z PDF) -->
			{#if policy.dane_importu}
				{@const di = policy.dane_importu}
				{@const ryzyka = di.ryzyka ?? []}
				{@const dodatkowe = Object.entries(di.dodatkowe ?? {})}
				<section aria-labelledby="dane-z-polisy" class="bg-white border border-line rounded-xl overflow-hidden">
					<h2 id="dane-z-polisy">
						<button
							onclick={() => (importOpen = !importOpen)}
							aria-expanded={importOpen}
							class="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-bg {importOpen ? 'border-b border-line-soft' : ''}"
						>
							<FileText size={16} class="text-ink-3 shrink-0" />
							<span class="text-[15px] font-semibold text-ink">Dane z polisy</span>
							{#if di.zrodlo?.produkt}<span class="text-xs text-ink-3 truncate">{di.zrodlo.produkt}</span>{/if}
							<ChevronDown size={16} class="ml-auto shrink-0 text-ink-3 transition-transform {importOpen ? 'rotate-180' : ''}" />
						</button>
					</h2>
					{#if importOpen}
						<div class="p-4 flex flex-col gap-4">
							{#if ryzyka.length}
								<div class="border border-line-soft rounded-lg overflow-x-auto">
									<table class="w-full text-[13px] min-w-[520px]">
										<thead>
											<tr class="bg-surface-2 text-ink-2">
												<th class="text-left px-3 py-2 font-semibold">Sekcja</th>
												<th class="text-left px-3 py-2 font-semibold">Przedmiot</th>
												<th class="text-right px-3 py-2 font-semibold">Suma ubezp.</th>
												<th class="text-right px-3 py-2 font-semibold">Składka</th>
											</tr>
										</thead>
										<tbody>
											{#each ryzyka as r}
												<tr class="border-t border-line-soft">
													<td class="px-3 py-2 text-ink-3 text-xs">{r.sekcja}</td>
													<td class="px-3 py-2 text-ink">{r.przedmiot}</td>
													<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.suma != null ? `${fmtPln(r.suma)} zł` : '—'}</td>
													<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap text-ink-2">{r.skladka != null ? `${fmtPln(r.skladka)} zł` : '—'}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
							{#if dodatkowe.length || di.owu || di.konto_do_wplat}
								<dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 text-[13px]">
									{#each dodatkowe as [klucz, wartosc]}
										<div class="flex justify-between gap-3 border-b border-line-soft py-1.5">
											<dt class="text-ink-3 shrink-0">{klucz}</dt>
											<dd class="text-ink text-right">{wartosc}</dd>
										</div>
									{/each}
									{#if di.owu}
										<div class="flex justify-between gap-3 border-b border-line-soft py-1.5">
											<dt class="text-ink-3 shrink-0">OWU</dt>
											<dd class="text-ink text-right">{di.owu}</dd>
										</div>
									{/if}
									{#if di.konto_do_wplat}
										<div class="flex justify-between gap-3 border-b border-line-soft py-1.5">
											<dt class="text-ink-3 shrink-0">Konto do wpłat</dt>
											<dd class="text-ink text-right font-mono text-xs break-words">{di.konto_do_wplat}</dd>
										</div>
									{/if}
								</dl>
							{/if}
							{#if di.zrodlo}
								<p class="text-xs text-ink-3">
									Odczytane z pliku{di.zrodlo.plik ? ` ${di.zrodlo.plik}` : ''}{di.zrodlo.ubezpieczyciel ? ` — ${di.zrodlo.ubezpieczyciel}` : ''}{di.zrodlo.data ? `, ${di.zrodlo.data}` : ''}.
								</p>
							{/if}
						</div>
					{/if}
				</section>
			{/if}
		</div>

		<aside class="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
			<!-- Szczegóły -->
			<section aria-labelledby="szczegoly-polisy" class="bg-white border border-line rounded-xl px-4 py-3.5">
				<h2 id="szczegoly-polisy" class="text-[15px] font-semibold text-ink mb-1">Szczegóły</h2>
				<dl class="text-[13px]">
					{#snippet wiersz(etykieta: string, wartosc: string | null | undefined, mono = false)}
						{#if wartosc}
							<div class="flex gap-3 py-1.5 border-t border-line-soft first:border-t-0">
								<dt class="w-[118px] shrink-0 text-ink-3">{etykieta}</dt>
								<dd class="flex-1 min-w-0 text-ink break-words {mono ? 'font-mono text-xs leading-5' : ''}">{wartosc}</dd>
							</div>
						{/if}
					{/snippet}
					<div class="flex gap-3 py-1.5">
						<dt class="w-[118px] shrink-0 text-ink-3">Ubezpieczający</dt>
						<dd class="flex-1 min-w-0"><a href="/clients/{policy.klient_id}" class="text-accent-text hover:underline break-words">{policy.crm_clients?.nazwa ?? '—'}</a></dd>
					</div>
					{#if ubezpieczony}
						<div class="flex gap-3 py-1.5 border-t border-line-soft">
							<dt class="w-[118px] shrink-0 text-ink-3">Ubezpieczony</dt>
							<dd class="flex-1 min-w-0"><a href="/clients/{ubezpieczony.id}" class="text-accent-text hover:underline break-words">{ubezpieczony.nazwa}</a></dd>
						</div>
					{/if}
					{@render wiersz('Towarzystwo', policy.crm_insurers?.nazwa ?? nazwaTu(policy))}
					{@render wiersz('Rodzaj', nazwaRodzaju(policy.rodzaj))}
					{#if przedmiotUd}
						{@render wiersz('Sumy', [przedmiotUd.ctn ? `CTN ${fmtPln(przedmiotUd.ctn)} zł` : '', przedmiotUd.ctc ? `CTC ${fmtPln(przedmiotUd.ctc)} zł` : '', przedmiotUd.si ? `SI ${fmtPln(przedmiotUd.si)} zł` : ''].filter(Boolean).join(' · '))}
					{:else}
						{@render wiersz('Przedmiot', policy.przedmiot)}
					{/if}
					{#if ugNadrzedna}
						<div class="flex gap-3 py-1.5 border-t border-line-soft">
							<dt class="w-[118px] shrink-0 text-ink-3">Umowa generalna</dt>
							<dd class="flex-1 min-w-0"><a href="/policies/{ugNadrzedna.id}" class="font-mono text-xs leading-5 text-accent-text hover:underline break-all">{ugNadrzedna.nr_polisy}</a></dd>
						</div>
					{/if}
					{@render wiersz('Zawarta', policy.data_zawarcia ? fmtDzien(policy.data_zawarcia, true) : null)}
					{@render wiersz('Okres', `${fmtDzien(policy.data_od, true)} – ${policy.data_do ? fmtDzien(policy.data_do, true) : 'bezterminowo'}`)}
					{@render wiersz('Raty', ug ? null : iloscRat > 1 ? `${iloscRat} raty` : 'jednorazowo')}
					{@render wiersz('Suma gwarancyjna', sumaGw != null ? `${fmtPln(sumaGw)} zł` : null)}
					{@render wiersz('Pojazd', pojazd ? `${pojazd.nr_rejestracyjny} · ${pojazd.marka_model}` : null)}
					{@render wiersz('VIN', pojazd?.vin, true)}
					{@render wiersz('Leasing', [policy.crm_leasings?.nazwa, policy.nr_umowy_leasingowej ? `umowa ${policy.nr_umowy_leasingowej}` : ''].filter(Boolean).join(' · ') || null)}
					{@render wiersz('Gwarancja', policy.gwarancja_typ)}
					{@render wiersz('Beneficjent', [policy.gwarancja_beneficjent_nazwa, policy.gwarancja_beneficjent_nip ? `NIP ${policy.gwarancja_beneficjent_nip}` : ''].filter(Boolean).join(' · ') || null)}
					{@render wiersz('Kontrakt', policy.gwarancja_kontrakt)}
					{@render wiersz('Stawka', policy.gwarancja_stawka_pct != null ? `${policy.gwarancja_stawka_pct}%` : null)}
					{@render wiersz('Dodana do CRM', policy.created_at ? fmtDzien(policy.created_at.slice(0, 10), true) : null)}
				</dl>
			</section>

			<!-- Umowa generalna: parametry -->
			{#if ug}
				<section aria-labelledby="parametry-ug" class="bg-white border border-line rounded-xl px-4 py-3.5">
					<h2 id="parametry-ug" class="text-[15px] font-semibold text-ink mb-1">Parametry umowy generalnej</h2>
					<dl class="text-[13px]">
						<div class="flex gap-3 py-1.5">
							<dt class="w-[118px] shrink-0 text-ink-3">Podtyp</dt>
							<dd class="flex-1 text-ink">{ugPodtypLabel[policy.ug_podtyp ?? ''] ?? policy.ug_podtyp ?? '—'}</dd>
						</div>
						{#if policy.ug_podtyp === 'gwarancje'}
							<div class="flex gap-3 py-1.5 border-t border-line-soft">
								<dt class="w-[118px] shrink-0 text-ink-3">Limit gwarancyjny</dt>
								<dd class="flex-1 text-ink tabular-nums">{policy.ug_limit != null ? `${fmtPln(policy.ug_limit)} zł` : '—'}</dd>
							</div>
						{/if}
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 border-t border-line-soft">
							<dt class="w-[118px] shrink-0 text-ink-3">Domyślna prowizja</dt>
							<dd class="flex-1 min-w-0 flex flex-wrap items-center gap-2">
								{#if ugEditOpen}
									<label class="sr-only" for="ug-prowizja">Domyślna prowizja UG (%)</label>
									<input id="ug-prowizja" type="number" step="0.01" bind:value={ugEditVal} placeholder="%" class="w-20 h-8 border border-line rounded-lg px-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent" />
									<button onclick={saveUgDefault} disabled={ugEditSaving} class="h-8 px-2.5 text-[13px] font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-60">{ugEditSaving ? 'Zapisywanie…' : 'Zapisz'}</button>
									<button onclick={() => (ugEditOpen = false)} class="h-8 px-2.5 text-[13px] border border-line rounded-lg text-ink-2 hover:bg-surface-2">Anuluj</button>
								{:else}
									<span class="text-ink tabular-nums">{policy.ug_default_prowizja_pct != null ? `${policy.ug_default_prowizja_pct}%` : '—'}</span>
									<button onclick={() => { ugEditVal = policy.ug_default_prowizja_pct?.toString() ?? ''; ugEditOpen = true; }} class="font-semibold text-accent-text hover:underline">zmień</button>
									{#if ugEditUpdatedCount > 0}<span class="text-xs text-ok">zaktualizowano {odmiana(ugEditUpdatedCount, 'polisę', 'polisy', 'polis')}</span>{/if}
								{/if}
							</dd>
						</div>
						<p class="pt-1.5 text-xs text-ink-3">Nowa domyślna prowizja trafia do polis w UG, które nie mają jeszcze ustawionej prowizji.</p>
					</dl>
				</section>
			{/if}

			<!-- Kontakt w TU -->
			<section aria-labelledby="kontakt-tu" class="bg-white border border-line rounded-xl px-4 py-3.5">
				<div class="flex items-center mb-1.5">
					<h2 id="kontakt-tu" class="text-[15px] font-semibold text-ink">Kontakt w towarzystwie</h2>
					<button
						onclick={() => { showContact = true; contactBranchId = ''; contactPersonId = ''; contactError = ''; poprzedniOpiekunUg = policy?.tu_contact_id ?? null; }}
						class="ml-auto h-7 px-1.5 text-[13px] font-semibold text-accent-text hover:underline"
					>{policy.tu_contact_id ? 'Zmień' : 'Przypisz'}</button>
				</div>
				{#if policy.crm_insurer_contacts}
					{@const c = policy.crm_insurer_contacts}
					<p class="font-medium text-ink">{c.imie_nazwisko}</p>
					{#if c.stanowisko || c.crm_insurer_branches}<p class="text-xs text-ink-3">{[c.stanowisko, c.crm_insurer_branches?.nazwa].filter(Boolean).join(' · ')}</p>{/if}
					{#if kontaktTu?.telefon || kontaktTu?.email}
						<p class="flex flex-wrap gap-x-3 text-[13px] mt-0.5">
							{#if kontaktTu?.telefon}<a href="tel:{kontaktTu.telefon}" class="text-accent-text hover:underline">{kontaktTu.telefon}</a>{/if}
							{#if kontaktTu?.email}<a href="mailto:{kontaktTu.email}" class="text-accent-text hover:underline break-all">{kontaktTu.email}</a>{/if}
						</p>
					{/if}
					<button onclick={removeContact} class="mt-1.5 text-xs text-ink-3 hover:text-danger hover:underline">Odepnij kontakt</button>
				{:else}
					<p class="text-[13px] text-ink-3">Nie przypisano osoby z {nazwaTu(policy)}.</p>
				{/if}
			</section>

			<!-- Opiekun i podział prowizji -->
			<section aria-labelledby="podzial-prowizji" class="bg-white border border-line rounded-xl px-4 py-3.5">
				<div class="flex items-center mb-1.5">
					<h2 id="podzial-prowizji" class="text-[15px] font-semibold text-ink">Opiekun i podział prowizji</h2>
					<button onclick={() => { showBrokers = true; pbError = ''; }} class="ml-auto h-7 px-1.5 text-[13px] font-semibold text-accent-text hover:underline">Zarządzaj</button>
				</div>
				{#if polisaBrokers.length === 0}
					<p class="text-[13px] text-ink-3">Brak przypisanych osób.</p>
				{:else}
					<ul>
						{#each polisaBrokers as pb (pb.id)}
							<li class="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2 border-t border-line-soft first:border-t-0">
								<span aria-hidden="true" class="w-[26px] h-[26px] rounded-full bg-surface-2 text-xs font-semibold flex items-center justify-center shrink-0">{inicjaly(pb.crm_profiles?.imie_nazwisko ?? pb.crm_profiles?.email)}</span>
								<span class="flex-1 min-w-0">
									<span class="block text-[13px] font-medium text-ink truncate">{pb.crm_profiles?.imie_nazwisko ?? pb.crm_profiles?.email ?? '—'}</span>
									{#if pb.rola !== 'opiekun'}
										<span class="block text-xs tabular-nums text-ink-3">{pb.udzial_pct}% prowizji · {fmtPln((policy.prowizja_przypisana ?? 0) * pb.udzial_pct / 100)} zł</span>
									{/if}
								</span>
								<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {rolaCls[pb.rola] ?? 'bg-surface-2 text-ink-2'}">{rolaLabel[pb.rola] ?? pb.rola}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Historia -->
			<section aria-labelledby="historia-polisy" class="bg-white border border-line rounded-xl px-4 pt-3.5 pb-1.5">
				<h2 id="historia-polisy" class="text-[15px] font-semibold text-ink mb-1">Historia</h2>
				{#if historia.length === 0}
					<p class="pb-2 text-[13px] text-ink-3">Brak wpisów w dzienniku.</p>
				{:else}
					<ol>
						{#each historia.slice(0, historiaLimit) as w (w.id)}
							<li class="flex gap-3 py-2 border-t border-line-soft first:border-t-0">
								<span aria-hidden="true" class="w-2 h-2 mt-1.5 rounded-full shrink-0 {w.action === 'policy_deleted' ? 'bg-danger' : 'bg-[#9AA3B2]'}"></span>
								<span class="flex-1 min-w-0">
									<span class="block text-[13px] text-ink break-words">{opisHistorii(w)}</span>
									<span class="block text-xs text-ink-3">{w.user_name ?? w.user_email ?? 'System'} · {fmtKiedy(w.created_at)}</span>
								</span>
							</li>
						{/each}
					</ol>
					{#if historia.length > historiaLimit}
						<button onclick={() => (historiaLimit += 10)} class="mb-2 mt-0.5 text-[13px] font-semibold text-accent-text hover:underline">Pokaż starsze ({historia.length - historiaLimit})</button>
					{/if}
				{/if}
			</section>
		</aside>
	</div>
{/if}

{#if policy}
<!-- Modal: Aneks -->
<Modal title="Aneks do polisy {policy.nr_polisy}" open={showAnnex} onclose={() => { showAnnex = false; axError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showAnnex = false; axError = ''; }} class={btnDrugi}>Anuluj</button>
		<button onclick={saveAnnex} disabled={savingAx} class={btnGlowny}>{savingAx ? 'Zapisywanie…' : 'Zapisz aneks'}</button>
	{/snippet}
	{#if axError}<p class={bladCls}>{axError}</p>{/if}
	<div class="flex flex-col gap-3">
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<div><label for="ax-nr" class={labelCls}>Nr aneksu *</label><input id="ax-nr" bind:value={axNr} class={inputCls} /></div>
			<div><label for="ax-data" class={labelCls}>Data aneksu *</label><input id="ax-data" type="date" bind:value={axData} class={inputCls} /></div>
		</div>
		<fieldset>
			<legend class={labelCls}>Typ aneksu</legend>
			<div class="grid grid-cols-2 gap-2">
				{#each Object.entries(TYP_ANEKSU) as [val, lbl]}
					<button
						type="button"
						aria-pressed={axTyp === val}
						onclick={() => (axTyp = val as typeof axTyp)}
						class="h-9 px-3 rounded-lg text-sm border text-left transition-colors
							{axTyp === val ? 'bg-accent-soft text-accent-text border-accent font-semibold' : 'bg-white text-ink-2 border-line hover:bg-surface-2'}"
					>{lbl}</button>
				{/each}
			</div>
		</fieldset>
		<div><label for="ax-opis" class={labelCls}>Opis</label><input id="ax-opis" bind:value={axOpis} class={inputCls} /></div>
		<div class="border-t border-line-soft pt-3">
			<p class="text-xs text-ink-3 mb-2">Przy korekcie wpisane wartości od razu zmieniają polisę.</p>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div><label for="ax-do" class={labelCls}>Nowa data końca</label><input id="ax-do" type="date" bind:value={axNewDataDo} class={inputCls} /></div>
				<div><label for="ax-skl" class={labelCls}>Nowa składka</label><input id="ax-skl" type="number" step="0.01" bind:value={axNewSkladka} class={inputCls} /></div>
				<div><label for="ax-delta" class={labelCls}>Zmiana składki (+/−)</label><input id="ax-delta" type="number" step="0.01" bind:value={axDeltaSkladka} class={inputCls} /></div>
				<div><label for="ax-pct" class={labelCls}>Nowa prowizja (%)</label><input id="ax-pct" type="number" step="0.01" bind:value={axNewProwizjaPct} class={inputCls} /></div>
			</div>
		</div>
	</div>
</Modal>

<!-- Modal: Opiekun i podział prowizji -->
<Modal title="Opiekun i podział prowizji — {policy.nr_polisy}" open={showBrokers} onclose={() => { showBrokers = false; pbError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showBrokers = false; pbError = ''; }} class={btnDrugi}>Zamknij</button>
	{/snippet}

	{#if polisaBrokers.length > 0}
		<ul class="mb-4 border border-line rounded-xl overflow-hidden">
			{#each polisaBrokers as pb (pb.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-t border-line-soft first:border-t-0">
					<span class="h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {rolaCls[pb.rola] ?? 'bg-surface-2 text-ink-2'}">{rolaLabel[pb.rola] ?? pb.rola}</span>
					<span class="flex-1 min-w-0 text-sm font-medium text-ink truncate">{pb.crm_profiles?.imie_nazwisko ?? pb.crm_profiles?.email ?? '—'}</span>
					{#if pb.rola !== 'opiekun'}
						<span class="text-[13px] tabular-nums whitespace-nowrap"><span class="font-semibold text-ink">{pb.udzial_pct}%</span> <span class="text-ink-3">· {fmtPln((policy.prowizja_przypisana ?? 0) * pb.udzial_pct / 100)} zł</span></span>
					{:else}
						<span class="text-xs text-ink-3">bez prowizji</span>
					{/if}
					<button onclick={() => removeBroker(pb)} aria-label="Usuń: {pb.crm_profiles?.imie_nazwisko ?? pb.crm_profiles?.email ?? 'osoba'}" title="Usuń" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-danger hover:bg-danger-soft"><Trash2 size={15} /></button>
				</li>
			{/each}
		</ul>
	{/if}

	<p class="text-[13px] font-semibold text-ink mb-2">Dodaj osobę</p>
	{#if pbError}<p class={bladCls}>{pbError}</p>{/if}
	<div class="flex flex-wrap gap-2 items-end">
		<div class="flex-[1_1_200px] min-w-0">
			<label for="pb-osoba" class={labelCls}>Osoba</label>
			<select id="pb-osoba" bind:value={pbBrokerId} class={inputCls}>
				<option value="">— wybierz —</option>
				{#each appState.brokers as b}
					<option value={b.id}>{b.imie_nazwisko ?? b.email}</option>
				{/each}
			</select>
		</div>
		<div class="w-40">
			<label for="pb-rola" class={labelCls}>Rola</label>
			<select id="pb-rola" bind:value={pbRola} class={inputCls}>
				<option value="akwizycja">Akwizycja</option>
				<option value="obsługa">Obsługa</option>
				<option value="opiekun">Opiekun (bez prowizji)</option>
			</select>
		</div>
		{#if pbRola !== 'opiekun'}
			<div class="w-24">
				<label for="pb-udzial" class={labelCls}>Udział %</label>
				<input id="pb-udzial" type="number" min="0" max="100" step="1" bind:value={pbUdzial} class={inputCls} />
			</div>
		{/if}
		<button onclick={addBroker} disabled={savingPB} class="{btnGlowny} shrink-0">{savingPB ? 'Dodawanie…' : 'Dodaj'}</button>
	</div>

	{#if polisaBrokers.filter((pb) => pb.rola !== 'opiekun').length > 1}
		{@const suma = polisaBrokers.filter((pb) => pb.rola !== 'opiekun').reduce((s, pb) => s + pb.udzial_pct, 0)}
		<p class="mt-3 text-[13px] rounded-lg px-3 py-2 {Math.abs(suma - 100) > 0.1 ? 'text-danger bg-danger-soft' : 'text-ok bg-ok-soft'}">
			Suma udziałów: <strong>{suma}%</strong>{Math.abs(suma - 100) > 0.1 ? ' — nie sumuje się do 100%' : ''}
		</p>
	{/if}
</Modal>

<!-- Modal: Usuń polisę -->
<Modal title="Usuń polisę {policy.nr_polisy}" open={showDelete} onclose={() => (showDelete = false)}>
	{#snippet footer()}
		<button onclick={() => (showDelete = false)} class={btnDrugi}>Anuluj</button>
		<button onclick={softDelete} disabled={deleting} class="h-9 px-4 text-sm font-semibold bg-danger text-white rounded-lg hover:opacity-90 disabled:opacity-60">{deleting ? 'Usuwanie…' : 'Przenieś do kosza'}</button>
	{/snippet}
	{#if deleteError}<p class={bladCls}>{deleteError}</p>{/if}
	<div class="flex flex-col gap-3">
		<p class="bg-warn-soft rounded-lg px-4 py-3 text-[13px] text-warn">Polisa trafi do kosza. Administrator może ją przywrócić albo usunąć na stałe.</p>
		<div>
			<label for="usun-powod" class={labelCls}>Uzasadnienie usunięcia *</label>
			<textarea id="usun-powod" bind:value={deletionReason} rows="3" placeholder="Podaj powód usunięcia polisy…" class={inputCls}></textarea>
		</div>
	</div>
</Modal>

<!-- Modal: Osoba kontaktowa TU -->
<Modal title="Kontakt w towarzystwie — {nazwaTu(policy)}" open={showContact} onclose={() => (showContact = false)}>
	{#snippet footer()}
		<button onclick={() => (showContact = false)} class={btnDrugi}>Anuluj</button>
		<button onclick={saveContact} disabled={savingContact} class={btnGlowny}>{savingContact ? 'Zapisywanie…' : 'Przypisz osobę'}</button>
	{/snippet}
	{#if contactError}<p class={bladCls}>{contactError}</p>{/if}
	<div class="flex flex-col gap-3">
		<div>
			<label for="tu-oddzial" class={labelCls}>Oddział</label>
			<select id="tu-oddzial" bind:value={contactBranchId} onchange={() => (contactPersonId = '')} class={inputCls}>
				<option value="">— bez oddziału (centrala) —</option>
				{#each tuBranches as b}
					<option value={b.id}>{b.nazwa}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="tu-osoba" class={labelCls}>Osoba *</label>
			<select id="tu-osoba" bind:value={contactPersonId} class={inputCls}>
				<option value="">— wybierz osobę —</option>
				{#each branchContacts as c}
					<option value={c.id}>{c.imie_nazwisko}{c.stanowisko ? ` — ${c.stanowisko}` : ''}</option>
				{/each}
			</select>
			{#if branchContacts.length === 0}
				<p class="text-xs text-ink-3 mt-1">Brak osób przypisanych do wybranego oddziału.</p>
			{/if}
		</div>
		{#if policy.typ_umowy === 'generalna'}
			<p class="text-xs text-ink-3">Polisy w UG bez kontaktu albo z dotychczasowym kontaktem UG dostaną nową osobę.</p>
		{/if}
	</div>
</Modal>

<!-- Modal: Dodaj płatność -->
<Modal title="Dodaj płatność — {policy.nr_polisy}" open={showAddPayment} onclose={() => (showAddPayment = false)}>
	{#snippet footer()}
		<button onclick={() => (showAddPayment = false)} class={btnDrugi}>Anuluj</button>
		<button onclick={saveAddPayment} disabled={savingAp} class={btnGlowny}>{savingAp ? 'Zapisywanie…' : 'Dodaj płatność'}</button>
	{/snippet}
	{#if apError}<p class={bladCls}>{apError}</p>{/if}
	<div class="flex flex-col gap-3">
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<div><label for="ap-data" class={labelCls}>Termin płatności *</label><input id="ap-data" type="date" bind:value={apData} class={inputCls} /></div>
			<div><label for="ap-kwota" class={labelCls}>Kwota * (może być ujemna)</label><input id="ap-kwota" type="number" step="0.01" bind:value={apKwota} class={inputCls} /></div>
		</div>
		<div>
			<label for="ap-powod" class={labelCls}>Powód nowej płatności *</label>
			<input id="ap-powod" bind:value={apPowod} placeholder="np. aneks, rozliczenie składki…" class={inputCls} />
		</div>
	</div>
</Modal>

<!-- E-mail do klienta -->
{#if klient}
	<EmailKlienta
		open={pisanieEmaila}
		{klient}
		polisy={polisyKlienta}
		kontakty={kontaktyKlienta}
		szablonStartowy={emailSzablon}
		polisaStartowa={policy.id}
		onclose={() => (pisanieEmaila = false)}
		onwyslano={() => {}}
	/>
{/if}
{/if}

<!-- Modal: Edytuj płatność -->
{#if editingPayment}
<Modal title="Edytuj ratę {editingPayment.nr_raty}" open={showEditPayment} onclose={() => { showEditPayment = false; editingPayment = null; }}>
	{#snippet footer()}
		<button onclick={() => { showEditPayment = false; editingPayment = null; }} class={btnDrugi}>Anuluj</button>
		<button onclick={saveEditPayment} disabled={savingEp} class={btnGlowny}>{savingEp ? 'Zapisywanie…' : 'Zapisz zmiany'}</button>
	{/snippet}
	{#if epError}<p class={bladCls}>{epError}</p>{/if}
	<div class="flex flex-col gap-3">
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<div><label for="ep-data" class={labelCls}>Termin płatności *</label><input id="ep-data" type="date" bind:value={epData} class={inputCls} /></div>
			<div><label for="ep-kwota" class={labelCls}>Kwota * (może być ujemna)</label><input id="ep-kwota" type="number" step="0.01" bind:value={epKwota} class={inputCls} /></div>
		</div>
		<div>
			<label for="ep-status" class={labelCls}>Status</label>
			<select id="ep-status" bind:value={epStatus} class={inputCls}>
				<option value="Oczekująca">Oczekująca</option>
				<option value="Opłacona">Opłacona</option>
				<option value="Zaległa">Zaległa</option>
				<option value="Częściowo opłacona">Częściowo opłacona</option>
			</select>
		</div>
	</div>
</Modal>
{/if}
