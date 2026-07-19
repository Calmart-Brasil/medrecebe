import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

import type { Attendance, UserProfile, Workplace } from '../types';
import { formatCurrency, formatDate } from './paymentRules';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const FOOTER_TOP = 42;

export interface ReconciliationPdfGroup {
  workplace: Workplace;
  month: string;
  attendances: Attendance[];
  totalCents: number;
  quantity: number;
}

export interface ReconciliationPdfResult {
  uri: string;
  fileName: string;
  omittedAttachments: number;
}

type PreparedAttachment = {
  bytes: Uint8Array;
  label: string;
};

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const value = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(year!, monthNumber! - 1, 1, 12),
  );
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : value;
}

function replaceAll(source: string, token: string, value: string): string {
  return source.split(token).join(value);
}

function pdfSafe(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, '?');
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  pdfSafe(text).replace(/\r/g, '').split('\n').forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function drawHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, subtitle: string): void {
  page.drawRectangle({ x: 0, y: 752, width: PAGE_WIDTH, height: PAGE_HEIGHT - 752, color: rgb(0.039, 0.122, 0.267) });
  page.drawRectangle({ x: 0, y: 752, width: 8, height: PAGE_HEIGHT - 752, color: rgb(0.169, 0.714, 0.451) });
  page.drawText('MedRecebe', { x: MARGIN, y: 807, size: 19, font: bold, color: rgb(1, 1, 1) });
  page.drawText(pdfSafe(subtitle), { x: MARGIN, y: 781, size: 10, font: regular, color: rgb(0.851, 0.906, 0.973) });
}

function detailLines(group: ReconciliationPdfGroup): string[] {
  return group.attendances.map((attendance) =>
    `${formatDate(attendance.occurredAt)} — ${Math.max(1, attendance.quantity ?? 1)} × ${attendance.modalityName} — ${formatCurrency(attendance.amountCents)}`,
  );
}

function reconciliationMessage(group: ReconciliationPdfGroup, profile: UserProfile, template: string): string {
  let body = template;
  const tokens: Record<string, string> = {
    '{{local}}': group.workplace.name,
    '{{periodo}}': monthLabel(group.month),
    '{{quantidade}}': String(group.quantity),
    '{{valor}}': formatCurrency(group.totalCents),
    '{{detalhes}}': 'Consulte o detalhamento consolidado a seguir.',
    '{{medico}}': profile.name,
  };
  Object.entries(tokens).forEach(([token, value]) => {
    body = replaceAll(body, token, value);
  });
  return body;
}

async function prepareAttachments(group: ReconciliationPdfGroup): Promise<{ attachments: PreparedAttachment[]; omitted: number }> {
  const unique = new Map<string, Attendance>();
  group.attendances.forEach((attendance) => {
    if (attendance.evidenceUri && !unique.has(attendance.evidenceUri)) unique.set(attendance.evidenceUri, attendance);
  });
  const attachments: PreparedAttachment[] = [];
  let omitted = 0;
  for (const [uri, attendance] of unique) {
    try {
      let image = await manipulateAsync(uri, [], { compress: 0.72, format: SaveFormat.JPEG });
      if (Math.max(image.width, image.height) > 1400) {
        const scale = 1400 / Math.max(image.width, image.height);
        image = await manipulateAsync(image.uri, [{ resize: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) } }], {
          compress: 0.72,
          format: SaveFormat.JPEG,
        });
      }
      attachments.push({
        bytes: await new File(image.uri).bytes(),
        label: `${formatDate(attendance.occurredAt)} • ${attendance.modalityName}`,
      });
    } catch {
      omitted += 1;
    }
  }
  return { attachments, omitted };
}

function safeFileName(group: ReconciliationPdfGroup): string {
  const workplace = group.workplace.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'local';
  return `conciliacao-medrecebe-${workplace}-${group.month}.pdf`;
}

