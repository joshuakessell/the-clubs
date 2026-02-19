export type AgreementLanguage = 'EN' | 'ES';
/**
 * Canonical agreement HTML as rendered in the customer kiosk (via `dangerouslySetInnerHTML`).
 *
 * IMPORTANT:
 * - Keep this as the single source of truth for any hard-coded “built-in” agreement text.
 * - The backend may still store/serve an agreement from the database; however, when the kiosk
 *   shows a built-in Spanish agreement, the PDF generator must use the exact same wording.
 */
export declare const AGREEMENT_LEGAL_BODY_HTML_BY_LANG: Record<AgreementLanguage, string>;
//# sourceMappingURL=agreementContent.d.ts.map