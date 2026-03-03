export type AgreementLanguage = 'EN' | 'ES';

/**
 * Canonical agreement HTML as rendered in the customer kiosk (via `dangerouslySetInnerHTML`).
 *
 * IMPORTANT:
 * - Keep this as the single source of truth for any hard-coded “built-in” agreement text.
 * - The backend may still store/serve an agreement from the database; however, when the kiosk
 *   shows a built-in Spanish agreement, the PDF generator must use the exact same wording.
 */
export const AGREEMENT_LEGAL_BODY_HTML_BY_LANG: Record<AgreementLanguage, string> = {
  EN: `<div style="font-size: 0.9rem; line-height: 1.5; color: inherit;">
<h3 style="text-align: center; font-weight: 700; margin-bottom: 1rem; text-transform: uppercase;">Assumption of Risk and Release of Liability</h3>
<p style="margin-bottom: 1rem;">By signing below, you acknowledge and agree to the following:</p>
<ol style="padding-left: 1.5rem; margin-bottom: 0; display: flex; flex-direction: column; gap: 0.75rem;">
  <li><strong>Nature of Establishment</strong><br/>Club Dallas is a gay oriented business. Entry and participation are voluntary.</li>
  <li><strong>Assumption of Risk</strong><br/>Use of the premises and facilities involves inherent risks, including bodily injury, illness, loss, theft, or damage to personal property. You confirm you are in good health and voluntarily assume all risks associated with entering and using the facilities.</li>
  <li><strong>Release of Liability</strong><br/>To the fullest extent permitted by Texas law, you release and waive any claims against Club Dallas, its owners, employees, and agents for personal injury, illness, death, or property loss or damage arising from your presence on the premises or use of facilities, except where prohibited by law, including gross negligence or willful misconduct.</li>
  <li><strong>Personal Responsibility</strong><br/>You are responsible for complying with all posted rules, including checkout times. Late checkout may result in additional fees and possible suspension of privileges. Club Dallas is not responsible for lost or stolen property.</li>
  <li><strong>Electronic Signature</strong><br/>By clicking "Click to Sign" and providing your digital signature, you agree that your electronic signature is legally binding and has the same effect as a handwritten signature. You confirm you are at least 18 years old.</li>
</ol>
</div>`,
  ES: `<div style="font-size: 0.9rem; line-height: 1.5; color: inherit;">
<h3 style="text-align: center; font-weight: 700; margin-bottom: 1rem; text-transform: uppercase;">Assumption of Risk and Release of Liability</h3>
<p style="margin-bottom: 1rem;">By signing below, you acknowledge and agree to the following:</p>
<ol style="padding-left: 1.5rem; margin-bottom: 0; display: flex; flex-direction: column; gap: 0.75rem;">
  <li><strong>Nature of Establishment</strong><br/>Club Dallas is a gay oriented business. Entry and participation are voluntary.</li>
  <li><strong>Assumption of Risk</strong><br/>Use of the premises and facilities involves inherent risks, including bodily injury, illness, loss, theft, or damage to personal property. You confirm you are in good health and voluntarily assume all risks associated with entering and using the facilities.</li>
  <li><strong>Release of Liability</strong><br/>To the fullest extent permitted by Texas law, you release and waive any claims against Club Dallas, its owners, employees, and agents for personal injury, illness, death, or property loss or damage arising from your presence on the premises or use of facilities, except where prohibited by law, including gross negligence or willful misconduct.</li>
  <li><strong>Personal Responsibility</strong><br/>You are responsible for complying with all posted rules, including checkout times. Late checkout may result in additional fees and possible suspension of privileges. Club Dallas is not responsible for lost or stolen property.</li>
  <li><strong>Electronic Signature</strong><br/>By clicking "Click to Sign" and providing your digital signature, you agree that your electronic signature is legally binding and has the same effect as a handwritten signature. You confirm you are at least 18 years old.</li>
</ol>
</div>`,
};
