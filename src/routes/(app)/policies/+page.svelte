<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { fmtPln, policyStatus } from '$lib/utils';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { Search } from 'lucide-svelte';

	let search = $state('');
	let showPolicy = $state(false);
	let showClaim = $state(false);
	let saving = $state(false);
	let formError = $state('');

	// Policy form
	let fpKlient = $state('');
	let fpTu = $state('');
	let fpNr = $state('');
	let fpRodzaj = $state('majątkowa');
	let fpPrzedmiot = $state('');
	let fpOd = $state('');
	let fpDo = $state('');
	let fpRaty = $state('1');
	let fpDatyRat = $state('');
	let fpSklPrzyp = $state('');
	let fpSklZaink = $state('0');
	let fpProwPct = $state('');
	let fpProwPrzyp = $state('');
	let fpProwZaink = $state('0');

	// Claim form
	let fclKlient = $state('');
	let fclPolisa = $state('');
	let fclNr = $state('');
	let fclData = $state('');
	let fclOpis = $state('');

	const filtered = $derived(
		appState.policies.filter((p) =>
			!search ||
			p.nr_polisy.toLowerCase().includes(search.toLowerCase()) ||
			(p.crm_clients?.nazwa ?? '').toLowerCase().includes(search.toLowerCase())
		)
	);

	async function savePolicy() {
		if (!fpKlient || !fpNr || !fpTu || !fpOd || !fpDo) { formError = 'Wypełnij wszystkie pola wymagane (*)'; return; }
		saving = true; formError = '';
		const sklPrzyp = parseFloat(fpSklPrzyp) || 0;
		const prowPct = parseFloat(fpProwPct) || 0;
		let prowPrzyp = parseFloat(fpProwPrzyp);
		if (isNaN(prowPrzyp) && prowPct > 0) prowPrzyp = (sklPrzyp * prowPct) / 100;
		else if (isNaN(prowPrzyp)) prowPrzyp = 0;

		const { error } = await sb.from('crm_policies').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: fpKlient, tu_id: fpTu, nr_polisy: fpNr, rodzaj: fpRodzaj,
			przedmiot: fpPrzedmiot || null, data_od: fpOd, data_do: fpDo,
			ilosc_rat: fpRaty, daty_rat: fpDatyRat || null,
			skladka_przypisana: sklPrzyp, skladka_zainkasowana: parseFloat(fpSklZaink) || 0,
			prowizja_pct: prowPct, prowizja_przypisana: prowPrzyp,
			prowizja_zainkasowana: parseFloat(fpProwZaink) || 0
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showPolicy = false;
		const { data } = await sb.from('crm_policies').select('*, crm_clients(nazwa), crm_insurers(nazwa)');
		appState.policies = (data ?? []) as typeof appState.policies;
	}

	async function saveClaim() {
		if (!fclKlient || !fclData) { formError = 'Wybierz klienta i datę szkody.'; return; }
		saving = true; formError = '';
		const pol = fclPolisa ? appState.policies.find((p) => p.id === fclPolisa) : null;
		const { error } = await sb.from('crm_claims').insert([{
			tenant_id: appState.profile!.tenant_id,
			klient_id: fclKlient, polisa_id: fclPolisa || null, tu_id: pol?.tu_id ?? null,
			nr_szkody: fclNr || null, data_szkody: fclData, opis_szkody: fclOpis || null, status: 'Zgłoszona'
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showClaim = false;
		const { data } = await sb.from('crm_claims').select('*, crm_clients(nazwa), crm_policies(nr_polisy)');
		appState.claims = (data ?? []) as typeof appState.claims;
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Polisy — AuraCRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Polisy w obsłudze</h1>
		<p class="text-sm text-slate-500 mt-1">Rejestr ubezpieczeń całego portfela</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => showClaim = true} class="flex items-center gap-2 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
			Zgłoś Szkodę
		</button>
		<button onclick={() => showPolicy = true} class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
			+ Nowa Polisa
		</button>
	</div>
</div>

<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
		<Search size={16} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj po nr polisy lub kliencie..." class="flex-1 text-sm outline-none text-slate-700 placeholder:text-slate-400" />
	</div>
	<table class="w-full text-left text-sm">
		<thead>
			<tr class="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
				<th class="px-5 py-3">Nr Polisy</th>
				<th class="px-5 py-3">Klient</th>
				<th class="px-5 py-3">TU</th>
				<th class="px-5 py-3">Rodzaj</th>
				<th class="px-5 py-3">Okres</th>
				<th class="px-5 py-3">Raty</th>
				<th class="px-5 py-3 text-right">Składka</th>
				<th class="px-5 py-3">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each filtered as p}
				{@const st = policyStatus(p.data_do)}
				<tr class="border-t border-slate-100 hover:bg-slate-50">
					<td class="px-5 py-3 font-medium">{p.nr_polisy}</td>
					<td class="px-5 py-3">{p.crm_clients?.nazwa ?? '—'}</td>
					<td class="px-5 py-3">{p.crm_insurers?.nazwa ?? '—'}</td>
					<td class="px-5 py-3"><Badge variant="neutral">{p.rodzaj}</Badge></td>
					<td class="px-5 py-3 text-xs">{p.data_od}<br/>{p.data_do}</td>
					<td class="px-5 py-3">{p.ilosc_rat}</td>
					<td class="px-5 py-3 text-right font-medium">{fmtPln(p.skladka_przypisana)}</td>
					<td class="px-5 py-3">
						<Badge variant={st.badge === 'badge-error' ? 'error' : st.badge === 'badge-warning' ? 'warning' : 'success'}>{st.label}</Badge>
					</td>
				</tr>
			{:else}
				<tr><td colspan="8" class="px-5 py-6 text-center text-slate-400">Brak polis</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- Modal: Nowa Polisa -->
<Modal title="Rejestracja Polisy" open={showPolicy} onclose={() => { showPolicy = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showPolicy = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={savePolicy} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zapisz Polisę'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Klient *</label>
				<select bind:value={fpKlient} class={inputCls}>
					<option value="">— wybierz klienta —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Towarzystwo (TU) *</label>
				<select bind:value={fpTu} class={inputCls}>
					<option value="">— wybierz TU —</option>
					{#each appState.insurers as t}<option value={t.id}>{t.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Nr Polisy *</label>
				<input bind:value={fpNr} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Rodzaj *</label>
				<select bind:value={fpRodzaj} class={inputCls}>
					<option value="majątkowa">Majątkowa</option>
					<option value="życie">Życie</option>
					<option value="komunikacja">Komunikacja</option>
					<option value="flota">Flota</option>
					<option value="finansowa">Finansowa (Gwarancje)</option>
					<option value="OC">OC</option>
					<option value="techniczna">Techniczna</option>
					<option value="polisa_obca">Polisa Obca (poza KNF)</option>
				</select>
			</div>
		</div>
		<div>
			<label class={labelCls}>Przedmiot ubezpieczenia</label>
			<input bind:value={fpPrzedmiot} class={inputCls} />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Data od *</label>
				<input type="date" bind:value={fpOd} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Data do *</label>
				<input type="date" bind:value={fpDo} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Raty</label>
				<select bind:value={fpRaty} class={inputCls}>
					<option value="1">1 rata</option>
					<option value="2">2 raty</option>
					<option value="4">4 raty</option>
					<option value="12">12 rat</option>
				</select>
			</div>
			<div>
				<label class={labelCls}>Daty rat</label>
				<input bind:value={fpDatyRat} placeholder="np. 01.01, 01.06" class={inputCls} />
			</div>
		</div>
		<hr class="border-slate-200" />
		<p class="text-sm font-semibold text-blue-600">Dane Finansowe (KNF)</p>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Składka Przypisana (PLN) *</label>
				<input type="number" step="0.01" bind:value={fpSklPrzyp} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Składka Zainkasowana</label>
				<input type="number" step="0.01" bind:value={fpSklZaink} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>% Prowizji</label>
				<input type="number" step="0.01" bind:value={fpProwPct} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Prowizja Przypisana</label>
				<input type="number" step="0.01" bind:value={fpProwPrzyp} placeholder="Auto z %" class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Prowizja Zainkasowana</label>
				<input type="number" step="0.01" bind:value={fpProwZaink} class={inputCls} />
			</div>
		</div>
	</div>
</Modal>

<!-- Modal: Szkoda -->
<Modal title="Rejestracja Szkody" open={showClaim} onclose={() => { showClaim = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showClaim = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={saveClaim} disabled={saving} class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Zgłoś Szkodę'}
		</button>
	{/snippet}

	{#if formError}<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={labelCls}>Klient *</label>
				<select bind:value={fclKlient} class={inputCls}>
					<option value="">— wybierz klienta —</option>
					{#each appState.clients as c}<option value={c.id}>{c.nazwa}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Z polisy</label>
				<select bind:value={fclPolisa} class={inputCls}>
					<option value="">— opcjonalnie —</option>
					{#each appState.policies as p}<option value={p.id}>{p.nr_polisy}</option>{/each}
				</select>
			</div>
			<div>
				<label class={labelCls}>Nr Szkody w TU</label>
				<input bind:value={fclNr} class={inputCls} />
			</div>
			<div>
				<label class={labelCls}>Data szkody *</label>
				<input type="date" bind:value={fclData} class={inputCls} />
			</div>
		</div>
		<div>
			<label class={labelCls}>Opis zdarzenia</label>
			<input bind:value={fclOpis} placeholder="Krótki opis..." class={inputCls} />
		</div>
	</div>
</Modal>
