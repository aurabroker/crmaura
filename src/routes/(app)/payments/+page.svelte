<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { PolicyPayment } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { fmtPln, todayStr } from '$lib/utils';
	import { Plus, Check, Search, FileSpreadsheet, AlertTriangle, CheckCircle2, Bell } from 'lucide-svelte';
	const today = todayStr();
	const currentMonth = $state(today.slice(0, 7));

	let filterMonth = $state(currentMonth);
	let filterStatus = $state('all');
	let search = $state('');
	let showModal = $state(false);
	let saving = $state(false);
	let formError = $state('');

	// Add payment form
	let fPolisa = $state('');
	let fNrRaty = $state('1');
	let fData = $state('');
	let fKwota = $state('');
	let fNotatka = $state('');

	// ===== UNIVERSAL COMMISSION IMPORT =====
	type ImportMode = 'ergo' | 'leadenhall';

	interface UniversalRow {
		nr_polisy: string;
		nr_polisy_raw: string;
		ubezpieczajacy: string;
		skladka_nota: number;
		prowizja_nota: number;
		// resolved
		payment_id: string | null;
		policy_id: string | null;
		prowizja_crm: number | null;
		new_status: 'Opłacona' | 'Częściowo opłacona' | null;
		not_found: boolean;
		already_settled: boolean;
		is_negative: boolean;
		prowizja_diff: number;
		operator_action: 'settle' | 'skip';
	}

	let showImport = $state(false);
	let importMode = $state<ImportMode>('ergo');
	let importFile = $state<File | null>(null);
	let importLoading = $state(false);
	let importError = $state('');
	let importPreview = $state<UniversalRow[]>([]);
	let importNumerNoty = $state('');
	let importDataZest = $state('');
	let importRazemSkladka = $state(0);
	let importRazemProwizja = $state(0);
	let importSaving = $state(false);
	let importDone = $state(false);
	let importSummary = $state('');

	// Policy number normalization — strips spaces, uppercase
	function normalizeNr(nr: string): string {
		return nr.replace(/[\s\-]/g, '').toUpperCase();
	}

	function findPolicy(nrPolisy: string) {
		const norm = normalizeNr(nrPolisy);
		// 1. Exact match
		let p = appState.policies.find(x => x.nr_polisy === nrPolisy);
		if (p) return p;
		// 2. Normalized match (strip spaces/dashes)
		p = appState.policies.find(x => normalizeNr(x.nr_polisy) === norm);
		if (p) return p;
		// 3. Suffix match (nota has "123456", CRM has "XYZ123456")
		p = appState.policies.find(x => {
			const pn = normalizeNr(x.nr_polisy);
			return pn.endsWith(norm) || norm.endsWith(pn);
		});
		return p ?? null;
	}

	function resolveRow(row: UniversalRow): UniversalRow {
		const settledStatuses = ['Opłacona', 'Częściowo opłacona'];
		const policy = findPolicy(row.nr_polisy_raw);
		if (!policy) { row.not_found = true; return row; }
		row.policy_id = policy.id;
		row.nr_polisy = policy.nr_polisy; // use CRM canonical form
		row.prowizja_crm = parseFloat(String(policy.prowizja_przypisana)) || 0;

		const payment = appState.payments.find(
			p => p.polisa_id === policy.id && !settledStatuses.includes(p.status)
		);
		if (payment) {
			row.payment_id = payment.id;
			const diff = Math.abs((row.prowizja_crm ?? 0) - row.prowizja_nota);
			row.prowizja_diff = diff;
			// ≤ 0.50 PLN → OK, > 0.50 PLN → needs operator decision (default: settle)
			row.new_status = diff <= 0.5 ? 'Opłacona' : 'Częściowo opłacona';
			row.operator_action = diff > 0.5 ? 'settle' : 'settle';
		} else {
			const anyPay = appState.payments.find(p => p.polisa_id === policy.id);
			if (anyPay && settledStatuses.includes(anyPay.status)) {
				row.already_settled = true;
			}
		}
		return row;
	}

	// ===== ERGO PARSER =====
	async function parseErgoXlsx(file: File): Promise<void> {
		const XLSX = await import('xlsx');
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const data = new Uint8Array(e.target!.result as ArrayBuffer);
					const wb = XLSX.read(data, { type: 'array' });
					const ws = wb.Sheets[wb.SheetNames[0]];
					const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

					importNumerNoty = ''; importDataZest = '';
					importRazemSkladka = 0; importRazemProwizja = 0;

					for (const row of rows) {
						const label = String(row[5] ?? '').trim();
						if (label === 'Numer zestawienia') importNumerNoty = String(row[7] ?? '').trim();
						if (label === 'Data sporządzenia zestawienia') importDataZest = String(row[7] ?? '').trim();
					}

					let dataStart = -1;
					for (let i = 0; i < rows.length; i++) {
						if (String(rows[i][1] ?? '').includes('Nr polisy')) { dataStart = i + 1; break; }
					}
					if (dataStart < 0) throw new Error('Nie znaleziono nagłówka tabeli w pliku ERGO');

					const parsed: UniversalRow[] = [];
					for (let i = dataStart; i < rows.length; i++) {
						const r = rows[i];
						const nr = String(r[1] ?? '').trim();
						if (!nr || nr === 'Razem') continue;
						const skladka = parseFloat(String(r[7]).replace(',', '.')) || 0;
						const prowizja = parseFloat(String(r[8]).replace(',', '.')) || 0;
						importRazemSkladka += Math.abs(skladka);
						importRazemProwizja += Math.abs(prowizja);
						const row: UniversalRow = {
							nr_polisy: nr, nr_polisy_raw: nr,
							ubezpieczajacy: String(r[0] ?? '').trim(),
							skladka_nota: skladka, prowizja_nota: prowizja,
							payment_id: null, policy_id: null, prowizja_crm: null,
							new_status: null, not_found: false, already_settled: false,
							is_negative: prowizja < 0, prowizja_diff: 0, operator_action: 'settle'
						};
						parsed.push(resolveRow(row));
					}
					importPreview = parsed;
					resolve();
				} catch (err: any) { reject(err); }
			};
			reader.onerror = () => reject(new Error('Błąd odczytu pliku'));
			reader.readAsArrayBuffer(file);
		});
	}

	// ===== LEADENHALL PARSER =====
	// Squarelife jest tożsamy z Leadenhall — obsługiwane identycznie
	async function parseLeadenhallXlsx(file: File): Promise<void> {
		const XLSX = await import('xlsx');
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const data = new Uint8Array(e.target!.result as ArrayBuffer);
					const wb = XLSX.read(data, { type: 'array' });
					const ws = wb.Sheets[wb.SheetNames[0]];
					const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

					// Row 0: "Zestawienie do noty księgowej nr N/XXX/..."
					const titleRow = String(rows[0]?.[0] ?? '').trim();
					const notaMatch = titleRow.match(/nr\s+([A-Z0-9\/\-]+)/i);
					importNumerNoty = notaMatch?.[1] ?? titleRow;
					importDataZest = '';
					importRazemSkladka = 0; importRazemProwizja = 0;

					// Row 1: headers — skip
					// Rows 2+: data
					// Cols: 0=Polisa, 3=Ubezpieczający, 13=Składka, 14=%Prowizji, 15=Prowizja, 17=Pracownik, 18=PESEL
					const parsed: UniversalRow[] = [];
					const peselsInNota: Set<string> = new Set();

					for (let i = 2; i < rows.length; i++) {
						const r = rows[i];
						const nr = String(r[0] ?? '').trim();
						if (!nr) continue;
						const skladka = parseFloat(String(r[13] ?? '0').replace(',', '.')) || 0;
						const prowizja = parseFloat(String(r[15] ?? '0').replace(',', '.')) || 0;
						const pesel = String(r[18] ?? '').trim();
						if (pesel) peselsInNota.add(pesel);
						importRazemSkladka += Math.abs(skladka);
						importRazemProwizja += Math.abs(prowizja);

						const row: UniversalRow = {
							nr_polisy: nr, nr_polisy_raw: nr,
							ubezpieczajacy: String(r[3] ?? '').trim(),
							skladka_nota: skladka, prowizja_nota: prowizja,
							payment_id: null, policy_id: null, prowizja_crm: null,
							new_status: null, not_found: false, already_settled: false,
							is_negative: prowizja < 0, prowizja_diff: 0, operator_action: 'settle'
						};
						parsed.push(resolveRow(row));
					}
					importPreview = parsed;
					resolve();
				} catch (err: any) { reject(err); }
			};
			reader.onerror = () => reject(new Error('Błąd odczytu pliku'));
			reader.readAsArrayBuffer(file);
		});
	}

	async function onImportFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importFile = file;
		importLoading = true;
		importError = '';
		importPreview = [];
		try {
			if (importMode === 'ergo') await parseErgoXlsx(file);
			else await parseLeadenhallXlsx(file);
		} catch (err: any) {
			importError = err.message ?? 'Błąd parsowania pliku';
		} finally {
			importLoading = false;
		}
	}

	function setOperatorAction(row: UniversalRow, action: 'settle' | 'skip') {
		importPreview = importPreview.map(r => r === row ? { ...r, operator_action: action } : r);
	}

	async function saveImport() {
		if (!importNumerNoty) { importError = 'Brak numeru zestawienia w pliku'; return; }
		importSaving = true; importError = '';

		const tuSkrot = importMode === 'ergo' ? 'ERGO' : 'LEADENHALL';

		// Upload source file to storage
		let fileUrl: string | null = null;
		if (importFile) {
			const ext = importFile.name.split('.').pop() ?? 'xlsx';
			const path = `${appState.profile!.tenant_id}/${tuSkrot}_${importNumerNoty.replace(/\//g, '-')}_${Date.now()}.${ext}`;
			const { data: upData } = await sb.storage.from('settlement-files').upload(path, importFile, { upsert: true });
			if (upData) {
				const { data: urlData } = sb.storage.from('settlement-files').getPublicUrl(path);
				fileUrl = urlData?.publicUrl ?? null;
				if (!fileUrl) {
					const { data: signedData } = await sb.storage.from('settlement-files').createSignedUrl(path, 60 * 60 * 24 * 365);
					fileUrl = signedData?.signedUrl ?? null;
				}
			}
		}

		const { data: nota, error: notaErr } = await sb.from('crm_noty').insert([{
			tenant_id: appState.profile!.tenant_id,
			numer_noty: importNumerNoty,
			tu_skrot: tuSkrot,
			data_zestawienia: importDataZest || null,
			razem_skladka: importRazemSkladka,
			razem_prowizja: importRazemProwizja,
			pozycji_count: importPreview.filter(r => r.payment_id && r.operator_action === 'settle').length,
			file_url: fileUrl
		}]).select('id').single();

		if (notaErr) { importSaving = false; importError = notaErr.message; return; }
		const notaId = nota!.id;

		// Rows to settle
		const toSettle = importPreview.filter(r => r.payment_id && r.new_status && r.operator_action === 'settle' && !r.is_negative);
		let settled = 0;
		for (const row of toSettle) {
			await sb.from('crm_policy_payments').update({
				status: row.new_status,
				kwota: Math.abs(row.skladka_nota),
				prowizja_z_noty: Math.abs(row.prowizja_nota),
				nota_id: notaId,
				data_oplacenia: today
			}).eq('id', row.payment_id!);
			settled++;
		}

		// Create alerts for: diff > 0.5 AND skip, negative amounts, and operator "aneks" choice
		const alertsToCreate = [];
		for (const row of importPreview) {
			if (row.is_negative) {
				alertsToCreate.push({
					tenant_id: appState.profile!.tenant_id,
					typ: 'ujemna_prowizja',
					polisa_id: row.policy_id,
					nr_polisy: row.nr_polisy_raw,
					opis: `Nota ${importNumerNoty}: ujemna prowizja ${fmtPln(row.prowizja_nota)} PLN dla polisy ${row.nr_polisy_raw} — wymagane sprawdzenie / aneks.`
				});
			} else if (row.prowizja_diff > 0.5 && row.operator_action === 'skip') {
				alertsToCreate.push({
					tenant_id: appState.profile!.tenant_id,
					typ: 'aneks_wymagany',
					polisa_id: row.policy_id,
					nr_polisy: row.nr_polisy_raw,
					opis: `Nota ${importNumerNoty}: rozjazd prowizji ${fmtPln(row.prowizja_diff)} PLN (nota: ${fmtPln(row.prowizja_nota)}, CRM: ${fmtPln(row.prowizja_crm ?? 0)}) dla polisy ${row.nr_polisy_raw} — konieczny aneks. Sprawdź wysokość prowizji.`
				});
			} else if (row.prowizja_diff > 0.5 && row.operator_action === 'settle') {
				alertsToCreate.push({
					tenant_id: appState.profile!.tenant_id,
					typ: 'prowizja_rozjazd',
					polisa_id: row.policy_id,
					nr_polisy: row.nr_polisy_raw,
					opis: `Nota ${importNumerNoty}: rozliczono z różnicą ${fmtPln(row.prowizja_diff)} PLN (nota: ${fmtPln(row.prowizja_nota)}, CRM: ${fmtPln(row.prowizja_crm ?? 0)}) dla polisy ${row.nr_polisy_raw}. Sprawdź wysokość prowizji.`
				});
			}
		}
		if (alertsToCreate.length > 0) {
			await sb.from('crm_alerts').insert(alertsToCreate);
		}

		// Refresh
		const { data: pays } = await sb.from('crm_policy_payments')
			.select('*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))').order('data_platnosci');
		appState.payments = (pays ?? []) as typeof appState.payments;
		const { data: alts } = await sb.from('crm_alerts').select('*').eq('resolved', false).order('created_at', { ascending: false });
		appState.alerts = (alts ?? []) as typeof appState.alerts;

		const notFound = importPreview.filter(r => r.not_found).map(r => r.nr_polisy_raw);
		const skipped = importPreview.filter(r => r.operator_action === 'skip').map(r => r.nr_polisy_raw);
		importSaving = false;
		importDone = true;
		importSummary = `Rozliczono ${settled} rat. Nota ${importNumerNoty} zapisana.`
			+ (notFound.length ? `\n\nNie znaleziono: ${notFound.join(', ')}` : '')
			+ (skipped.length ? `\n\nPominięto (aneks): ${skipped.join(', ')}` : '')
			+ (alertsToCreate.length ? `\n\n⚠ Utworzono ${alertsToCreate.length} alert(ów) do sprawdzenia.` : '');
	}

	function openImport(mode: ImportMode) {
		importMode = mode;
		importFile = null;
		importPreview = [];
		importNumerNoty = '';
		importError = '';
		importDone = false;
		importSummary = '';
		showImport = true;
	}

	function closeImport() {
		showImport = false;
	}

	// ===== PAYMENT MANAGEMENT =====
	$effect(() => {
		if (fPolisa) {
			const pol = appState.policies.find((p) => p.id === fPolisa);
			if (pol) {
				const raty = parseInt(pol.ilosc_rat) || 1;
				fKwota = (pol.skladka_przypisana / raty).toFixed(2);
			}
		}
	});

	const filtered = $derived(
		appState.payments
			.filter((p) => filterMonth === 'all' || p.data_platnosci.startsWith(filterMonth))
			.filter((p) => filterStatus === 'all' || p.status === filterStatus)
			.filter((p) => {
				if (!search) return true;
				const klient = p.crm_policies?.crm_clients?.nazwa ?? '';
				const nr = p.crm_policies?.nr_polisy ?? '';
				return klient.toLowerCase().includes(search.toLowerCase()) || nr.toLowerCase().includes(search.toLowerCase());
			})
			.sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci))
	);

	const byDay = $derived(() => {
		const map = new Map<string, typeof filtered>();
		for (const p of filtered) {
			const day = p.data_platnosci;
			if (!map.has(day)) map.set(day, []);
			map.get(day)!.push(p);
		}
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	});

	async function reloadPayments() {
		const { data } = await sb.from('crm_policy_payments').select('*, crm_policies(nr_polisy, crm_clients!klient_id(nazwa))').order('data_platnosci');
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function markPaid(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today }).eq('id', pay.id);
		await reloadPayments();
	}

	async function markOverdue(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Zaległa' }).eq('id', pay.id);
		await reloadPayments();
	}

	async function revertPayment(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Oczekująca', data_oplacenia: null, nota_id: null, prowizja_z_noty: null }).eq('id', pay.id);
		await reloadPayments();
	}

	async function addPayment() {
		if (!fPolisa || !fData || !fKwota) { formError = 'Wypełnij wymagane pola.'; return; }
		saving = true; formError = '';
		const { error } = await sb.from('crm_policy_payments').insert([{
			tenant_id: appState.profile!.tenant_id,
			polisa_id: fPolisa,
			nr_raty: parseInt(fNrRaty) || 1,
			data_platnosci: fData,
			kwota: parseFloat(fKwota),
			notatka: fNotatka || null,
			status: 'Oczekująca'
		}]);
		saving = false;
		if (error) { formError = error.message; return; }
		showModal = false;
		await reloadPayments();
	}

	const statusVariant = (s: string) =>
		s === 'Opłacona' ? 'success' : s === 'Zaległa' ? 'error' : s === 'Częściowo opłacona' ? 'warning' : 'neutral';

	function isOverdue(pay: PolicyPayment): boolean {
		return pay.status === 'Oczekująca' && pay.data_platnosci < today;
	}

	const months = $derived(() => {
		const set = new Set<string>();
		for (const p of appState.payments) set.add(p.data_platnosci.slice(0, 7));
		return [...set].sort();
	});

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	const totalFiltered = $derived(filtered.reduce((s, p) => s + Number(p.kwota), 0));
	const totalPaid = $derived(filtered.filter((p) => p.status === 'Opłacona').reduce((s, p) => s + Number(p.kwota), 0));
	const totalPending = $derived(filtered.filter((p) => p.status !== 'Opłacona').reduce((s, p) => s + Number(p.kwota), 0));

	const importToProcess = $derived(importPreview.filter(r => r.payment_id && r.new_status && !r.is_negative));
	const importNotFound = $derived(importPreview.filter(r => r.not_found));
	const importAlreadySettled = $derived(importPreview.filter(r => r.already_settled));
	const importNegative = $derived(importPreview.filter(r => r.is_negative));
	const importNeedsDecision = $derived(importPreview.filter(r => r.prowizja_diff > 0.5 && !r.is_negative && r.payment_id));

	// Checkbox selection
	let selected = $state(new Set<string>());
	function toggleSelect(id: string) {
		const s = new Set(selected);
		s.has(id) ? s.delete(id) : s.add(id);
		selected = s;
	}
	function toggleDay(ids: string[]) {
		const s = new Set(selected);
		const allIn = ids.every(id => s.has(id));
		ids.forEach(id => allIn ? s.delete(id) : s.add(id));
		selected = s;
	}

	const selectedPays = $derived(filtered.filter(p => selected.has(p.id)));
	const canMarkPaid = $derived(selectedPays.some(p => p.status === 'Oczekująca' || p.status === 'Zaległa'));
	const canMarkOverdue = $derived(selectedPays.some(p => p.status === 'Oczekująca'));
	const canRevert = $derived(selectedPays.some(p => p.status === 'Opłacona' || p.status === 'Częściowo opłacona'));

	async function bulkMarkPaid() {
		const ids = selectedPays.filter(p => p.status === 'Oczekująca' || p.status === 'Zaległa').map(p => p.id);
		await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today }).in('id', ids);
		await reloadPayments(); selected = new Set();
	}
	async function bulkMarkOverdue() {
		const ids = selectedPays.filter(p => p.status === 'Oczekująca').map(p => p.id);
		await sb.from('crm_policy_payments').update({ status: 'Zaległa' }).in('id', ids);
		await reloadPayments(); selected = new Set();
	}
	async function bulkRevert() {
		const ids = selectedPays.filter(p => p.status === 'Opłacona' || p.status === 'Częściowo opłacona').map(p => p.id);
		await sb.from('crm_policy_payments').update({ status: 'Oczekująca', data_oplacenia: null, nota_id: null, prowizja_z_noty: null }).in('id', ids);
		await reloadPayments(); selected = new Set();
	}
