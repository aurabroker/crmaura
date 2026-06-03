<script lang="ts">
	import { sb } from '$lib/supabase';
	import { appState } from '$lib/stores/app.svelte';

	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	let imie_nazwisko = $state(appState.profile?.imie_nazwisko ?? '');
	let stanowisko = $state(appState.profile?.stanowisko ?? '');
	let profileMsg = $state('');
	let profileError = $state('');
	let profileLoading = $state(false);

	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordMsg = $state('');
	let passwordError = $state('');
	let passwordLoading = $state(false);

	$effect(() => {
		if (appState.profile) {
			imie_nazwisko = appState.profile.imie_nazwisko ?? '';
			stanowisko = (appState.profile as any).stanowisko ?? '';
		}
	});

	async function saveProfile() {
		profileMsg = '';
		profileError = '';
		profileLoading = true;
		const { error } = await sb
			.from('crm_profiles')
			.update({ imie_nazwisko, stanowisko })
			.eq('id', appState.profile!.id);
		profileLoading = false;
		if (error) {
			profileError = error.message;
		} else {
			if (appState.profile) {
				appState.profile.imie_nazwisko = imie_nazwisko;
				(appState.profile as any).stanowisko = stanowisko;
			}
			profileMsg = 'Dane zostały zapisane.';
		}
	}

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
</script>

<div class="max-w-xl mx-auto py-8 space-y-8">
	<h1 class="text-2xl font-bold text-slate-900">Ustawienia konta</h1>

	<!-- Dane profilu -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
		<h2 class="text-lg font-semibold text-slate-800 mb-5">Dane profilu</h2>
		<div class="space-y-4">
			<div>
				<label class={labelCls} for="imie_nazwisko">Imię i Nazwisko</label>
				<input id="imie_nazwisko" class={inputCls} type="text" bind:value={imie_nazwisko} />
			</div>
			<div>
				<label class={labelCls} for="stanowisko">Stanowisko</label>
				<input id="stanowisko" class={inputCls} type="text" bind:value={stanowisko} />
			</div>
			{#if profileMsg}
				<p class="text-sm text-green-600">{profileMsg}</p>
			{/if}
			{#if profileError}
				<p class="text-sm text-red-600">{profileError}</p>
			{/if}
			<button
				onclick={saveProfile}
				disabled={profileLoading}
				class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50"
			>
				{profileLoading ? 'Zapisywanie...' : 'Zapisz dane'}
			</button>
		</div>
	</div>

	<!-- Zmiana hasła -->
	<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
		<h2 class="text-lg font-semibold text-slate-800 mb-5">Zmiana hasła</h2>
		<div class="space-y-4">
			<div>
				<label class={labelCls} for="newPassword">Nowe hasło</label>
				<input id="newPassword" class={inputCls} type="password" bind:value={newPassword} placeholder="min. 8 znaków" />
			</div>
			<div>
				<label class={labelCls} for="confirmPassword">Potwierdź hasło</label>
				<input id="confirmPassword" class={inputCls} type="password" bind:value={confirmPassword} />
			</div>
			{#if passwordMsg}
				<p class="text-sm text-green-600">{passwordMsg}</p>
			{/if}
			{#if passwordError}
				<p class="text-sm text-red-600">{passwordError}</p>
			{/if}
			<button
				onclick={savePassword}
				disabled={passwordLoading}
				class="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50"
			>
				{passwordLoading ? 'Zapisywanie...' : 'Zmień hasło'}
			</button>
		</div>
	</div>
</div>
