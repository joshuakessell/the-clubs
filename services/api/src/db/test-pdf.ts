import { db } from './index';
import { sql } from 'drizzle-orm';
import { generateAgreementPdf } from '../utils/pdf-generator';

async function run() {
  const result = await db.execute<Record<string, unknown>>(
    sql`SELECT
         cb.id as block_id,
         cb.agreement_signed,
         cb.starts_at as block_starts_at,
         c.name as customer_name,
         c.dob as customer_dob,
         c.membership_number,
         sig.signed_at as sig_signed_at,
         sig.signature_png_base64 as sig_png_base64,
         sig.agreement_text_snapshot as sig_agreement_text,
         sig.agreement_version as sig_agreement_version,
         a.title as agreement_title
       FROM checkin_blocks cb
       JOIN visits v ON v.id = cb.visit_id
       JOIN customers c ON c.id = v.customer_id
       LEFT JOIN LATERAL (
         SELECT signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, agreement_id
         FROM agreement_signatures
         WHERE checkin_block_id = cb.id
         ORDER BY created_at DESC LIMIT 1
       ) sig ON TRUE
       LEFT JOIN agreements a ON a.id = sig.agreement_id
       WHERE cb.agreement_signed = true
       LIMIT 1`
  );
  if (result.rows.length === 0) {
    console.log('No blocks with signatures found');
    process.exit(0);
  }
  const row = result.rows[0] as any;
  console.log('Found block with signature:', row.block_id);

  try {
    const pdfBuf = await generateAgreementPdf({
      agreementTitle: row.agreement_title || 'Club Agreement',
      agreementVersion: row.sig_agreement_version || undefined,
      agreementText: row.sig_agreement_text || '',
      customerName: row.customer_name || 'Guest',
      customerDob: row.customer_dob,
      membershipNumber: row.membership_number || undefined,
      checkinAt: new Date(row.block_starts_at),
      signedAt: new Date(row.sig_signed_at),
      signatureImageBase64: row.sig_png_base64 || undefined,
    });
    console.log('Successfully generated PDF!');
    console.log('PDF length:', pdfBuf.length);
  } catch (err) {
    console.error('Failed to generate PDF:', err);
  }
  process.exit(0);
}

run().catch(console.error);
