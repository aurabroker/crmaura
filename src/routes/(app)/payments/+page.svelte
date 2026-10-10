<script lang="ts">
	import { wczytajPlatnosci } from '$lib/kolekcje';
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { PolicyPayment } from '$lib/types/database';
	import Modal from '$lib/components/Modal.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { fmtPln, todayStr, fmtDzien, fmtTermin, dateDiffDays, odmiana } from '$lib/utils';
	import { poTerminie, ugBezRozliczania, ROZLICZONE } from '$lib/platnosci';
	import { Plus, Check, Search, FileSpreadsheet, AlertTriangle, CheckCircle2,
		RotateCcw, FileText, User, Copy, ChevronDown } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { ctxMenu } from '$lib/actions/ctxMenu';
	import { ctxCopy, type CtxItem } from '$lib/stores/ctxmenu.svelte';
	import { dekodujCsv, parseErgoCsv } from '$lib/commissionImport/ergoCsv';
	import { parseColonnade } from '$lib/commissionImport/colonnadeXlsx';
	const today = todayStr();
	type Filtr = 'wszystkie' | 'po-terminie' | 'tydzien' | 'pozniej' | 'oplacone';
	let filtr = $state<Filtr>('wszystkie');
	let filterMonth = $state('all');
	// Głębokie linki, np. /payments?filtr=po-terminie
	onMount(() => {
		const f = $page.url.searchParams.get('filtr') as Filtr | null;
		if (f && ['po-terminie', 'tydzien', 'pozniej', 'oplacone'].includes(f)) filtr = f;
	});
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
	type ImportMode = 'ergo' | 'leadenhall' | 'colonnade';
	const TU_NOTY: Record<ImportMode, string> = { ergo: 'ERGO', leadenhall: 'LEADENHALL', colonnade: 'COLONNADE' };

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
		// Noty „rata po racie” (Colonnade): numer raty i data wpłaty z pliku
		nr_raty?: number | null;
		data_oplacenia?: string | null;
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
	// Zestawienie CSV ERGO: miesiąc z numeru i rozbieżności z sumami w nagłówku pliku
	let importOkres = $state<string | null>(null);
	let importOstrzezenia = $state<string[]>([]);
	// Wcześniejszy import tego samego zestawienia: rozliczone wtedy polisy są pomijane,
	// a nowe pozycje dopisujemy do tej samej noty
	let importPoprzednia = $state<{ id: string; data: string; pozycji: number } | null>(null);

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

		// Nota z numerem raty (Colonnade): ta konkretna rata. Gdy jest już rozliczona — nie bierzemy innej.
		if (row.nr_raty != null) {
			const rata = appState.payments.find(p => p.polisa_id === policy.id && p.nr_raty === row.nr_raty);
			if (rata && settledStatuses.includes(rata.status)) { row.already_settled = true; return row; }
			// Prowizja oczekiwana dla tej raty: kwota wpłaty × stawka polisy
			row.prowizja_crm = Math.round(Math.abs(row.skladka_nota) * (Number(policy.prowizja_pct) || 0)) / 100;
			const cel = rata ?? appState.payments
				.filter(p => p.polisa_id === policy.id && !settledStatuses.includes(p.status))
				.sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci))
				.find(p => Math.abs(Number(p.kwota) - Math.abs(row.skladka_nota)) < 0.01);
			if (cel) {
				row.payment_id = cel.id;
				row.prowizja_diff = Math.abs(row.prowizja_crm - Math.abs(row.prowizja_nota));
				// Status z wpłaty (cała rata = opłacona); rozjazd prowizji idzie do alertu, nie do statusu raty
				row.new_status = Math.abs(Number(cel.kwota) - Math.abs(row.skladka_nota)) < 0.01 ? 'Opłacona' : 'Częściowo opłacona';
			}
			return row;
		}

		// Rata o kwocie równej składce z noty, a gdy takiej nie ma — najwcześniejsza nierozliczona
		const otwarte = appState.payments
			.filter(p => p.polisa_id === policy.id && !settledStatuses.includes(p.status))
			.sort((a, b) => a.data_platnosci.localeCompare(b.data_platnosci));
		const payment = otwarte.find(p => Math.abs(Number(p.kwota) - Math.abs(row.skladka_nota)) < 0.01) ?? otwarte[0];
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

	// ===== ERGO CSV — „Szczegóły zestawienia prowizyjnego” z portalu agenta =====
	async function parseErgoCsvFile(file: File): Promise<void> {
		const z = parseErgoCsv(dekodujCsv(new Uint8Array(await file.arrayBuffer())));
		importNumerNoty = z.numer;
		importDataZest = ''; // plik nie podaje daty sporządzenia, tylko miesiąc w numerze
		importOkres = z.okres;
		importOstrzezenia = z.ostrzezenia;
		importRazemSkladka = z.razem_podstawa;
		importRazemProwizja = z.razem_prowizja;
		importPreview = z.pozycje.map(p => resolveRow({
			nr_polisy: p.nr_polisy, nr_polisy_raw: p.nr_polisy,
			ubezpieczajacy: p.ubezpieczajacy,
			skladka_nota: p.podstawa, prowizja_nota: p.prowizja,
			payment_id: null, policy_id: null, prowizja_crm: null,
			new_status: null, not_found: false, already_settled: false,
			is_negative: p.prowizja < 0, prowizja_diff: 0, operator_action: 'settle'
		}));
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

	// ===== COLONNADE (portal Cellent) — jedna pozycja = jedna rata =====
	async function parseColonnadeFile(file: File): Promise<void> {
		const XLSX = await import('xlsx');
		const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
		const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
		const z = parseColonnade(rows, file.name);
		importNumerNoty = z.numer;
		importDataZest = z.data_wygenerowania ?? '';
		importOkres = z.okres;
		importOstrzezenia = z.ostrzezenia;
		importRazemSkladka = z.razem_kwota;
		importRazemProwizja = z.razem_prowizja;
		importPreview = z.pozycje.map(p => resolveRow({
			nr_polisy: p.nr_polisy, nr_polisy_raw: p.nr_polisy,
			ubezpieczajacy: p.ubezpieczajacy,
			skladka_nota: p.kwota, prowizja_nota: p.prowizja,
			payment_id: null, policy_id: null, prowizja_crm: null,
			new_status: null, not_found: false, already_settled: false,
			is_negative: p.prowizja < 0, prowizja_diff: 0, operator_action: 'settle',
			nr_raty: p.nr_raty, data_oplacenia: p.data_oplacenia
		}));
	}

	async function onImportFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importFile = file;
		importLoading = true;
		importError = '';
		importPreview = [];
		importOkres = null;
		importOstrzezenia = [];
		importPoprzednia = null;
		try {
			if (importMode === 'ergo' && /\.csv$/i.test(file.name)) await parseErgoCsvFile(file);
			else if (importMode === 'ergo') await parseErgoXlsx(file);
			else if (importMode === 'colonnade') await parseColonnadeFile(file);
			else await parseLeadenhallXlsx(file);
			if (importNumerNoty) {
				const { data } = await sb.from('crm_noty').select('id, data_importu, pozycji_count')
					.eq('numer_noty', importNumerNoty).eq('tu_skrot', TU_NOTY[importMode])
					.order('data_importu');
				const wczesniej = (data ?? []) as { id: string; data_importu: string; pozycji_count: number | null }[];
				if (wczesniej.length) {
					importPoprzednia = {
						id: wczesniej[0].id,
						data: new Date(wczesniej[0].data_importu).toLocaleDateString('pl-PL'),
						pozycji: wczesniej[0].pozycji_count ?? 0
					};
					// Polisa rozliczona już tym zestawieniem nie dostaje drugiej raty z tej samej noty
					// (przy notach z numerem raty — ta sama rata)
					const notaIds = new Set(wczesniej.map(n => n.id));
					importPreview = importPreview.map(r =>
						r.policy_id && appState.payments.some(p => p.polisa_id === r.policy_id && (r.nr_raty == null || p.nr_raty === r.nr_raty) && p.nota_id && notaIds.has(p.nota_id))
							? { ...r, payment_id: null, new_status: null, already_settled: true }
							: r
					);
				}
			}
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

		const tuSkrot = TU_NOTY[importMode];

		// Plik źródłowy do prywatnego bucketu; w nocie zapisujemy ścieżkę, a link do pobrania
		// powstaje przy kliknięciu (storageLink.ts).
		const pozycji = importPreview.filter(r => r.payment_id && r.operator_action === 'settle').length;
		let notaId: string;
		if (importPoprzednia) {
			// Ponowny import tego samego zestawienia — pozycje dopisujemy do istniejącej noty (plik już w niej jest)
			const { error: notaErr } = await sb.from('crm_noty')
				.update({ pozycji_count: importPoprzednia.pozycji + pozycji } as never)
				.eq('id', importPoprzednia.id);
			if (notaErr) { importSaving = false; importError = notaErr.message; return; }
			notaId = importPoprzednia.id;
		} else {
			let fileUrl: string | null = null;
			if (importFile) {
				const ext = importFile.name.split('.').pop() ?? 'xlsx';
				const path = `${appState.profile!.tenant_id}/${tuSkrot}_${importNumerNoty.replace(/\//g, '-')}_${Date.now()}.${ext}`;
				const { data: upData } = await sb.storage.from('settlement-files').upload(path, importFile, { upsert: true });
				if (upData) fileUrl = path;
			}

			const { data: nota, error: notaErr } = await sb.from('crm_noty').insert([{
				tenant_id: appState.profile!.tenant_id,
				numer_noty: importNumerNoty,
				tu_skrot: tuSkrot,
				data_zestawienia: importDataZest || null,
				razem_skladka: importRazemSkladka,
				razem_prowizja: importRazemProwizja,
				pozycji_count: pozycji,
				file_url: fileUrl
			}]).select('id').single();

			if (notaErr) { importSaving = false; importError = notaErr.message; return; }
			notaId = nota!.id;
		}

		// Rows to settle
		const toSettle = importPreview.filter(r => r.payment_id && r.new_status && r.operator_action === 'settle' && !r.is_negative);
		let settled = 0;
		for (const row of toSettle) {
			await sb.from('crm_policy_payments').update({
				status: row.new_status,
				kwota: Math.abs(row.skladka_nota),
				prowizja_z_noty: Math.abs(row.prowizja_nota),
				nota_id: notaId,
				data_oplacenia: row.data_oplacenia ?? today
			} as never).eq('id', row.payment_id!);
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
		const { data: pays, error: bladPlatnosci } = await wczytajPlatnosci();
		if (!bladPlatnosci && pays) appState.payments = pays as typeof appState.payments;
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
		importOkres = null;
		importOstrzezenia = [];
		importPoprzednia = null;
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

	// ===== RATY: grupy wg pilności (wspólna definicja „po terminie” — $lib/platnosci) =====
	const ugIds = $derived(ugBezRozliczania(appState.policies));
	const polisaWg = $derived(new Map(appState.policies.map((p) => [p.id, p])));

	type Grupa = 'po-terminie' | 'tydzien' | 'pozniej' | 'oplacone' | 'ug';
	function grupaRaty(p: PolicyPayment): Grupa {
		if (ROZLICZONE.includes(p.status)) return 'oplacone';
		if (ugIds.has(p.polisa_id)) return 'ug';
		if (poTerminie(p, today, ugIds)) return 'po-terminie';
		return dateDiffDays(today, p.data_platnosci) <= 7 ? 'tydzien' : 'pozniej';
	}

	// Okres i wyszukiwanie — podstawa podsumowania, liczników i grup
	const wOkresie = $derived(
		appState.payments
			.filter((p) => filterMonth === 'all' || p.data_platnosci.startsWith(filterMonth))
			.filter((p) => {
				if (!search) return true;
				const q = search.toLowerCase();
				return (p.crm_policies?.crm_clients?.nazwa ?? '').toLowerCase().includes(q) ||
					(p.crm_policies?.nr_polisy ?? '').toLowerCase().includes(q);
			})
	);
	const zGrupa = $derived(wOkresie.map((p) => ({ p, g: grupaRaty(p) })));
	const licznik = (g: Grupa) => zGrupa.filter((x) => x.g === g).length;
	const suma = (g: Grupa) => zGrupa.filter((x) => x.g === g).reduce((s, x) => s + Number(x.p.kwota), 0);

	const GRUPY: { id: Grupa; tytul: string; ton: string }[] = [
		{ id: 'po-terminie', tytul: 'Po terminie', ton: 'text-danger' },
		{ id: 'tydzien', tytul: 'Najbliższe 7 dni', ton: 'text-warn' },
		{ id: 'pozniej', tytul: 'Później', ton: 'text-ink' },
		{ id: 'oplacone', tytul: 'Opłacone', ton: 'text-ok' },
		{ id: 'ug', tytul: 'Umowy generalne bez rozliczania płatności', ton: 'text-ink-2' }
	];
	const grupy = $derived(
		GRUPY.filter((g) => filtr === 'wszystkie' || g.id === filtr)
			.map((g) => {
				const raty = zGrupa
					.filter((x) => x.g === g.id)
					.map((x) => x.p)
					.sort((a, b) => g.id === 'oplacone'
						? (b.data_oplacenia ?? b.data_platnosci).localeCompare(a.data_oplacenia ?? a.data_platnosci)
						: a.data_platnosci.localeCompare(b.data_platnosci));
				return { ...g, raty, suma: raty.reduce((s, p) => s + Number(p.kwota), 0) };
			})
			.filter((g) => g.raty.length > 0)
	);
	const filtered = $derived(grupy.flatMap((g) => g.raty));

	const LIMIT = 25;
	let rozwiniete = $state(new Set<Grupa>());
	function przelaczGrupe(g: Grupa) {
		const s = new Set(rozwiniete);
		s.has(g) ? s.delete(g) : s.add(g);
		rozwiniete = s;
	}

	const filtry = $derived<[Filtr, string, number | null][]>([
		['wszystkie', 'Wszystkie', null],
		['po-terminie', 'Po terminie', licznik('po-terminie')],
		['tydzien', 'Najbliższe 7 dni', licznik('tydzien')],
		['pozniej', 'Później', licznik('pozniej')],
		['oplacone', 'Opłacone', licznik('oplacone')]
	]);

	const podsum = $derived({
		oplacone: { n: licznik('oplacone'), s: suma('oplacone') },
		oczekujace: { n: licznik('tydzien') + licznik('pozniej'), s: suma('tydzien') + suma('pozniej') },
		poTerminie: { n: licznik('po-terminie'), s: suma('po-terminie') }
	});
	const razem = $derived(podsum.oplacone.s + podsum.oczekujace.s + podsum.poTerminie.s);
	const udzial = (x: number) => (razem > 0 ? (x / razem) * 100 : 0);
	const fmtProc = (n: number) => `${n.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`;
	const nazwaMiesiaca = (ym: string) =>
		new Date(`${ym}-01T12:00:00`).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

	function rataZ(p: PolicyPayment): string {
		const ile = parseInt(polisaWg.get(p.polisa_id)?.ilosc_rat ?? '1') || 1;
		return ile > 1 ? `${p.nr_raty}/${ile}` : String(p.nr_raty);
	}
	function chip(p: PolicyPayment, g: Grupa): { tekst: string; cls: string } {
		if (g === 'oplacone') {
			return p.status === 'Częściowo opłacona'
				? { tekst: 'Częściowo', cls: 'bg-warn-soft text-warn' }
				: { tekst: 'Opłacona', cls: 'bg-ok-soft text-ok' };
		}
		if (g === 'po-terminie') return { tekst: 'Po terminie', cls: 'bg-danger-soft text-danger' };
		if (g === 'ug') return { tekst: 'Bez rozliczania', cls: 'bg-surface-2 text-ink-2' };
		return { tekst: 'Oczekuje', cls: 'bg-surface-2 text-ink-2' };
	}
	function opisTerminu(p: PolicyPayment, g: Grupa): string {
		if (g === 'oplacone') return p.data_oplacenia ? `opłacona ${fmtDzien(p.data_oplacenia)}` : 'opłacona';
		return fmtTermin(p.data_platnosci, today);
	}
	const tonTerminu = (g: Grupa) =>
		g === 'po-terminie' ? 'text-danger font-semibold' : g === 'tydzien' ? 'text-warn font-semibold' : g === 'oplacone' ? 'text-ok' : 'text-ink-2';

	let rozliczMenu = $state(false);
	$effect(() => {
		if (rozliczMenu) {
			const zamknij = () => (rozliczMenu = false);
			window.addEventListener('click', zamknij, { once: true });
		}
	});

	// Komunikat po zapisie, z „Cofnij”
	let toast = $state<{ tekst: string; blad?: boolean; cofnij?: () => void } | null>(null);
	const bladZapisu = (e: { message: string }) => { toast = { tekst: `Nie udało się zapisać: ${e.message}`, blad: true }; };

	async function reloadPayments() {
		const { data } = await wczytajPlatnosci();
		appState.payments = (data ?? []) as typeof appState.payments;
	}

	async function markPaid(pay: PolicyPayment) {
		const poprzednio = { status: pay.status, data_oplacenia: pay.data_oplacenia };
		const { error } = await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today } as never).eq('id', pay.id);
		if (error) { bladZapisu(error); return; }
		await reloadPayments();
		toast = {
			tekst: `Rata ${pay.nr_raty} polisy ${pay.crm_policies?.nr_polisy ?? ''} oznaczona jako opłacona`,
			cofnij: async () => {
				toast = null;
				const { error: e2 } = await sb.from('crm_policy_payments').update(poprzednio as never).eq('id', pay.id);
				if (e2) { bladZapisu(e2); return; }
				await reloadPayments();
			}
		};
	}

	async function markOverdue(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Zaległa' }).eq('id', pay.id);
		await reloadPayments();
	}

	async function revertPayment(pay: PolicyPayment) {
		await sb.from('crm_policy_payments').update({ status: 'Oczekująca', data_oplacenia: null, nota_id: null, prowizja_z_noty: null }).eq('id', pay.id);
		await reloadPayments();
	}

	function paymentMenu(pay: PolicyPayment): CtxItem[] {
		const pol = appState.policies.find((x) => x.id === pay.polisa_id);
		return [
			{
				label: 'Oznacz jako Opłacona',
				icon: Check,
				disabled: pay.status === 'Opłacona',
				onSelect: () => markPaid(pay)
			},
			{
				label: 'Oznacz jako Zaległa',
				icon: AlertTriangle,
				disabled: pay.status === 'Zaległa',
				onSelect: () => markOverdue(pay)
			},
			{
				label: 'Cofnij do Oczekującej',
				icon: RotateCcw,
				disabled: pay.status === 'Oczekująca',
				onSelect: () => revertPayment(pay)
			},
			{ separator: true },
			{
				label: 'Przejdź do polisy',
				icon: FileText,
				disabled: !pay.polisa_id,
				onSelect: () => goto(`/policies/${pay.polisa_id}`)
			},
			{
				label: 'Karta klienta',
				icon: User,
				disabled: !pol?.klient_id,
				onSelect: () => goto(`/clients/${pol!.klient_id}`)
			},
			{ separator: true },
			{
				label: 'Kopiuj nr polisy',
				icon: Copy,
				disabled: !pay.crm_policies?.nr_polisy,
				onSelect: () => ctxCopy(pay.crm_policies?.nr_polisy, 'nr polisy')
			},
			{
				label: 'Kopiuj kwotę raty',
				icon: Copy,
				onSelect: () => ctxCopy(String(pay.kwota ?? ''), 'kwotę')
			}
		];
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

	const months = $derived(() => {
		const set = new Set<string>();
		for (const p of appState.payments) set.add(p.data_platnosci.slice(0, 7));
		return [...set].sort();
	});

	const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

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
	function toggleGrupa(ids: string[]) {
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
		const doZmiany = selectedPays.filter(p => p.status === 'Oczekująca' || p.status === 'Zaległa');
		const ids = doZmiany.map(p => p.id);
		const { error } = await sb.from('crm_policy_payments').update({ status: 'Opłacona', data_oplacenia: today } as never).in('id', ids);
		if (error) { bladZapisu(error); return; }
		await reloadPayments(); selected = new Set();
		toast = {
			tekst: `${odmiana(ids.length, 'rata oznaczona', 'raty oznaczone', 'rat oznaczonych')} jako opłacone`,
			cofnij: async () => {
				toast = null;
				for (const status of ['Oczekująca', 'Zaległa']) {
					const grupa = doZmiany.filter(p => p.status === status).map(p => p.id);
					if (!grupa.length) continue;
					const { error: e2 } = await sb.from('crm_policy_payments').update({ status, data_oplacenia: null } as never).in('id', grupa);
					if (e2) { bladZapisu(e2); return; }
				}
				await reloadPayments();
			}
		};
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

<svelte:head><title>Płatności — AuraCRM</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3 mb-5">
	<div>
		<h1 class="text-2xl font-semibold text-ink">Płatności</h1>
		<p class="text-sm text-ink-3 mt-0.5">Raty składek — terminy, wpłaty i rozliczenia not</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<div class="relative">
			<button
				onclick={(e) => { e.stopPropagation(); rozliczMenu = !rozliczMenu; }}
				aria-expanded={rozliczMenu}
				aria-haspopup="menu"
				class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2"
			>
				<FileSpreadsheet size={16} class="text-ink-3" /> Rozlicz notę TU <ChevronDown size={14} />
			</button>
			{#if rozliczMenu}
				<div role="menu" class="absolute right-0 top-full mt-1 w-72 bg-white border border-line rounded-xl shadow-xl z-50 py-1">
					<button role="menuitem" onclick={() => { rozliczMenu = false; openImport('ergo'); }} class="w-full text-left px-4 py-2.5 hover:bg-surface-2">
						<span class="block text-sm font-medium text-ink">ERGO Hestia</span>
						<span class="block text-xs text-ink-3">zestawienie prowizyjne — CSV lub XLSX</span>
					</button>
					<button role="menuitem" onclick={() => { rozliczMenu = false; openImport('leadenhall'); }} class="w-full text-left px-4 py-2.5 hover:bg-surface-2">
						<span class="block text-sm font-medium text-ink">Leadenhall / Squarelife</span>
						<span class="block text-xs text-ink-3">nota prowizyjna — XLSX</span>
					</button>
					<button role="menuitem" onclick={() => { rozliczMenu = false; openImport('colonnade'); }} class="w-full text-left px-4 py-2.5 hover:bg-surface-2">
						<span class="block text-sm font-medium text-ink">Colonnade (Cellent)</span>
						<span class="block text-xs text-ink-3">zestawienie prowizyjne — XLSX, rata po racie</span>
					</button>
				</div>
			{/if}
		</div>
		<button onclick={() => (showModal = true)} class="h-9 flex items-center gap-1.5 px-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-colors">
			<Plus size={16} /> Dodaj ratę
		</button>
	</div>
</div>

<!-- Alerty prowizyjne -->
{#if appState.alerts.length > 0}
	<div class="mb-4 bg-white border border-amber-200 rounded-xl overflow-hidden">
		<div class="px-4 py-2.5 flex items-center gap-2 bg-warn-soft border-b border-amber-200">
			<AlertTriangle size={16} class="text-warn" />
			<span class="text-sm font-semibold text-amber-800">Alerty prowizyjne ({appState.alerts.length})</span>
			<a href="/dashboard#alerty" class="ml-auto text-[13px] font-semibold text-accent-text hover:underline">Rozwiąż na pulpicie →</a>
		</div>
		<ul class="divide-y divide-line-soft">
			{#each appState.alerts.slice(0, 3) as alert}
				<li class="px-4 py-2 text-[13px] text-ink-2">
					<span class="font-semibold text-ink">{alert.typ === 'ujemna_prowizja' ? 'Ujemna prowizja' : alert.typ === 'aneks_wymagany' ? 'Aneks wymagany' : 'Rozbieżność prowizji'}</span>
					{#if alert.nr_polisy} · polisa <span class="font-mono">{alert.nr_polisy}</span>{/if}
					· {alert.opis}
				</li>
			{/each}
			{#if appState.alerts.length > 3}
				<li class="px-4 py-2 text-[13px] text-ink-3">… i {appState.alerts.length - 3} więcej</li>
			{/if}
		</ul>
	</div>
{/if}

<!-- Podsumowanie -->
<section aria-label="Podsumowanie rat" class="bg-white border border-line rounded-xl p-4 flex flex-col gap-3 mb-4">
	<div class="flex flex-wrap items-center gap-3">
		<label>
			<span class="sr-only">Okres</span>
			<select bind:value={filterMonth} class="h-8 px-2.5 border border-line rounded-lg bg-white text-[13px] font-semibold text-ink">
				<option value="all">Wszystkie raty · stan na {fmtDzien(today)}</option>
				{#each months() as m}
					<option value={m}>{nazwaMiesiaca(m)}</option>
				{/each}
			</select>
		</label>
		<div class="flex flex-wrap gap-x-6 gap-y-2 sm:ml-auto">
			<span class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-sm bg-ok"></span>
				<span class="text-[13px] text-ink-2">Opłacone · {podsum.oplacone.n}</span>
				<span class="font-semibold tabular-nums">{fmtPln(podsum.oplacone.s)} zł</span>
			</span>
			<span class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-sm bg-[#7B8496]"></span>
				<span class="text-[13px] text-ink-2">Oczekujące · {podsum.oczekujace.n}</span>
				<span class="font-semibold tabular-nums">{fmtPln(podsum.oczekujace.s)} zł</span>
			</span>
			<span class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-sm bg-danger"></span>
				<span class="text-[13px] text-ink-2">Po terminie · {podsum.poTerminie.n}</span>
				<span class="font-semibold tabular-nums text-danger">{fmtPln(podsum.poTerminie.s)} zł</span>
			</span>
		</div>
	</div>
	<div
		role="img"
		aria-label="Opłacone {fmtProc(udzial(podsum.oplacone.s))}, oczekujące {fmtProc(udzial(podsum.oczekujace.s))}, po terminie {fmtProc(udzial(podsum.poTerminie.s))} wartości rat"
		class="flex gap-0.5 h-2.5 rounded-full overflow-hidden bg-surface-2"
	>
		{#if podsum.oplacone.s > 0}<span class="bg-ok min-w-1" style="width: {udzial(podsum.oplacone.s)}%"></span>{/if}
		{#if podsum.oczekujace.s > 0}<span class="bg-[#7B8496] min-w-1" style="width: {udzial(podsum.oczekujace.s)}%"></span>{/if}
		{#if podsum.poTerminie.s > 0}<span class="bg-danger min-w-1" style="width: {udzial(podsum.poTerminie.s)}%"></span>{/if}
	</div>
</section>

<!-- Filtry -->
<div class="flex flex-wrap items-center gap-2 mb-3">
	<div role="group" aria-label="Filtr statusu" class="flex flex-wrap gap-1.5">
		{#each filtry as [id, label, n]}
			<button
				aria-pressed={filtr === id}
				onclick={() => (filtr = id)}
				class="h-[30px] px-3 rounded-full text-[13px] font-medium border transition-colors
					{filtr === id ? 'bg-ink text-white border-ink' : 'bg-white text-ink-2 border-line hover:bg-surface-2'}"
			>{n != null ? `${label} ${n}` : label}</button>
		{/each}
	</div>
	<label class="w-full sm:w-[300px] sm:ml-auto h-9 flex items-center gap-2 px-2.5 border border-line rounded-lg bg-white focus-within:border-accent">
		<Search size={16} class="text-ink-3 shrink-0" />
		<span class="sr-only">Filtruj raty</span>
		<input bind:value={search} placeholder="Klient lub nr polisy" class="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
	</label>
</div>

<!-- Raty -->
<section aria-label="Raty" class="bg-white border border-line rounded-xl overflow-hidden">
	{#if selected.size > 0}
		<div class="flex flex-wrap items-center gap-2 px-4 py-2 bg-accent-soft text-accent-text text-[13px]">
			<span class="font-semibold mr-1">{odmiana(selected.size, 'rata zaznaczona', 'raty zaznaczone', 'rat zaznaczonych')}</span>
			{#if canMarkPaid}
				<button onclick={bulkMarkPaid} class="h-7 px-2.5 border border-blue-300 rounded-lg bg-white font-medium hover:bg-blue-50">Oznacz jako opłacone</button>
			{/if}
			{#if canMarkOverdue}
				<button onclick={bulkMarkOverdue} class="h-7 px-2.5 border border-blue-300 rounded-lg bg-white font-medium hover:bg-blue-50">Oznacz jako zaległe</button>
			{/if}
			{#if canRevert}
				<button onclick={bulkRevert} class="h-7 px-2.5 border border-blue-300 rounded-lg bg-white font-medium hover:bg-blue-50">Cofnij do oczekujących</button>
			{/if}
			<button onclick={() => (selected = new Set())} class="ml-auto h-7 px-2 font-semibold hover:underline">Odznacz</button>
		</div>
	{/if}

	{#if grupy.length === 0}
		<p class="px-4 py-12 text-center text-sm text-ink-3">Brak rat dla wybranych filtrów.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[960px] text-[13px] text-left">
				<thead>
					<tr class="bg-surface-2 text-ink-2">
						<th class="w-11 pl-4 py-2.5"><span class="sr-only">Zaznacz</span></th>
						<th class="px-3 py-2.5 font-semibold">Termin</th>
						<th class="px-3 py-2.5 font-semibold">Polisa</th>
						<th class="px-3 py-2.5 font-semibold">Klient</th>
						<th class="px-3 py-2.5 font-semibold">Rata</th>
						<th class="hidden min-[1400px]:table-cell px-3 py-2.5 font-semibold">TU</th>
						<th class="px-3 py-2.5 font-semibold text-right">Kwota</th>
						<th class="hidden min-[1400px]:table-cell px-3 py-2.5 font-semibold text-right" title="Prowizja z noty prowizyjnej TU">Prowizja</th>
						<th class="px-3 py-2.5 font-semibold">Status</th>
						<th class="px-3 py-2.5"><span class="sr-only">Akcje</span></th>
					</tr>
				</thead>
				{#each grupy as g (g.id)}
					{@const ids = g.raty.map((p) => p.id)}
					{@const wszystkie = ids.every((id) => selected.has(id))}
					{@const widoczne = rozwiniete.has(g.id) ? g.raty : g.raty.slice(0, LIMIT)}
					<tbody>
						<tr class="border-t border-line bg-side">
							<td class="pl-4 py-2.5">
								<input type="checkbox" checked={wszystkie} onchange={() => toggleGrupa(ids)} aria-label="Zaznacz całą grupę: {g.tytul}" class="w-4 h-4 accent-accent cursor-pointer align-middle" />
							</td>
							<th scope="rowgroup" colspan="9" class="px-3 py-2.5 text-left font-normal">
								<span class="font-semibold {g.ton}">{g.tytul}</span>
								<span class="ml-2.5 text-ink-2 tabular-nums">{odmiana(g.raty.length, 'rata', 'raty', 'rat')} · {fmtPln(g.suma)} zł</span>
							</th>
						</tr>
						{#each widoczne as pay (pay.id)}
							{@const checked = selected.has(pay.id)}
							{@const c = chip(pay, g.id)}
							{@const pol = polisaWg.get(pay.polisa_id)}
							<tr
								use:ctxMenu={{ items: () => paymentMenu(pay), title: `${pay.crm_policies?.nr_polisy ?? 'Rata'} — rata ${pay.nr_raty}` }}
								class="border-t border-line-soft {checked ? 'bg-blue-50' : 'hover:bg-bg'}"
							>
								<td class="pl-4 py-2">
									<input type="checkbox" {checked} onchange={() => toggleSelect(pay.id)} aria-label="Zaznacz ratę {pay.nr_raty} polisy {pay.crm_policies?.nr_polisy ?? ''}" class="w-4 h-4 accent-accent cursor-pointer align-middle" />
								</td>
								<td class="px-3 py-2 whitespace-nowrap">
									<span class="block">{fmtDzien(pay.data_platnosci)}</span>
									<span class="block text-xs {tonTerminu(g.id)}">{opisTerminu(pay, g.id)}</span>
								</td>
								<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
									<a href="/policies/{pay.polisa_id}" class="text-accent-text hover:underline">{pay.crm_policies?.nr_polisy ?? '—'}</a>
								</td>
								<td class="px-3 py-2 min-w-[180px] max-w-[300px]">
									{#if pol?.klient_id}
										<a href="/clients/{pol.klient_id}" class="block truncate font-medium text-ink hover:text-accent-text">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</a>
									{:else}
										<span class="block truncate font-medium">{pay.crm_policies?.crm_clients?.nazwa ?? '—'}</span>
									{/if}
									{#if pay.notatka}<span class="block truncate text-xs text-ink-3" title={pay.notatka}>{pay.notatka}</span>{/if}
								</td>
								<td class="px-3 py-2 tabular-nums">{rataZ(pay)}</td>
								<td class="hidden min-[1400px]:table-cell px-3 py-2 text-ink-2 whitespace-nowrap">{pol?.crm_insurers?.skrot ?? pol?.crm_insurers?.nazwa ?? '—'}</td>
								<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">{fmtPln(pay.kwota)} zł</td>
								<td class="hidden min-[1400px]:table-cell px-3 py-2 text-right tabular-nums whitespace-nowrap text-ink-2">{pay.prowizja_z_noty != null ? `${fmtPln(pay.prowizja_z_noty)} zł` : '—'}</td>
								<td class="px-3 py-2">
									<span class="inline-block h-[22px] leading-[22px] px-2 rounded-full text-xs font-semibold whitespace-nowrap {c.cls}">{c.tekst}</span>
								</td>
								<td class="px-3 py-1.5 text-right whitespace-nowrap">
									{#if g.id !== 'oplacone'}
										<button onclick={() => markPaid(pay)} class="h-[30px] px-2.5 text-[13px] font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2">Oznacz wpłatę</button>
									{/if}
								</td>
							</tr>
						{/each}
						{#if g.raty.length > LIMIT}
							<tr class="border-t border-line-soft">
								<td></td>
								<td colspan="9" class="px-3 py-2">
									<button onclick={() => przelaczGrupe(g.id)} class="text-[13px] font-semibold text-accent-text hover:underline">
										{rozwiniete.has(g.id) ? 'Pokaż mniej' : `Pokaż wszystkie ${g.raty.length} →`}
									</button>
								</td>
							</tr>
						{/if}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-line-soft text-[13px] text-ink-2">
		<span>Status „po terminie” liczony z daty — tak samo na pulpicie i w menu. Prawy przycisk myszy na racie: więcej akcji.</span>
		<span class="sm:ml-auto tabular-nums">{odmiana(wOkresie.length, 'rata', 'raty', 'rat')}</span>
	</div>
</section>

{#if toast}
	<Toast tekst={toast.tekst} blad={toast.blad} oncofnij={toast.cofnij} onzamknij={() => (toast = null)} />
{/if}

<!-- Modal: Dodaj Ratę -->
<Modal title="Dodaj Ratę Płatności" open={showModal} onclose={() => { showModal = false; formError = ''; }}>
	{#snippet footer()}
		<button onclick={() => { showModal = false; formError = ''; }} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
		<button onclick={addPayment} disabled={saving} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover disabled:opacity-60">
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

<!-- Modal: Import prowizji (ERGO / Leadenhall / Colonnade) -->
<Modal
	title={importMode === 'ergo' ? 'Rozlicz ERGO — Import zestawienia prowizyjnego' : importMode === 'colonnade' ? 'Rozlicz Colonnade — Import zestawienia prowizyjnego (Cellent)' : 'Rozlicz Leadenhall / Squarelife — Import noty prowizyjnej'}
	open={showImport}
	onclose={closeImport}
>
	{#snippet footer()}
		{#if importDone}
			<button onclick={closeImport} class="px-4 py-2 text-sm bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover">Zamknij</button>
		{:else}
			<button onclick={closeImport} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">Anuluj</button>
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
					Wybierz plik zestawienia prowizyjnego {importMode === 'ergo' ? 'ERGO — „Szczegóły zestawienia prowizyjnego” (.csv) lub zestawienie .xlsx' : importMode === 'colonnade' ? 'Colonnade z portalu Cellent (.xlsx) — bez zmiany nazwy pliku, numer noty jest w nazwie' : 'Leadenhall/Squarelife (.xlsx)'}
				</label>
				<input type="file" accept={importMode === 'ergo' ? '.csv,.xlsx' : '.xlsx'} onchange={onImportFile}
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
					{#if importOkres}
						<div class="text-blue-700">Okres: {new Date(`${importOkres}-01T12:00:00`).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })} · {importPreview.length} polis</div>
					{/if}
					<div class="text-blue-700">Razem składka: {fmtPln(importRazemSkladka)} PLN · Razem prowizja: {fmtPln(importRazemProwizja)} PLN</div>
				</div>

				{#if importPoprzednia}
					<div class="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
						<AlertTriangle size={15} class="mt-0.5 shrink-0" />
						<span>To zestawienie było już importowane {importPoprzednia.data} ({importPoprzednia.pozycji} rozliczonych pozycji). Polisy rozliczone tą notą są pominięte — rozliczysz tylko pozostałe, a nowe pozycje trafią do tej samej noty.</span>
					</div>
				{/if}

				{#if importOstrzezenia.length > 0}
					<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
						<div class="flex items-center gap-2 font-semibold text-amber-700 mb-1"><AlertTriangle size={15} /> Sumy w pliku nie zgadzają się z wierszami:</div>
						{#each importOstrzezenia as o}<div class="text-sm text-amber-700">{o}</div>{/each}
					</div>
				{/if}

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
					<div class="bg-slate-50 border border-line rounded-lg px-4 py-3">
						<div class="text-sm font-semibold text-slate-600 mb-1">Już rozliczone — pominięte ({importAlreadySettled.length}):</div>
						{#each importAlreadySettled as r}<div class="text-xs text-slate-500 font-mono">{r.nr_polisy_raw}</div>{/each}
					</div>
				{/if}

				<!-- Tabela do rozliczenia -->
				{#if importToProcess.length > 0}
					<div class="border border-line rounded-lg overflow-hidden">
						<table class="w-full text-xs">
							<thead class="bg-slate-50 border-b border-line">
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
									<tr class="border-t border-line-soft {bigDiff ? 'bg-amber-50/60' : ''}">
										<td class="px-3 py-2 font-mono">{r.nr_polisy}</td>
										<td class="px-3 py-2 text-slate-600 truncate max-w-[120px]">{r.ubezpieczajacy}</td>
										<td class="px-3 py-2 text-right">{fmtPln(r.skladka_nota)}</td>
										<td class="px-3 py-2 text-right {bigDiff ? 'text-amber-700 font-bold' : ''}">{fmtPln(r.prowizja_nota)}</td>
										<td class="px-3 py-2 text-right {bigDiff ? 'text-amber-700 font-bold' : ''}">{fmtPln(r.prowizja_crm ?? 0)}</td>
										<td class="px-3 py-2">
											{#if bigDiff}
												<!-- Różnica > 0.5 PLN: operator decyduje -->
												<div class="flex flex-col gap-1">
													<p class="text-xs text-amber-700 font-semibold">Δ {fmtPln(r.prowizja_diff)} PLN</p>
													<div class="flex gap-1">
														<button
															onclick={() => setOperatorAction(r, 'settle')}
															class="px-2 py-0.5 rounded text-xs font-semibold border transition-colors {r.operator_action === 'settle' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-line text-slate-600 hover:bg-slate-50'}">
															Rozlicz
														</button>
														<button
															onclick={() => setOperatorAction(r, 'skip')}
															class="px-2 py-0.5 rounded text-xs font-semibold border transition-colors {r.operator_action === 'skip' ? 'bg-red-600 text-white border-red-600' : 'border-line text-slate-600 hover:bg-slate-50'}">
															Aneks
														</button>
													</div>
												</div>
											{:else}
												<span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Opłacona ✓</span>
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