</script>

<svelte:head><title>Płatności — FRANK67 CRM</title></svelte:head>

<div class="flex items-center justify-between mb-6">
	<div>
		<h1 class="text-2xl font-semibold text-slate-900">Płatności Składek</h1>
		<p class="text-sm text-slate-500 mt-1">Kalendarz rat i kontrola płatności klientów</p>
	</div>
	<div class="flex gap-2">
		<button onclick={() => openImport('ergo')} class="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
			<FileSpreadsheet size={15} /> Rozlicz ERGO
		</button>
		<button onclick={() => openImport('leadenhall')} class="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors">
			<FileSpreadsheet size={15} /> Rozlicz Leadenhall
		</button>
		<button onclick={() => showModal = true} class="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">
			<Plus size={15} /> Dodaj Ratę
		</button>
	</div>
</div>

<!-- Alerty (prowizja, ujemne) -->
{#if appState.alerts.length > 0}
<div class="mb-4 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
	<div class="px-4 py-3 flex items-center gap-2 border-b border-amber-200">
		<Bell size={14} class="text-amber-600" />
		<span class="text-sm font-semibold text-amber-800">Alerty prowizyjne ({appState.alerts.length})</span>
		<a href="/dashboard" class="ml-auto text-xs text-amber-600 hover:underline">Pulpit →</a>
	</div>
	<div class="divide-y divide-amber-100">
		{#each appState.alerts.slice(0, 3) as alert}
			<div class="px-4 py-2 text-xs text-amber-800">
				<span class="font-semibold">{alert.typ === 'ujemna_prowizja' ? '⊖ Ujemna prowizja' : alert.typ === 'aneks_wymagany' ? '⚠ Aneks wymagany' : '≠ Rozjazd prowizji'}</span>
				{#if alert.nr_polisy} · Polisa <span class="font-mono">{alert.nr_polisy}</span>{/if}
				· {alert.opis}
			</div>
		{/each}
		{#if appState.alerts.length > 3}
			<div class="px-4 py-2 text-xs text-amber-600">... i {appState.alerts.length - 3} więcej</div>
		{/if}
	</div>
</div>
{/if}

<!-- Filtry -->
<div class="flex gap-3 mb-4 flex-wrap">
	<div class="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2">
		<Search size={15} class="text-slate-400" />
		<input bind:value={search} placeholder="Szukaj klienta / polisy..." class="text-sm outline-none placeholder:text-slate-400 w-48" />
	</div>
	<select bind:value={filterMonth} class="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-700">
		<option value="all">Wszystkie miesiące</option>
		{#each months() as m}
			<option value={m}>{m}</option>
		{/each}
	</select>
	{#each [['all','Wszystkie'],['Oczekująca','Oczekujące'],['Opłacona','Opłacone'],['Częściowo opłacona','Częściowo'],['Zaległa','Zaległe']] as [val, label]}
		<button
			onclick={() => filterStatus = val}
			class="px-3 py-2 rounded-xl text-sm font-medium border transition-colors
				{filterStatus === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}"
		>{label}</button>
	{/each}
</div>

<!-- Podsumowanie -->
<div class="grid grid-cols-3 gap-4 mb-6">
	<div class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-slate-500 mb-1">Łącznie rat</p>
		<p class="text-xl font-semibold text-slate-900">{fmtPln(totalFiltered)} PLN</p>
	</div>
	<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-emerald-600 mb-1">Opłacone</p>
		<p class="text-xl font-semibold text-emerald-700">{fmtPln(totalPaid)} PLN</p>
	</div>
	<div class="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
		<p class="text-xs font-medium text-red-500 mb-1">Do zapłaty / Zaległe</p>
		<p class="text-xl font-semibold text-red-600">{fmtPln(totalPending)} PLN</p>
	</div>
</div>

<!-- Floating action bar -->
{#if selected.size > 0}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
		<span class="text-sm font-medium">{selected.size} zaznaczone</span>
		<div class="w-px h-5 bg-slate-600"></div>
		{#if canMarkPaid}
			<button onclick={bulkMarkPaid} class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-500 hover:bg-emerald-400 rounded-xl font-semibold transition-colors">
				<Check size={13} /> Opłacona
			</button>
		{/if}
		{#if canMarkOverdue}
			<button onclick={bulkMarkOverdue} class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 hover:bg-red-400 rounded-xl font-semibold transition-colors">Zaległa</button>
		{/if}
		{#if canRevert}
			<button onclick={bulkRevert} class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-600 hover:bg-slate-500 rounded-xl font-semibold transition-colors">↩ Cofnij</button>
		{/if}
		<button onclick={() => selected = new Set()} class="text-slate-400 hover:text-white text-xs ml-1">✕</button>
	</div>
{/if}

<!-- Tabela rat -->
{#each byDay() as [day, pays]}
	{@const dayIds = pays.map(p => p.id)}
	{@const allChecked = dayIds.every(id => selected.has(id))}
	<div class="mb-5">
		<div class="flex items-center gap-3 mb-1.5">
			<input type="checkbox" checked={allChecked} onchange={() => toggleDay(dayIds)}
				class="w-3.5 h-3.5 rounded accent-slate-700 cursor-pointer" />
			<div class="text-sm font-bold text-slate-700">{day}</div>
			<div class="flex-1 h-px bg-slate-200"></div>
			<div class="text-xs text-slate-400">{pays.length} rat · {fmtPln(pays.reduce((s,p) => s+Number(p.kwota),0))} PLN</div>
		</div>
		<div class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
			<table class="w-full text-left text-sm border-collapse table-fixed">
				<thead class="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<tr>
						<th class="px-4 py-2 w-10"></th>
						<th class="px-4 py-2 w-[14%]">Polisa</th>
						<th class="px-4 py-2 w-[22%]">Klient</th>
						<th class="px-4 py-2 w-[7%] text-center">Rata</th>
						<th class="px-4 py-2 w-[12%] text-right">Kwota</th>
						<th class="px-4 py-2 w-[12%] text-right">Prowizja</th>
						<th class="px-4 py-2 w-[14%]">Status</th>
						<th class="px-4 py-2">Info</th>
					</tr>
				</thead>
				<tbody>
					{#each pays as pay}
						{@const checked = selected.has(pay.id)}
						<tr onclick={() => toggleSelect(pay.id)}
							class="border-t border-slate-200 cursor-pointer transition-colors
								{checked ? 'bg-blue-50' : pay.status === 'Zaległa' || isOverdue(pay) ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-slate-50'}">
							<td class="px-4 py-2.5 text-center" onclick={(e) => e.stopPropagation()}>
								<input type="checkbox" {checked} onchange={() => toggleSelect(pay.id)}
									class="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer" />
							</td>
							<td class="px-4 py-2.5 font-mono text-xs font-semibold text-blue-700 border-l border-slate-200">
								<a href="/policies/{pay.polisa_id}" onclick={(e) => e.stopPropagation()} class="hover:underline">{pay.crm_policies?.nr_polisy ?? '—'}</a>
							</td>
							<td class="px-4 py-2.5 border-l border-slate-200">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</td>
							<td class="px-4 py-2.5 text-center text-slate-500 border-l border-slate-200">{pay.nr_raty}</td>
							<td class="px-4 py-2.5 text-right font-semibold border-l border-slate-200">{fmtPln(pay.kwota)}</td>
							<td class="px-4 py-2.5 text-right text-xs border-l border-slate-200">
								{#if pay.prowizja_z_noty}<span class="text-blue-600 font-medium">{fmtPln(pay.prowizja_z_noty)}</span>{:else}<span class="text-slate-300">—</span>{/if}
							</td>
							<td class="px-4 py-2.5 border-l border-slate-200">
								<Badge variant={statusVariant(pay.status)}>{pay.status}</Badge>
							</td>
							<td class="px-4 py-2.5 text-xs text-slate-400 border-l border-slate-200">
								{pay.data_oplacenia ? `Zapł. ${pay.data_oplacenia}` : ''}{pay.notatka ? ` · ${pay.notatka}` : ''}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
		Brak rat płatności w wybranym filtrze
	</div>
{/each}

<!-- Modal: Dodaj Ratę -->
<Modal title="Dodaj Ratę Płatności" open={showModal} onclose={() => { showModal = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; formError = ''; }} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={addPayment} disabled={saving} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60">
			{saving ? 'Zapisywanie...' : 'Dodaj Ratę'}
		</button>
	{/snippet}
	{#if formError}<div class="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>{/if}
	<div class="space-y-3">
		<div>
			<label class={labelCls}>Polisa *</label>
			<select bind:value={fPolisa} class={inputCls}>
				<option value="">— wybierz polisę —</option>
				{#each appState.policies as p}
					<option value={p.id}>{p.nr_polisy} — {p.crm_clients?.nazwa}</option>
				{/each}
			</select>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div><label class={labelCls}>Nr Raty</label><input type="number" bind:value={fNrRaty} min="1" class={inputCls} /></div>
			<div><label class={labelCls}>Termin płatności *</label><input type="date" bind:value={fData} class={inputCls} /></div>
			<div><label class={labelCls}>Kwota raty (PLN) *</label><input type="number" step="0.01" bind:value={fKwota} class={inputCls} /></div>
			<div><label class={labelCls}>Notatka</label><input bind:value={fNotatka} class={inputCls} /></div>
		</div>
	</div>
</Modal>

<!-- Modal: Import prowizji (ERGO / Leadenhall) -->
<Modal
	title={importMode === 'ergo' ? 'Rozlicz ERGO — Import zestawienia prowizyjnego' : 'Rozlicz Leadenhall / Squarelife — Import noty prowizyjnej'}
	open={showImport}
	onclose={closeImport}
>
	{#snippet footer()}
		{#if importDone}
			<button onclick={closeImport} class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">Zamknij</button>
		{:else}
			<button onclick={closeImport} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
			{#if importToProcess.length > 0 && !importLoading}
				<button onclick={saveImport} disabled={importSaving} class="px-4 py-2 text-sm {importMode === 'ergo' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-violet-600 hover:bg-violet-700'} text-white rounded-lg font-semibold disabled:opacity-60">
					{importSaving ? 'Rozliczanie...' : `Rozlicz ${importToProcess.filter(r => r.operator_action === 'settle').length} rat`}
				</button>
			{/if}
		{/if}
	{/snippet}

	{#if importDone}
		<div class="flex flex-col items-center gap-4 py-4">
			<CheckCircle2 size={48} class="text-emerald-500" />
			<div class="text-center whitespace-pre-line text-sm text-slate-700">{importSummary}</div>
		</div>
	{:else}
		<div class="space-y-4">
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-2">
					Wybierz plik zestawienia prowizyjnego {importMode === 'ergo' ? 'ERGO' : 'Leadenhall/Squarelife'} (.xlsx)
				</label>
				<input type="file" accept=".xlsx" onchange={onImportFile}
					class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold {importMode === 'ergo' ? 'file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100' : 'file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100'}" />
			</div>

			{#if importLoading}
				<div class="text-sm text-slate-500 text-center py-4">Parsowanie pliku...</div>
			{/if}
			{#if importError}
				<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{importError}</div>
			{/if}

			{#if importPreview.length > 0}
				<!-- Info noty -->
				<div class="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
					<div class="font-semibold text-blue-800 mb-1">Nota: {importNumerNoty}</div>
					<div class="text-blue-700">Razem składka: {fmtPln(importRazemSkladka)} PLN · Razem prowizja: {fmtPln(importRazemProwizja)} PLN</div>
				</div>

				<!-- Ujemne kwoty — alert -->
				{#if importNegative.length > 0}
					<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
						<div class="flex items-center gap-2 font-semibold text-red-700 mb-2"><AlertTriangle size={15} /> Ujemna prowizja — wymagane działanie ({importNegative.length}):</div>
						{#each importNegative as r}
							<div class="text-sm text-red-600 font-mono">{r.nr_polisy_raw} — {r.ubezpieczajacy} — {fmtPln(r.prowizja_nota)} PLN</div>
						{/each}
						<p class="text-xs text-red-500 mt-2">Alert zostanie wysłany do brokera i admina. Wymagany aneks do polisy.</p>
					</div>
				{/if}

				<!-- Nieznalezione -->
				{#if importNotFound.length > 0}
					<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
						<div class="flex items-center gap-2 font-semibold text-amber-700 mb-2"><AlertTriangle size={15} /> Polisy nieznalezione w bazie ({importNotFound.length}):</div>
						{#each importNotFound as r}
							<div class="text-sm text-amber-700 font-mono">{r.nr_polisy_raw} — {r.ubezpieczajacy}</div>
						{/each}
					</div>
				{/if}

				<!-- Już rozliczone -->
				{#if importAlreadySettled.length > 0}
					<div class="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
						<div class="text-sm font-semibold text-slate-600 mb-1">Już rozliczone — pominięte ({importAlreadySettled.length}):</div>
						{#each importAlreadySettled as r}<div class="text-xs text-slate-500 font-mono">{r.nr_polisy_raw}</div>{/each}
					</div>
				{/if}

				<!-- Tabela do rozliczenia -->
				{#if importToProcess.length > 0}
					<div class="border border-slate-200 rounded-lg overflow-hidden">
						<table class="w-full text-xs">
							<thead class="bg-slate-50 border-b border-slate-200">
								<tr>
									<th class="px-3 py-2 text-left font-semibold text-slate-600">Nr polisy</th>
									<th class="px-3 py-2 text-left font-semibold text-slate-600">Ubezpieczający</th>
									<th class="px-3 py-2 text-right font-semibold text-slate-600">Składka</th>
									<th class="px-3 py-2 text-right font-semibold text-slate-600">Prow. nota</th>
									<th class="px-3 py-2 text-right font-semibold text-slate-600">Prow. CRM</th>
									<th class="px-3 py-2 font-semibold text-slate-600">Akcja</th>
								</tr>
							</thead>
							<tbody>
								{#each importToProcess as r}
									{@const bigDiff = r.prowizja_diff > 0.5}
									<tr class="border-t border-slate-100 {bigDiff ? 'bg-amber-50/60' : ''}">
										<td class="px-3 py-2 font-mono">{r.nr_polisy}</td>
										<td class="px-3 py-2 text-slate-600 truncate max-w-[120px]">{r.ubezpieczajacy}</td>
										<td class="px-3 py-2 text-right">{fmtPln(r.skladka_nota)}</td>
										<td class="px-3 py-2 text-right {bigDiff ? 'text-amber-700 font-bold' : ''}">{fmtPln(r.prowizja_nota)}</td>
										<td class="px-3 py-2 text-right {bigDiff ? 'text-amber-700 font-bold' : ''}">{fmtPln(r.prowizja_crm ?? 0)}</td>
										<td class="px-3 py-2">
											{#if bigDiff}
												<!-- Różnica > 0.5 PLN: operator decyduje -->
												<div class="flex flex-col gap-1">
													<p class="text-[10px] text-amber-700 font-semibold">Δ {fmtPln(r.prowizja_diff)} PLN</p>
													<div class="flex gap-1">
														<button
															onclick={() => setOperatorAction(r, 'settle')}
															class="px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors {r.operator_action === 'settle' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}">
															Rozlicz
														</button>
														<button
															onclick={() => setOperatorAction(r, 'skip')}
															class="px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors {r.operator_action === 'skip' ? 'bg-red-600 text-white border-red-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}">
															Aneks
														</button>
													</div>
												</div>
											{:else}
												<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">Opłacona ✓</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if importNeedsDecision.length > 0}
						<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
							<strong>{importNeedsDecision.length}</strong> pozycji z rozjazdem prowizji > 0,50 PLN wymaga decyzji.
							„Rozlicz" — zaksięguj i utwórz alert do weryfikacji.
							„Aneks" — nie rozliczaj, utwórz alert o konieczności aneksu do polisy.
						</p>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</Modal>
