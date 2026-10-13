<script lang="ts">
	// Ustawienia → Powiadomienia: codzienne podsumowanie na e-mail pracownika (adres z profilu — nie do zmiany tutaj).
	// Godzina w czasie polskim, wybór sekcji, „nie wysyłaj, gdy nic nowego”, „Wyślij teraz” do sprawdzenia treści.
	import { sb } from '$lib/supabase';
	import { ctxToast } from '$lib/stores/ctxmenu.svelte';
	import { AlertTriangle, Bell, Send } from 'lucide-svelte';

	type Ustawienia = { godzina: number; sekcje: Record<string, boolean>; aktywne: boolean; pomin_puste: boolean; zapisane: boolean; ostatnio_wyslano_at: string | null; ostatni_blad: string | null };
	type Odp = { sekcje_lista: [string, string][]; ustawienia: Ustawienia; adres: string; wysylka_gotowa: boolean };

	let dane = $state<Odp | null>(null);
	let u = $state<Ustawienia | null>(null);
	let blad = $state('');
	let zapisywanie = $state(false);
	let wysylanie = $state(false);

	async function naglowki(json = false): Promise<Record<string, string>> {
		const { data: { session } } = await sb.auth.getSession();
		return { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) };
	}
	async function odpowiedz<T>(res: Response): Promise<T> {
		const d = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
		if (!res.ok) throw new Error(d?.message ?? `Błąd ${res.status}`);
		return d as T;
	}

	async function wczytaj() {
		blad = '';
		try {
			dane = await odpowiedz<Odp>(await fetch('/api/podsumowanie', { headers: await naglowki() }));
			u = { ...dane.ustawienia, sekcje: { ...dane.ustawienia.sekcje } };
		} catch (e) {
			blad = (e as Error).message;
		}
	}
	$effect(() => { void wczytaj(); });

	async function zapisz(): Promise<boolean> {
		if (!u) return false;
		zapisywanie = true;
		blad = '';
		try {
			await odpowiedz(await fetch('/api/podsumowanie', { method: 'PUT', headers: await naglowki(true), body: JSON.stringify({ godzina: u.godzina, sekcje: u.sekcje, aktywne: u.aktywne, pomin_puste: u.pomin_puste }) }));
			u.zapisane = true;
			ctxToast(u.aktywne ? `Zapisano — podsumowanie codziennie ok. ${u.godzina}:10` : 'Zapisano — podsumowanie wyłączone');
			return true;
		} catch (e) {
			blad = (e as Error).message;
			return false;
		} finally {
			zapisywanie = false;
		}
	}

	async function wyslijTeraz() {
		if (!(await zapisz())) return;
		wysylanie = true;
		try {
			const w = await odpowiedz<{ temat: string; pusto: boolean }>(await fetch('/api/podsumowanie', { method: 'POST', headers: await naglowki(true), body: '{}' }));
			ctxToast(`Wysłano: ${w.temat}`);
			await wczytaj();
		} catch (e) {
			blad = (e as Error).message;
		} finally {
			wysylanie = false;
		}
	}

	const kiedy = (iso: string) => new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });
	const GODZINY = Array.from({ length: 17 }, (_, i) => i + 5); // 5:00–21:00
</script>

<div class="space-y-4 max-w-2xl">
	<div>
		<h2 class="text-lg font-semibold text-slate-900 flex items-center gap-2"><Bell size={18} class="text-ink-3" /> Codzienne podsumowanie na e-mail</h2>
		<p class="text-sm text-slate-500">Raz dziennie, o wybranej godzinie, na Twój adres z profilu{dane ? `: ${dane.adres}` : ''}. Zawiera zmiany od poprzedniego podsumowania.</p>
	</div>

	{#if blad}<p class="text-[13px] text-danger bg-danger-soft rounded-lg px-3 py-2">{blad}</p>{/if}
	{#if dane && !dane.wysylka_gotowa}
		<p class="flex items-start gap-2 text-[13px] text-warn bg-warn-soft rounded-lg px-3 py-2"><AlertTriangle size={15} class="shrink-0 mt-0.5" /> Firma nie ma skonfigurowanej wysyłki e-maili (klucz Resend i adres nadawcy w SAAS Admin) — podsumowanie nie wyjdzie, dopóki to nie zostanie ustawione.</p>
	{/if}

	{#if u}
		<div class="bg-white border border-line rounded-xl p-4 space-y-4">
			<label class="flex items-center gap-3 cursor-pointer">
				<input type="checkbox" bind:checked={u.aktywne} class="w-4 h-4 accent-accent" />
				<span class="text-sm font-semibold text-ink">Wysyłaj codzienne podsumowanie</span>
			</label>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<label class="block">
					<span class="block text-[13px] font-semibold text-ink mb-1.5">Godzina (czas polski)</span>
					<select bind:value={u.godzina} disabled={!u.aktywne} class="w-full h-9 px-2.5 border border-line rounded-lg bg-white text-sm disabled:opacity-60">
						{#each GODZINY as g}<option value={g}>{g}:00</option>{/each}
					</select>
					<span class="block text-xs text-ink-3 mt-1">Mail wychodzi kilka minut po pełnej godzinie.</span>
				</label>
				<label class="flex items-start gap-2 cursor-pointer sm:pt-7">
					<input type="checkbox" bind:checked={u.pomin_puste} disabled={!u.aktywne} class="mt-0.5 w-4 h-4 accent-accent" />
					<span class="text-[13px] text-ink">Nie wysyłaj, gdy nie ma nic nowego<span class="block text-xs text-ink-3">inaczej dostaniesz krótki mail „spokojny dzień”</span></span>
				</label>
			</div>

			<fieldset>
				<legend class="text-[13px] font-semibold text-ink mb-1.5">Co ma być w podsumowaniu</legend>
				<div class="flex flex-col gap-1.5">
					{#each dane?.sekcje_lista ?? [] as [k, opis] (k)}
						<label class="flex items-center gap-2 cursor-pointer">
							<input type="checkbox" bind:checked={u.sekcje[k]} disabled={!u.aktywne} class="w-4 h-4 accent-accent shrink-0" />
							<span class="text-[13px] text-ink">{opis}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="flex flex-wrap items-center gap-2 pt-2 border-t border-line-soft">
				<button onclick={zapisz} disabled={zapisywanie || wysylanie} class="h-9 px-4 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-50">{zapisywanie ? 'Zapisywanie…' : 'Zapisz'}</button>
				<button onclick={wyslijTeraz} disabled={zapisywanie || wysylanie || !dane?.wysylka_gotowa} title="Zapisuje ustawienia i wysyła podsumowanie od razu — także gdy nic nowego" class="h-9 flex items-center gap-1.5 px-3 text-sm font-medium border border-line rounded-lg bg-white text-ink hover:bg-surface-2 disabled:opacity-50">
					<Send size={15} class="text-ink-3" /> {wysylanie ? 'Wysyłanie…' : 'Wyślij teraz'}
				</button>
				<span class="text-xs text-ink-3 sm:ml-auto">
					{#if u.ostatni_blad}<span class="text-danger">Ostatnia próba nie wyszła: {u.ostatni_blad}</span>
					{:else if u.ostatnio_wyslano_at}Ostatnie podsumowanie: {kiedy(u.ostatnio_wyslano_at)}
					{:else}Jeszcze nie wysłano.{/if}
				</span>
			</div>
		</div>
	{:else if !blad}
		<p class="text-sm text-ink-3">Wczytywanie…</p>
	{/if}
</div>
