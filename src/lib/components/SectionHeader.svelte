<script lang="ts">
	interface Props {
		title: string;
	}
	let { title }: Props = $props();
</script>

<h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</h2>
