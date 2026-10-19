<script lang="ts">
	import { TYP_ZADANIA_ETYKIETA, ustawStatusZadania } from '$lib/zadania';
	import TaskModal from '$lib/components/TaskModal.svelte';
	import { sb } from '$lib/supabase';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { appState } from '$lib/stores/app.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { ArrowLeft, Building2, Phone, Mail, MapPin, Tag, Send, Pencil, UserPlus, Trash2, CheckCircle2, Circle, Clock, Plus, AlertCircle, X, ChevronLeft, ChevronRight, UserRound } from 'lucide-svelte';
	import type { CrmTask } from '$lib/types/database';
	import { fmtDzien } from '$lib/utils';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { klientBeauty, programOcBeauty, wywolajApi } from '$lib/components/renewal/crmRenewals';
	import type { OdnowienieUtworzone } from '$lib/renewals/staffApi';
	import {
		ETYKIETA_ZAINTERESOWANIA, OPIS_ZAINTERESOWANIA, ZAINTERESOWANIA, ZRODLO_LEADA, nazwaKampanii, posortujZainteresowania,
		stanMaila, type MailKampanii, type Zgloszenie
	} from '$lib/sprzedaz';
	import { wierszeWnioskuUD, type WniosekUD } from '$lib/utrataDochodu';

	type Prospect = {
		id: string;
		tenant_id: string;
		nazwa: string;
		nip: string | null;
		adres: string | null;
		telefon: string | null;
		email: string | null;
		branza: string | null;
		notatki: string | null;
		zatrudnienie: number | null;
		broker_id: string | null;
		status: string;
		created_at: string;
		crm_profiles?: { imie_nazwisko: string } | null;
		klient_id: string | null;
		zainteresowania: string[] | null;
		przychod: string | null;
		zrodlo: string | null;
		data_zgloszenia: string | null;
		liczba_zgloszen: number | null;
		crm_clients?: { nazwa: string; nazwa_skrocona: string | null; nip: string | null; email: string | null; telefon: string | null; ulica: string | null; beauty_id: number | string | null } | null;
	};

	type Activity = {
		id: string;
		typ: 'notatka' | 'komentarz' | 'wiadomosc';
		tresc: string;
		created_at: string;
		author_id: string | null;
		crm_profiles?: { imie_nazwisko: string } | null;
	};

	const prospectId = $derived($page.params.id);

	let prospect = $state<Prospect | null>(null);
	let activities = $state<Activity[]>([]);
	let loading = $state(true);
	let newText = $state('');
	let sending = $state(false);
	let editingProspect = $state(false);

	// edit form
	let fNazwa = $state('');
	let fNip = $state('');
	let fAdres = $state('');
	let fTelefon = $state('');
	let fEmail = $state('');
	let fBranza = $state('');
	let fNotatki = $state('');
	let fZatrudnienie = $state<number | ''>('');
	let fStatus = $state('nowy');
	let fZainteresowania = $state<string[]>([]);
	let fPrzychod = $state('');
	let saving = $state(false);

	// Zgłoszenia z formularza i maile kampanii (BEAUTY) firmy tego leada; wnioski z aplikacji Utrata Dochodu (crm_ud_leady).
	let zgloszenia = $state<Zgloszenie[]>([]);
	let maileKampanii = $state<MailKampanii[]>([]);
	let wnioskiUD = $state<WniosekUD[]>([]);
	const maZgloszenieUD = $derived(zgloszenia.some((z) => z.zrodlo === 'utrata_dochodu'));
	const klient = $derived(prospect?.crm_clients ?? null);
	const nazwaLeada = $derived(klient?.nazwa_skrocona ?? klient?.nazwa ?? prospect?.nazwa ?? '');
	// „APK i wniosek o pierwszą polisę OC beauty” to rozwiązanie branży beauty: firma prowadzi program OC beauty,
	// a lead jest z formularza BEAUTY albo jego firma jest klientem beauty (import BEAUTY / certyfikat z programu).
	const leadBeauty = $derived(
		!!prospect && programOcBeauty(appState.policies) &&
			klientBeauty({ beautyId: prospect.crm_clients?.beauty_id, klientId: prospect.klient_id, zrodloLeada: prospect.zrodlo }, appState.policies)
	);

	const statusLabels: Record<string, string> = {
		'nowy': 'Nowy', 'w_kontakcie': 'W kontakcie',
		'oferta_wyslana': 'Oferta wysłana', 'wygrany': 'Wygrany', 'przegrany': 'Przegrany'
	};
	function statusVariant(s: string): 'info' | 'success' | 'error' | 'warning' {
		if (s === 'wygrany') return 'success';
		if (s === 'przegrany') return 'error';
		if (s === 'oferta_wyslana') return 'warning';
		return 'info';
	}

	function extractZatrudnienie(prospect: Prospect) {
		if (prospect.zatrudnienie != null) return String(prospect.zatrudnienie);
		if (!prospect.notatki) return null;
		const m = prospect.notatki.match(/Zatrudnienie:\s*(\d[\d\s]*)/);
		return m ? m[1].trim() : null;
	}
	function extractWWW(notatki: string | null) {
		if (!notatki) return null;
		const m = notatki.match(/WWW:\s*(https?:\/\/\S+)/);
		return m ? m[1] : null;
	}

	async function load() {
		loading = true;
		const { data: p } = await sb.from('crm_prospects')
			.select('*, crm_profiles(imie_nazwisko), crm_clients(nazwa, nazwa_skrocona, nip, email, telefon, ulica, beauty_id)')
			.eq('id', prospectId)
			.single();
		prospect = p as Prospect | null;
		fPrzychodInline = prospect?.przychod ?? '';
		void wczytajZgloszeniaIMaile();

		const { data: acts } = await sb.from('crm_prospect_activities')
			.select('*, crm_profiles(imie_nazwisko)')
			.eq('prospect_id', prospectId)
			.order('created_at', { ascending: true });
		activities = (acts ?? []) as Activity[];
		loading = false;
		await loadTasks();
	}

	// Ta sama trasa `[id]` jest współdzielona między prospektami — przy przejściu
	// „Poprzedni/Następny" komponent nie montuje się ponownie, więc dane
	// przeładowujemy przez efekt reagujący na zmianę id.
	$effect(() => {
		void prospectId;
		load();
	});

	// ---- Nawigacja Poprzedni / Następny (kolejność z listy Prospects) ----
	let navIds = $state<string[]>([]);
	onMount(() => {
		try {
			const raw = sessionStorage.getItem('prospects:order');
			if (raw) navIds = JSON.parse(raw);
		} catch { /* brak zapisanej kolejności — przyciski się nie pokażą */ }
	});
	const navIndex = $derived(navIds.indexOf(prospectId));
	const prevId = $derived(navIndex > 0 ? navIds[navIndex - 1] : null);
	const nextId = $derived(navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null);

	function goToProspect(id: string | null) {
		if (id) goto(`/prospects/${id}`);
	}

	// Strzałki ← / → przełączają prospekty (poza polami tekstowymi).
	function onKeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
		if (e.key === 'ArrowLeft' && prevId) { e.preventDefault(); goToProspect(prevId); }
		else if (e.key === 'ArrowRight' && nextId) { e.preventDefault(); goToProspect(nextId); }
	}

	async function wczytajZgloszeniaIMaile() {
		const lead = prospect;
		if (!lead) return;
		const [z, m, ud] = await Promise.all([
			sb.from('crm_zgloszenia')
				.select('id, klient_id, prospect_id, zrodlo, zgloszono_at, firma, kontakt, email, telefon, produkt, zainteresowania, przychod, ponowne, poprzednie_at, poprzednie_typ, historyczne, odczytane_at')
				.or(lead.klient_id ? `prospect_id.eq.${lead.id},klient_id.eq.${lead.klient_id}` : `prospect_id.eq.${lead.id}`)
				.order('zgloszono_at', { ascending: false })
				.limit(20),
			lead.klient_id
				? sb.from('crm_kampanie_maile')
					.select('id, kampania, kod, temat, adres, status, wyslano_at, dostarczono_at, otwarto_at, kliknieto_at, odbito_at')
					.eq('klient_id', lead.klient_id)
					.order('wyslano_at', { ascending: false })
					.limit(20)
				: Promise.resolve({ data: [] }),
			sb.from('crm_ud_leady')
				.select('ud_klient_id, etap, status_crm, sprzedano_at, zarchiwizowano_at, synced_at, dane')
				.eq('prospect_id', lead.id)
				.order('created_at', { ascending: false })
				.limit(5)
		]);
		if (prospect?.id !== lead.id) return;
		zgloszenia = (z.data ?? []) as Zgloszenie[];
		maileKampanii = (m.data ?? []) as MailKampanii[];
		wnioskiUD = (ud.data ?? []) as WniosekUD[];
	}

	function przelaczZainteresowanie(k: string) {
		fZainteresowania = fZainteresowania.includes(k) ? fZainteresowania.filter((x) => x !== k) : [...fZainteresowania, k];
	}

	// Okno „Poszukiwane ubezpieczenia” (obok Zadań i Aktywności): chipy zapisują się od razu, przychód po wyjściu z pola.
	let zapisPoszukiwanych = $state(false);
	let fPrzychodInline = $state('');
	async function zapiszPoszukiwane(zmiana: { zainteresowania?: string[]; przychod?: string | null }) {
		if (!prospect || zapisPoszukiwanych) return;
		zapisPoszukiwanych = true;
		const dane = { ...zmiana, ...(zmiana.zainteresowania ? { zainteresowania: posortujZainteresowania(zmiana.zainteresowania) } : {}) };
		const { error } = await sb.from('crm_prospects').update(dane as never).eq('id', prospect.id);
		zapisPoszukiwanych = false;
		if (error) { ctxToast(`Nie udało się zapisać: ${error.message}`); return; }
		prospect = { ...prospect, ...dane };
	}
	function przelaczPoszukiwane(k: string) {
		const obecne = prospect?.zainteresowania ?? [];
		void zapiszPoszukiwane({ zainteresowania: obecne.includes(k) ? obecne.filter((x) => x !== k) : [...obecne, k] });
	}
	function zapiszPrzychod() {
		const v = fPrzychodInline.trim() || null;
		if (v === (prospect?.przychod ?? null)) return;
		void zapiszPoszukiwane({ przychod: v });
	}

	// Aktywność to jeden rodzaj wpisu (dawny podział komentarz / notatka / wiadomość nie wnosił różnicy);
	// wpisy ręczne zapisujemy jako „komentarz”, wpisy systemowe (np. wysłany wniosek) zostają „notatką”.
	async function addActivity() {
		if (!newText.trim() || !prospect) return;
		sending = true;
		await sb.from('crm_prospect_activities').insert([{
			tenant_id: prospect.tenant_id,
			prospect_id: prospect.id,
			author_id: appState.profile?.id ?? null,
			typ: 'komentarz',
			tresc: newText.trim()
		}]);
		newText = '';
		sending = false;
		await promoteToWKontakcie();
		await load();
	}

	// Po dodaniu komentarza/zadania prospekt "nowy" trafia do "W kontakcie".
	async function promoteToWKontakcie() {
		if (!prospect || prospect.status !== 'nowy') return;
		await sb.from('crm_prospects').update({ status: 'w_kontakcie' }).eq('id', prospect.id);
		prospect = { ...prospect, status: 'w_kontakcie' };
	}

	async function deleteActivity(id: string) {
		if (!confirm('Usunąć wpis?')) return;
		await sb.from('crm_prospect_activities').delete().eq('id', id);
		await load();
	}

	function startEdit() {
		if (!prospect) return;
		fNazwa = prospect.nazwa; fNip = prospect.nip ?? ''; fAdres = prospect.adres ?? '';
		fTelefon = prospect.telefon ?? ''; fEmail = prospect.email ?? '';
		fBranza = prospect.branza ?? ''; fNotatki = prospect.notatki ?? '';
		fZatrudnienie = prospect.zatrudnienie ?? '';
		fStatus = prospect.status;
		fZainteresowania = [...(prospect.zainteresowania ?? [])];
		fPrzychod = prospect.przychod ?? '';
		editingProspect = true;
	}

	async function saveEdit() {
		if (!prospect || (!prospect.klient_id && !fNazwa.trim())) return;
		saving = true;
		const wspolne = {
			branza: fBranza.trim() || null, notatki: fNotatki.trim() || null,
			zatrudnienie: fZatrudnienie !== '' ? Number(fZatrudnienie) : null,
			status: fStatus,
			zainteresowania: posortujZainteresowania(fZainteresowania),
			przychod: fPrzychod.trim() || null
		};
		// Lead powiązany z klientem: dane firmy edytuje się w kartotece klienta.
		await sb.from('crm_prospects').update(prospect.klient_id ? wspolne : {
			...wspolne,
			nazwa: fNazwa.trim(), nip: fNip.trim() || null, adres: fAdres.trim() || null,
			telefon: fTelefon.trim() || null, email: fEmail.trim() || null
		}).eq('id', prospect.id);
		saving = false;
		editingProspect = false;
		await load();
	}

	// Lead spoza kartoteki → klient (albo powiązanie z istniejącym klientem o tym NIP). Etap się nie zmienia:
	// lead zamknie się jako „Wygrany” sam, gdy klient dostanie polisę.
	async function convertToClient() {
		if (!prospect) return;
		if (prospect.klient_id) { goto(`/clients/${prospect.klient_id}`); return; }
		const nip = (prospect.nip ?? '').replace(/\D/g, '');
		let klientId = nip.length === 10 ? appState.clients.find((c) => (c.nip ?? '').replace(/\D/g, '') === nip)?.id ?? null : null;
		if (!klientId) {
			if (!(await askConfirm({ title: 'Dodać do Klientów?', message: `„${prospect.nazwa}” trafi do kartoteki klientów. Lead zostaje w Sprzedaży do pierwszej polisy.`, confirmLabel: 'Dodaj', danger: false }))) return;
			const { data, error } = await sb.from('crm_clients').insert([{
				tenant_id: appState.profile!.tenant_id,
				opiekun_id: prospect.broker_id ?? appState.profile!.id,
				typ: 'firma',
				nazwa: prospect.nazwa, nip: prospect.nip, ulica: prospect.adres, email: prospect.email, telefon: prospect.telefon
			}] as never).select('id').single();
			if (error || !data) { alert('Błąd: ' + (error?.message ?? 'nie udało się dodać klienta')); return; }
			klientId = (data as { id: string }).id;
		}
		await sb.from('crm_prospects').update({ klient_id: klientId }).eq('id', prospect.id);
		await load();
	}

	// Pierwsza polisa OC beauty: link do APK i wniosku dla leada (klient bez certyfikatu). Lead spoza kartoteki
	// najpierw trafia do Klientów (convertToClient) — wniosek jest zawsze przypięty do klienta.
	let wniosekPracuje = $state<'' | 'email' | 'link'>('');
	let wniosekLink = $state('');
	async function wyslijWniosek(tryb: 'email' | 'link') {
		if (!prospect || wniosekPracuje) return;
		if (!prospect.klient_id) {
			await convertToClient();
			if (!prospect?.klient_id) return;
		}
		wniosekPracuje = tryb;
		try {
			const body = { klient_id: prospect.klient_id, tryb, oczekiwany_test: appState.tenantFeatures?.odnowienia_test === true };
			let w = await wywolajApi<OdnowienieUtworzone>('POST', '/api/renewals', body);
			if (!w.ok && w.status === 409 && w.aktywny) {
				const tak = await askConfirm({
					title: 'Ten klient ma już aktywny wniosek o pierwszą polisę.',
					message: 'Utworzyć nowy i unieważnić poprzedni link?',
					detail: 'Poprzedni link przestanie działać od razu.',
					confirmLabel: 'Utwórz nowy',
					cancelLabel: 'Zostaw obecny'
				});
				if (!tak) return;
				w = await wywolajApi<OdnowienieUtworzone>('POST', '/api/renewals', { ...body, zastap: true });
			}
			if (!w.ok) {
				alert(w.message);
				return;
			}
			wniosekLink = w.data.link ?? '';
			if (tryb === 'email') {
				ctxToast(w.data.test ? `TEST: wniosek wysłany na adres testowy ${w.data.adres ?? ''}` : `Wysłano link do APK i wniosku${w.data.adres ? ` na ${w.data.adres}` : ''}`);
			} else {
				try {
					await navigator.clipboard.writeText(wniosekLink);
					ctxToast('Skopiowano link do APK i wniosku');
				} catch {
					ctxToast('Link utworzony — skopiuj go z pola poniżej');
				}
			}
			await sb.from('crm_prospect_activities').insert([{
				tenant_id: prospect.tenant_id,
				prospect_id: prospect.id,
				author_id: appState.profile?.id ?? null,
				typ: 'notatka',
				tresc: tryb === 'email' ? `Wysłano klientowi link do APK i wniosku o pierwszą polisę OC (e-mail${w.data.adres ? `: ${w.data.adres}` : ''}).` : 'Utworzono link do APK i wniosku o pierwszą polisę OC (do przekazania klientowi).'
			}] as never);
			await load();
		} finally {
			wniosekPracuje = '';
		}
	}

	function formatDate(dt: string) {
		return new Date(dt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// ---- Zadania leada: wspólna karta zadania (TaskModal) z leadem na sztywno; lead z kartoteki niesie też klienta ----
	let tasks = $state<CrmTask[]>([]);
	let showTaskForm = $state(false);
	let editingTask = $state<CrmTask | null>(null);
	// Etykiety wspólne z resztą CRM (także „wniosek” — zadania z wniosków online).
	const taskTypeLabels: Record<string, string> = TYP_ZADANIA_ETYKIETA;

	const today = new Date().toISOString().slice(0, 10);

	async function loadTasks() {
		const { data } = await sb.from('crm_tasks')
			.select('*, assigned_profile:crm_profiles!assigned_to(imie_nazwisko, email)')
			.eq('prospect_id', prospectId)
			.order('termin', { ascending: true, nullsFirst: false });
		tasks = (data ?? []) as CrmTask[];
	}

	function openNewTask() {
		editingTask = null;
		showTaskForm = true;
	}

	function openEditTask(t: CrmTask) {
		editingTask = t;
		showTaskForm = true;
	}

	function cancelTaskForm() {
		showTaskForm = false;
		editingTask = null;
	}

	// Po zapisie z karty zadania: lead „nowy” przechodzi w „w kontakcie”, lista zadań leada odświeża się
	// (zadania w pamięci całego CRM odświeża sam TaskModal).
	async function poZapisieZadania() {
		editingTask = null;
		await promoteToWKontakcie();
		await loadTasks();
	}

	async function toggleTaskStatus(t: CrmTask) {
		const next = t.status === 'zakonczone' ? 'otwarte' : 'zakonczone';
		const blad = await ustawStatusZadania(t, next, appState.profile!.id);
		if (blad) ctxToast(`Nie udało się zmienić statusu: ${blad}`);
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
		return (t.status === 'otwarte' || t.status === 'w_toku') && !!t.termin && t.termin < today;
	}

	const priorityDotMap: Record<CrmTask['priorytet'], string> = {
		pilny: 'bg-red-500', wysoki: 'bg-orange-400', normalny: 'bg-blue-400', niski: 'bg-slate-300'
	};

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

</script>

<svelte:head><title>{prospect?.nazwa ?? 'Prospect'} — CRM</title></svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="mb-5 flex items-center justify-between gap-3 flex-wrap">
	<button onclick={() => goto('/prospects')} class="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
		<ArrowLeft size={15} /> Powrót do Leadów
	</button>
	{#if navIndex >= 0 && navIds.length > 1}
		<div class="flex items-center gap-1.5">
			<button
				onclick={() => goToProspect(prevId)}
				disabled={!prevId}
				title="Poprzedni prospect (←)"
				class="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-line rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
			>
				<ChevronLeft size={15} /> Poprzedni
			</button>
			<span class="text-xs text-slate-400 tabular-nums px-1">{navIndex + 1} / {navIds.length}</span>
			<button
				onclick={() => goToProspect(nextId)}
				disabled={!nextId}
				title="Następny prospect (→)"
				class="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-line rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
			>
				Następny <ChevronRight size={15} />
			</button>
		</div>
	{/if}
</div>

{#if loading}
	<div class="text-center text-slate-400 py-16">Ładowanie...</div>
{:else if !prospect}
	<div class="text-center text-slate-400 py-16">Nie znaleziono prospect.</div>
{:else}
	{@const zatrud = extractZatrudnienie(prospect)}
	{@const www = extractWWW(prospect.notatki)}

	<!-- Górny rząd: Klient + (tylko beauty) APK i wniosek o pierwszą polisę OC beauty. Ramka „Ubezpieczenia posiadane” usunięta 2026-10-15 (kolumny ubez_* zostają w bazie). -->
	<div class="grid grid-cols-1 {leadBeauty ? 'lg:grid-cols-2' : ''} gap-5 mb-5 items-start">

	<!-- Klient -->
	<div class="bg-white border border-line rounded-xl shadow-sm p-6">
		{#if editingProspect}
			<div class="space-y-3">
				<div class="grid grid-cols-2 gap-3">
					{#if prospect.klient_id}
						<div class="col-span-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
							<p class="font-semibold text-ink">{nazwaLeada}</p>
							<p class="text-xs text-ink-3">Dane firmy edytujesz w kartotece klienta — <a href="/clients/{prospect.klient_id}" class="font-semibold text-accent-text hover:underline">Panel 360°</a>.</p>
						</div>
					{:else}
						<div class="col-span-2">
							<label class={labelCls}>Nazwa *</label>
							<input bind:value={fNazwa} class={inputCls} />
						</div>
						<div><label class={labelCls}>NIP</label><input bind:value={fNip} class={inputCls} /></div>
						<div class="col-span-2"><label class={labelCls}>Adres</label><input bind:value={fAdres} class={inputCls} /></div>
						<div><label class={labelCls}>Telefon</label><input bind:value={fTelefon} class={inputCls} /></div>
						<div><label class={labelCls}>Email</label><input bind:value={fEmail} type="email" class={inputCls} /></div>
					{/if}
					<div class="col-span-2">
						<span class={labelCls}>Zainteresowanie</span>
						<div class="flex flex-wrap gap-1.5">
							{#each ZAINTERESOWANIA as k}
								{@const on = fZainteresowania.includes(k)}
								<button type="button" aria-pressed={on} onclick={() => przelaczZainteresowanie(k)} title={OPIS_ZAINTERESOWANIA[k]}
									class="h-7 px-2.5 rounded-full text-xs font-medium border {on ? 'bg-accent-soft border-accent text-accent-text' : 'bg-white border-line text-ink-2 hover:bg-surface-2'}">{ETYKIETA_ZAINTERESOWANIA[k]}</button>
							{/each}
						</div>
					</div>
					<div><label class={labelCls}>Przychód roczny</label><input bind:value={fPrzychod} placeholder="np. do 250 000 zł" class={inputCls} /></div>
					<div><label class={labelCls}>Branża</label><input bind:value={fBranza} class={inputCls} /></div>
					<div><label class={labelCls}>Zatrudnienie (os.)</label><input type="number" bind:value={fZatrudnienie} class={inputCls} placeholder="liczba osób" min="0" /></div>
					<div>
						<label class={labelCls}>Status</label>
						<select bind:value={fStatus} class={inputCls}>
							<option value="nowy">Nowy</option>
							<option value="w_kontakcie">W kontakcie</option>
							<option value="oferta_wyslana">Oferta wysłana</option>
							<option value="wygrany">Wygrany</option>
							<option value="przegrany">Przegrany</option>
						</select>
					</div>
					<div class="col-span-2"><label class={labelCls}>Notatki</label><textarea bind:value={fNotatki} rows="2" class={inputCls}></textarea></div>
				</div>
				<div class="flex gap-2 pt-1">
					<button onclick={saveEdit} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
						{saving ? 'Zapisuję...' : 'Zapisz'}
					</button>
					<button onclick={() => editingProspect = false} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">
						Anuluj
					</button>
				</div>
			</div>
		{:else}
			<div class="flex items-start justify-between gap-4">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-3 flex-wrap mb-2">
						<h1 class="text-xl font-bold text-slate-900 leading-tight">{nazwaLeada}</h1>
						<Badge variant={statusVariant(prospect.status)}>{statusLabels[prospect.status] ?? prospect.status}</Badge>
					</div>
					<!-- Czego klient szuka i przychód: okno „Poszukiwane ubezpieczenia” niżej (obok Zadań i Aktywności). -->
					{#if (prospect.liczba_zgloszen ?? 0) >= 2}
						<div class="flex flex-wrap items-center gap-1.5 text-[13px]">
							<span class="h-[22px] leading-[22px] px-2 rounded-full bg-warn-soft text-warn text-xs font-semibold">{prospect.liczba_zgloszen}× zgłoszenie</span>
						</div>
					{/if}
					{#if prospect.klient_id || prospect.zrodlo || prospect.data_zgloszenia}
						<p class="mt-1.5 text-xs text-ink-3">
							{#if prospect.klient_id}Firma z kartoteki — <a href="/clients/{prospect.klient_id}" class="font-semibold text-accent-text hover:underline">Panel 360° klienta</a>{/if}
							{#if prospect.zrodlo}{prospect.klient_id ? ' · ' : ''}źródło: {ZRODLO_LEADA[prospect.zrodlo] ?? prospect.zrodlo}{/if}
							{#if prospect.data_zgloszenia} · pierwsze zgłoszenie {fmtDzien(prospect.data_zgloszenia.slice(0, 10), true)}{/if}
						</p>
					{/if}
					<div class="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm mt-3">
						{#if klient?.nip ?? prospect.nip}
							<div class="flex items-center gap-2 text-slate-600">
								<Tag size={13} class="text-slate-400 shrink-0" />
								<span>NIP: <strong>{klient?.nip ?? prospect.nip}</strong></span>
							</div>
						{/if}
						{#if prospect.branza}
							<div class="flex items-center gap-2 text-slate-600">
								<Building2 size={13} class="text-slate-400 shrink-0" />
								<span class="truncate">{prospect.branza}</span>
							</div>
						{/if}
						{#if zatrud}
							<div class="flex items-center gap-2 text-slate-600">
								<span class="text-slate-400 text-xs font-bold">👥</span>
								<span>Zatrudnienie: <strong>{zatrud} os.</strong></span>
							</div>
						{/if}
						{#if klient?.telefon ?? prospect.telefon}
							<div class="flex items-center gap-2 text-slate-600">
								<Phone size={13} class="text-slate-400 shrink-0" />
								<a href="tel:{klient?.telefon ?? prospect.telefon}" class="hover:underline">{klient?.telefon ?? prospect.telefon}</a>
							</div>
						{/if}
						{#if klient?.email ?? prospect.email}
							<div class="flex items-center gap-2 text-slate-600">
								<Mail size={13} class="text-slate-400 shrink-0" />
								<a href="mailto:{klient?.email ?? prospect.email}" class="text-blue-600 hover:underline truncate">{klient?.email ?? prospect.email}</a>
							</div>
						{/if}
						{#if klient?.ulica ?? prospect.adres}
							<div class="flex items-center gap-2 text-slate-600 col-span-2">
								<MapPin size={13} class="text-slate-400 shrink-0" />
								<span>{klient?.ulica ?? prospect.adres}</span>
							</div>
						{/if}
						{#if www}
							<div class="flex items-center gap-2 text-slate-600 col-span-2">
								<span class="text-slate-400 text-xs">🌐</span>
								<a href={www} target="_blank" rel="noopener" class="text-blue-600 hover:underline truncate">{www}</a>
							</div>
						{/if}
					</div>
				</div>
				<div class="flex items-center gap-1 shrink-0">
					<button onclick={startEdit} title="Edytuj" class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
						<Pencil size={15} />
					</button>
					{#if prospect.klient_id}
						<a href="/clients/{prospect.klient_id}" title="Panel 360° klienta" aria-label="Panel 360° klienta" class="p-2 rounded-lg text-ink-3 hover:text-accent-text hover:bg-accent-soft transition-colors">
							<UserRound size={15} />
						</a>
					{:else}
						<button onclick={convertToClient} title="Dodaj do Klientów" class="p-2 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
							<UserPlus size={15} />
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Pierwsza polisa OC beauty: link do APK i wniosku (ten sam formularz co odnowienia, bez certyfikatu). Tylko dla leadów beauty. -->
	{#if leadBeauty}
		<div class="bg-white border border-line rounded-xl shadow-sm px-6 py-4" data-testid="lead-pierwsza-polisa">
			<div class="flex flex-wrap items-center gap-3">
				<div class="min-w-0 flex-1">
					<h2 class="text-sm font-semibold text-slate-700 flex items-center gap-2"><Send size={15} class="text-rose-500" /> APK i wniosek o pierwszą polisę OC beauty</h2>
					<p class="text-[13px] text-ink-3 mt-0.5">
						Rozwiązanie dla branży beauty: klient wypełnia analizę potrzeb i wniosek online (dane gabinetu, początek ochrony, suma, ochrona prawna), podpisuje palcem albo myszą. PDF-y i zadanie trafią do CRM{prospect.klient_id ? '' : ' — lead zostanie najpierw dodany do Klientów'}.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<button onclick={() => wyslijWniosek('email')} disabled={!!wniosekPracuje} class="h-9 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60">
						{wniosekPracuje === 'email' ? 'Wysyłanie…' : 'Wyślij e-mailem'}
					</button>
					<button onclick={() => wyslijWniosek('link')} disabled={!!wniosekPracuje} class="h-9 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-60">
						{wniosekPracuje === 'link' ? 'Tworzenie…' : 'Utwórz link'}
					</button>
				</div>
			</div>
			{#if wniosekLink}
				<div class="mt-3 flex flex-wrap items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
					<span class="text-xs font-semibold text-blue-700 uppercase tracking-wide">Link dla klienta</span>
					<input readonly value={wniosekLink} onfocus={(e) => e.currentTarget.select()} class="flex-1 min-w-[240px] border border-blue-200 bg-white rounded-md px-2 py-1 text-xs font-mono text-slate-700" />
					<button type="button" onclick={() => (wniosekLink = '')} class="text-blue-400 hover:text-blue-700" aria-label="Ukryj link">✕</button>
				</div>
			{/if}
			{#if prospect.klient_id}
				<p class="mt-2 text-xs text-ink-3">Przebieg wniosku (APK, podpisy, PDF-y) jest na <a href="/clients/{prospect.klient_id}?tab=apk" class="font-semibold text-accent-text hover:underline">karcie klienta → APK</a>.</p>
			{/if}
		</div>
	{/if}

	</div>
	<!-- /górny rząd -->

	{#if wnioskiUD.length}
		<!-- Wniosek złożony w aplikacji Utrata Dochodu (synchronizacja w bazie: crm_ud_leady). Dane medyczne zostają w aplikacji. -->
		<section aria-label="Wniosek w aplikacji Utrata Dochodu" data-testid="lead-ud" class="bg-white border border-line rounded-xl px-5 py-4 mb-5">
			<h2 class="text-sm font-semibold text-ink mb-2">Wniosek w aplikacji Utrata Dochodu{#if wnioskiUD.length > 1} <span class="font-normal text-ink-3">{wnioskiUD.length}</span>{/if}</h2>
			<div class="grid grid-cols-1 {wnioskiUD.length > 1 ? 'lg:grid-cols-2' : ''} gap-x-8 gap-y-3">
				{#each wnioskiUD as w (w.ud_klient_id)}
					<dl class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
						{#each wierszeWnioskuUD(w, (d) => fmtDzien(d.slice(0, 10), true)) as [etykieta, wartosc] (etykieta)}
							<dt class="text-ink-3">{etykieta}</dt>
							<dd class="text-ink">{wartosc}</dd>
						{/each}
					</dl>
				{/each}
			</div>
			<p class="mt-2.5 text-xs text-ink-3">Etap leada w CRM podąża za etapem w aplikacji (tylko do przodu); sprzedaż w aplikacji zapisuje się w aktywności.</p>
		</section>
	{/if}

	{#if zgloszenia.length || maileKampanii.length}
		<section aria-label="Zgłoszenia i maile kampanii" class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
			<div class="bg-white border border-line rounded-xl px-5 py-4">
				<h2 class="text-sm font-semibold text-ink mb-2">{maZgloszenieUD ? 'Zgłoszenia z formularza i aplikacji' : 'Zgłoszenia z formularza'} <span class="font-normal text-ink-3">{zgloszenia.length}</span></h2>
				{#if zgloszenia.length === 0}
					<p class="text-[13px] text-ink-3">{prospect.data_zgloszenia ? `Zgłoszenie z ${fmtDzien(prospect.data_zgloszenia.slice(0, 10), true)} (z BEAUTY) — kolejne pojawią się tutaj.` : 'Brak zgłoszeń z formularza.'}</p>
				{:else}
					<ul>
						{#each zgloszenia as z (z.id)}
							<li class="py-2 border-t border-line-soft first:border-t-0 text-[13px]">
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="font-medium text-ink">{fmtDzien(z.zgloszono_at.slice(0, 10), true)}</span>
									{#if z.zrodlo === 'utrata_dochodu'}<span title="Wniosek złożony w aplikacji Utrata Dochodu" class="h-5 leading-5 px-1.5 rounded-full bg-surface-2 text-ink-2 text-[11px] font-semibold">aplikacja UD</span>{/if}
									{#if z.ponowne && !z.historyczne}<span class="h-5 leading-5 px-1.5 rounded-full bg-warn-soft text-warn text-[11px] font-semibold">ponowne</span>{/if}
									{#each posortujZainteresowania(z.zainteresowania) as k}
										<span title={OPIS_ZAINTERESOWANIA[k]} class="h-5 leading-5 px-1.5 rounded-full bg-accent-soft text-accent-text text-[11px] font-semibold">{ETYKIETA_ZAINTERESOWANIA[k] ?? k}</span>
									{/each}
								</div>
								<p class="text-xs text-ink-3">{[z.produkt, z.przychod ? `przychód ${z.przychod}` : null, z.kontakt, z.telefon].filter(Boolean).join(' · ')}</p>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<div class="bg-white border border-line rounded-xl px-5 py-4">
				<h2 class="text-sm font-semibold text-ink mb-2">Maile kampanii <span class="font-normal text-ink-3">{maileKampanii.length}</span></h2>
				{#if maileKampanii.length === 0}
					<p class="text-[13px] text-ink-3">{prospect.klient_id ? 'Do tej firmy nie wysłano jeszcze maili kampanii.' : 'Maile kampanii widać dla firm z kartoteki.'}</p>
				{:else}
					<ul>
						{#each maileKampanii as m (m.id)}
							{@const st = stanMaila(m)}
							<li class="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2 border-t border-line-soft first:border-t-0 text-[13px]">
								<span class="flex-1 min-w-0 truncate text-ink" title={m.temat ?? undefined}>{nazwaKampanii(m.kampania)}</span>
								<span class="text-xs text-ink-3 whitespace-nowrap">{m.wyslano_at ? fmtDzien(m.wyslano_at.slice(0, 10), true) : ''}</span>
								<span class="h-5 leading-5 px-1.5 rounded-full text-[11px] font-semibold {st.cls}">{st.tekst}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>
	{/if}

	<!-- Poszukiwane ubezpieczenia + Zadania + Aktywność (obok siebie) -->
	<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(260px,0.75fr)_minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
	<!-- Poszukiwane ubezpieczenia: czego klient szuka (z formularza BEAUTY albo wpisane ręcznie) i przychód -->
	<div class="bg-white border border-line rounded-xl shadow-sm md:col-span-2 xl:col-span-1" data-testid="lead-poszukiwane">
		<div class="px-5 py-4 border-b border-line-soft">
			<h2 class="text-sm font-semibold text-slate-700 flex items-center gap-2"><Tag size={15} class="text-amber-500" /> Poszukiwane ubezpieczenia</h2>
			<p class="text-xs text-ink-3 mt-0.5">Kliknij, żeby zaznaczyć albo odznaczyć — zapisuje się od razu.</p>
		</div>
		<div class="px-5 py-4 flex flex-col gap-3">
			<div class="flex flex-wrap gap-1.5">
				{#each ZAINTERESOWANIA as k}
					{@const on = (prospect.zainteresowania ?? []).includes(k)}
					<button type="button" aria-pressed={on} disabled={zapisPoszukiwanych} onclick={() => przelaczPoszukiwane(k)} title={OPIS_ZAINTERESOWANIA[k]}
						class="h-7 px-2.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 {on ? 'bg-accent-soft border-accent text-accent-text' : 'bg-white border-line text-ink-2 hover:bg-surface-2'}">{ETYKIETA_ZAINTERESOWANIA[k]}</button>
				{/each}
			</div>
			{#if !(prospect.zainteresowania ?? []).length}
				<p class="text-[13px] text-ink-3">Nie wiadomo jeszcze, czego szuka ten klient.</p>
			{/if}
			<label class="flex flex-col gap-1 text-xs text-ink-3">
				Przychód roczny
				<input bind:value={fPrzychodInline} onblur={zapiszPrzychod} onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} placeholder="np. do 250 000 zł" data-testid="lead-przychod" class="h-8 border border-line rounded-lg px-2.5 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/40" />
			</label>
			{#if zgloszenia.length}
				{@const z = zgloszenia[0]}
				<p class="text-xs text-ink-3">Ostatnie zgłoszenie {fmtDzien(z.zgloszono_at.slice(0, 10), true)}{z.produkt ? ` · ${z.produkt}` : ''}</p>
			{/if}
		</div>
	</div>

	<!-- Tasks -->
	<div class="bg-white border border-line rounded-xl shadow-sm">
		<div class="px-6 py-4 border-b border-line-soft flex items-center justify-between">
			<h2 class="text-sm font-semibold text-slate-700 flex items-center gap-2">
				<CheckCircle2 size={15} class="text-blue-500" /> Zadania
				{#if tasks.filter(t => t.status !== 'zakonczone').length > 0}
					<span class="bg-blue-100 text-blue-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{tasks.filter(t => t.status !== 'zakonczone').length}</span>
				{/if}
			</h2>
			<button onclick={openNewTask} class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover">
				<Plus size={12} /> Nowe zadanie
			</button>
		</div>

		{#if tasks.length === 0}
			<div class="px-6 py-6 text-center text-slate-400 text-sm">Brak zadań — dodaj pierwsze zadanie dla tej firmy</div>
		{:else}
			<ul class="divide-y divide-line-soft">
				{#each tasks as t}
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
							{#if t.typy && t.typy.length > 0}
								<div class="flex flex-wrap items-center gap-1 mt-0.5">
									{#each t.typy as ty}
										<span class="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.5 rounded">{taskTypeLabels[ty] ?? ty}</span>
									{/each}
								</div>
							{/if}
							{#if t.assigned_profile || (t.extra_assignees && t.extra_assignees.length > 0)}
								<div class="flex flex-wrap items-center gap-1 mt-0.5">
									{#if t.assigned_profile}
										<span class="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded">{t.assigned_profile.imie_nazwisko ?? t.assigned_profile.email}</span>
									{/if}
									{#each (t.extra_assignees ?? []) as uid}
										{@const p = appState.brokers.find(b => b.id === uid)}
										{#if p}<span class="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{p.imie_nazwisko ?? p.email}</span>{/if}
									{/each}
								</div>
							{/if}
							{#if t.czas_trwania_dni}
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
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
							<button onclick={() => openEditTask(t)} class="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"><Pencil size={12} /></button>
							<button onclick={() => deleteTask(t)} class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Karta zadania: lead na sztywno; lead z kartoteki niesie też klienta (zadanie widać na obu kartach) -->
	{#if prospect}
		<TaskModal
			open={showTaskForm}
			editingTask={editingTask}
			presetProspectId={prospect.id}
			presetProspectNazwa={prospect.nazwa}
			presetKlientId={prospect.klient_id ?? ''}
			presetKlientNazwa={prospect.crm_clients?.nazwa ?? prospect.nazwa}
			onclose={cancelTaskForm}
			onsaved={poZapisieZadania}
		/>
	{/if}

	<!-- Activity feed -->
	<div class="bg-white border border-line rounded-xl shadow-sm">
		<div class="px-6 py-4 border-b border-line-soft">
			<h2 class="text-sm font-semibold text-slate-700">Aktywność</h2>
			<p class="text-xs text-ink-3 mt-0.5">Notatki z rozmów, ustalenia, komentarze — jeden rodzaj wpisu, najnowsze na dole.</p>
		</div>

		<!-- Feed -->
		<div class="divide-y divide-line-soft max-h-[420px] overflow-y-auto">
			{#if activities.length === 0}
				<div class="px-6 py-8 text-center text-slate-400 text-sm">Brak aktywności — dodaj pierwszy wpis poniżej</div>
			{/if}
			{#each activities as act}
				<div class="px-6 py-4 flex gap-3 group">
					<div class="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0 mt-0.5">
						{(act.crm_profiles?.imie_nazwisko ?? 'U').charAt(0).toUpperCase()}
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 mb-1 flex-wrap">
							<span class="text-xs font-semibold text-slate-700">{act.crm_profiles?.imie_nazwisko ?? (act.author_id ? 'Użytkownik' : 'System')}</span>
							<span class="text-xs text-slate-400">{formatDate(act.created_at)}</span>
						</div>
						<p class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{act.tresc}</p>
					</div>
					<button onclick={() => deleteActivity(act.id)} class="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-red-500 transition-all self-start shrink-0">
						<Trash2 size={12} />
					</button>
				</div>
			{/each}
		</div>

		<!-- Input -->
		<div class="px-6 py-4 border-t border-line-soft bg-slate-50 rounded-b-xl">
			<textarea
				bind:value={newText}
				placeholder="Dodaj wpis — notatka z rozmowy, ustalenia, komentarz…"
				rows="3"
				class="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-white"
				onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addActivity(); }}
			></textarea>
			<div class="flex items-center justify-between mt-2">
				<span class="text-xs text-slate-400">Ctrl+Enter aby wysłać</span>
				<button
					onclick={addActivity}
					disabled={sending || !newText.trim()}
					class="inline-flex items-center gap-2 px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-40 transition-colors"
				>
					<Send size={13} /> Dodaj wpis
				</button>
			</div>
		</div>
	</div>
	</div>
{/if}
