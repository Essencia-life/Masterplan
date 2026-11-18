// Vite inlines the file as a data URI ("data:image/png;base64,…"); it is the website logo (src/lib/assets/logo.avif) as PNG, because mail clients do not show AVIF
import uri from './logo.png?inline';

/** Sent inside the mail (Content-ID), so it shows without "load images" and without a public URL. */
export const LOGO_CID = 'logo@essencia.life';
export const logo = { cid: LOGO_CID, type: 'image/png', content: Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64') };
