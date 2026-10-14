<script lang="ts">
	// Karta klienta → „Scal z innym klientem”: wybór drugiego rekordu (szukaj po nazwie, NIP, e-mailu), który z dwóch
	// zostaje, podgląd tego, co zostanie przeniesione, i scalenie po stronie serwera (jedna transakcja).
	import Modal from '$lib/components/Modal.svelte';
	import { appState } from '$lib/stores/app.svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import type { Client } from '$lib/types/database';
	import { cyfry, domyslnyDocelowy, nazwaDoPorownan, nipPoprawny, odswiezPoScaleniu, opisPowiazan, opisWyniku, powiazaniaKlienta, scalKlientow } from '$lib/klienci';
	import { fmtDzien } from '$lib/utils';
	import { AlertTriangle, Search } from 'lucide-svelte';

	interface Props {
		klient: Client;
		open: boolean;
		onclose: () => void;
		/** Po scaleniu: id rekordu, który został. */
		onscalono: (docelowyId: string) => void;
	}
	let { klient, open, onclose, onscalono }: Props = $props();

	let szukaj = $state('');
	let drugiId = $state('');
	let docelowyId = $state('');
	let pracuje = $state(false);
	let blad = $state('');

	const drugi = $derived(appState.clients.find((c) => c.id === drugiId) ?? null);
	// Podpowiedzi: ten sam NIP / e-mail / telefon / nazwa na górze, potem wyniki wyszukiwania.
	const podobne = $derived.by(() => {
		const nip = cyfry(klient.nip);
		const email = (klient.email ?? '').trim().toLowerCase();
		const tel = cyfry(klient.telefon);
		const nazwa = nazwaDoPorownan(klient.nazwa_skrocona ?? klient.nazwa);
		return appState.clients.filter((c) => {
			if (c.id === klient.id) return false;
			return (nip.length >= 9 && cyfry(c.nip) === nip) || (!!email && (c.email ?? '').trim().toLowerCase() === email) || (tel.length >= 9 && cyfry(c.telefon) === tel) || (!!nazwa && nazwaDoPorownan(c.nazwa_skrocona ?? c.nazwa) === nazwa);
		});
	});
	const wyniki = $derived.by(() => {
		const q = szukaj.trim().toLowerCase();
		if (!q) return podobne.slice(0, 8);
		const qc = cyfry(q);
		return appState.clients
			.filter((c) => c.id !== klient.id && ((c.nazwa + ' ' + (c.nazwa_skrocona ?? '') + ' ' + (c.email ?? '')).toLowerCase().includes(q) || (qc.length >= 4 && (cyfry(c.nip).includes(qc) || cyfry(c.telefon).includes(qc)))))
			.slice(0, 8);
	});

	function wybierz(c: Client) {
		drugiId = c.id;
		docelowyId = domyslnyDocelowy([klient, c]).id;
		blad = '';
	}

	const usuwany = $derived(drugi ? (docelowyId === klient.id ? drugi : klient) : null);
	const zostaje = $derived(drugi ? (docelowyId === klient.id ? klient : drugi) : null);

	async function scal() {
		if (!drugi || !zostaje || !usuwany) return;
		pracuje = true;
		blad = '';
		const w = await scalKlientow(zostaje.id, [usuwany.id]);
		if (!w.ok) {
			blad = w.message;
			pracuje = false;
			return;
		}
		await odswiezPoScaleniu();
		pracuje = false;
		ctxToast(`Scalono klientów. ${opisWyniku(w.data)}`);
		const cel = w.data.docelowy;
		zamknij();
		onscalono(cel);
	}

	function zamknij() {
		szukaj = '';
		drugiId = '';
		docelowyId = '';
		blad = '';
		onclose();
	}

	const opis = (c: Client) => [c.nip ? `NIP ${c.nip}${nipPoprawny(c.nip) ? '' : ' (niepełny)'}` : 'bez NIP', c.email, c.telefon, c.created_at ? `od ${fmtDzien(c.created_at, true)}` : ''].filter(Boolean).join(' · ');
</script>

