/**
 * PDF generation utility for agreement documents.
 *
 * Goals:
 * - Produce a polished, legal-document-like PDF (letterhead + typography).
 * - Render agreement HTML without leaking raw tags.
 * - Support multi-page agreements (no truncation).
 * - Include identity metadata (name + DOB) and check-in timestamp.
 * - Add "Page X of Y" on every page.
 *
 * Implementation notes:
 * - We intentionally avoid headless browser rendering to keep dependencies lightweight.
 * - We support the small HTML subset used by the kiosk agreement body: h2/h3/p/strong/em/br/ul/ol/li.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function extractBase64FromDataUrlOrRaw(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('data:')) {
    const comma = trimmed.indexOf(',');
    if (comma === -1) throw new Error('Invalid data URL: missing comma');
    return trimmed.slice(comma + 1);
  }
  return trimmed;
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Buffer is available in Node; pdf-lib wants Uint8Array.
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function decodeHtmlEntities(input: string): string {
  // Minimal entity decoding for our agreement content.
  const replaced = input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  // Numeric entities: &#123; or &#x1F600;
  return replaced.replace(/&#(x?[0-9a-fA-F]+);/g, (_m, raw) => {
    try {
      const s = String(raw);
      const codePoint =
        s.startsWith('x') || s.startsWith('X') ? parseInt(s.slice(1), 16) : parseInt(s, 10);
      if (!Number.isFinite(codePoint)) return '';
      return String.fromCodePoint(codePoint);
    } catch {
      return '';
    }
  });
}

type InlineStyle = { bold: boolean; italic: boolean };
type InlineRun = { text: string; style: InlineStyle };
type BlockType = 'h2' | 'h3' | 'p';
type Block = { type: BlockType; runs: InlineRun[] };

function normalizeRuns(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.style.bold === r.style.bold && prev.style.italic === r.style.italic) {
      prev.text += r.text;
    } else {
      out.push({ text: r.text, style: { ...r.style } });
    }
  }
  return out;
}

function stripDangerousHtml(html: string): string {
  // Remove scripts/styles entirely (defense-in-depth, even though agreement HTML is server-controlled).
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function parseAgreementHtmlToBlocks(inputHtml: string): Block[] {
  const html = stripDangerousHtml(inputHtml || '');
  const tokens = html.split(/(<[^>]+>)/g).filter((t) => t.length > 0);

  const blocks: Block[] = [];
  let current: Block | null = null;
  const styleStack: InlineStyle[] = [{ bold: false, italic: false }];

  const currentStyle = (): InlineStyle => styleStack[styleStack.length - 1]!;

  const ensureBlock = (type: BlockType): void => {
    if (!current) {
      current = { type, runs: [] };
      return;
    }
    if (current.type !== type) {
      // Close the previous block and start a new one.
      const finalized = normalizeRuns(current.runs);
      if (finalized.some((r) => r.text.replace(/\s+/g, '').length > 0))
        blocks.push({ ...current, runs: finalized });
      current = { type, runs: [] };
    }
  };

  const closeBlock = (): void => {
    if (!current) return;
    const finalized = normalizeRuns(current.runs);
    if (finalized.some((r) => r.text.replace(/\s+/g, '').length > 0))
      blocks.push({ ...current, runs: finalized });
    current = null;
  };

  const appendText = (text: string): void => {
    const decoded = decodeHtmlEntities(text);
    if (!decoded) return;
    ensureBlock(current?.type ?? 'p');
    current!.runs.push({ text: decoded, style: { ...currentStyle() } });
  };

  const appendNewline = (): void => {
    ensureBlock(current?.type ?? 'p');
    current!.runs.push({ text: '\n', style: { ...currentStyle() } });
  };

  // List handling: flatten to paragraphs with bullet/number prefixes.
  const listStack: Array<{ kind: 'ul' | 'ol'; index: number }> = [];
  const currentListPrefix = (): string => {
    const top = listStack[listStack.length - 1];
    if (!top) return '';
    if (top.kind === 'ul') return '• ';
    return `${top.index}. `;
  };

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      appendText(token);
      continue;
    }

    const raw = token.replace(/\s+/g, ' ').trim();
    const m = raw.match(/^<\/?\s*([a-zA-Z0-9]+)\b/);
    if (!m) continue;
    const tag = m[1]!.toLowerCase();
    const isEnd = raw.startsWith('</');
    const isSelfClosing = raw.endsWith('/>') || tag === 'br';

    if (!isEnd) {
      if (tag === 'p' || tag === 'h2' || tag === 'h3') {
        ensureBlock(tag as BlockType);
        continue;
      }
      if (tag === 'br') {
        appendNewline();
        continue;
      }
      if (tag === 'strong' || tag === 'b') {
        styleStack.push({ ...currentStyle(), bold: true });
        continue;
      }
      if (tag === 'em' || tag === 'i') {
        styleStack.push({ ...currentStyle(), italic: true });
        continue;
      }
      if (tag === 'ul' || tag === 'ol') {
        listStack.push({ kind: tag as 'ul' | 'ol', index: 0 });
        continue;
      }
      if (tag === 'li') {
        const top = listStack[listStack.length - 1];
        if (top && top.kind === 'ol') top.index += 1;
        ensureBlock('p');
        appendText(currentListPrefix());
        continue;
      }

      if (isSelfClosing) continue;
      continue;
    }

    // End tags
    if (tag === 'p' || tag === 'h2' || tag === 'h3') {
      closeBlock();
      continue;
    }
    if (tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i') {
      if (styleStack.length > 1) styleStack.pop();
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      listStack.pop();
      continue;
    }
    if (tag === 'li') {
      closeBlock();
      continue;
    }
  }
  closeBlock();

  // If there were no HTML blocks at all, fall back to treating the whole thing as plaintext paragraphs.
  if (blocks.length === 0) {
    const raw = (inputHtml || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return raw
      .split('\n')
      .map((line) => line.trimEnd())
      .map((line) => ({
        type: 'p' as const,
        runs: [{ text: line || '', style: { bold: false, italic: false } }],
      }))
      .filter((b) => b.runs[0]!.text.length > 0);
  }

  return blocks;
}

function formatDob(dob: unknown): string | undefined {
  if (!dob) return undefined;
  if (typeof dob === 'string') {
    const s = dob.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  if (dob instanceof Date && !Number.isNaN(dob.getTime())) {
    // Use UTC date components to avoid timezone shifting a DATE-only value.
    const y = dob.getUTCFullYear();
    const m = String(dob.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dob.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return undefined;
}

function formatZonedDateTime(dt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

async function tryEmbedClubLogoPng(
  pdfDoc: PDFDocument
): Promise<ReturnType<PDFDocument['embedPng']> | null> {
  const envPath = process.env.CLUB_DALLAS_LOGO_PATH?.trim();

  // Candidate locations (best-effort). If none exist, we fall back to text-only letterhead.
  const candidates = [
    envPath,
    path.resolve(process.cwd(), '../../apps/customer-kiosk/src/assets/the-clubs-logo.png'),
    path.resolve(process.cwd(), '../apps/customer-kiosk/src/assets/the-clubs-logo.png'),
    path.resolve(process.cwd(), 'apps/customer-kiosk/src/assets/the-clubs-logo.png'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      const bytes = await fs.readFile(p);
      return await pdfDoc.embedPng(bytes);
    } catch {
      // ignore and try next
    }
  }
  return null;
}

export async function generateAgreementPdf(params: {
  agreementTitle?: string;
  agreementVersion?: string;
  agreementText: string; // may be HTML (as rendered in kiosk)
  customerName: string;
  customerDob?: string | Date | null;
  membershipNumber?: string;
  checkinAt?: Date;
  signedAt: Date;
  signatureImageBase64?: string; // raw base64 OR full data URL
  signatureText?: string; // Optional text to render in signature box if no image
  timeZone?: string; // for "check-in" and "signed" timestamps; default: America/Chicago
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  // Fonts: Times for body (legal doc feel), Helvetica for header/labels.
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBoldItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logo = await tryEmbedClubLogoPng(pdfDoc);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const marginX = 54;
  const marginTop = 54;
  const marginBottom = 54;
  const headerHeight = 72;
  const footerHeight = 28;
  const contentWidth = PAGE_W - marginX * 2;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);

  const tz = params.timeZone || 'America/Chicago';
  const checkinAt = params.checkinAt || params.signedAt;
  const dob = formatDob(params.customerDob);
  const agreementTitle = (params.agreementTitle || 'Club Agreement').trim();
  const agreementVersion = (params.agreementVersion || '').trim();

  const blocks = parseAgreementHtmlToBlocks(params.agreementText);

  const pickBodyFont = (style: InlineStyle) => {
    if (style.bold && style.italic) return timesBoldItalic;
    if (style.bold) return timesBold;
    if (style.italic) return timesItalic;
    return times;
  };

  const measure = (text: string, style: InlineStyle, fontSize: number): number => {
    const f = pickBodyFont(style);
    return f.widthOfTextAtSize(text, fontSize);
  };

  const splitLongToken = (token: InlineRun, fontSize: number, maxWidth: number): InlineRun[] => {
    const f = pickBodyFont(token.style);
    const out: InlineRun[] = [];
    let chunk = '';
    for (const ch of token.text) {
      const candidate = chunk + ch;
      if (f.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        chunk = candidate;
      } else {
        if (chunk) out.push({ text: chunk, style: token.style });
        chunk = ch;
      }
    }
    if (chunk) out.push({ text: chunk, style: token.style });
    return out;
  };

  const layoutRunsToLines = (
    runs: InlineRun[],
    fontSize: number,
    maxWidth: number
  ): InlineRun[][] => {
    // Collapse HTML-style whitespace: sequences of whitespace become a single space, but preserve explicit newlines.
    const tokens: InlineRun[] = [];
    for (const run of runs) {
      const parts = run.text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (part.length > 0) {
          const collapsed = part.replace(/\s+/g, ' ');
          const split = collapsed.split(/(\s)/).filter((p) => p.length > 0);
          for (const s of split) {
            tokens.push({ text: s, style: run.style });
          }
        }
        if (i < parts.length - 1) tokens.push({ text: '\n', style: run.style });
      }
    }

    const lines: InlineRun[][] = [];
    let line: InlineRun[] = [];
    let width = 0;

    const pushLine = () => {
      // Trim trailing spaces
      while (line.length > 0 && /^\s+$/.test(line[line.length - 1]!.text)) {
        line.pop();
      }
      if (line.length > 0) lines.push(line);
      line = [];
      width = 0;
    };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.text === '\n') {
        pushLine();
        lines.push([]); // paragraph break (blank line)
        continue;
      }

      const isSpace = /^\s+$/.test(t.text);
      if (isSpace && line.length === 0) continue;

      const w = measure(t.text, t.style, fontSize);
      if (width + w <= maxWidth) {
        line.push(t);
        width += w;
        continue;
      }

      // If it's a space, start a new line and skip the space.
      if (isSpace) {
        pushLine();
        continue;
      }

      // If the token itself is too long, break it.
      if (line.length === 0 && w > maxWidth) {
        const parts = splitLongToken(t, fontSize, maxWidth);
        for (let pi = 0; pi < parts.length; pi++) {
          const p = parts[pi]!;
          const pw = measure(p.text, p.style, fontSize);
          if (width + pw > maxWidth && line.length > 0) pushLine();
          line.push(p);
          width += pw;
          if (width >= maxWidth) pushLine();
        }
        continue;
      }

      // Wrap to next line.
      pushLine();
      i -= 1; // re-process this token on the new line
    }

    pushLine();
    // Remove trailing blank lines
    while (lines.length > 0 && lines[lines.length - 1]!.length === 0) lines.pop();
    return lines;
  };

  const drawLetterhead = (page: any) => {
    const topY = PAGE_H - marginTop;

    if (logo) {
      // Place logo centered in the header so it doesn't overlap the "Club Dallas" label on the left.
      // Cap both height + width to keep it legible but safely away from the left header text.
      const maxLogoH = 54;
      const maxLogoW = 260;
      const scale = Math.min(1, maxLogoH / logo.height, maxLogoW / logo.width);
      const drawH = logo.height * scale;
      const drawW = logo.width * scale;
      const x = (PAGE_W - drawW) / 2;
      const y = topY - drawH + 2;
      page.drawImage(logo, { x, y, width: drawW, height: drawH });
    }

    page.drawText('Club Dallas', {
      x: marginX,
      y: topY - 14,
      size: 16,
      font: helvBold,
      color: black,
    });

    // Horizontal rule under letterhead
    page.drawLine({
      start: { x: marginX, y: topY - headerHeight },
      end: { x: PAGE_W - marginX, y: topY - headerHeight },
      thickness: 1,
      color: rgb(0.75, 0.75, 0.75),
    });
  };

  const drawFooter = (page: any, pageIndex: number, totalPages: number) => {
    const text = `Page ${pageIndex + 1} of ${totalPages}`;
    const size = 9;
    const w = helv.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: PAGE_W - marginX - w,
      y: marginBottom - footerHeight + 10,
      size,
      font: helv,
      color: gray,
    });
  };

  const createPage = (isFirstPage: boolean): { page: any; y: number } => {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    drawLetterhead(page);

    let y = PAGE_H - marginTop - headerHeight - 18;

    if (isFirstPage) {
      // Title
      page.drawText(agreementTitle, { x: marginX, y, size: 16, font: helvBold, color: black });
      y -= 22;

      // Meta lines
      const metaSize = 10;
      const metaLineHeight = 14;
      const meta = [
        { k: 'Customer Name:', v: params.customerName || 'Customer' },
        { k: 'Date of Birth:', v: dob || 'N/A' },
        { k: `Check-in (${tz}):`, v: formatZonedDateTime(checkinAt, tz) },
        { k: `Signed (${tz}):`, v: formatZonedDateTime(params.signedAt, tz) },
        { k: 'Membership #:', v: params.membershipNumber || 'N/A' },
        ...(agreementVersion ? [{ k: 'Agreement Version:', v: agreementVersion }] : []),
      ];

      for (const row of meta) {
        page.drawText(row.k, { x: marginX, y, size: metaSize, font: helvBold, color: black });
        page.drawText(row.v, { x: marginX + 140, y, size: metaSize, font: helv, color: black });
        y -= metaLineHeight;
      }

      y -= 6;
      page.drawLine({
        start: { x: marginX, y },
        end: { x: PAGE_W - marginX, y },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.85),
      });
      y -= 18;
    }

    return { page, y };
  };

  const bottomY = marginBottom + footerHeight;

  const drawTextLineRuns = (
    page: any,
    x: number,
    y: number,
    line: InlineRun[],
    fontSize: number
  ) => {
    let cursorX = x;
    for (const run of line) {
      if (!run.text) continue;
      const f = pickBodyFont(run.style);
      page.drawText(run.text, { x: cursorX, y, size: fontSize, font: f, color: black });
      cursorX += f.widthOfTextAtSize(run.text, fontSize);
    }
  };

  let { page: currentPage, y } = createPage(true);
  const pages: any[] = [currentPage];

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < bottomY) {
      const next = createPage(false);
      currentPage = next.page;
      y = next.y;
      pages.push(currentPage);
    }
  };

  for (const block of blocks) {
    if (block.type === 'h2') {
      const fontSize = 13;
      const lineHeight = 16;
      const lines = layoutRunsToLines(block.runs, fontSize, contentWidth);
      const needed = lines.length * lineHeight + 12;
      ensureSpace(needed);
      for (const line of lines) {
        const text = line.map((r) => r.text).join('');
        const w = timesBold.widthOfTextAtSize(text, fontSize);
        const x = marginX + Math.max(0, (contentWidth - w) / 2);
        // Draw h2 as bold, centered; ignore mixed styles within h2 (we don't use them currently).
        currentPage.drawText(text, { x, y, size: fontSize, font: timesBold, color: black });
        y -= lineHeight;
      }
      y -= 10;
      continue;
    }

    if (block.type === 'h3') {
      const fontSize = 11.5;
      const lineHeight = 14.5;
      const lines = layoutRunsToLines(block.runs, fontSize, contentWidth);
      const needed = lines.length * lineHeight + 10;
      ensureSpace(needed);
      for (const line of lines) {
        const text = line
          .map((r) => r.text)
          .join('')
          .trim();
        currentPage.drawText(text, {
          x: marginX,
          y,
          size: fontSize,
          font: timesBold,
          color: black,
        });
        y -= lineHeight;
      }
      y -= 6;
      continue;
    }

    // Paragraph
    const fontSize = 10.5;
    const lineHeight = 13.5;
    const lines = layoutRunsToLines(block.runs, fontSize, contentWidth);
    const needed = lines.length * lineHeight + 10;
    ensureSpace(Math.min(needed, lineHeight * 2)); // allow flowing onto next pages

    for (const line of lines) {
      if (line.length === 0) {
        y -= lineHeight; // blank line
        ensureSpace(lineHeight);
        continue;
      }
      ensureSpace(lineHeight);
      drawTextLineRuns(currentPage, marginX, y, line, fontSize);
      y -= lineHeight;
    }
    y -= 8;
  }

  // Signature block (keep together)
  const signatureBoxHeight = 110;
  const signatureBlockHeight = signatureBoxHeight + 44;
  ensureSpace(signatureBlockHeight);

  currentPage.drawText('Signature:', { x: marginX, y, size: 11, font: helvBold, color: black });
  y -= 14;

  const sigBoxX = marginX;
  const sigBoxY = y - signatureBoxHeight;
  currentPage.drawRectangle({
    x: sigBoxX,
    y: sigBoxY,
    width: contentWidth,
    height: signatureBoxHeight,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 1,
  });

  if (params.signatureImageBase64) {
    const rawBase64 = extractBase64FromDataUrlOrRaw(params.signatureImageBase64);
    const pngBytes = base64ToUint8Array(rawBase64);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const padding = 10;
    const maxW = contentWidth - padding * 2;
    const maxH = signatureBoxHeight - padding * 2;
    const scale = Math.min(maxW / pngImage.width, maxH / pngImage.height);
    const drawW = pngImage.width * scale;
    const drawH = pngImage.height * scale;
    const drawX = sigBoxX + padding + (maxW - drawW) / 2;
    const drawY = sigBoxY + padding + (maxH - drawH) / 2;
    currentPage.drawImage(pngImage, { x: drawX, y: drawY, width: drawW, height: drawH });
  } else if (params.signatureText) {
    const size = 12;
    const textWidth = helv.widthOfTextAtSize(params.signatureText, size);
    const textX = sigBoxX + (contentWidth - textWidth) / 2;
    const textY = sigBoxY + signatureBoxHeight / 2 - 6;
    currentPage.drawText(params.signatureText, {
      x: textX,
      y: textY,
      size,
      font: helv,
      color: black,
    });
  } else {
    currentPage.drawText('(no signature image provided)', {
      x: sigBoxX + 10,
      y: sigBoxY + signatureBoxHeight / 2 - 4,
      size: 10,
      font: helv,
      color: gray,
    });
  }

  y = sigBoxY - 18;
  currentPage.drawText(`Printed Name: ${params.customerName}`, {
    x: marginX,
    y,
    size: 10,
    font: helv,
    color: black,
  });
  y -= 14;
  currentPage.drawText(`Signed (${tz}): ${formatZonedDateTime(params.signedAt, tz)}`, {
    x: marginX,
    y,
    size: 10,
    font: helv,
    color: black,
  });

  // Add page numbering after all pages exist
  const totalPages = pdfDoc.getPageCount();
  const allPages = pdfDoc.getPages();
  for (let i = 0; i < allPages.length; i++) {
    drawFooter(allPages[i], i, totalPages);
  }

  // Use a more traditional PDF structure for maximum compatibility with older parsers/readers.
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(pdfBytes);
}
