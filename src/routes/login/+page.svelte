<script lang="ts">
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import { turnstileEnabled as useTurnstile, isCaptchaError, captchaErrorMessage } from '$lib/utils/turnstile';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let turnstileToken = $state('');
	let turnstile = $state<{ reset: () => void } | null>(null);

	// Token Turnstile trafia do Supabase Auth (options.captchaToken), które weryfikuje go po stronie
	// serwera, gdy ochrona CAPTCHA jest włączona w Supabase. Token jest jednorazowy — po każdej
	// próbie (udanej czy nie) prosimy widżet o nowy.
	async function login(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (useTurnstile && !turnstileToken) { error = 'Potwierdź, że nie jesteś robotem.'; return; }
		loading = true;
		const { error: err } = await sb.auth.signInWithPassword({
			email,
			password,
			options: useTurnstile ? { captchaToken: turnstileToken } : undefined
		});
		loading = false;
		if (useTurnstile) { turnstileToken = ''; turnstile?.reset(); }
		if (err) error = isCaptchaError(err) ? captchaErrorMessage(err) : err.message;
		else goto('/dashboard');
	}
</script>

<svelte:head><title>Logowanie — AuraCRM</title></svelte:head>

<div class="min-h-screen flex items-center justify-center bg-slate-50">
	<div class="bg-white border border-line rounded-2xl shadow-xl p-8 w-full max-w-sm">

		<div class="flex items-center justify-center gap-2 mb-8">
			<span class="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle></svg>
			</span>
			<span class="text-2xl font-semibold text-slate-900">AuraCRM</span>
		</div>

		{#if error}
			<div class="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
				{error}
			</div>
		{/if}

		<form onsubmit={login} class="space-y-4">
			<div>
				<label class="block text-sm font-medium text-slate-700 mb-1" for="email">E-mail Brokera</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="jan@auraconsulting.pl"
					autocomplete="username"
					required
					class="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
					class="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>
			{#if useTurnstile}
				<Turnstile bind:this={turnstile} onToken={(t) => turnstileToken = t} onError={() => turnstileToken = ''} onExpire={() => turnstileToken = ''} />
			{/if}
			<button
				type="submit"
				disabled={loading || (useTurnstile && !turnstileToken)}
				class="w-full bg-accent text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-60"
			>
				{loading ? 'Logowanie...' : 'Zaloguj do systemu'}
			</button>
		</form>
	</div>
</div>
