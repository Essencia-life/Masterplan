import mjml2html from 'mjml';

/**
 * Brand layout of the mails (same palette as the app): forest header with the wordmark,
 * parchment background, terra accent. Gmail ignores web fonts, so the serif falls back to Georgia.
 * The wordmark is text, like in the app header; for a logo image put a PNG into static/email/ and
 * replace the header text below with an <mj-image>.
 */
const mjmlSource = (bodyHtml: string) => `<mjml>
  <mj-head>
    <mj-title>Essência</mj-title>
    <mj-font name="Cormorant Garamond" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&amp;display=swap" />
    <mj-attributes>
      <mj-all font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" />
      <mj-text font-size="16px" line-height="1.6" color="#3b2d20" />
    </mj-attributes>
    <mj-style inline="inline">
      p { margin: 0 0 14px 0; }
      ul { margin: 0 0 14px 0; padding-left: 20px; }
      li { margin-bottom: 4px; }
      a { color: #2c4632; }
      h2 { margin: 0 0 12px 0; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 26px; color: #2c4632; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f6f0e2" width="600px">
    <mj-section background-color="#2c4632" padding="30px 24px 26px 24px">
      <mj-column>
        <mj-text align="center" padding="0" font-family="'Cormorant Garamond', Georgia, serif" font-size="40px" font-weight="700" letter-spacing="1px" line-height="1.1" color="#f6f0e2">essência</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#b05d38" padding="0">
      <mj-column><mj-spacer height="4px" /></mj-column>
    </mj-section>
    <mj-section background-color="#fffcf4" padding="30px 24px 16px 24px">
      <mj-column><mj-text padding="0 8px">${bodyHtml}</mj-text></mj-column>
    </mj-section>
    <mj-section padding="18px 24px 28px 24px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#8b8372">Essência Cooperativa · Aljezur, Portugal</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

/** Compiles the body (HTML, placeholders like {{name}} are passed through) into a complete HTML mail. */
export async function renderLayout(bodyHtml: string): Promise<string> {
	const { html } = await mjml2html(mjmlSource(bodyHtml), { validationLevel: 'soft' });
	return html;
}
