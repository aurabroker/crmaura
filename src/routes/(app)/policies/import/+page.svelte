<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import { logAudit } from '$lib/utils/audit';
	import { fmtPln } from '$lib/utils';
	import { readPdf, type PdfDoc } from '$lib/policyImport/pdf';
	import { templatesFor } from '$lib/policyImport/templates';
	import { buildDraft, type Draft } from '$lib/policyImport/map';
	import type { ExtractedPolicy, ProductTemplate } from '$lib/policyImport/types';
	import type { Client, Insurer } from '$lib/types/database';
	import {
		ArrowLeft, Upload, FileText, CheckCircle2, AlertTriangle, XCircle,
		Info, Loader2, Building2, Package, Users, Save, RefreshCw
	} from 'lucide-svelte';

	const inp = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	let insurerId = $state('');
	let productId = $state('');
	let clientId = $state('');
	let clientSearch = $state('');
	let clientOpen = $state(false);

	let file = $state<File | null>(null);
	let dragOver = $state(false);
	let parsing = $state(false);
	let saving = $state(false);
	let parseError = $state('');
	let extracted = $state<ExtractedPolicy | null>(null);
	let utworzPojazd = $state(false);
	let wnioskujPojazd = $state(false);
	let potwierdzOdnowienie = $state(false);

	// Wejście z karty polisy: /policies/import?renewal_of=<id> — import od razu
	// wiąże nową polisę jako odnowienie wskazanej.
	const renewalOf = $page.url.searchParams.get('renewal_of');
	const renewalSource = $derived(
		renewalOf ? (appState.policies.find((p) => p.id === renewalOf) ?? null) : null
	);

	// Odnowienie dotyczy tego samego klienta i towarzystwa — podstawiamy je raz,
	// gdy dane zdążą się doczytać. Broker może je nadpisać (zmiana TU przy odnowieniu).
	let prefilled = false;
	$effect(() => {
		if (prefilled || !renewalSource) return;
		prefilled = true;
		clientId = renewalSource.klient_id;
		insurerId = renewalSource.tu_id;
	});

	const insurer = $derived(appState.insurers.find((i) => i.id === insurerId) ?? null);
	const produkty = $derived<ProductTemplate[]>(insurer ? templatesFor(insurer) : []);
	const product = $derived(produkty.find((p) => p.id === productId) ?? null);
	const client = $derived(appState.clients.find((c) => c.id === clientId) ?? null);

	const filteredClients = $derived(
		clientSearch.trim()
			? appState.clients.filter(
					(c) =>
						c.nazwa.toLowerCase().includes(clientSearch.toLowerCase()) ||
						(c.nazwa_skrocona ?? '').toLowerCase().includes(clientSearch.toLowerCase()) ||
						(c.nip ?? '').includes(clientSearch.trim()) ||
						(c.regon ?? '').includes(clientSearch.trim())
				)
			: appState.clients
	);

	// Towarzystwa z gotowym szablonem na górze listy — reszta i tak jest wybieralna,
	// ale bez parsera import się nie uruchomi.
	const insurersSorted = $derived(
		[...appState.insurers].sort((a, b) => {
			const ap = templatesFor(a).some((p) => p.parse) ? 0 : 1;
			const bp = templatesFor(b).some((p) => p.parse) ? 0 : 1;
			return ap - bp || a.nazwa.localeCompare(b.nazwa, 'pl');
		})
	);

	const draft = $derived<Draft | null>(
		extracted && product && client && appState.profile
			? buildDraft({
					extracted,
					product,
					client,
					clients: appState.clients,
					insurerId,
					insurerNazwa: insurer?.nazwa ?? null,
					fileName: file?.name ?? null,
					policies: appState.policies,
					vehicles: appState.vehicles,
					leasings: appState.leasings,
					tenantId: appState.profile.tenant_id,
					utworzPojazd,
					wnioskujPojazd,
					potwierdzOdnowienie,
					renewalOf
				})
			: null
	);

	const bledy = $derived(draft?.issues.filter((i) => i.level === 'error') ?? []);
	const moznaZapisac = $derived(!!draft && bledy.length === 0 && !saving);

	function resetOdczyt() {
		extracted = null;
		parseError = '';
		utworzPojazd = false;
		wnioskujPojazd = false;
		potwierdzOdnowienie = false;
	}

	function insurerLabel(i: Insurer): string {
		const gotowe = templatesFor(i).filter((p) => p.parse).length;
		const base = i.skrot ? `${i.skrot} — ${i.nazwa}` : i.nazwa;
		return gotowe ? base : `${base} (brak szablonu)`;
	}

	function pickClient(c: Client) {
		clientId = c.id;
		clientOpen = false;
		clientSearch = '';
		resetOdczyt();
	}

	async function handleFile(f: File | null | undefined) {
		if (!f) return;
		if (!f.name.toLowerCase().endsWith('.pdf')) {
			parseError = 'Moduł przyjmuje wyłącznie pliki PDF.';
			return;
		}
		file = f;
		await parseFile();
	}

	async function parseFile() {
		if (!file || !product) return;
		parsing = true;
		parseError = '';
		extracted = null;
		try {
			const doc: PdfDoc = await readPdf(file);
			if (product.detect) {
				const mismatch = product.detect(doc);
				if (mismatch) {
					parseError = mismatch;
					return;
				}
			}
			if (!product.parse) {
				parseError = product.todo ?? 'Ten produkt nie ma jeszcze szablonu mapowania.';
				return;
			}
			extracted = product.parse(doc);
		} catch (err) {
			parseError = err instanceof Error ? err.message : 'Nie udało się odczytać pliku PDF.';
		} finally {
			parsing = false;
		}
	}

	async function save() {
		if (!draft || !mozliweZapisanie()) return;
		saving = true;

		// Pojazd i finansujący muszą istnieć przed polisą — bez ich id nie byłoby powiązania.
		const payload = { ...draft.payload };

		if (draft.nowyLeasing) {
			const { data: leasing, error: lErr } = await sb
				.from('crm_leasings')
				.insert([draft.nowyLeasing])
				.select('id')
				.single();
			if (lErr) {
				saving = false;
				parseError = `Nie udało się dopisać finansującego: ${lErr.message}`;
				return;
			}
			payload.leasing_id = leasing!.id;
			await logAudit('leasing_created', 'leasing', leasing!.id, draft.nowyLeasing.nazwa as string, {
				zrodlo: 'import polisy',
				plik: file?.name
			});
		}

		if (draft.nowyPojazd) {
			const { data: pojazd, error: vErr } = await sb
				.from('crm_vehicles')
				.insert([draft.nowyPojazd])
				.select('id')
				.single();
			if (vErr) {
				saving = false;
				parseError = `Nie udało się założyć pojazdu: ${vErr.message}`;
				return;
			}
			payload.pojazd_id = pojazd!.id;
			await logAudit('vehicle_created', 'vehicle', pojazd!.id, draft.nowyPojazd.nr_rejestracyjny as string, {
				zrodlo: 'import polisy',
				plik: file?.name
			});
		}

		const { data: inserted, error } = await sb
			.from('crm_policies')
			.insert([payload])
			.select('id')
			.single();

		if (error) {
			saving = false;
			parseError = error.message;
			return;
		}

		if (draft.raty.length && inserted?.id) {
			await sb.from('crm_policy_payments').insert(
				draft.raty.map((r) => ({
					tenant_id: appState.profile!.tenant_id,
					polisa_id: inserted.id,
					nr_raty: r.nr,
					data_platnosci: r.data,
					kwota: r.kwota,
					status: 'Oczekująca'
				}))
			);
		}

		// Wniosek o pojazd składamy po zapisie polisy, żeby administrator widział,
		// której polisy dotyczy.
		if (draft.wniosekPojazd && inserted?.id) {
			const { data: wniosek } = await sb
				.from('crm_vehicle_requests')
				.insert([
					{
						...draft.wniosekPojazd,
						polisa_id: inserted.id,
						created_by: appState.profile!.id
					}
				])
				.select('id')
				.single();
			await logAudit(
				'vehicle_request_created',
				'vehicle_request',
				wniosek?.id ?? null,
				(draft.wniosekPojazd.vin as string) ?? null,
				{ polisa: payload.nr_polisy, plik: file?.name }
			);
		}

		await logAudit('policy_imported', 'policy', inserted?.id, payload.nr_polisy as string, {
			produkt: product?.label,
			ubezpieczyciel: insurer?.nazwa,
			plik: file?.name,
			ug: draft.ug?.nr_polisy ?? null,
			pojazd: (payload.pojazd_id as string | null) ?? null,
			leasing: (payload.leasing_id as string | null) ?? null
		});

		const [rP, rPay, rV, rL, rVR] = await Promise.all([
			sb
				.from('crm_policies')
				.select(
					'*, crm_clients!klient_id(nazwa), ubezpieczony:crm_clients!ubezpieczony_id(nazwa), crm_insurers(nazwa, skrot), crm_insurer_contacts(imie_nazwisko, stanowisko, crm_insurer_branches(nazwa))'
				)
				.is('deleted_at', null),
			sb
				.from('crm_policy_payments')
				.select('*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))')
				.order('data_platnosci'),
			sb.from('crm_vehicles').select('*'),
			sb.from('crm_leasings').select('*'),
			sb.from('crm_vehicle_requests').select('*').eq('status', 'oczekuje')
		]);
		appState.policies = (rP.data ?? []) as typeof appState.policies;
		appState.payments = (rPay.data ?? []) as typeof appState.payments;
		appState.vehicles = (rV.data ?? []) as typeof appState.vehicles;
		appState.leasings = (rL.data ?? []) as typeof appState.leasings;
		appState.vehicleRequests = (rVR.data ?? []) as typeof appState.vehicleRequests;
		saving = false;
		goto(`/policies/${inserted!.id}`);
	}

	function mozliweZapisanie() {
		return !!draft && draft.issues.filter((i) => i.level === 'error').length === 0;
	}

	const krok = $derived(
		!insurerId ? 1 : !productId ? 2 : !clientId ? 3 : !extracted ? 4 : 5
	);
