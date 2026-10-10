<script lang="ts">
	// „Napisz e-mail” z Panelu 360°: adresaci (klient i osoby kontaktowe), szablon, polisa, treść,
	// załączniki PDF polis z magazynu. Wysyła serwer kluczem Resend firmy; wiadomość trafia do historii.
	import { untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { fmtDzien, todayStr } from '$lib/utils';
	import { nazwaRodzaju, nazwaTu } from '$lib/statusPolisy';
	import { magazynDostepny, rozmiar, wczytajPlikiPolis, RODZAJ_PLIKU, type PlikPolisy } from '$lib/plikiPolis';
	import { SZABLONY, zbudujSzablon, type Szablon } from '$lib/szablonyEmail';
	import type { Client, ClientContact, Policy } from '$lib/types/database';
	import { AlertTriangle, Paperclip, Send } from 'lucide-svelte';

	let {
		open,
		klient,
		polisy,
		kontakty,
		szablonStartowy = 'wlasny',
		polisaStartowa = null,
		onclose,
		onwyslano
	}: {
		open: boolean;
		klient: Client;
		polisy: Policy[];
		kontakty: ClientContact[];
		szablonStartowy?: Szablon;
		polisaStartowa?: string | null;
		onclose: () => void;
		onwyslano: () => void;
	} = $props();

	const dzis = todayStr();
	type Adres = { adres: string; etykieta: string };
	const adresy = $derived<Adres[]>(
		[
			...(klient.email ? [{ adres: klient.email.trim(), etykieta: `${klient.nazwa_skrocona ?? klient.nazwa} (klient)` }] : []),
			...kontakty.filter((c) => c.email).map((c) => ({ adres: c.email!.trim(), etykieta: `${c.imie_nazwisko}${c.stanowisko ? `, ${c.stanowisko}` : ''}` }))
		].filter((a, i, t) => t.findIndex((x) => x.adres.toLowerCase() === a.adres.toLowerCase()) === i)
	);
	// Najnowsze umowy na górze listy
	const polisySort = $derived([...polisy].sort((a, b) => (b.data_od ?? '').localeCompare(a.data_od ?? '')));
	const OTWARTE = ['Oczekująca', 'Zaległa'];
	/** Polisa, której szablon dotyczy najpewniej: rata → najstarsza nieopłacona rata, odnowienie → najbliższy koniec, reszta → najnowsza. */
	function domyslnaPolisa(s: Szablon): string {
		if (s === 'rata') {
			const ids = new Set(polisy.map((p) => p.id));
			const r = appState.payments.filter((x) => ids.has(x.polisa_id) && OTWARTE.includes(x.status)).sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci))[0];
			if (r) return r.polisa_id;
		}
		if (s === 'odnowienie') {
			const p = polisy.filter((x) => x.data_do && x.data_do >= dzis).sort((a, b) => a.data_do.localeCompare(b.data_do))[0];
			if (p) return p.id;
		}
		return polisySort[0]?.id ?? '';
	}

	let wybrani = $state<Set<string>>(new Set());
	let szablon = $state<Szablon>('wlasny');
	let polisaId = $state('');
	let temat = $state('');
	let tresc = $state('');
	let zalaczniki = $state<Set<string>>(new Set());
	let pliki = $state<PlikPolisy[]>([]);
	let magazyn = $state(false);
	let ustawienia = $state<{ gotowe: boolean; nadawca: string | null; odpowiedzi: string | null } | null>(null);
	let wysylanie = $state(false);
	let blad = $state('');

	async function naglowki(): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
	}

	// Przy każdym otwarciu: świeży stan, ustawienia wysyłki i pliki polis klienta.
	let byloOtwarte = false;
	$effect(() => {
		if (open && !byloOtwarte) untrack(() => {
			blad = '';
			wybrani = new Set(adresy.slice(0, 1).map((a) => a.adres));
			szablon = szablonStartowy;
			polisaId = polisaStartowa ?? (SZABLONY.find((s) => s.id === szablonStartowy)?.polisa ? domyslnaPolisa(szablonStartowy) : '');
			zalaczniki = new Set();
			przelicz();
			void (async () => {
				const [u, lista, ok] = await Promise.all([
					fetch('/api/email/ustawienia', { headers: await naglowki() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
					wczytajPlikiPolis(polisy.map((p) => p.id)),
					magazynDostepny()
				]);
				ustawienia = u;
				pliki = lista;
				magazyn = ok;
				if (szablon === 'potwierdzenie') { zaznaczPdfPolisy(); przelicz(); }
			})();
		});
		byloOtwarte = open;
	});

	const polisa = $derived(polisy.find((p) => p.id === polisaId) ?? null);
	const nazwaPolisy = (id: string) => polisy.find((p) => p.id === id)?.nr_polisy ?? '—';

	function zaznaczPdfPolisy() {
		const pdf = pliki.find((f) => f.polisa_id === polisaId && f.rodzaj === 'polisa');
		if (pdf) zalaczniki = new Set([...zalaczniki, pdf.id]);
	}

	function przelicz() {
		const prof = appState.profile as (typeof appState.profile & { telefon?: string | null }) | null;
		const t = zbudujSzablon(szablon, {
			klient,
			polisa,
			raty: appState.payments.filter((r) => r.polisa_id === polisaId),
			zalacznikPolisy: pliki.some((f) => f.polisa_id === polisaId && zalaczniki.has(f.id)),
			nadawca: { imie: prof?.imie_nazwisko ?? null, stanowisko: prof?.stanowisko ?? null, telefon: prof?.telefon ?? null, firma: appState.tenantNazwa },
			dzis
		});
		temat = t.temat;
		tresc = t.tresc;
	}

	function wybierzSzablon(s: Szablon) {
		szablon = s;
		if (SZABLONY.find((x) => x.id === s)?.polisa) polisaId = domyslnaPolisa(s);
		if (s === 'potwierdzenie') zaznaczPdfPolisy();
		przelicz();
	}
	function wybierzPolise(id: string) {
		polisaId = id;
		if (szablon === 'potwierdzenie') zaznaczPdfPolisy();
		if (szablon !== 'wlasny') przelicz();
	}
	function przelaczAdres(a: string) {
		const n = new Set(wybrani);
		if (n.has(a)) n.delete(a); else n.add(a);
		wybrani = n;
	}
	function przelaczZalacznik(id: string) {
		const n = new Set(zalaczniki);
		if (n.has(id)) n.delete(id); else n.add(id);
		zalaczniki = n;
	}

	const mailto = $derived(`mailto:${[...wybrani].join(',')}?subject=${encodeURIComponent(temat)}&body=${encodeURIComponent(tresc)}`);
	const moznaWyslac = $derived(!!ustawienia?.gotowe && wybrani.size > 0 && !!temat.trim() && !!tresc.trim() && !wysylanie);

	async function wyslij() {
		if (!moznaWyslac) return;
		wysylanie = true;
		blad = '';
		try {
			const res = await fetch(`/api/klienci/${klient.id}/email`, {
				method: 'POST',
				headers: await naglowki(),
				body: JSON.stringify({
					do: [...wybrani],
					temat,
					tresc,
					polisa_ids: polisaId ? [polisaId] : [],
					zalaczniki: [...zalaczniki]
				})
			});
			const d = (await res.json().catch(() => null)) as { message?: string; adresy?: string[] } | null;
			if (!res.ok) throw new Error(d?.message ?? `Błąd ${res.status}`);
			ctxToast(`Wysłano e-mail: ${(d?.adresy ?? [...wybrani]).join(', ')}`);
			onwyslano();
			onclose();
		} catch (e) {
			blad = (e as Error).message;
		} finally {
			wysylanie = false;
		}
	}
</script>

<Modal title="Napisz e-mail — {klient.nazwa_skrocona ?? klient.nazwa}" {open} {onclose} windowed>
	{#snippet footer()}
		<a href={mailto} class="mr-auto self-center text-[13px] font-medium text-ink-2 hover:text-accent-text hover:underline">Otwórz w programie pocztowym</a>
		<button onclick={onclose} class="px-4 py-2 text-sm border border-line rounded-lg text-ink-2 hover:bg-surface-2">Anuluj</button>
		<button onclick={wyslij} disabled={!moznaWyslac} class="flex items-center gap-1.5 px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-50">
			<Send size={15} /> {wysylanie ? 'Wysyłanie…' : 'Wyślij'}
		</button>
	{/snippet}

	<div class="flex flex-col gap-4 text-sm">
		{#if ustawienia && !ustawienia.gotowe}
			<p class="flex items-start gap-2 text-[13px] text-warn bg-warn-soft rounded-lg px-3 py-2">
				<AlertTriangle size={15} class="shrink-0 mt-0.5" />
				Wysyłka z CRM nie jest skonfigurowana dla firmy (klucz Resend i adres nadawcy w SAAS Admin). Możesz otworzyć wiadomość w programie pocztowym.
			</p>
		{/if}
		{#if blad}<p class="text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}

		<fieldset>
			<legend class="text-[13px] font-semibold text-ink mb-1.5">Do</legend>
			{#if adresy.length === 0}
				<p class="text-[13px] text-ink-3">Klient nie ma adresu e-mail. Dodaj go w danych klienta albo przy osobie kontaktowej.</p>
			{:else}
				<div class="flex flex-col gap-1">
					{#each adresy as a (a.adres)}
						<label class="flex items-center gap-2 cursor-pointer min-w-0">
							<input type="checkbox" checked={wybrani.has(a.adres)} onchange={() => przelaczAdres(a.adres)} class="w-4 h-4 accent-accent shrink-0" />
							<span class="text-ink truncate">{a.adres}</span>
							<span class="text-xs text-ink-3 truncate min-w-0">{a.etykieta}</span>
						</label>
					{/each}
				</div>
			{/if}
		</fieldset>

		<div>
			<span class="block text-[13px] font-semibold text-ink mb-1.5">Szablon</span>
			<div role="group" aria-label="Szablon wiadomości" class="flex flex-wrap gap-1.5">
				{#each SZABLONY as s}
					<button
						aria-pressed={szablon === s.id}
						onclick={() => wybierzSzablon(s.id)}
						disabled={s.polisa && polisy.length === 0}
						class="h-8 px-3 rounded-full text-[13px] border disabled:opacity-40 {szablon === s.id ? 'bg-ink text-white border-ink font-semibold' : 'bg-white text-ink-2 border-line hover:bg-surface-2'}"
					>{s.nazwa}</button>
				{/each}
			</div>
		</div>

		{#if polisy.length > 0}
			<label class="block">
				<span class="block text-[13px] font-semibold text-ink mb-1.5">Dotyczy polisy</span>
				<select value={polisaId} onchange={(e) => wybierzPolise((e.currentTarget as HTMLSelectElement).value)} class="w-full h-9 px-2.5 border border-line rounded-lg bg-white text-sm">
					<option value="">— bez polisy —</option>
					{#each polisySort as p (p.id)}
						<option value={p.id}>{p.nr_polisy} · {nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)} · do {fmtDzien(p.data_do, true)}</option>
					{/each}
				</select>
			</label>
		{/if}

		<label class="block">
			<span class="block text-[13px] font-semibold text-ink mb-1.5">Temat</span>
			<input bind:value={temat} maxlength="200" class="w-full h-9 px-3 border border-line rounded-lg text-sm focus:outline-none focus:border-accent" />
		</label>
		<label class="block">
			<span class="block text-[13px] font-semibold text-ink mb-1.5">Treść</span>
			<textarea bind:value={tresc} rows="13" maxlength="10000" class="w-full px-3 py-2 border border-line rounded-lg text-sm leading-relaxed focus:outline-none focus:border-accent"></textarea>
		</label>

		{#if pliki.length > 0}
			<fieldset>
				<legend class="flex items-center gap-1.5 text-[13px] font-semibold text-ink mb-1.5"><Paperclip size={14} /> Załączniki (PDF polis klienta)</legend>
				<div class="flex flex-col gap-1">
					{#each pliki as f (f.id)}
						<label class="flex items-center gap-2 cursor-pointer min-w-0">
							<input type="checkbox" checked={zalaczniki.has(f.id)} onchange={() => przelaczZalacznik(f.id)} disabled={!magazyn} class="w-4 h-4 accent-accent" />
							<span class="text-ink truncate">{f.nazwa}</span>
							<span class="text-xs text-ink-3 whitespace-nowrap">{RODZAJ_PLIKU[f.rodzaj]} · polisa {nazwaPolisy(f.polisa_id)} · {rozmiar(f.rozmiar)}</span>
						</label>
					{/each}
				</div>
			</fieldset>
		{:else if magazyn && polisy.length > 0}
			<p class="text-xs text-ink-3">Polisy klienta nie mają zapisanych PDF — dodasz je na karcie polisy (sekcja „Dokumenty”).</p>
		{/if}

		{#if ustawienia?.nadawca}
			<p class="text-xs text-ink-3 border-t border-line-soft pt-3">
				Od: {ustawienia.nadawca}{ustawienia.odpowiedzi ? ` · odpowiedzi trafią na ${ustawienia.odpowiedzi}` : ''} · wiadomość zapisze się w historii e-maili klienta
			</p>
		{/if}
	</div>
</Modal>
