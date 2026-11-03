<script lang="ts">
	// Lista zgłoszeń wyrejestrowania przy kliencie: kto, kiedy, do kogo,
	// z jakim dowodem. Załączniki otwierane podpisanym linkiem z prywatnego bucketa.
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { VehicleDeregistration } from '$lib/types/database';
	import Badge from '$lib/components/Badge.svelte';
	import { Paperclip, Mail, RefreshCw } from 'lucide-svelte';

	interface Props {
		klientId: string;
		/** Przeładuj po zmianie z zewnątrz (np. po wysłaniu nowego zgłoszenia). */
		wersja?: number;
	}
	let { klientId, wersja = 0 }: Props = $props();

	const POWOD: Record<string, string> = {
		sprzedaz: 'sprzedaż',
		zlomowanie: 'złomowanie',
		kradziez: 'kradzież',
		inne: 'inne'
	};

	let lista = $state<VehicleDeregistration[]>([]);
	let ladowanie = $state(false);

	async function zaladuj() {
		ladowanie = true;
		const { data } = await sb
			.from('crm_vehicle_deregistrations')
			.select('*')
			.eq('klient_id', klientId)
			.order('created_at', { ascending: false });
		lista = (data ?? []) as VehicleDeregistration[];
		ladowanie = false;
	}

	$effect(() => {
		void wersja;
		if (klientId) zaladuj();
	});

	async function otworz(sciezka: string) {
		const { data } = await sb.storage.from('wyrejestrowania').createSignedUrl(sciezka, 60 * 10);
		if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
	}

	function tuNazwa(id: string | null) {
		const t = appState.insurers.find((i) => i.id === id);
		return t ? (t.skrot ?? t.nazwa) : '—';
	}
	function fmt(ts: string) {
		return new Date(ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
	}
</script>

<div class="bg-white border border-line rounded-xl shadow-sm overflow-hidden">
	<div class="px-5 py-3 border-b border-line bg-slate-50 flex items-center justify-between">
		<h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
			<Mail size={14} class="text-slate-400" /> Zgłoszenia wyrejestrowania do TU
			<span class="text-xs font-normal text-slate-400">({lista.length})</span>
		</h3>
		<button onclick={zaladuj} class="text-slate-400 hover:text-slate-700" title="Odśwież">
			<RefreshCw size={14} class={ladowanie ? 'animate-spin' : ''} />
		</button>
	</div>

	{#if !lista.length}
		<p class="px-5 py-6 text-sm text-slate-400 text-center">
			{ladowanie ? 'Ładowanie…' : 'Brak zgłoszeń wyrejestrowania dla tego klienta.'}
		</p>
	{:else}
		<div class="divide-y divide-line-soft">
			{#each lista as z (z.id)}
				<div class="px-5 py-3">
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<span class="font-semibold text-slate-900">{z.pojazd_opis ?? '—'}</span>
						<Badge variant={z.status === 'wyslane' ? 'success' : 'error'}>
							{z.status === 'wyslane' ? 'wysłane' : 'błąd wysyłki'}
						</Badge>
						<span class="text-xs text-slate-500">{POWOD[z.powod] ?? z.powod}{z.data_zdarzenia ? ` · ${z.data_zdarzenia}` : ''}</span>
					</div>
					<p class="text-xs text-slate-500 mt-1">
						{fmt(z.created_at)} · wysłał(a) <strong class="text-slate-700">{z.wyslal_nazwa ?? '—'}</strong>
						· do {tuNazwa(z.tu_id)}: {z.adresaci.join(', ')}{z.cc.length ? ` · CC: ${z.cc.join(', ')}` : ''}
					</p>
					{#if z.blad}
						<p class="text-xs text-red-700 mt-1">{z.blad}</p>
					{/if}
					{#if z.zalaczniki?.length}
						<div class="flex flex-wrap gap-2 mt-2">
							{#each z.zalaczniki as f}
								<button
									onclick={() => otworz(f.sciezka)}
									class="inline-flex items-center gap-1.5 text-xs border border-line rounded-lg px-2.5 py-1 text-slate-700 hover:bg-slate-50"
								>
									<Paperclip size={12} class="text-slate-400" /> {f.nazwa}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
