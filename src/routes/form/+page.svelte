<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { sb } from '$lib/supabase';

	type Status = 'loading' | 'invalid' | 'expired' | 'used' | 'ready' | 'submitted';

	let status = $state<Status>('loading');
	let formId = $state('');
	let tokenId = $state('');
	let clientName = $state('');
	let advisorName = $state('');
	let tenantNazwa = $state('');
	let saving = $state(false);
	let saveError = $state('');

	// Form fields
	let stanCywilny = $state('');
	let liczbaDzieci = $state('');
	let zatrudnienie = $state('');
	let dochodMies = $state('');
	let posiadaneUb = $state<string[]>([]);
	let celUbezpieczenia = $state<string[]>([]);
	let priorytet = $state('');
	let dodatkowe = $state('');

	const stanOptions = ['Kawaler/Panna', 'Żonaty/Zamężna', 'Rozwiedziony/a', 'Wdowiec/Wdowa'];
	const zatrudOptions = ['Pracownik etatowy', 'Przedsiębiorca', 'Wolny zawód', 'Emeryt/Rencista', 'Bezrobotny/a', 'Inne'];
	const dochodOptions = ['do 3 000 zł', '3 001 – 6 000 zł', '6 001 – 10 000 zł', '10 001 – 20 000 zł', 'powyżej 20 000 zł', 'Nie chcę podawać'];
	const ubOptions = ['Ubezpieczenie na życie', 'OC komunikacyjne', 'AC / Autocasco', 'Majątkowe (dom/mieszkanie)', 'Zdrowotne/Abonament medyczny', 'NNW', 'Ubezpieczenie firmowe', 'Brak ubezpieczeń'];
	const celOptions = ['Ochrona finansowa rodziny', 'Zabezpieczenie majątku', 'Ochrona zdrowia i leczenie', 'Gromadzenie oszczędności', 'Ochrona działalności firmy', 'Inne'];
	const priorytetOptions = ['Życie i zdrowie', 'Majątek i nieruchomości', 'Pojazdy', 'Firma / działalność', 'Odpowiedzialność cywilna', 'Podróże'];

	function toggleArr(arr: string[], val: string): string[] {
		return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val];
	}

	onMount(async () => {
		const token = $page.url.searchParams.get('token');
		if (!token) { status = 'invalid'; return; }

		const { data: tok, error } = await sb
			.from('apk_tokens')
			.select('id, status, expires_at, form_id, advisor_name')
			.eq('token', token)
			.single();

		if (error || !tok) { status = 'invalid'; return; }
		if (tok.status === 'used') { status = 'used'; return; }
		if (new Date(tok.expires_at) < new Date()) { status = 'expired'; return; }

		tokenId = tok.id;
		advisorName = tok.advisor_name ?? '';

		const { data: form } = await sb
			.from('apk_forms')
			.select('id, client_name, advisor_name, form_data, status, tenant_id')
			.eq('id', tok.form_id)
			.single();

		if (!form) { status = 'invalid'; return; }
		if (form.status === 'submitted') { status = 'submitted'; return; }

		formId = form.id;
		clientName = form.client_name;
		advisorName = advisorName || form.advisor_name || '';

		if (form.tenant_id) {
			const { data: tenant } = await sb.from('crm_tenants').select('nazwa').eq('id', form.tenant_id).single();
			tenantNazwa = tenant?.nazwa ?? '';
		}

		// Restore draft if exists
		const fd = (form.form_data ?? {}) as Record<string, unknown>;
		stanCywilny = (fd.stan_cywilny as string) ?? '';
		liczbaDzieci = (fd.liczba_dzieci as string) ?? '';
		zatrudnienie = (fd.zatrudnienie as string) ?? '';
		dochodMies = (fd.dochod_mies as string) ?? '';
		posiadaneUb = (fd.posiadane_ub as string[]) ?? [];
		celUbezpieczenia = (fd.cel_ubezpieczenia as string[]) ?? [];
		priorytet = (fd.priorytet as string) ?? '';
		dodatkowe = (fd.dodatkowe as string) ?? '';

		status = 'ready';
	});

	async function submit(asDraft: boolean) {
		saving = true; saveError = '';
		const form_data = {
			stan_cywilny: stanCywilny,
			liczba_dzieci: liczbaDzieci,
			zatrudnienie,
			dochod_mies: dochodMies,
			posiadane_ub: posiadaneUb,
			cel_ubezpieczenia: celUbezpieczenia,
			priorytet,
			dodatkowe
		};

		const { error: formErr } = await sb.from('apk_forms').update({
			form_data,
			status: asDraft ? 'draft' : 'submitted',
			submitted_at: asDraft ? null : new Date().toISOString()
		}).eq('id', formId);

		if (formErr) { saving = false; saveError = formErr.message; return; }

		if (!asDraft) {
			await sb.from('apk_tokens').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', tokenId);
			status = 'submitted';
		}
		saving = false;
	}

	const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