<Modal title="Scal z innym klientem" {open} onclose={zamknij}>
	{#snippet footer()}
		<button onclick={zamknij} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={scal} disabled={!drugi || pracuje} class="px-4 py-2 text-sm bg-danger text-white rounded-lg font-semibold hover:opacity-90 disabled:opacity-50">
			{pracuje ? 'Scalanie…' : usuwany ? `Scal i usuń „${usuwany.nazwa_skrocona ?? usuwany.nazwa}”` : 'Scal'}
		</button>
	{/snippet}

	<div class="space-y-4">
		<p class="text-sm text-slate-600">
			Wszystko, co ma usuwany rekord (polisy, wnioski o odnowienie, e-maile, zgłoszenia, zgody, zadania, szkody, pojazdy, kontakty, APK, lead), przechodzi na rekord, który zostaje. Puste pola zostającego rekordu uzupełniamy z usuwanego. Operacji nie da się cofnąć z aplikacji.
		</p>

		{#if !drugi}
			<label class="h-10 flex items-center gap-2 px-3 border border-line rounded-lg bg-white focus-within:border-accent">
				<Search size={16} class="text-ink-3 shrink-0" />
				<span class="sr-only">Szukaj klienta</span>
				<input bind:value={szukaj} placeholder="Nazwa, NIP, e-mail albo telefon drugiego rekordu…" class="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-3" data-testid="scal-szukaj" />
			</label>
			{#if !szukaj.trim() && podobne.length}
				<p class="text-xs font-semibold text-warn">Podobne rekordy (ten sam NIP, e-mail, telefon albo nazwa):</p>
			{/if}
			{#if wyniki.length}
				<ul class="divide-y divide-line-soft border border-line rounded-lg overflow-hidden">
					{#each wyniki as c (c.id)}
						<li>
							<button type="button" onclick={() => wybierz(c)} class="w-full text-left px-3 py-2 hover:bg-slate-50">
								<span class="block text-sm font-medium text-slate-900">{c.nazwa_skrocona ?? c.nazwa}</span>
								<span class="block text-xs text-slate-500">{opis(c)} · {opisPowiazan(powiazaniaKlienta(c.id))}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if szukaj.trim()}
				<p class="text-sm text-slate-400">Nic nie znaleziono.</p>
			{/if}
		{:else}
			<fieldset>
				<legend class="text-sm font-semibold text-slate-700 mb-2">Który rekord zostaje?</legend>
				<div class="space-y-2">
					{#each [klient, drugi] as c (c.id)}
						{@const p = powiazaniaKlienta(c.id)}
						<label class="flex items-start gap-3 p-3 border rounded-xl cursor-pointer {docelowyId === c.id ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-slate-50'}">
							<input type="radio" name="scal-docelowy" value={c.id} checked={docelowyId === c.id} onchange={() => (docelowyId = c.id)} class="mt-1 accent-blue-600" />
							<span class="min-w-0">
								<span class="block text-sm font-medium text-slate-900">{c.nazwa_skrocona ?? c.nazwa}{c.id === klient.id ? ' (ten klient)' : ''}</span>
								{#if c.nazwa_skrocona && c.nazwa_skrocona !== c.nazwa}<span class="block text-xs text-slate-500">{c.nazwa}</span>{/if}
								<span class="block text-xs text-slate-500">{opis(c)}</span>
								<span class="block text-xs {p.polisy ? 'text-emerald-700' : 'text-slate-400'}">{opisPowiazan(p)}{c.auth_user_id ? ' · logowanie do panelu' : ''}{c.beauty_id != null ? ` · BEAUTY ${c.beauty_id}` : ''}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>
			{#if usuwany}
				<p class="flex items-start gap-2 text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
					<AlertTriangle size={16} class="text-warn shrink-0 mt-0.5" />
					<span>Rekord <strong>{usuwany.nazwa_skrocona ?? usuwany.nazwa}</strong> zostanie usunięty, a jego dane ({opisPowiazan(powiazaniaKlienta(usuwany.id))}) przejdą na <strong>{zostaje?.nazwa_skrocona ?? zostaje?.nazwa}</strong>.</span>
				</p>
			{/if}
			<button type="button" onclick={() => { drugiId = ''; docelowyId = ''; }} class="text-xs font-semibold text-accent-text hover:underline">Wybierz inny rekord</button>
		{/if}

		{#if blad}<p class="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}
	</div>
</Modal>
