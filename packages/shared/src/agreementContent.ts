export type AgreementLanguage = 'EN' | 'ES';

/**
 * Canonical agreement HTML as rendered in the customer kiosk (via `dangerouslySetInnerHTML`).
 *
 * IMPORTANT:
 * - Keep this as the single source of truth for any hard-coded "built-in" agreement text.
 * - The backend may still store/serve an agreement from the database; however, when the kiosk
 *   shows a built-in Spanish agreement, the PDF generator must use the exact same wording.
 */

const AGREEMENT_PARAGRAPHS = [
  'Club Dallas is a gay-oriented adult establishment. Entry and participation are voluntary. If you are uncomfortable with the nature of a gay facility or the conduct of gay patrons, you are advised not to enter.',
  'Use of the premises and facilities involves inherent risks, including possible injury, illness, or loss, theft, or damage to personal property. You confirm that you are in good health and voluntarily assume all risks associated with entering and using the facilities.',
  'To the fullest extent permitted by Texas law, you release and waive any claims against Club Dallas, its owners, employees, and agents for injury, illness, death, or property loss arising from your presence on the premises or use of the facilities, except where prohibited by law, including gross negligence or willful misconduct.',
  'You agree to follow all posted rules, including checkout times. Late checkout may result in additional fees or suspension of privileges. Club Dallas is not responsible for lost or stolen property.',
  'By providing your digital signature, you confirm you are at least 18 years old and agree that your electronic signature is legally binding and equivalent to a handwritten signature.',
];

const paragraphsHtml = AGREEMENT_PARAGRAPHS.map(
  (text) => `<p style="margin: 0 0 0.9rem 0; text-align: justify; hyphens: auto;">${text}</p>`
).join('\n');

const AGREEMENT_HTML = `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 0.9rem; line-height: 1.75; color: inherit;">
  <h3 style="text-align: center; font-weight: 700; font-size: 0.95rem; margin: 0 0 0.75rem 0; text-transform: uppercase; letter-spacing: 0.08em; color: inherit;">
    Assumption of Risk and Liability Release
  </h3>
  <div style="border-top: 2px solid currentColor; border-bottom: 1px solid currentColor; padding: 0.5rem 0; margin-bottom: 1rem; opacity: 0.4;">
    <p style="margin: 0; text-align: center; font-size: 0.8rem; letter-spacing: 0.04em; color: inherit; opacity: 0.7; text-transform: uppercase;">
      Please read carefully before signing
    </p>
  </div>
  <p style="margin: 0 0 1rem 0; font-style: italic; color: inherit; opacity: 0.8;">
    By signing below, you acknowledge and agree to the following:
  </p>
${paragraphsHtml}
</div>`;

export const AGREEMENT_LEGAL_BODY_HTML_BY_LANG: Record<AgreementLanguage, string> = {
  EN: AGREEMENT_HTML,
  ES: AGREEMENT_HTML,
};
