<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';
	import { page } from '$app/stores';

	onMount(async () => {
		const token = $page.url.searchParams.get('token');
		if (token) { goto(`/form?token=${token}`); return; }
		const { data: { session } } = await sb.auth.getSession();
		if (session) goto('/dashboard');
		else goto('/login');
	});
</script>
