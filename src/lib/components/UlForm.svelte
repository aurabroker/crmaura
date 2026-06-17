<script lang="ts">
	import type { BondInsurer, BondTenant, BondTuDict } from '$lib/types/database';

	interface Props {
		ul?: BondInsurer | null;
		tenants: BondTenant[];
		tuDict: BondTuDict[];
		presetTenantId?: string;
	}
	let { ul = null, tenants, tuDict, presetTenantId = '' }: Props = $props();

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';
	const lbl = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1';

	let fpTenant = $state(ul?.bond_tenant_id ?? presetTenantId);
	let fpNazwa = $state(ul?.bond_nazwa ?? '');
	let fpNip = $state(ul?.bond_nip ?? '');
	let fpUlNr = $state(ul?.bond_ul_nr ?? '');
	let fpOd = $state(ul?.bond_ul_data_od ?? '');
	let fpDo = $state(ul?.bond_ul_data_do ?? '');
	let fpLimit = $state(ul?.bond_limit?.toString() ?? '');
	let fpStawka = $state(ul?.bond_stawka_bazowa?.toString() ?? '');
	let fpSkladkaMin = $state(ul?.bond_skladka_min?.toString() ?? '');
	let fpNegocjowana = $state(ul?.bond_stawka_negocjowana ?? false);

	export function getValues() {
		return {
			bond_tenant_id: fpTenant,
			bond_nazwa: fpNazwa.trim(),
			bond_nip: fpNip.trim() || null,
			bond_ul_nr: fpUlNr.trim() || null,
			bond_ul_data_od: fpOd || null,
			bond_ul_data_do: fpDo || null,
			bond_limit: fpLimit ? parseFloat(fpLimit) : null,
			bond_stawka_bazowa: fpStawka ? parseFloat(fpStawka) : null,
			bond_skladka_min: fpSkladkaMin ? parseFloat(fpSkladkaMin) : null,
			bond_stawka_negocjowana: fpNegocjowana
		};
	}

	export function isValid(): string | null {
		if (!fpTenant) return 'Wybierz podmiot (klienta) UL';
		if (!fpNazwa.trim()) return 'Wybierz Towarzystwo Ubezpieczeń';
		if (fpLimit && parseFloat(fpLimit) < 0) return 'Limit nie może być ujemny';
		return null;
	}
</script>

<div class="space-y-4">
	<!-- Podmiot | TU -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Podmiot (klient) *</label>
			<select bind:value={fpTenant} class={inp} disabled={!!ul}>
				<option value="">— wybierz podmiot —</option>
				{#each tenants as t}
					<option value={t.bond_id}>{t.bond_nazwa}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class={lbl}>Towarzystwo Ubezpieczeń *</label>
			<select bind:value={fpNazwa} class={inp}>
				<option value="">— wybierz TU —</option>
				{#each tuDict as tu}
					<option value={tu.name}>{tu.short_name ? `${tu.short_name} — ${tu.name}` : tu.name}</option>
				{/each}
				{#if fpNazwa && !tuDict.some((tu) => tu.name === fpNazwa)}
					<option value={fpNazwa}>{fpNazwa}</option>
				{/if}
			</select>
		</div>
	</div>

	<!-- Nr UL | NIP TU -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>Numer Umowy Limitowej</label>
			<input bind:value={fpUlNr} class={inp} placeholder="np. UG/001877/22" />
		</div>
		<div>
			<label class={lbl}>NIP TU</label>
			<input bind:value={fpNip} class={inp} placeholder="opcjonalnie" />
		</div>
	</div>

	<!-- Daty UL -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class={lbl}>UL obowiązuje od</label>
			<input type="date" bind:value={fpOd} class={inp} />
		</div>
		<div>
			<label class={lbl}>UL obowiązuje do</label>
			<input type="date" bind:value={fpDo} class={inp} />
		</div>
	</div>

	<!-- Parametry finansowe -->
	<div class="border-t border-slate-100 pt-4">
		<p class="text-xs font-semibold text-violet-600 uppercase tracking-wider mb-3">Parametry limitu</p>
		<div class="grid grid-cols-3 gap-4">
			<div>
				<label class={lbl}>Limit (PLN)</label>
				<input type="number" step="0.01" bind:value={fpLimit} class={inp} placeholder="np. 10 000 000" />
			</div>
			<div>
				<label class={lbl}>Stawka bazowa (%)</label>
				<input type="number" step="0.0001" bind:value={fpStawka} class={inp} placeholder="np. 1.2" />
			</div>
			<div>
				<label class={lbl}>Min. składka (PLN)</label>
				<input type="number" step="0.01" bind:value={fpSkladkaMin} class={inp} placeholder="np. 500" />
			</div>
		</div>
	</div>

	<label class="flex items-center gap-3 cursor-pointer">
		<input type="checkbox" bind:checked={fpNegocjowana} class="w-4 h-4 rounded accent-violet-600" />
		<span class="text-sm text-slate-700">Stawka negocjowana (indywidualnie ustalona z TU)</span>
	</label>
</div>
