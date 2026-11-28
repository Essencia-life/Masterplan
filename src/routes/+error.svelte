<script lang="ts">
	import { page } from '$app/state';
	import { Button } from 'flowbite-svelte';
	import logo from '#lib/assets/logo_tree.png';

	const status = $derived(page.status);
	const texts: Record<number, [string, string]> = {
		400: ['That did not work', 'The request could not be understood.'],
		401: ['Please sign in', 'You need to sign in with your Essência account to do this.'],
		403: ['No access', 'Your account is not allowed to do this. Ask the team if you think it should be.'],
		404: ['Nothing here', 'This page or booking does not exist (any more).'],
		429: ['Slow down a little', 'Too many requests in a short time. Please try again in a minute.'],
		502: ['Google did not answer', 'The calendars could not be read right now. Please try again in a moment.'],
		503: ['Temporarily unavailable', 'The service is busy or being updated. Please try again in a moment.']
	};
	const [title, hint] = $derived(texts[status] ?? (status >= 500 ? ['Something went wrong on our side', 'It is not your fault. Try again, and if it keeps happening, tell the team what you were doing.'] : ['Something went wrong', 'Please try again.']));
	// the server's own message is only shown when it adds something (500s are hidden by SvelteKit anyway)
	const detail = $derived(page.error?.message && page.error.message !== title && !/^internal (server )?error$/i.test(page.error.message) ? page.error.message : '');
	const signInUrl = $derived(`/auth/login?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`);
</script>

<svelte:head><title>{status} · {title} · Masterplan</title></svelte:head>

<main class="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-12 text-center">
	<img src={logo} alt="essência" class="h-16 w-auto opacity-90" />
	<p class="font-display text-7xl leading-none font-bold text-muted">{status}</p>
	<h1 class="font-display text-3xl font-bold">{title}</h1>
	<p class="max-w-md text-muted">{hint}</p>
	{#if detail}
		<p class="max-w-md rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm break-words">{detail}</p>
	{/if}
	<div class="mt-2 flex flex-wrap justify-center gap-2">
		{#if status === 401}<Button href={signInUrl} data-sveltekit-reload>Sign in</Button>{/if}
		<Button color={status === 401 ? 'alternative' : 'primary'} href="/">Back to the Masterplan</Button>
		{#if status >= 500 || status === 429}<Button color="alternative" onclick={() => location.reload()}>Try again</Button>{/if}
	</div>
</main>
