<script lang="ts">
	// "Zgłoś wyrejestrowanie pojazdu": e-mail do adresów ustawionych przy
	// towarzystwie (dwa), kopia na adres brokera/agenta, dowód w załączniku.
	// Zgłoszenie zapisuje się przy kliencie — widać kto, kiedy i do kogo.
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';
	import type { Vehicle } from '$lib/types/database';
	import { vehicleLabel } from '$lib/hestia/pojazd';
	import Modal from '$lib/components/Modal.svelte';
	import { Paperclip, Send, X, AlertTriangle } from 'lucide-svelte';

	interface Props {
		open: boolean;
		vehicle: Vehicle;
		onclose: () => void;
		onsent?: () => void;
	}
	let { open, vehicle, onclose, onsent }: Props = $props();

	const inp =
		'w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	const POWODY = [
		['sprzedaz', 'Sprzedaż pojazdu'],
		['zlomowanie', 'Złomowanie / kasacja'],
		['kradziez', 'Kradzież'],
		['inne', 'Inne']
	] as const;

	const today = new Date().toISOString().slice(0, 10);
	const klient = $derived(appState.clients.find((c) => c.id === vehicle.klient_id) ?? null);

	// Polisy pojazdu — domyślnie czynna, a gdy jej brak, ostatnia.
	const polisy = $derived(
		appState.policies
			.filter((p) => p.pojazd_id === vehicle.id && !p.deleted_at)
			.sort((a, b) => (b.data_od ?? '').localeCompare(a.data_od ?? ''))
	);
	const domyslnaPolisa = $derived(
		polisy.find((p) => p.data_od <= today && p.data_do >= today) ?? polisy[0] ?? null
	);

	let polisaId = $state('');
	let tuId = $state('');
	let powod = $state<(typeof POWODY)[number][0]>('sprzedaz');
	let dataZdarzenia = $state(today);
	let tresc = $state('');
	let cc = $state('');
	let pliki = $state<File[]>([]);
	let wysylanie = $state(false);
	let blad = $state('');

	let zainicjowany = false;
	$effect(() => {
		if (!open || zainicjowany) return;
		zainicjowany = true;
		polisaId = domyslnaPolisa?.id ?? '';
		tuId = domyslnaPolisa?.tu_id ?? '';
		cc = appState.profile?.email_cc_zgloszenia ?? '';
	});

	// Zmiana polisy zmienia towarzystwo — to do TU z polisy idzie zgłoszenie.
	$effect(() => {
		const p = polisy.find((x) => x.id === polisaId);
		if (p) tuId = p.tu_id;
	});

	const tu = $derived(appState.insurers.find((i) => i.id === tuId) ?? null);
	const adresaciTU = $derived(
		[tu?.email_wyrej_1, tu?.email_wyrej_2].map((s) => (s ?? '').trim()).filter(Boolean)
	);

	function dodajPliki(lista: FileList | null | undefined) {
		if (!lista) return;
		const nowe = Array.from(lista).filter((f) => !pliki.some((p) => p.name === f.name && p.size === f.size));
		pliki = [...pliki, ...nowe];
	}
	function usunPlik(i: number) {
		pliki = pliki.filter((_, idx) => idx !== i);
	}

	async function wyslij() {
		blad = '';
		if (!tuId) { blad = 'Wskaż towarzystwo.'; return; }
		if (!adresaciTU.length) {
			blad = `Towarzystwo ${tu?.nazwa ?? ''} nie ma ustawionego adresu do zgłoszeń wyrejestrowania. Uzupełnij go w Ustawieniach → System → Towarzystwa.`;
			return;
		}
		if (!pliki.length) {
			blad = 'Dołącz dowód wyrejestrowania — umowę sprzedaży, fakturę albo decyzję o złomowaniu.';
			return;
		}
		wysylanie = true;
		try {
			const { data: { session } } = await sb.auth.getSession();
			const fd = new FormData();
			fd.set('pojazd_id', vehicle.id);
			fd.set('tu_id', tuId);
			fd.set('polisa_id', polisaId);
			fd.set('powod', powod);
			fd.set('data_zdarzenia', dataZdarzenia);
			fd.set('tresc', tresc);
			fd.set('cc', cc);
			for (const f of pliki) fd.append('zalaczniki', f, f.name);

			const res = await fetch('/api/vehicles/deregister', {
				method: 'POST',
				headers: { Authorization: `Bearer ${session?.access_token}` },
				body: fd
			});
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			if (!res.ok) {
				blad = body.message ?? `Błąd ${res.status}`;
				return;
			}
			onsent?.();
			onclose();
		} catch (e) {
			blad = e instanceof Error ? e.message : String(e);
		} finally {
			wysylanie = false;
		}
	}
</script>

