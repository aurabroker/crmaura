<script lang="ts">
	// Ustawienia → System: klucz, którym arkusz zgłoszeń (Apps Script) wysyła zgłoszenia do CRM, albo — przy
	// zakres="asystent_ai" — klucz workera konsultacji AI (wysyłka wniosku online na prośbę klienta).
	// Klucz widać tylko raz, zaraz po wygenerowaniu — w bazie zostaje jego skrót. Nowy klucz wyłącza poprzedni
	// klucz tego samego zakresu; klucze arkusza i asystenta są niezależne.
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { fmtDzien } from '$lib/utils';
	import { Copy, KeyRound } from 'lucide-svelte';

	// Ten sam zbiór co ZakresKlucza w $lib/server/zgloszenia (moduł serwerowy, tu niedostępny).
	type Zakres = 'zgloszenia' | 'asystent_ai';
	let { zakres = 'zgloszenia' }: { zakres?: Zakres } = $props();
	const asystent = $derived(zakres === 'asystent_ai');
	const api = $derived(`/api/integracje/klucze?zakres=${zakres}`);

	type Klucz = { id: string; prefiks: string; created_at: string; ostatnio_uzyty_at: string | null };
	type Stan = { aktywny: Klucz | null; zgloszen?: number; ostatnie?: { zgloszono_at: string; firma: string | null } | null };

	let stan = $state<Stan | null>(null);
	let nowy = $state('');
	let blad = $state('');
	let trwa = $state(false);
	let skopiowano = $state('');
	const adres = typeof location !== 'undefined' ? `${location.origin}/api/leady/zgloszenia` : '/api/leady/zgloszenia';

	async function naglowki(): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
	}
	async function wczytaj() {
		blad = '';
		const res = await fetch(api, { headers: await naglowki() });
		if (!res.ok) { blad = ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Błąd ${res.status}`; return; }
		stan = (await res.json()) as Stan;
	}
	async function generuj() {
		const ostrzezenie = asystent
			? 'Dotychczasowy klucz przestanie działać — asystent AI nie wyśle wniosku, dopóki nie wkleisz nowego klucza w workerze. Kontynuować?'
			: 'Dotychczasowy klucz przestanie działać — arkusz będzie wymagał wklejenia nowego. Kontynuować?';
		if (stan?.aktywny && !(await askConfirm({ title: 'Nowy klucz', message: ostrzezenie, confirmLabel: 'Wygeneruj', danger: false }))) return;
		trwa = true; blad = '';
		const res = await fetch(api, { method: 'POST', headers: await naglowki(), body: '{}' });
		trwa = false;
		if (!res.ok) { blad = ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Błąd ${res.status}`; return; }
		const d = (await res.json()) as { klucz: string; aktywny: Klucz };
		nowy = d.klucz;
		stan = { ...(stan ?? {}), aktywny: d.aktywny };
	}
	async function wylacz() {
		const skutek = asystent
			? 'Asystent AI przestanie wysyłać klientom link do wniosku online, dopóki nie wkleisz nowego klucza w workerze.'
			: 'Arkusz przestanie przekazywać zgłoszenia do CRM, dopóki nie wkleisz nowego klucza.';
		if (!(await askConfirm({ title: 'Wyłączyć klucz?', message: skutek, confirmLabel: 'Wyłącz', danger: true }))) return;
		trwa = true;
		const res = await fetch(api, { method: 'DELETE', headers: await naglowki() });
		trwa = false;
		if (res.ok) { nowy = ''; await wczytaj(); }
	}
	async function kopiuj(tekst: string, co: string) {
		try { await navigator.clipboard.writeText(tekst); skopiowano = co; setTimeout(() => (skopiowano = ''), 2000); } catch { /* schowek niedostępny — tekst można zaznaczyć ręcznie */ }
	}
	onMount(wczytaj);
</script>