</script>

<svelte:head><title>Analiza Potrzeb Klienta — FRANK67</title></svelte:head>

<div class="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
	<div class="w-full max-w-2xl">
		<!-- Logo / header -->
		<div class="text-center mb-8">
			<div class="inline-flex items-center justify-center w-12 h-12 bg-slate-900 rounded-xl mb-3">
				<span class="text-white font-bold text-lg">F</span>
			</div>
			<h1 class="text-2xl font-bold text-slate-900">Analiza Potrzeb Klienta</h1>
			<p class="text-slate-500 text-sm mt-1">Formularz zgodny z wymogami IDD</p>
			{#if tenantNazwa}<p class="text-slate-400 text-xs mt-1">Doradca: {tenantNazwa}</p>{/if}
		</div>

		{#if status === 'loading'}
			<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center text-slate-400">
				Ładowanie formularza…
			</div>

		{:else if status === 'invalid'}
			<div class="bg-white rounded-2xl shadow-sm border border-red-200 p-10 text-center">
				<div class="text-4xl mb-3">🔗</div>
				<h2 class="text-lg font-semibold text-slate-900 mb-1">Nieprawidłowy link</h2>
				<p class="text-slate-500 text-sm">Ten link jest nieprawidłowy lub wygasł. Skontaktuj się ze swoim doradcą.</p>
			</div>

		{:else if status === 'expired'}
			<div class="bg-white rounded-2xl shadow-sm border border-amber-200 p-10 text-center">
				<div class="text-4xl mb-3">⏳</div>
				<h2 class="text-lg font-semibold text-slate-900 mb-1">Link wygasł</h2>
				<p class="text-slate-500 text-sm">Ważność tego linku dobiegła końca. Poproś doradcę o nowy link.</p>
			</div>

		{:else if status === 'used'}
			<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center">
				<div class="text-4xl mb-3">✅</div>
				<h2 class="text-lg font-semibold text-slate-900 mb-1">Formularz już wypełniony</h2>
				<p class="text-slate-500 text-sm">Ten formularz został już wcześniej przesłany. Dziękujemy!</p>
			</div>

		{:else if status === 'submitted'}
			<div class="bg-white rounded-2xl shadow-sm border border-emerald-200 p-10 text-center">
				<div class="text-5xl mb-4">✅</div>
				<h2 class="text-xl font-bold text-slate-900 mb-2">Formularz przesłany!</h2>
				<p class="text-slate-500 text-sm">Dziękujemy za wypełnienie ankiety APK.<br/>Twój doradca skontaktuje się z Tobą wkrótce.</p>
			</div>

		{:else if status === 'ready'}
			<div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
				<!-- Klient header -->
				<div class="bg-slate-900 px-6 py-5">
					<p class="text-slate-400 text-xs uppercase tracking-wider mb-0.5">Klient</p>
					<p class="text-white text-xl font-semibold">{clientName}</p>
					{#if advisorName}
						<p class="text-slate-400 text-sm mt-0.5">Doradca: {advisorName}</p>
					{/if}
				</div>

				<div class="p-6 space-y-8">
					<!-- Sekcja 1: Dane osobowe -->
					<section>
						<h2 class="text-base font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">1. Sytuacja rodzinna</h2>
						<div class="grid grid-cols-2 gap-4">
							<div>
								<label class="block text-sm font-medium text-slate-700 mb-1">Stan cywilny</label>
								<select bind:value={stanCywilny} class={inp}>
									<option value="">— wybierz —</option>
									{#each stanOptions as o}<option value={o}>{o}</option>{/each}
								</select>
							</div>
							<div>
								<label class="block text-sm font-medium text-slate-700 mb-1">Liczba dzieci na utrzymaniu</label>
								<select bind:value={liczbaDzieci} class={inp}>
									<option value="">— wybierz —</option>
									{#each ['0','1','2','3','4 lub więcej'] as o}<option value={o}>{o}</option>{/each}
								</select>
							</div>
						</div>
					</section>

					<!-- Sekcja 2: Praca i dochody -->
					<section>
						<h2 class="text-base font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">2. Sytuacja zawodowa i finansowa</h2>
						<div class="grid grid-cols-2 gap-4">
							<div>
								<label class="block text-sm font-medium text-slate-700 mb-1">Zatrudnienie</label>
								<select bind:value={zatrudnienie} class={inp}>
									<option value="">— wybierz —</option>
									{#each zatrudOptions as o}<option value={o}>{o}</option>{/each}
								</select>
							</div>
							<div>
								<label class="block text-sm font-medium text-slate-700 mb-1">Dochód miesięczny netto</label>
								<select bind:value={dochodMies} class={inp}>
									<option value="">— wybierz —</option>
									{#each dochodOptions as o}<option value={o}>{o}</option>{/each}
								</select>
							</div>
						</div>
					</section>

					<!-- Sekcja 3: Obecna ochrona -->
					<section>
						<h2 class="text-base font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">3. Posiadane ubezpieczenia</h2>
						<p class="text-xs text-slate-500 mb-3">Zaznacz wszystkie, które posiadasz:</p>
						<div class="grid grid-cols-2 gap-2">
							{#each ubOptions as o}
								<label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer p-2 rounded-lg hover:bg-slate-50">
									<input type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
										checked={posiadaneUb.includes(o)}
										onchange={() => posiadaneUb = toggleArr(posiadaneUb, o)} />
									{o}
								</label>
							{/each}
						</div>
					</section>

					<!-- Sekcja 4: Potrzeby -->
					<section>
						<h2 class="text-base font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">4. Cel i potrzeby ubezpieczeniowe</h2>
						<p class="text-xs text-slate-500 mb-3">Zaznacz co jest dla Ciebie ważne:</p>
						<div class="grid grid-cols-2 gap-2 mb-4">
							{#each celOptions as o}
								<label class="flex items-center gap-2 text-sm text-slate-700 cursor-pointer p-2 rounded-lg hover:bg-slate-50">
									<input type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
										checked={celUbezpieczenia.includes(o)}
										onchange={() => celUbezpieczenia = toggleArr(celUbezpieczenia, o)} />
									{o}
								</label>
							{/each}
						</div>
						<div>
							<label class="block text-sm font-medium text-slate-700 mb-1">Najważniejszy priorytet ochrony</label>
							<select bind:value={priorytet} class={inp}>
								<option value="">— wybierz —</option>
								{#each priorytetOptions as o}<option value={o}>{o}</option>{/each}
							</select>
						</div>
					</section>

					<!-- Sekcja 5: Dodatkowe -->
					<section>
						<h2 class="text-base font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">5. Informacje dodatkowe</h2>
						<textarea bind:value={dodatkowe} rows="4" class={inp}
							placeholder="Wpisz wszelkie dodatkowe informacje, pytania lub uwagi dla doradcy…"></textarea>
					</section>

					<!-- Klauzula RODO -->
					<div class="bg-slate-50 rounded-lg px-4 py-3 text-xs text-slate-500 leading-relaxed">
						Administratorem Twoich danych osobowych jest podmiot świadczący usługi brokerskie wskazany powyżej.
						Dane są przetwarzane w celu realizacji analizy potrzeb klienta (APK) zgodnie z ustawą o dystrybucji ubezpieczeń
						(IDD) oraz ogólnym rozporządzeniem o ochronie danych (RODO). Podanie danych jest dobrowolne, lecz niezbędne
						do prawidłowego przygotowania oferty ubezpieczeniowej.
					</div>

					{#if saveError}
						<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</div>
					{/if}

					<!-- Przyciski -->
					<div class="flex gap-3 pt-2">
						<button onclick={() => submit(true)} disabled={saving}
							class="flex-1 py-2.5 text-sm border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-60 transition-colors">
							{saving ? 'Zapisywanie…' : 'Zapisz szkic'}
						</button>
						<button onclick={() => submit(false)} disabled={saving}
							class="flex-[2] py-2.5 text-sm bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-700 disabled:opacity-60 transition-colors">
							{saving ? 'Wysyłanie…' : 'Wyślij formularz'}
						</button>
					</div>
				</div>
			</div>
		{/if}

		<p class="text-center text-xs text-slate-400 mt-6">
			{#if tenantNazwa}Doradca: {tenantNazwa} · {/if}Analiza Potrzeb Klienta · {new Date().getFullYear()}
		</p>
	</div>
</div>
