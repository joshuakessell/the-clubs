export type AgreementLanguage = 'EN' | 'ES';

/**
 * Canonical agreement HTML as rendered in the customer kiosk (via `dangerouslySetInnerHTML`).
 *
 * IMPORTANT:
 * - Keep this as the single source of truth for any hard-coded "built-in" agreement text.
 * - The backend may still store/serve an agreement from the database; however, when the kiosk
 *   shows a built-in Spanish agreement, the PDF generator must use the exact same wording.
 */

const AGREEMENT_HTML = `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 0.9rem; line-height: 1.7; color: #111111;">
  <h3 style="text-align: center; font-weight: 700; margin: 0 0 1.25rem 0; text-transform: uppercase; letter-spacing: 0.05em; font-size: 1rem;">
    Assumption of Risk and Release of Liability
  </h3>

  <p style="margin: 0 0 1rem 0; text-align: left;">
    By signing below, you acknowledge and agree to the following terms and conditions:
  </p>

  <ol style="padding-left: 1.5rem; margin: 0; list-style-type: decimal;">
    <li style="margin-bottom: 1rem; padding-left: 0.25rem;">
      <strong>Nature of Establishment.</strong>&nbsp;
      Club Dallas is a gay oriented business. Entry and participation are voluntary.
    </li>
    <li style="margin-bottom: 1rem; padding-left: 0.25rem;">
      <strong>Assumption of Risk.</strong>&nbsp;
      Use of the premises and facilities involves inherent risks, including bodily injury, illness, loss, theft, or damage to personal property. You confirm you are in good health and voluntarily assume all risks associated with entering and using the facilities.
    </li>
    <li style="margin-bottom: 1rem; padding-left: 0.25rem;">
      <strong>Release of Liability.</strong>&nbsp;
      To the fullest extent permitted by Texas law, you release and waive any claims against Club Dallas, its owners, employees, and agents for personal injury, illness, death, or property loss or damage arising from your presence on the premises or use of facilities, except where prohibited by law, including gross negligence or willful misconduct.
    </li>
    <li style="margin-bottom: 1rem; padding-left: 0.25rem;">
      <strong>Personal Responsibility.</strong>&nbsp;
      You are responsible for complying with all posted rules, including checkout times. Late checkout may result in additional fees and possible suspension of privileges. Club Dallas is not responsible for lost or stolen property.
    </li>
    <li style="margin-bottom: 0; padding-left: 0.25rem;">
      <strong>Electronic Signature.</strong>&nbsp;
      By providing your digital signature, you agree that your electronic signature is legally binding and has the same effect as a handwritten signature. You confirm you are at least 18 years old.
    </li>
  </ol>
</div>`;

export const AGREEMENT_LEGAL_BODY_HTML_BY_LANG: Record<AgreementLanguage, string> = {
  EN: AGREEMENT_HTML,
  ES: AGREEMENT_HTML,
};