<section aria-labelledby="integracja-{zakres}" class="bg-white border border-line rounded-xl px-5 py-4 mb-6">
	<div class="flex flex-wrap items-start gap-3">
		<KeyRound size={18} class="text-ink-3 mt-0.5" aria-hidden="true" />
		<div class="flex-1 min-w-[240px]">
			{#if asystent}
				<h2 id="integracja-{zakres}" class="text-[15px] font-semibold text-ink">Klucz asystenta AI (konsultacja)</h2>
				<p class="text-[13px] text-ink-2 mt-0.5">
					Asystentka AI na stronie konsultacji wysyła tym kluczem klientowi z karty link do wniosku online (pierwsza polisa
					albo odnowienie), gdy klient o to poprosi. Klucz arkusza zgłoszeń działa niezależnie.
				</p>
			{:else}
				<h2 id="integracja-{zakres}" class="text-[15px] font-semibold text-ink">Formularz zgłoszeń (arkusz Google)</h2>
				<p class="text-[13px] text-ink-2 mt-0.5">
					Skrypt arkusza wysyła każde zgłoszenie do CRM. Nowa firma od razu trafia do Klientów i Leadów, a ponowne zgłoszenie
					znanej firmy pokazuje agentowi komunikat „Klient po raz kolejny prosi o ofertę” i zakłada zadanie na dziś.
				</p>
			{/if}
		</div>
	</div>

	{#if blad}<p class="mt-3 text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}

	{#if stan}
		<dl class="mt-3 grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
			{#if !asystent}
				<dt class="text-ink-3">Adres dla skryptu</dt>
				<dd class="flex items-center gap-2 min-w-0">
					<code class="font-mono text-xs text-ink truncate">{adres}</code>
					<button onclick={() => kopiuj(adres, 'adres')} class="shrink-0 text-xs font-semibold text-accent-text hover:underline">{skopiowano === 'adres' ? 'skopiowano' : 'kopiuj'}</button>
				</dd>
			{/if}
			<dt class="text-ink-3">Klucz</dt>
			<dd>
				{#if stan.aktywny}
					<span class="font-mono text-xs">{stan.aktywny.prefiks}…</span>
					<span class="text-ink-3"> · od {fmtDzien(stan.aktywny.created_at.slice(0, 10), true)}{stan.aktywny.ostatnio_uzyty_at ? ` · ostatnio użyty ${fmtDzien(stan.aktywny.ostatnio_uzyty_at.slice(0, 10), true)}` : ' · jeszcze nieużyty'}</span>
				{:else}
					<span class="text-ink-3">{asystent ? 'brak — asystent AI nie wysyła wniosków' : 'brak — arkusz nie przekazuje zgłoszeń'}</span>
				{/if}
			</dd>
			{#if !asystent}
				<dt class="text-ink-3">Zgłoszenia w CRM</dt>
				<dd class="tabular-nums">{stan.zgloszen ?? 0}{stan.ostatnie ? ` · ostatnie ${fmtDzien(stan.ostatnie.zgloszono_at.slice(0, 10), true)}${stan.ostatnie.firma ? ` (${stan.ostatnie.firma})` : ''}` : ''}</dd>
			{/if}
		</dl>

		{#if nowy}
			<div class="mt-3 rounded-lg border border-warn bg-warn-soft px-3 py-2.5">
				<p class="text-[13px] font-semibold text-ink">Skopiuj klucz teraz — później nie będzie go widać.</p>
				<div class="mt-1.5 flex items-center gap-2 min-w-0">
					<code class="flex-1 min-w-0 font-mono text-xs bg-white border border-line rounded px-2 py-1.5 break-all select-all">{nowy}</code>
					<button onclick={() => kopiuj(nowy, 'klucz')} class="shrink-0 h-8 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover"><Copy size={14} /> {skopiowano === 'klucz' ? 'Skopiowano' : 'Kopiuj'}</button>
				</div>
				{#if asystent}
					<p class="mt-1.5 text-xs text-ink-2">Wklej go jako sekret <span class="font-mono">CRM_ASYSTENT_KEY</span> workera konsultacja-agent: w folderze <span class="font-mono">worker</span> polecenie <span class="font-mono">npx wrangler secret put CRM_ASYSTENT_KEY</span>.</p>
				{:else}
					<p class="mt-1.5 text-xs text-ink-2">W arkuszu: Rozszerzenia → Apps Script → Ustawienia projektu → Właściwości skryptu → <span class="font-mono">CRM_KLUCZ</span>.</p>
				{/if}
			</div>
		{/if}

		<div class="mt-3 flex flex-wrap gap-2">
			<button onclick={generuj} disabled={trwa} class="h-9 px-4 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-60">{stan.aktywny ? 'Wygeneruj nowy klucz' : 'Wygeneruj klucz'}</button>
			{#if stan.aktywny}
				<button onclick={wylacz} disabled={trwa} class="h-9 px-4 rounded-lg border border-line bg-white text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60">Wyłącz klucz</button>
			{/if}
		</div>
	{:else if !blad}
		<p class="mt-3 text-[13px] text-ink-3">Wczytuję…</p>
	{/if}
</section>