</script>

<svelte:head><title>Import polisy — FRANK67 CRM</title></svelte:head>

<div class="max-w-5xl">
	<div class="flex items-center gap-3 mb-6">
		<button
			onclick={() => history.back()}
			class="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
		>
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">
				{renewalSource ? 'Odnowienie polisy z pliku' : 'Import polisy'}
			</h1>
			<p class="text-sm text-slate-500 mt-0.5">
				{renewalSource
					? `Nowa polisa zostanie powiązana jako odnowienie ${renewalSource.nr_polisy}`
					: 'Wskaż towarzystwo, produkt i klienta, a następnie wgraj plik PDF polisy'}
			</p>
		</div>
	</div>

	{#if renewalSource}
		<div class="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
			<RefreshCw size={15} class="text-amber-600 mt-0.5 shrink-0" />
			<p class="text-sm text-amber-900">
				Odnawiasz polisę <strong>{renewalSource.nr_polisy}</strong>
				({renewalSource.data_od} — {renewalSource.data_do}). Klient i towarzystwo zostały
				podstawione; jeśli odnowienie idzie do innego TU, zmień je poniżej.
			</p>
		</div>
	{/if}

	<!-- Krok 1-3: wybór kontekstu -->
	<div class="bg-white border border-line rounded-xl p-5 shadow-sm mb-4">
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div>
				<label class={lbl} for="imp-tu"><Building2 size={12} class="inline -mt-0.5" /> Ubezpieczyciel *</label>
				<select
					id="imp-tu"
					class={inp}
					bind:value={insurerId}
					onchange={() => { productId = ''; resetOdczyt(); }}
				>
					<option value="">— wybierz —</option>
					{#each insurersSorted as i}
						<option value={i.id}>{insurerLabel(i)}</option>
					{/each}
				</select>
			</div>

			<div>
				<label class={lbl} for="imp-produkt"><Package size={12} class="inline -mt-0.5" /> Produkt *</label>
				<select
					id="imp-produkt"
					class={inp}
					bind:value={productId}
					disabled={!insurerId || produkty.length === 0}
					onchange={resetOdczyt}
				>
					<option value="">
						{insurerId && produkty.length === 0 ? '— brak szablonów dla tego TU —' : '— wybierz —'}
					</option>
					{#each produkty as p}
						<option value={p.id}>{p.label}{p.parse ? '' : ' (w przygotowaniu)'}</option>
					{/each}
				</select>
				{#if product && !product.parse}
					<p class="text-[11px] text-amber-700 mt-1">{product.todo}</p>
				{/if}
			</div>

			<div>
				<label class={lbl} for="imp-klient"><Users size={12} class="inline -mt-0.5" /> Klient *</label>
				<div
					class="relative"
					onfocusout={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget as Node)) { clientOpen = false; clientSearch = ''; }
					}}
				>
					<input
						id="imp-klient"
						class={inp}
						placeholder={client?.nazwa ?? 'Szukaj po nazwie, NIP lub REGON…'}
						value={clientOpen ? clientSearch : (client?.nazwa ?? '')}
						oninput={(e) => { clientSearch = e.currentTarget.value; }}
						onfocus={() => { clientOpen = true; clientSearch = ''; }}
					/>
					{#if clientOpen}
						<div class="absolute z-[200] left-0 right-0 top-full mt-0.5 bg-white border border-line rounded-lg shadow-2xl max-h-64 overflow-y-auto">
							{#each filteredClients.slice(0, 50) as c}
								<button
									tabindex="0"
									type="button"
									onclick={() => pickClient(c)}
									class="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none border-b border-line-soft last:border-0"
								>
									<div class="font-medium text-slate-800">{c.nazwa}</div>
									<div class="text-[11px] text-slate-400">
										{#if c.nip || c.regon}
											{c.nip ? `NIP ${c.nip}` : ''}{c.nip && c.regon ? ' · ' : ''}{c.regon ? `REGON ${c.regon}` : ''}
										{:else}
											brak NIP i REGON
										{/if}
									</div>
								</button>
							{:else}
								<div class="px-3 py-3 text-sm text-slate-400">Brak klientów spełniających kryteria</div>
							{/each}
						</div>
					{/if}
				</div>
				{#if client && !client.nip && !client.regon}
					<p class="text-[11px] text-red-600 mt-1">
						Klient nie ma NIP ani REGON — nie da się potwierdzić, że polisa należy do niego.
					</p>
				{/if}
			</div>
		</div>
	</div>

	<!-- Krok 4: plik -->
	{#if insurerId && productId && clientId}
		<div class="bg-white border border-line rounded-xl p-5 shadow-sm mb-4">
			<div
				role="button"
				tabindex="0"
				class="border-2 border-dashed rounded-xl px-6 py-8 text-center transition-colors cursor-pointer
					{dragOver ? 'border-blue-400 bg-blue-50' : 'border-line hover:border-slate-300 hover:bg-slate-50'}"
				ondragover={(e) => { e.preventDefault(); dragOver = true; }}
				ondragleave={() => (dragOver = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragOver = false;
					handleFile(e.dataTransfer?.files?.[0]);
				}}
				onclick={() => document.getElementById('imp-file')?.click()}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('imp-file')?.click(); }}
			>
				<input
					id="imp-file"
					type="file"
					accept="application/pdf,.pdf"
					class="hidden"
					onchange={(e) => handleFile(e.currentTarget.files?.[0])}
				/>
				{#if parsing}
					<Loader2 size={28} class="mx-auto text-blue-500 animate-spin" />
					<p class="text-sm text-slate-600 mt-2">Odczytuję polisę…</p>
				{:else if file}
					<FileText size={28} class="mx-auto text-slate-400" />
					<p class="text-sm font-medium text-slate-700 mt-2">{file.name}</p>
					<p class="text-xs text-slate-400 mt-0.5">
						{(file.size / 1024).toFixed(0)} kB — kliknij, aby wybrać inny plik
					</p>
				{:else}
					<Upload size={28} class="mx-auto text-slate-400" />
					<p class="text-sm text-slate-600 mt-2">Przeciągnij PDF polisy albo kliknij, aby wybrać</p>
					<p class="text-xs text-slate-400 mt-0.5">
						Plik jest czytany lokalnie w przeglądarce i nie opuszcza Twojego komputera
					</p>
				{/if}
			</div>

			{#if parseError}
				<div class="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
					<XCircle size={16} class="text-red-600 mt-0.5 shrink-0" />
					<p class="text-sm text-red-800">{parseError}</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Krok 5: podgląd mapowania -->
	{#if draft && extracted}
		{@const e = extracted}
		<div class="bg-white border border-line rounded-xl overflow-hidden shadow-sm mb-4">
			<div class="px-5 py-3 border-b border-line bg-slate-50">
				<h2 class="text-sm font-semibold text-slate-800">Odczytane dane</h2>
			</div>

			<div class="p-5 space-y-5">
				<!-- Rozpoznane odnowienie: pojazd ma polisę kończącą się tuż przed nową -->
				{#if draft.kandydatOdnowienia}
					{@const k = draft.kandydatOdnowienia}
					<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
						<div class="flex items-start gap-2">
							<RefreshCw size={15} class="text-amber-600 mt-0.5 shrink-0" />
							<div class="flex-1">
								<p class="text-sm font-medium text-amber-900">
									Czy to odnowienie polisy {k.nr_polisy}?
								</p>
								<p class="text-xs text-amber-800 mt-0.5">
									Ten sam pojazd ma polisę na okres {k.data_od} — {k.data_do}, a importowana
									zaczyna się {e.data_od}. Powiązanie ustawi ją jako odnowienie i zamknie
									poprzednią w Odnowieniach.
								</p>
								<label class="flex items-center gap-2 mt-2 cursor-pointer">
									<input type="checkbox" bind:checked={potwierdzOdnowienie} />
									<span class="text-sm text-amber-900">
										Tak, to odnowienie polisy {k.nr_polisy}
									</span>
								</label>
							</div>
						</div>
					</div>
				{/if}

				<!-- Walidacja -->
				<div class="space-y-2">
					{#each draft.issues as issue}
						<div
							class="flex items-start gap-2 rounded-lg px-3 py-2 border text-sm
								{issue.level === 'error'
									? 'bg-red-50 border-red-200 text-red-800'
									: issue.level === 'warn'
										? 'bg-amber-50 border-amber-200 text-amber-800'
										: 'bg-emerald-50 border-emerald-200 text-emerald-800'}"
						>
							{#if issue.level === 'error'}
								<XCircle size={15} class="mt-0.5 shrink-0" />
							{:else if issue.level === 'warn'}
								<AlertTriangle size={15} class="mt-0.5 shrink-0" />
							{:else}
								<CheckCircle2 size={15} class="mt-0.5 shrink-0" />
							{/if}
							<span>{issue.text}</span>
						</div>
					{/each}
				</div>

				<!-- Pola trafiające do CRM -->
				<div>
					<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
						Dane polisy
					</h3>
					<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Numer polisy</dt>
							<dd class="font-medium text-slate-900 text-right">{e.nr_polisy ?? '—'}</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Okres</dt>
							<dd class="font-medium text-slate-900 text-right">{e.data_od ?? '—'} → {e.data_do ?? '—'}</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Data zawarcia</dt>
							<dd class="font-medium text-slate-900 text-right">{e.data_zawarcia ?? '—'}</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Składka</dt>
							<dd class="font-medium text-slate-900 text-right">{fmtPln(e.skladka)} zł</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Rodzaj w CRM</dt>
							<dd class="font-medium text-slate-900 text-right">{product?.rodzaj}</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Prowizja</dt>
							<dd class="font-medium text-slate-900 text-right">
								{draft.payload.prowizja_pct
									? `${draft.payload.prowizja_pct}% — ${fmtPln(draft.payload.prowizja_przypisana as number)} zł`
									: 'do uzupełnienia'}
							</dd>
						</div>
					</dl>
				</div>

				<!-- Klient z dokumentu -->
				<div>
					<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
						Podmiot z polisy
					</h3>
					<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Ubezpieczający</dt>
							<dd class="font-medium text-slate-900 text-right">{e.klient_nazwa ?? '—'}</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">NIP / REGON</dt>
							<dd class="font-medium text-slate-900 text-right">
								{e.klient_nip ?? '—'} / {e.klient_regon ?? '—'}
							</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Adres</dt>
							<dd class="font-medium text-slate-900 text-right">{e.klient_adres ?? '—'}</dd>
						</div>
						<div class="flex justify-between gap-3 border-b border-line-soft py-1">
							<dt class="text-slate-500">Wybrany klient CRM</dt>
							<dd class="font-medium text-slate-900 text-right">{client?.nazwa}</dd>
						</div>
						{#if e.ubezpieczony_nazwa && (e.ubezpieczony_regon || e.ubezpieczony_nip)}
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">Ubezpieczony</dt>
								<dd class="font-medium text-slate-900 text-right">
									{e.ubezpieczony_nazwa}
									<span class="block text-[11px] text-slate-400">
										{e.ubezpieczony_nip ?? e.ubezpieczony_regon} —
										{draft.ubezpieczony ? 'powiązany z kartoteką' : 'poza kartoteką'}
									</span>
								</dd>
							</div>
						{/if}
						{#if draft.leasing || e.leasing}
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">Finansujący</dt>
								<dd class="font-medium text-slate-900 text-right">
									{draft.leasing?.nazwa ?? e.leasing?.nazwa}
									<span class="block text-[11px] text-slate-400">
										{draft.leasing
											? 'ze słownika leasingów'
											: 'zostanie dopisany do słownika leasingów'}
									</span>
								</dd>
							</div>
						{/if}
					</dl>
				</div>

				<!-- Pojazd -->
				{#if e.pojazd}
					{@const v = e.pojazd}
					<div>
						<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pojazd</h3>
						<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">Nr rejestracyjny</dt>
								<dd class="font-medium text-slate-900 text-right">{v.nr_rejestracyjny ?? '—'}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">VIN</dt>
								<dd class="font-medium text-slate-900 text-right font-mono text-xs">{v.vin ?? '—'}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">Marka i model</dt>
								<dd class="font-medium text-slate-900 text-right">{v.marka_model ?? '—'}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">Rok / pojemność</dt>
								<dd class="font-medium text-slate-900 text-right">
									{v.rok_produkcji ?? '—'} / {v.pojemnosc_silnika ? `${v.pojemnosc_silnika} ccm` : '—'}
								</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">Rodzaj</dt>
								<dd class="font-medium text-slate-900 text-right">{v.rodzaj_pojazdu ?? '—'}</dd>
							</div>
							<div class="flex justify-between gap-3 border-b border-line-soft py-1">
								<dt class="text-slate-500">W kartotece CRM</dt>
								<dd class="font-medium text-right {draft.pojazd ? 'text-emerald-700' : 'text-amber-700'}">
									{draft.pojazd ? draft.pojazd.nr_rejestracyjny : 'brak — do założenia'}
								</dd>
							</div>
						</dl>

						{#if !draft.pojazd && v.nr_rejestracyjny}
							<label
								class="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer"
							>
								<input type="checkbox" bind:checked={utworzPojazd} class="mt-0.5" />
								<span class="text-sm text-amber-900">
									Załóż ten pojazd w kartotece klienta na podstawie danych z polisy.
									<span class="block text-xs text-amber-700 mt-0.5">
										Bez tego import jest zablokowany — polisa komunikacyjna musi wskazywać pojazd.
									</span>
								</span>
							</label>
						{:else if !draft.pojazd}
							<!-- Brak rejestracji: pojazdu nie da się zapisać, decyduje administrator. -->
							<label
								class="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer"
							>
								<input type="checkbox" bind:checked={wnioskujPojazd} class="mt-0.5" />
								<span class="text-sm text-amber-900">
									Złóż wniosek do administratora o dodanie tego pojazdu.
									<span class="block text-xs text-amber-700 mt-0.5">
										Polisa nie zawiera numeru rejestracyjnego, a kartoteka pojazdów go wymaga.
										Administrator uzupełni numer i zaakceptuje albo odrzuci wniosek. Polisa zostanie
										zapisana bez powiązania z pojazdem.
									</span>
								</span>
							</label>
						{/if}
					</div>
				{/if}

				<!-- Raty -->
				{#if draft.raty.length}
					<div>
						<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
							Harmonogram rat ({draft.raty.length})
						</h3>
						<div class="border border-line rounded-lg overflow-hidden">
							<table class="w-full text-sm">
								<thead class="bg-slate-50 text-xs text-slate-500">
									<tr>
										<th class="text-left px-3 py-2 font-semibold">Rata</th>
										<th class="text-left px-3 py-2 font-semibold">Termin</th>
										<th class="text-right px-3 py-2 font-semibold">Kwota</th>
									</tr>
								</thead>
								<tbody>
									{#each draft.raty as r}
										<tr class="border-t border-line-soft">
											<td class="px-3 py-2 text-slate-600">{r.nr}</td>
											<td class="px-3 py-2 text-slate-800">{r.data}</td>
											<td class="px-3 py-2 text-right font-medium text-slate-900">{fmtPln(r.kwota)} zł</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<!-- Ryzyka -->
				{#if e.ryzyka.length}
					<div>
						<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
							Ubezpieczone ryzyka ({e.ryzyka.length})
						</h3>
						<div class="border border-line rounded-lg overflow-hidden">
							<table class="w-full text-sm">
								<thead class="bg-slate-50 text-xs text-slate-500">
									<tr>
										<th class="text-left px-3 py-2 font-semibold">Sekcja</th>
										<th class="text-left px-3 py-2 font-semibold">Przedmiot</th>
										<th class="text-right px-3 py-2 font-semibold">Suma ubezp.</th>
										<th class="text-right px-3 py-2 font-semibold">Składka</th>
									</tr>
								</thead>
								<tbody>
									{#each e.ryzyka as r}
										<tr class="border-t border-line-soft">
											<td class="px-3 py-2 text-slate-500 text-xs">{r.sekcja}</td>
											<td class="px-3 py-2 text-slate-800">{r.przedmiot}</td>
											<td class="px-3 py-2 text-right text-slate-900">
												{r.suma != null ? `${fmtPln(r.suma)} zł` : '—'}
											</td>
											<td class="px-3 py-2 text-right text-slate-600">
												{r.skladka != null ? `${fmtPln(r.skladka)} zł` : '—'}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<!-- Pozostałe odczytane informacje -->
				{#if Object.keys(e.dodatkowe).length || e.produkt_owu || e.konto_do_wplat}
					<div>
						<h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
							Pozostałe informacje z dokumentu
						</h3>
						<div class="flex items-start gap-2 bg-slate-50 border border-line rounded-lg px-3 py-2 mb-2">
							<Info size={14} class="text-slate-400 mt-0.5 shrink-0" />
							<p class="text-xs text-slate-500">
								Te dane nie mają odpowiedniego pola w kartotece polisy — zapisujemy je w opisie
								przedmiotu ubezpieczenia albo pomijamy.
							</p>
						</div>
						<dl class="space-y-1 text-sm">
							{#if e.produkt_owu}
								<div class="flex justify-between gap-3 border-b border-line-soft py-1">
									<dt class="text-slate-500">OWU</dt>
									<dd class="text-slate-800 text-right">{e.produkt_owu}</dd>
								</div>
							{/if}
							{#if e.konto_do_wplat}
								<div class="flex justify-between gap-3 border-b border-line-soft py-1">
									<dt class="text-slate-500">Konto do wpłat</dt>
									<dd class="text-slate-800 text-right font-mono text-xs">{e.konto_do_wplat}</dd>
								</div>
							{/if}
							{#each Object.entries(e.dodatkowe) as [k, v]}
								<div class="flex justify-between gap-3 border-b border-line-soft py-1">
									<dt class="text-slate-500">{k}</dt>
									<dd class="text-slate-800 text-right">{v}</dd>
								</div>
							{/each}
						</dl>
					</div>
				{/if}
			</div>

			<div class="px-5 py-4 border-t border-line bg-slate-50 flex items-center justify-between gap-4">
				<p class="text-xs text-slate-500">
					{#if bledy.length}
						Import zablokowany — popraw {bledy.length === 1 ? 'wskazany problem' : 'wskazane problemy'}.
					{:else}
						Polisa zostanie zapisana w CRM wraz z harmonogramem rat.
					{/if}
				</p>
				<button
					onclick={save}
					disabled={!moznaZapisac}
					class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{#if saving}
						<Loader2 size={15} class="animate-spin" /> Zapisuję…
					{:else}
						<Save size={15} /> Zapisz polisę w CRM
					{/if}
				</button>
			</div>
		</div>
	{:else if krok < 4}
		<div class="bg-white border border-line rounded-xl px-5 py-8 text-center text-sm text-slate-400">
			{#if krok === 1}
				Wybierz ubezpieczyciela, aby zobaczyć dostępne produkty.
			{:else if krok === 2}
				Wybierz produkt — od niego zależy sposób odczytu polisy.
			{:else}
				Wskaż klienta, do którego ma trafić polisa.
			{/if}
		</div>
	{/if}
</div>
