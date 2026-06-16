<script lang="ts">
	import { sb } from '$lib/supabase';
	import { portalState } from '$lib/stores/portal.svelte';

	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordMsg = $state('');
	let passwordError = $state('');
	let passwordLoading = $state(false);

	async function savePassword() {
		passwordMsg = '';
		passwordError = '';
		if (newPassword.length < 8) {
			passwordError = 'Hasło musi mieć co najmniej 8 znaków.';
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordError = 'Hasła nie są zgodne.';
			return;
		}
		passwordLoading = true;
		const { error } = await sb.auth.updateUser({ password: newPassword });
		passwordLoading = false;
		if (error) {
			passwordError = error.message;
		} else {
			newPassword = '';
			confirmPassword = '';
			passwordMsg = 'Hasło zostało zmienione.';
		}
	}

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
</script>

<svelte:head><title>Ustawienia — Panel Klienta</title></svelte:head>

<h1 class="text-2xl font-bold text-slate-900 mb-6">Ustawienia</h1>

<div class="grid gap-6 max-w-md">
	<div class="bg-white border border-slate-200 rounded-2xl p-5">
		<h2 class="text-sm font-semibold text-slate-900 mb-3">Dane konta</h2>
		<p class="text-sm text-slate-600"><span class="text-slate-400">Klient:</span> {portalState.client?.nazwa}</p>
		<p class="text-sm text-slate-600"><span class="text-slate-400">E-mail:</span> {portalState.client?.email}</p>
	</div>

	<div class="bg-white border border-slate-200 rounded-2xl p-5">
		<h2 class="text-sm font-semibold text-slate-900 mb-3">Zmiana hasła</h2>
		<div class="space-y-3">
			<div>
				<label class={labelCls} for="newPassword">Nowe hasło</label>
				<input id="newPassword" class={inputCls} type="password" bind:value={newPassword} placeholder="min. 8 znaków" />
			</div>
			<div>
				<label class={labelCls} for="confirmPassword">Powtórz nowe hasło</label>
				<input id="confirmPassword" class={inputCls} type="password" bind:value={confirmPassword} />
			</div>
			{#if passwordMsg}<p class="text-sm text-green-600">{passwordMsg}</p>{/if}
			{#if passwordError}<p class="text-sm text-red-600">{passwordError}</p>{/if}
			<button
				onclick={savePassword}
				disabled={passwordLoading}
				class="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-60"
			>
				{passwordLoading ? 'Zapisywanie...' : 'Zmień hasło'}
			</button>
		</div>
	</div>
</div>