export async function createReconciliationPdf(
  group: ReconciliationPdfGroup,
  profile: UserProfile,
  messageTemplate: string,
): Promise<ReconciliationPdfResult> {
  const prepared = await prepareAttachments(group);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page, regular, bold, 'Solicitação de conciliação de repasses');
  let y = 724;

  const nextTextPage = (): void => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, regular, bold, 'Solicitação de conciliação de repasses — continuação');
    y = 724;
  };
  const addLines = (value: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; after?: number; lineHeight?: number } = {}): void => {
    const size = options.size ?? 10;
    const font = options.bold ? bold : regular;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const lines = wrapText(value, font, size, PAGE_WIDTH - MARGIN * 2);
    if (y - lines.length * lineHeight < FOOTER_TOP + 18) nextTextPage();
    lines.forEach((line) => {
      page.drawText(line, { x: MARGIN, y, size, font, color: options.color ?? rgb(0.067, 0.102, 0.169) });
      y -= lineHeight;
    });
    y -= options.after ?? 0;
  };
  const addSection = (value: string): void => {
    if (y - 31 < FOOTER_TOP + 18) nextTextPage();
    y -= 5;
    page.drawText(value.toUpperCase(), { x: MARGIN, y, size: 9, font: bold, color: rgb(0, 0.302, 0.714) });
    y -= 19;
  };

  addSection('Resumo da solicitação');
  addLines(`Local: ${group.workplace.name}`, { bold: true, size: 12, after: 3 });
  if (group.workplace.payerLegalName) addLines(`Razão Social do pagador: ${group.workplace.payerLegalName}`);
  if (group.workplace.payerCnpj) addLines(`CNPJ do pagador: ${formatCnpj(group.workplace.payerCnpj)}`);
  addLines(`Período: ${monthLabel(group.month)}`);
  addLines(`Médico solicitante: ${profile.name}`);
  addLines(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { after: 8 });
  addLines('VALOR CONTABILIZADO', { bold: true, size: 8, color: rgb(0.353, 0.392, 0.447) });
  addLines(formatCurrency(group.totalCents), { bold: true, size: 24, color: rgb(0, 0.302, 0.714), lineHeight: 31 });
  addLines(`${group.quantity} atendimentos • ${prepared.attachments.length} comprovantes incluídos`, { after: 8 });
  addSection('Mensagem de conferência');
  addLines(reconciliationMessage(group, profile, messageTemplate), { lineHeight: 15, after: 8 });
  addSection('Atendimentos consolidados');
  detailLines(group).forEach((line, index) => addLines(`${index + 1}. ${line}`, { size: 9, lineHeight: 13, after: 3 }));
  if (prepared.omitted) addLines(`${prepared.omitted} comprovante(s) não puderam ser incluídos. Confira os registros no MedRecebe.`, {
    bold: true,
    size: 9,
    color: rgb(0.722, 0.165, 0.204),
  });

  for (let index = 0; index < prepared.attachments.length; index += 1) {
    const attachment = prepared.attachments[index]!;
    const image = await pdf.embedJpg(attachment.bytes);
    const attachmentPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(attachmentPage, regular, bold, `Comprovante ${index + 1} de ${prepared.attachments.length}`);
    attachmentPage.drawText(pdfSafe(attachment.label), { x: MARGIN, y: 724, size: 10, font: bold, color: rgb(0.039, 0.122, 0.267) });
    const dimensions = image.scaleToFit(PAGE_WIDTH - MARGIN * 2, 642);
    attachmentPage.drawImage(image, {
      x: (PAGE_WIDTH - dimensions.width) / 2,
      y: FOOTER_TOP + 34 + (642 - dimensions.height) / 2,
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: MARGIN, y: FOOTER_TOP }, end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_TOP }, thickness: 0.6, color: rgb(0.851, 0.906, 0.973) });
    pdfPage.drawText('Documento de conferência financeira gerado pelo MedRecebe', { x: MARGIN, y: 25, size: 8, font: regular, color: rgb(0.353, 0.392, 0.447) });
    pdfPage.drawText(`${index + 1}/${pages.length}`, { x: PAGE_WIDTH - MARGIN - 20, y: 25, size: 8, font: bold, color: rgb(0.039, 0.122, 0.267) });
  });

  const fileName = safeFileName(group);
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  target.create({ intermediates: true });
  target.write(await pdf.save());
  return { uri: target.uri, fileName, omittedAttachments: prepared.omitted };
}
