<script lang="ts">
	// Flota / Pojazdy klienta (Panel 360°): każdy pojazd ze stanem ochrony liczonym z jego polis, historią ochrony,
	// odnowieniem i powiązaniem polis komunikacyjnych, które nie mają jeszcze pojazdu. Formularz pojazdu
	// (dodanie / edycja) ma karta klienta — tu tylko wywołania onnew / onedit.
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { wczytajPojazdy, wczytajPolisy } from '$lib/kolekcje';
	import { askConfirm } from '$lib/stores/confirm.svelte';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { logAudit } from '$lib/utils/audit';
	import { fmtDzien, fmtPln, odmiana, todayStr } from '$lib/utils';
	import { nazwaRodzaju, nazwaTu, polisaAktywna } from '$lib/statusPolisy';
	import { adresOdnowieniaRecznego } from '$lib/formularzPolisy';
	import { DNI_OSTRZEZENIA_FLOTY, etykietaRodzajuPojazdu, ochronaPojazdu, opisTechniczny, podsumowanieFloty, polisyBezPojazdu, polisyPojazdu, sortujPojazdy } from '$lib/flota';
	import Kopiuj from '$lib/components/Kopiuj.svelte';
	import type { Policy, Vehicle } from '$lib/types/database';
	import { Car, ChevronRight, Link, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-svelte';

	let {
		klientId,
		pojazdy,
		polisy,
		dzis = todayStr(),
		onnew,
		onedit
	}: { klientId: string; pojazdy: Vehicle[]; polisy: Policy[]; dzis?: string; onnew: () => void; onedit: (v: Vehicle) => void } = $props();

	const podsum = $derived(podsumowanieFloty(pojazdy, polisy, dzis));
	const lista = $derived(sortujPojazdy(pojazdy, polisy, dzis));
	const bezPojazdu = $derived(polisyBezPojazdu(polisy));

	let rozwiniety = $state<string | null>(null);
	// Powiązanie: pojazd → polisa (z wiersza pojazdu) albo polisa → pojazd (z listy polis bez pojazdu).
	let wiazePojazd = $state<string | null>(null);
	let wybranaPolisa = $state('');
	let wybranyPojazd = $state<Record<string, string>>({});
	let zapis = $state(false);

	const data = (iso: string | null | undefined) => (iso ? fmtDzien(iso.slice(0, 10), true) : '—');

	async function odswiezPolisy() {
		const { data: d, error } = await wczytajPolisy();
		if (!error && d) appState.policies = d as typeof appState.policies;
	}

	async function powiaz(polisaId: string, pojazdId: string) {
		if (!polisaId || !pojazdId || zapis) return;
		zapis = true;
		const { error } = await sb.from('crm_policies').update({ pojazd_id: pojazdId } as never).eq('id', polisaId);
		zapis = false;
		if (error) { ctxToast(`Nie udało się powiązać: ${error.message}`); return; }
		const v = pojazdy.find((x) => x.id === pojazdId);
		const p = polisy.find((x) => x.id === polisaId);
		await logAudit('policy_updated', 'policy', polisaId, p?.nr_polisy ?? '', { pojazd_id: pojazdId, nr_rejestracyjny: v?.nr_rejestracyjny ?? null });
		wiazePojazd = null;
		wybranaPolisa = '';
		await odswiezPolisy();
		ctxToast(`Powiązano polisę ${p?.nr_polisy ?? ''} z pojazdem ${v?.nr_rejestracyjny ?? ''}`);
	}

	function nowaPolisa(v: Vehicle) {
		const przedmiot = [v.nr_rejestracyjny, v.marka_model].filter(Boolean).join(' ') + (v.vin ? ` / ${v.vin}` : '');
		goto(`/policies/new?klient=${klientId}&rodzaj=komunikacja&przedmiot=${encodeURIComponent(przedmiot)}&pojazd_id=${v.id}`);
	}

	async function usun(v: Vehicle) {
		const historia = polisyPojazdu(v.id, polisy);
		if (historia.length) {
			ctxToast(`Nie można usunąć — pojazd ma ${odmiana(historia.length, 'polisę', 'polisy', 'polis')} w historii.`);
			return;
		}
		const ok = await askConfirm({
			title: 'Usunąć pojazd?',
			message: `${v.nr_rejestracyjny} — ${v.marka_model || 'bez nazwy'}`,
			detail: 'Operacji nie da się cofnąć.',
			confirmLabel: 'Usuń'
		});
		if (!ok) return;
		const { error } = await sb.from('crm_vehicles').delete().eq('id', v.id);
		if (error) { ctxToast(`Nie udało się usunąć: ${error.message}`); return; }
		await logAudit('vehicle_deleted', 'vehicle', v.id, v.nr_rejestracyjny);
		const { data: d } = await wczytajPojazdy();
		appState.vehicles = (d ?? []) as typeof appState.vehicles;
	}
</script>

<section aria-label="Pojazdy klienta" data-testid="flota" class="bg-white border border-line rounded-xl overflow-hidden">
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 border-b border-line-soft">
		<div class="flex items-center gap-2">
			<Car size={16} class="text-ink-3" aria-hidden="true" />
			<h2 class="text-[15px] font-semibold text-ink">Pojazdy <span class="font-normal text-ink-3 tabular-nums">{podsum.n}</span></h2>
		</div>
		{#if podsum.n}
			<div class="flex flex-wrap gap-1.5 text-xs font-semibold" data-testid="flota-podsumowanie">
				<span class="h-[22px] leading-[22px] px-2 rounded-full bg-ok-soft text-ok">{podsum.zOchrona} z ochroną</span>
				{#if podsum.konczaceSie}<span class="h-[22px] leading-[22px] px-2 rounded-full bg-warn-soft text-warn">{podsum.konczaceSie} kończy się w {DNI_OSTRZEZENIA_FLOTY} dni</span>{/if}
				{#if podsum.bezOchrony}<span class="h-[22px] leading-[22px] px-2 rounded-full bg-danger-soft text-danger">{podsum.bezOchrony} bez ochrony</span>{/if}
			</div>
		{/if}
		<button onclick={onnew} data-testid="flota-dodaj" class="ml-auto h-8 flex items-center gap-1 pl-2 pr-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover transition-colors">
			<Plus size={14} /> Dodaj pojazd
		</button>
	</div>

	{#if lista.length === 0}
		<div class="px-5 py-10 text-center">
			<Car size={24} class="mx-auto mb-2 text-ink-3 opacity-60" aria-hidden="true" />
			<p class="text-sm text-ink-2">Ten klient nie ma jeszcze pojazdów w CRM.</p>
			<p class="text-xs text-ink-3 mt-1">Dodaj pojazd, a zobaczysz tu ochronę OC / AC, historię polis i odnowienia w jednym miejscu.</p>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[840px] text-left text-sm">
				<thead>
					<tr class="bg-surface-2 text-[13px] font-semibold text-ink-2">
						<th class="px-5 py-2.5">Pojazd</th>
						<th class="px-5 py-2.5">Dane</th>
						<th class="px-5 py-2.5">Ochrona</th>
						<th class="px-5 py-2.5 text-right">Polisy</th>
						<th class="px-5 py-2.5"><span class="sr-only">Akcje</span></th>
					</tr>
				</thead>
				<tbody>
					{#each lista as v (v.id)}
						{@const o = ochronaPojazdu(v.id, polisy, dzis)}
						{@const historia = polisyPojazdu(v.id, polisy)}
						{@const rodzaj = etykietaRodzajuPojazdu(v.rodzaj_pojazdu)}
						{@const tech = opisTechniczny(v)}
						{@const otwarty = rozwiniety === v.id}
						<tr class="border-t border-line-soft align-top hover:bg-slate-50/60" data-testid="pojazd" data-stan={o.stan}>
							<td class="px-5 py-3">
								<div class="flex items-center gap-1 font-semibold text-ink whitespace-nowrap">
									<span class="font-mono tracking-wide">{v.nr_rejestracyjny}</span> <Kopiuj tekst={v.nr_rejestracyjny} opis="nr rejestracyjny" />
								</div>
								<div class="text-[13px] text-ink-2">{v.marka_model || '—'}</div>
								{#if rodzaj || v.rok_produkcji}
									<div class="text-xs text-ink-3">{[rodzaj, v.rok_produkcji ? `rocznik ${v.rok_produkcji}` : null].filter(Boolean).join(' · ')}</div>
								{/if}
							</td>
							<td class="px-5 py-3">
								<div class="flex items-center gap-1 font-mono text-xs text-ink-2 whitespace-nowrap">
									{v.vin ?? 'VIN —'} {#if v.vin}<Kopiuj tekst={v.vin} opis="VIN" />{/if}
								</div>
								{#if tech}<div class="text-xs text-ink-3 mt-0.5">{tech}</div>{/if}
							</td>
							<td class="px-5 py-3">
								<span class="inline-block h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold {o.cls}" data-testid="pojazd-ochrona">{o.tekst}</span>
								{#each o.czynne as p (p.id)}
									<div class="mt-1 text-[13px]">
										<a href="/policies/{p.id}" class="font-medium text-accent-text hover:underline">{nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)} · {p.nr_polisy}</a>
										<span class="text-ink-3"> do {data(p.data_do)}</span>
									</div>
								{/each}
								{#if o.nastepna}
									<div class="mt-1 text-xs text-ink-3">odnowienie <a href="/policies/{o.nastepna.id}" class="text-accent-text hover:underline">{o.nastepna.nr_polisy}</a> od {data(o.nastepna.data_od)}</div>
								{/if}
								{#if o.stan === 'wygasla' && o.ostatnia}
									<div class="mt-1 text-xs text-ink-3">ostatnia: <a href="/policies/{o.ostatnia.id}" class="text-accent-text hover:underline">{o.ostatnia.nr_polisy}</a> · {nazwaTu(o.ostatnia)} · do {data(o.ostatnia.data_do)}</div>
								{/if}
							</td>
							<td class="px-5 py-3 text-right whitespace-nowrap">
								{#if historia.length}
									<button onclick={() => (rozwiniety = otwarty ? null : v.id)} aria-expanded={otwarty} class="inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
										{odmiana(historia.length, 'polisa', 'polisy', 'polis')} <ChevronRight size={14} class="transition-transform {otwarty ? 'rotate-90' : ''}" />
									</button>
								{:else}
									<span class="text-xs text-ink-3">—</span>
								{/if}
							</td>
							<td class="px-5 py-3 whitespace-nowrap">
								<div class="flex items-center justify-end gap-1.5 {wiazePojazd === v.id ? 'flex-wrap' : ''}">
									{#if (o.stan === 'konczy_sie' || o.stan === 'wygasla') && o.ostatnia}
										<a href={adresOdnowieniaRecznego(o.ostatnia)} data-testid="pojazd-odnow" class="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent-hover"><RefreshCw size={13} /> Odnów</a>
									{:else if o.stan === 'brak'}
										<button onclick={() => nowaPolisa(v)} class="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg border border-line bg-white text-[13px] font-medium text-ink hover:bg-surface-2"><Plus size={13} /> Nowa polisa</button>
									{/if}
									{#if bezPojazdu.length}
										{#if wiazePojazd === v.id}
											<select bind:value={wybranaPolisa} aria-label="Polisa do powiązania z pojazdem {v.nr_rejestracyjny}" class="h-8 border border-line rounded-lg px-2 text-xs bg-white">
												<option value="">— wybierz polisę —</option>
												{#each bezPojazdu as p (p.id)}
													<option value={p.id}>{p.nr_polisy} · {nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)} · {p.data_od} – {p.data_do}</option>
												{/each}
											</select>
											<button onclick={() => powiaz(wybranaPolisa, v.id)} disabled={!wybranaPolisa || zapis} class="h-8 px-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-50">{zapis ? '…' : 'Powiąż'}</button>
											<button onclick={() => { wiazePojazd = null; wybranaPolisa = ''; }} class="h-8 px-2 rounded-lg border border-line text-xs text-ink-2 hover:bg-surface-2">Anuluj</button>
										{:else}
											<button onclick={() => { wiazePojazd = v.id; wybranaPolisa = ''; }} title="Przypisz do pojazdu polisę komunikacyjną, która nie ma jeszcze pojazdu" class="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg border border-line bg-white text-[13px] font-medium text-ink hover:bg-surface-2"><Link size={13} /> Powiąż</button>
										{/if}
									{/if}
									<button onclick={() => onedit(v)} aria-label="Edytuj pojazd {v.nr_rejestracyjny}" title="Edytuj" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2"><Pencil size={14} /></button>
									{#if !historia.length}
										<button onclick={() => usun(v)} aria-label="Usuń pojazd {v.nr_rejestracyjny}" title="Usuń" class="w-8 h-8 flex items-center justify-center rounded-lg text-ink-3 hover:text-danger hover:bg-danger-soft"><Trash2 size={14} /></button>
									{/if}
								</div>
							</td>
						</tr>
						{#if otwarty}
							<tr class="bg-surface-2/60" data-testid="pojazd-historia">
								<td colspan="5" class="px-5 py-3">
									<p class="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-2">Historia ochrony</p>
									<div class="bg-white border border-line rounded-lg overflow-x-auto">
										<table class="w-full text-left text-[13px]">
											<thead>
												<tr class="text-xs font-semibold text-ink-3">
													<th class="px-3 py-2">Polisa</th>
													<th class="px-3 py-2">Rodzaj</th>
													<th class="px-3 py-2">TU</th>
													<th class="px-3 py-2">Okres</th>
													<th class="px-3 py-2 text-right">Składka</th>
													<th class="px-3 py-2">Stan</th>
												</tr>
											</thead>
											<tbody>
												{#each historia as p (p.id)}
													{@const czynna = (p.data_od ?? '') <= dzis && polisaAktywna(p, dzis)}
													<tr class="border-t border-line-soft">
														<td class="px-3 py-2 whitespace-nowrap"><a href="/policies/{p.id}" class="font-medium text-accent-text hover:underline">{p.nr_polisy}</a> <Kopiuj tekst={p.nr_polisy} opis="nr polisy" /></td>
														<td class="px-3 py-2 text-ink-2">{nazwaRodzaju(p.rodzaj)}</td>
														<td class="px-3 py-2 text-ink-2">{nazwaTu(p)}</td>
														<td class="px-3 py-2 text-ink-2 whitespace-nowrap">{data(p.data_od)} – {data(p.data_do)}</td>
														<td class="px-3 py-2 text-right tabular-nums">{fmtPln(p.skladka_przypisana)} zł</td>
														<td class="px-3 py-2">
															<span class="inline-flex items-center gap-1.5 text-xs">
																{#if czynna}
																	<span class="h-5 leading-5 px-1.5 rounded-full bg-ok-soft text-ok font-semibold">czynna</span>
																{:else if (p.data_od ?? '') > dzis}
																	<span class="h-5 leading-5 px-1.5 rounded-full bg-accent-soft text-accent-text font-semibold">oczekująca</span>
																{:else}
																	<span class="h-5 leading-5 px-1.5 rounded-full bg-surface-2 text-ink-2 font-semibold">zakończona</span>
																{/if}
																{#if p.renewal_of}<span class="text-ink-3 inline-flex items-center gap-0.5"><RefreshCw size={11} /> odnowienie</span>{/if}
															</span>
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
									{#if o.stan !== 'czynna' && o.stan !== 'oczekujaca' && o.ostatnia}
										<div class="flex flex-wrap gap-2 mt-2.5">
											<a href={adresOdnowieniaRecznego(o.ostatnia)} class="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg border border-line bg-white text-[13px] font-medium text-ink hover:bg-surface-2"><RefreshCw size={13} /> Odnów ręcznie {o.ostatnia.nr_polisy}</a>
											<a href="/policies/import?renewal_of={o.ostatnia.id}" class="h-8 inline-flex items-center gap-1 px-2.5 rounded-lg border border-line bg-white text-[13px] font-medium text-ink hover:bg-surface-2"><Upload size={13} /> Wgraj odnowienie z PDF</a>
										</div>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if bezPojazdu.length}
		<div class="border-t border-line-soft px-5 py-3.5" data-testid="polisy-bez-pojazdu">
			<p class="text-[13px] font-semibold text-ink">Polisy komunikacyjne bez przypisanego pojazdu <span class="font-normal text-ink-3">{bezPojazdu.length}</span></p>
			<p class="text-xs text-ink-3 mb-2">Przypisz pojazd, żeby ochrona i odnowienia liczyły się na pojeździe.</p>
			<ul class="flex flex-col gap-1.5">
				{#each bezPojazdu as p (p.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
						<a href="/policies/{p.id}" class="font-medium text-accent-text hover:underline">{p.nr_polisy}</a>
						<span class="text-ink-2">{nazwaRodzaju(p.rodzaj)} · {nazwaTu(p)} · {data(p.data_od)} – {data(p.data_do)}{p.przedmiot ? ` · ${p.przedmiot}` : ''}</span>
						{#if pojazdy.length}
							<span class="ml-auto flex items-center gap-1.5">
								<select bind:value={wybranyPojazd[p.id]} aria-label="Pojazd do polisy {p.nr_polisy}" class="h-8 border border-line rounded-lg px-2 text-xs bg-white">
									<option value="">— pojazd —</option>
									{#each pojazdy as v (v.id)}<option value={v.id}>{v.nr_rejestracyjny} · {v.marka_model}</option>{/each}
								</select>
								<button onclick={() => powiaz(p.id, wybranyPojazd[p.id] ?? '')} disabled={!wybranyPojazd[p.id] || zapis} class="h-8 px-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-50">Powiąż</button>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
