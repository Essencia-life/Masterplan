/** Sveltia CMS GitHub login (copied from the website repo, GitHub only). */

/** HTML that hands the token (or the error) to the CMS window that opened the popup. */
export const outputHTML = ({ token, error, errorCode }: { token?: string; error?: string; errorCode?: string }) => {
	const provider = 'github';
	const state = error ? 'error' : 'success';
	const content = error ? { provider, error, errorCode } : { provider, token };
	return new Response(
		`<!doctype html><html><body><script>
(() => {
	window.addEventListener('message', ({ data, origin }) => {
		if (data === 'authorizing:${provider}') {
			window.opener?.postMessage('authorization:${provider}:${state}:' + ${JSON.stringify(JSON.stringify(content)).replaceAll('<', '\\u003c')}, origin);
		}
	});
	window.opener?.postMessage('authorizing:${provider}', '*');
})();
</script></body></html>`,
		{ headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Set-Cookie': 'csrf-token=deleted; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure' } }
	);
};
