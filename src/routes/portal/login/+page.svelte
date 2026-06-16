<script lang="ts">
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { ShieldCheck } from 'lucide-svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function login(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;
		const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
		if (err) { loading = false; error = err.message; return; }

		const { data: client } = await sb.from('crm_clients').select('id').eq('auth_user_id', data.user.id).single();
		loading = false;
		if (!client) {
			await sb.auth.signOut();
			error = 'To konto nie ma dostępu do Panelu Klienta.';
			return;
		}
		goto('/portal');
	}
</script>

<svelte:head><title>Panel Klienta — Logowanie</title></svelte:head>

<div class="min-h-screen flex items-center justify-center bg-slate-50">
	<div class="bg-white border border-slate-200 rounded-2xl shadow-xl p-8 w-full max-w-sm">

		<div class="flex items-center justify-center gap-2 mb-8">
			<ShieldCheck size={28} class="text-blue-500" />
			<span class="text-2xl font-bold text-slate-900">Panel Klienta</span>
		</div>

		{#if error}
			<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
				{error}
			</div>
		{/if}

		<form onsubmit={login} class="space-y-4">
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1" for="email">E-mail</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					autocomplete="username"
					required
					class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1" for="password">Hasło</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					autocomplete="current-password"
					required
					class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>
			<button
				type="submit"
				disabled={loading}
				class="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-60"
			>
				{loading ? 'Logowanie...' : 'Zaloguj się'}
			</button>
		</form>

		<p class="text-center text-xs text-slate-400 mt-6">
			Dostęp do konta otrzymujesz od swojego doradcy.
		</p>
	</div>
</div>
