// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** signed-in Workspace user, undefined for anonymous visitors */
			user?: { email: string; name: string };
			/** OAuth refresh token of that user, never sent to the client */
			refreshToken?: string;
		}
		interface PageData {
			user?: { email: string; name: string } | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
