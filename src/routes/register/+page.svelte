<script lang="ts">
	const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
	const labelCls = 'block text-sm font-medium text-slate-700 mb-1';

	let nazwa_firmy = $state('');
	let email = $state('');
	let imie_nazwisko = $state('');
	let password = $state('');
	let confirmPassword = $state('');

	let loading = $state(false);
	let success = $state(false);
	let errorMsg = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';

		if (!nazwa_firmy || !email || !imie_nazwisko || !password || !confirmPassword) {
			errorMsg = 'Wszystkie pola są wymagane.';
			return;
		}
		if (password.length < 8) {
			errorMsg = 'Hasło musi mieć co najmniej 8 znaków.';
			return;
		}
		if (password !== confirmPassword) {
			errorMsg = 'Hasła nie są zgodne.';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ nazwa_firmy, email, imie_nazwisko, password })
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.message ?? 'Wystąpił błąd. Spróbuj ponownie.';
			} else {
				success = true;
			}
		} catch {
			errorMsg = 'Błąd połączenia. Spróbuj ponownie.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Rejestracja — AuraCRM</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 flex items-center justify-center px-4" style="font-family: 'Inter', sans-serif">
	<div class="w-full max-w-md">
		<div class="text-center mb-8">
			<a href="/login" class="inline-flex items-center gap-2 font-bold text-2xl text-slate-900">
				Aura<span class="text-blue-500">CRM</span>
			</a>
			<p class="text-slate-500 text-sm mt-2">Utwórz konto dla swojej kancelarii</p>
		</div>

		<div class="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
			{#if success}
				<div class="text-center space-y-4">
					<div class="text-green-600 text-lg font-semibold">Konto utworzone!</div>
					<p class="text-slate-600 text-sm">Możesz się teraz zalogować.</p>
					<a href="/login" class="inline-block px-5 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700">
						Przejdź do logowania
					</a>
				</div>
			{:else}
				<h1 class="text-xl font-bold text-slate-900 mb-6">Rejestracja</h1>
				<form onsubmit={submit} class="space-y-4">
					<div>
						<label class={labelCls} for="nazwa_firmy">Nazwa firmy / kancelarii *</label>
						<input id="nazwa_firmy" class={inputCls} type="text" bind:value={nazwa_firmy} required />
					</div>
					<div>
						<label class={labelCls} for="email">Email admina *</label>
						<input id="email" class={inputCls} type="email" bind:value={email} required />
					</div>
					<div>
						<label class={labelCls} for="imie_nazwisko">Imię i Nazwisko admina *</label>
						<input id="imie_nazwisko" class={inputCls} type="text" bind:value={imie_nazwisko} required />
					</div>
					<div>
						<label class={labelCls} for="password">Hasło * (min. 8 znaków)</label>
						<input id="password" class={inputCls} type="password" bind:value={password} required />
					</div>
					<div>
						<label class={labelCls} for="confirmPassword">Potwierdź hasło *</label>
						<input id="confirmPassword" class={inputCls} type="password" bind:value={confirmPassword} required />
					</div>

					{#if errorMsg}
						<p class="text-sm text-red-600">{errorMsg}</p>
					{/if}

					<button
						type="submit"
						disabled={loading}
						class="w-full px-4 py-2 text-sm bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-700 disabled:opacity-50"
					>
						{loading ? 'Tworzenie konta...' : 'Utwórz konto'}
					</button>
				</form>

				<p class="text-center text-sm text-slate-500 mt-6">
					Masz już konto?
					<a href="/login" class="text-blue-600 hover:underline font-medium">Zaloguj się</a>
				</p>
			{/if}
		</div>
	</div>
</div>
