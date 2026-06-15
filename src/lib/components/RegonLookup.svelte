<script lang="ts">
	import { sb } from '$lib/supabase';
	import { Search, CheckCircle, AlertTriangle } from 'lucide-svelte';

	type Props = {
		onResult: (data: { nazwa: string; nip: string; regon: string; adres: string }) => void;
		class?: string;
	};

	let { onResult, class: cls = '' }: Props = $props();

	let query = $state('');
	let mode: 'nip' | 'regon' = $state('nip');
	let status: 'idle' | 'loading' | 'ok' | 'not_found' | 'error' = $state('idle');
	let warning = $state('');
	let inputCls = 'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

	function cleanDigits(v: string) {
		return v.replace(/[^0-9]/g, '');
	}

	function isReadyToSearch() {
		const d = cleanDigits(query);
		if (mode === 'nip') return d.length === 10;
		return d.length === 9 || d.length === 14;
	}

	async function lookup() {
		if (!isReadyToSearch()) return;
		status = 'loading';
		warning = '';
		try {
			const { data: { session } } = await sb.auth.getSession();
			const param = `${mode}=${cleanDigits(query)}`;
			const res = await fetch(`/api/regon/lookup?${param}`, {
				headers: { 'Authorization': `Bearer ${session?.access_token}` }
			});
			const data = await res.json();

			if (data.available === false) {
				status = 'error';
				return;
			}
			if (!data.found) {
				status = 'not_found';
				return;
			}
			if (data.data_zawieszenia) {
				warning = `Uwaga: wg GUS działalność zawieszona od ${data.data_zawieszenia}`;
			}
			status = 'ok';
			onResult({
				nazwa: data.nazwa ?? '',
				nip: data.nip ?? '',
				regon: data.regon ?? '',
				adres: data.adres ?? ''
			});
		} catch {
			status = 'error';
		}
	}

	function handleInput() {
		if (status !== 'idle') status = 'idle';
	}
</script>

<div class="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2 {cls}">
	<div class="flex items-center gap-2 text-xs font-semibold text-blue-700 mb-1">
		<Search size={13} /> Pobierz dane z rejestru REGON (GUS)
	</div>
	<div class="flex gap-2">
		<select
			bind:value={mode}
			onchange={() => { query = ''; status = 'idle'; }}
			class="border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
		>
			<option value="nip">NIP</option>
			<option value="regon">REGON</option>
		</select>
		<input
			bind:value={query}
			oninput={handleInput}
			onkeydown={(e) => e.key === 'Enter' && lookup()}
			placeholder={mode === 'nip' ? '10 cyfr' : '9 lub 14 cyfr'}
			class="{inputCls} flex-1 bg-white"
		/>
		<button
			type="button"
			onclick={lookup}
			disabled={!isReadyToSearch() || status === 'loading'}
			class="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
		>
			{status === 'loading' ? 'Szukam…' : 'Pobierz'}
		</button>
	</div>

	{#if status === 'ok' && !warning}
		<p class="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle size={12} /> Dane pobrane — możesz je edytować przed zapisem.</p>
	{/if}
	{#if status === 'ok' && warning}
		<p class="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle size={12} /> {warning}</p>
	{/if}
	{#if status === 'not_found'}
		<p class="text-xs text-slate-500">Nie znaleziono podmiotu — wpisz dane ręcznie.</p>
	{/if}
	{#if status === 'error'}
		<p class="text-xs text-red-600">Błąd pobierania danych — wpisz dane ręcznie.</p>
	{/if}
</div>
