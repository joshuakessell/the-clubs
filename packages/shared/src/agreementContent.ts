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
  EN: `<p style="text-transform: uppercase; font-weight: 700;">
This is a GAY ORIENTED BUSINESS. If you are offended by association or behavioural conduct of gay persons, we REQUEST AND ADVISE you not to patronize this establishment. Notice to all patrons: either bodily injury or real property damage or stolen property claims, by signing this document, you are releasing Club Dallas of any responsibility or liability claims. Member acknowledges that they are in good health and use these facilities at their own risk. You are responsible and agree to check out on time. Late checkouts will result in overtime fees and may lead to loss of Club privileges. IF THE ABOVE STATEMENT IS UNDERSTOOD, SIGN BELOW. IF YOU DISAGREE WITH THE ABOVE, DO NOT ENTER.
</p>`,
  ES: `<p style="text-transform: uppercase; font-weight: 700;">
This is a GAY ORIENTED BUSINESS. If you are offended by association or behavioural conduct of gay persons, we REQUEST AND ADVISE you not to patronize this establishment. Notice to all patrons: either bodily injury or real property damage or stolen property claims, by signing this document, you are releasing Club Dallas of any responsibility or liability claims. Member acknowledges that they are in good health and use these facilities at their own risk. You are responsible and agree to check out on time. Late checkouts will result in overtime fees and may lead to loss of Club privileges. IF THE ABOVE STATEMENT IS UNDERSTOOD, SIGN BELOW. IF YOU DISAGREE WITH THE ABOVE, DO NOT ENTER.
</p>`,
};
