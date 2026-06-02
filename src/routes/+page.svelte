<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { sb } from '$lib/supabase';

	onMount(async () => {
		const { data: { session } } = await sb.auth.getSession();
		if (session) goto('/dashboard');
		else goto('/login');
	});
</script>
