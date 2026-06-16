<script lang="ts">
	import { onMount } from 'svelte';
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';
	import { fmtPln } from '$lib/utils';
	import type { Claim } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { AlertTriangle } from 'lucide-svelte';

	let loading = $state(true);
	let claims = $state<Claim[]>([]);

	onMount(async () => {
		const klientId = portalState.client?.id;
		if (!klientId) return;
		const { data } = await sb.from('crm_claims')
			.select('*, crm_policies(nr_polisy)')
			.eq('klient_id', klientId)
			.order('data_szkody', { ascending: false });
		claims = (data ?? []) as Claim[];
		loading = false;
	});

	const statusVariant = (s: string) =>
		s === 'Wypłacona' || s === 'Zakończona' ? 'success' :
		s === 'Odmowa' ? 'error' : 'warning';
</script>

<svelte:head><title>Szkody — Panel Klienta</title></svelte:head>

<h1 class="text-2xl font-bold text-slate-900 mb-6">Szkody</h1>

{#if loading}
	<div class="text-slate-400 text-sm">Ładowanie...</div>
{:else if claims.length === 0}
	<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400">
		<AlertTriangle size={32} class="mx-auto mb-2 text-slate-300" />
		Nie masz zarejestrowanych szkód.
	</div>
{:else}
<div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
	<table class="w-full text-sm">
		<thead class="bg-slate-50 text-slate-500 text-xs uppercase">
			<tr>
				<th class="text-left px-4 py-3">Nr szkody</th>
				<th class="text-left px-4 py-3">Polisa</th>
				<th class="text-left px-4 py-3">Data szkody</th>
				<th class="text-right px-4 py-3">Wartość roszczenia</th>
				<th class="text-left px-4 py-3">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each claims as c}
				<tr class="border-t border-slate-100">
					<td class="px-4 py-3 font-medium text-slate-900">{c.nr_szkody ?? '—'}</td>
					<td class="px-4 py-3 text-slate-600">{c.crm_policies?.nr_polisy ?? '—'}</td>
					<td class="px-4 py-3 text-slate-600">{c.data_szkody}</td>
					<td class="px-4 py-3 text-right text-slate-900">{c.wartosc_roszczenia != null ? `${fmtPln(c.wartosc_roszczenia)} zł` : '—'}</td>
					<td class="px-4 py-3"><Badge variant={statusVariant(c.status)}>{c.status}</Badge></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{/if}