<Modal {open} title="Zgłoś wyrejestrowanie pojazdu" {onclose}>
	{#snippet footer()}
		<button onclick={onclose} class="px-4 py-2 text-sm border border-line rounded-lg text-slate-600 hover:bg-slate-50">
			Anuluj
		</button>
		<button
			onclick={wyslij}
			disabled={wysylanie}
			class="flex items-center gap-2 px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-60"
		>
			<Send size={14} /> {wysylanie ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}
		</button>
	{/snippet}

	<div class="space-y-4">
		<div class="bg-slate-50 border border-line rounded-lg px-4 py-3 text-sm">
			<p class="font-semibold text-slate-900">{vehicleLabel(vehicle, { zModelem: true })}</p>
			<p class="text-xs text-slate-500 mt-0.5">
				{klient?.nazwa ?? '—'}{vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}
			</p>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="dr-polisa">Polisa</label>
				<select id="dr-polisa" class={inp} bind:value={polisaId}>
					<option value="">— bez wskazania polisy —</option>
					{#each polisy as p (p.id)}
						<option value={p.id}>{p.nr_polisy} ({p.data_od} — {p.data_do})</option>
					{/each}
				</select>
			</div>
			<div>
				<label class={lbl} for="dr-tu">Towarzystwo *</label>
				<select id="dr-tu" class={inp} bind:value={tuId}>
					<option value="">— wybierz —</option>
					{#each appState.insurers as i (i.id)}
						<option value={i.id}>{i.skrot ? `${i.skrot} — ${i.nazwa}` : i.nazwa}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="rounded-lg border px-3 py-2 text-sm {adresaciTU.length ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}">
			{#if !tu}
				Wskaż towarzystwo, żeby zobaczyć adresatów.
			{:else if adresaciTU.length}
				Do: <strong>{adresaciTU.join(', ')}</strong>
				<span class="block text-xs opacity-80">adresy ustawione przy {tu.skrot ?? tu.nazwa} w Ustawieniach</span>
			{:else}
				<span class="flex items-start gap-2">
					<AlertTriangle size={15} class="mt-0.5 shrink-0" />
					<span>
						{tu.nazwa} nie ma adresu do zgłoszeń wyrejestrowania.
						<a href="/settings?tab=system" class="underline">Uzupełnij w Ustawieniach</a>, zanim wyślesz.
					</span>
				</span>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class={lbl} for="dr-powod">Powód *</label>
				<select id="dr-powod" class={inp} bind:value={powod}>
					{#each POWODY as [v, l]}<option value={v}>{l}</option>{/each}
				</select>
			</div>
			<div>
				<label class={lbl} for="dr-data">Data zdarzenia</label>
				<input id="dr-data" class={inp} type="date" bind:value={dataZdarzenia} />
			</div>
		</div>

		<div>
			<label class={lbl} for="dr-cc">Kopia (CC) — Twój adres</label>
			<input id="dr-cc" class={inp} type="email" bind:value={cc} placeholder="adres brokera / agenta" />
			<p class="text-[11px] text-slate-400 mt-1">
				Domyślny adres ustawisz w Ustawieniach → Profil. Kilka adresów rozdziel przecinkiem.
			</p>
		</div>

		<div>
			<label class={lbl} for="dr-tresc">Dodatkowa treść</label>
			<textarea id="dr-tresc" class="{inp} min-h-[72px]" bind:value={tresc} placeholder="opcjonalnie — np. prośba o zwrot składki na konto…"></textarea>
		</div>

		<div>
			<label class={lbl} for="dr-pliki">Dowód wyrejestrowania *</label>
			<input
				id="dr-pliki"
				type="file"
				multiple
				accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
				class="block w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-line file:bg-white file:text-sm file:text-slate-700 hover:file:bg-slate-50"
				onchange={(e) => { dodajPliki(e.currentTarget.files); e.currentTarget.value = ''; }}
			/>
			<p class="text-[11px] text-slate-400 mt-1">
				Umowa sprzedaży, faktura, decyzja o złomowaniu — PDF lub zdjęcie, do 10 MB każdy.
			</p>
			{#if pliki.length}
				<ul class="mt-2 space-y-1">
					{#each pliki as f, i}
						<li class="flex items-center gap-2 text-sm bg-white border border-line rounded-lg px-3 py-1.5">
							<Paperclip size={13} class="text-slate-400 shrink-0" />
							<span class="flex-1 truncate">{f.name}</span>
							<span class="text-xs text-slate-400">{(f.size / 1024).toFixed(0)} kB</span>
							<button onclick={() => usunPlik(i)} class="text-slate-400 hover:text-red-600" title="Usuń"><X size={14} /></button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if blad}
			<div class="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800">{blad}</div>
		{/if}
	</div>
</Modal>
