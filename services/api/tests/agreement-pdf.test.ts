import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateAgreementPdf } from '../src/utils/pdf-generator.js';

describe('Agreement PDF generation', () => {
  it('writes a valid, multi-page PDF and a parser can open it (no raw HTML tags)', async () => {
    const signatureBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const longBody = Array.from({ length: 120 }, (_v, i) => {
      const n = i + 1;
      return `<h3>Section ${n}</h3><p><strong>PLEASE READ CAREFULLY.</strong> This is paragraph ${n} of a long agreement intended to span multiple pages in the generated PDF.</p>`;
    }).join('\n');

    const pdf = await generateAgreementPdf({
      agreementTitle: 'Club Dallas Agreement',
      agreementVersion: 'test-v1',
      agreementText: `<h2>TEST AGREEMENT</h2><p>Intro paragraph.</p>${longBody}`,
      customerName: 'Test Customer',
      customerDob: '2000-01-02',
      membershipNumber: 'TEST-001',
      checkinAt: new Date('2026-01-03T01:23:00.000Z'),
      signedAt: new Date('2026-01-03T00:00:00.000Z'),
      signatureImageBase64: signatureBase64,
    });

    const outDir = path.resolve(process.cwd(), 'services/api/tests/_artifacts');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'test-agreement.pdf');
    await fs.writeFile(outPath, pdf);

    // Parse with a different library than the generator to confirm the PDF is readable.
    const mod = await import('pdf-parse');
    const pdfParse = (mod as any).default ?? mod;
    const parsed = await pdfParse(pdf);

    expect(parsed.numpages).toBeGreaterThanOrEqual(2);
    expect(parsed.text).toContain('Club Dallas Agreement');
    expect(parsed.text).toContain('Customer Name:');
    expect(parsed.text).toContain('Test Customer');
    expect(parsed.text).toContain('Date of Birth:');
    expect(parsed.text).toContain('2000-01-02');
    expect(parsed.text).not.toContain('<h2');
    expect(parsed.text).not.toContain('<p');
    expect(parsed.text).toMatch(/Page\s+1\s+of\s+\d+/);
  });
});
