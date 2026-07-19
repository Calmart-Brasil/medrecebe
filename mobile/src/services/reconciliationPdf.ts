import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { PDFDocument, PDFFont, PDFName, PDFPage, PDFString, StandardFonts, rgb } from 'pdf-lib';

import type { Attendance, UserProfile, Workplace } from '../types';
import { formatCurrency, formatDate } from './paymentRules';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const FOOTER_TOP = 42;
const SITE_URL = 'https://medrecebe.com.br';

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
  page.drawRectangle({ x: 0, y: 746, width: PAGE_WIDTH, height: PAGE_HEIGHT - 746, color: rgb(0.039, 0.122, 0.267) });
  page.drawRectangle({ x: 0, y: 746, width: 8, height: PAGE_HEIGHT - 746, color: rgb(0.169, 0.714, 0.451) });
  page.drawText('MedRecebe', { x: MARGIN, y: 807, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Gestão de recebíveis médicos', { x: MARGIN, y: 786, size: 9, font: regular, color: rgb(0.851, 0.906, 0.973) });
  page.drawText(pdfSafe(subtitle.toUpperCase()), { x: 344, y: 807, size: 8, font: bold, color: rgb(0.337, 0.627, 0.91) });
  page.drawText('medrecebe.com.br', { x: 419, y: 786, size: 9, font: bold, color: rgb(1, 1, 1) });
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
  drawHeader(page, regular, bold, 'Conciliação de repasses');
  let y = 714;
  const ink = rgb(0.067, 0.102, 0.169);
  const navy = rgb(0.039, 0.122, 0.267);
  const blue = rgb(0, 0.302, 0.714);
  const sky = rgb(0.337, 0.627, 0.91);
  const ice = rgb(0.851, 0.906, 0.973);
  const mist = rgb(0.937, 0.957, 0.984);
  const muted = rgb(0.353, 0.392, 0.447);
  const short = (value: string, length: number): string => pdfSafe(value).length > length ? `${pdfSafe(value).slice(0, length - 1)}…` : pdfSafe(value);

  const nextTextPage = (): void => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, regular, bold, 'Conciliação de repasses • continuação');
    y = 714;
  };
  const ensureSpace = (height: number): void => {
    if (y - height < FOOTER_TOP + 18) nextTextPage();
  };
  const addLines = (value: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; after?: number; lineHeight?: number } = {}): void => {
    const size = options.size ?? 10;
    const font = options.bold ? bold : regular;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const lines = wrapText(value, font, size, PAGE_WIDTH - MARGIN * 2);
    ensureSpace(lines.length * lineHeight + (options.after ?? 0));
    lines.forEach((line) => {
      page.drawText(line, { x: MARGIN, y, size, font, color: options.color ?? ink });
      y -= lineHeight;
    });
    y -= options.after ?? 0;
  };
  const addSection = (value: string, subtitle = ''): void => {
    ensureSpace(subtitle ? 43 : 29);
    y -= 4;
    page.drawText(value.toUpperCase(), { x: MARGIN, y, size: 9, font: bold, color: blue });
    y -= 18;
    if (subtitle) {
      page.drawText(pdfSafe(subtitle), { x: MARGIN, y, size: 8.5, font: regular, color: muted });
      y -= 18;
    }
  };

  page.drawText('Solicitação de conferência financeira', { x: MARGIN, y, size: 22, font: bold, color: navy });
  y -= 27;
  page.drawText('Documento consolidado para validação dos repasses médicos contabilizados.', { x: MARGIN, y, size: 9.5, font: regular, color: muted });
  y -= 24;

  page.drawRectangle({ x: MARGIN, y: y - 104, width: PAGE_WIDTH - MARGIN * 2, height: 104, color: mist });
  page.drawText('PAGADOR E PERÍODO', { x: MARGIN + 16, y: y - 20, size: 8, font: bold, color: blue });
  page.drawText(short(group.workplace.name, 52), { x: MARGIN + 16, y: y - 41, size: 13, font: bold, color: navy });
  page.drawText(short(group.workplace.payerLegalName || 'Razão Social não informada', 66), { x: MARGIN + 16, y: y - 59, size: 9, font: regular, color: ink });
  page.drawText(`CNPJ: ${group.workplace.payerCnpj ? formatCnpj(group.workplace.payerCnpj) : 'não informado'}`, { x: MARGIN + 16, y: y - 79, size: 8.5, font: regular, color: muted });
  page.drawText(`Solicitante: ${short(profile.name, 34)}`, { x: MARGIN + 274, y: y - 59, size: 8.5, font: regular, color: ink });
  page.drawText(`Período: ${monthLabel(group.month)}`, { x: MARGIN + 274, y: y - 79, size: 8.5, font: bold, color: navy });
  y -= 117;

  page.drawRectangle({ x: MARGIN, y: y - 70, width: PAGE_WIDTH - MARGIN * 2, height: 70, color: navy });
  page.drawText('VALOR CONTABILIZADO', { x: MARGIN + 16, y: y - 19, size: 8, font: bold, color: sky });
  page.drawText(formatCurrency(group.totalCents), { x: MARGIN + 16, y: y - 49, size: 24, font: bold, color: rgb(1, 1, 1) });
  page.drawText('VOLUME DO PERÍODO', { x: MARGIN + 322, y: y - 19, size: 8, font: bold, color: sky });
  page.drawText(`${group.quantity} atendimentos`, { x: MARGIN + 322, y: y - 43, size: 14, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`${prepared.attachments.length} comprovantes anexados`, { x: MARGIN + 322, y: y - 58, size: 8, font: regular, color: ice });
  y -= 83;

  addSection('Objetivo da solicitação');
  addLines(reconciliationMessage(group, profile, messageTemplate), { size: 9.5, lineHeight: 14, after: 10 });

  const summaries = new Map<string, { quantity: number; amountCents: number }>();
  group.attendances.forEach((attendance) => {
    const current = summaries.get(attendance.modalityName) ?? { quantity: 0, amountCents: 0 };
    current.quantity += Math.max(1, attendance.quantity ?? 1);
    current.amountCents += attendance.amountCents;
    summaries.set(attendance.modalityName, current);
  });
  addSection('Resumo financeiro por modalidade');
  ensureSpace(25 + summaries.size * 23);
  page.drawRectangle({ x: MARGIN, y: y - 20, width: PAGE_WIDTH - MARGIN * 2, height: 20, color: ice });
  page.drawText('MODALIDADE', { x: MARGIN + 9, y: y - 14, size: 7.5, font: bold, color: navy });
  page.drawText('QTD.', { x: 410, y: y - 14, size: 7.5, font: bold, color: navy });
  page.drawText('VALOR', { x: 480, y: y - 14, size: 7.5, font: bold, color: navy });
  y -= 25;
  summaries.forEach((summary, modality) => {
    page.drawText(short(modality, 52), { x: MARGIN + 9, y: y - 13, size: 8.5, font: bold, color: ink });
    page.drawText(String(summary.quantity), { x: 410, y: y - 13, size: 8.5, font: regular, color: ink });
    page.drawText(formatCurrency(summary.amountCents), { x: 480, y: y - 13, size: 8.5, font: bold, color: blue });
    page.drawLine({ start: { x: MARGIN, y: y - 20 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 20 }, thickness: 0.5, color: ice });
    y -= 23;
  });
  y -= 8;

  const drawDetailHeader = (): void => {
    page.drawRectangle({ x: MARGIN, y: y - 21, width: PAGE_WIDTH - MARGIN * 2, height: 21, color: ice });
    page.drawText('DATA', { x: MARGIN + 8, y: y - 14, size: 7, font: bold, color: navy });
    page.drawText('MODALIDADE', { x: 108, y: y - 14, size: 7, font: bold, color: navy });
    page.drawText('QTD.', { x: 340, y: y - 14, size: 7, font: bold, color: navy });
    page.drawText('VENCIMENTO', { x: 387, y: y - 14, size: 7, font: bold, color: navy });
    page.drawText('VALOR', { x: 492, y: y - 14, size: 7, font: bold, color: navy });
    y -= 26;
  };
  addSection('Detalhamento dos registros', 'Datas, modalidades, vencimentos previstos e valores registrados no MedRecebe.');
  ensureSpace(48);
  drawDetailHeader();
  group.attendances.forEach((attendance) => {
    if (y - 24 < FOOTER_TOP + 18) {
      nextTextPage();
      page.drawText('DETALHAMENTO DOS REGISTROS • CONTINUAÇÃO', { x: MARGIN, y, size: 9, font: bold, color: blue });
      y -= 22;
      drawDetailHeader();
    }
    page.drawText(formatDate(attendance.occurredAt), { x: MARGIN + 8, y: y - 14, size: 8, font: regular, color: ink });
    page.drawText(short(attendance.modalityName, 38), { x: 108, y: y - 14, size: 8, font: regular, color: ink });
    page.drawText(String(Math.max(1, attendance.quantity ?? 1)), { x: 340, y: y - 14, size: 8, font: regular, color: ink });
    page.drawText(formatDate(attendance.dueAt), { x: 387, y: y - 14, size: 8, font: regular, color: ink });
    page.drawText(formatCurrency(attendance.amountCents), { x: 492, y: y - 14, size: 8, font: bold, color: navy });
    page.drawLine({ start: { x: MARGIN, y: y - 21 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 21 }, thickness: 0.5, color: ice });
    y -= 24;
  });
  if (prepared.omitted) addLines(`${prepared.omitted} comprovante(s) não puderam ser incluídos. Revise os anexos no MedRecebe.`, { bold: true, size: 8.5, color: rgb(0.722, 0.165, 0.204) });

  for (let index = 0; index < prepared.attachments.length; index += 1) {
    const attachment = prepared.attachments[index]!;
    const image = await pdf.embedJpg(attachment.bytes);
    const attachmentPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(attachmentPage, regular, bold, 'Documento comprobatório');
    attachmentPage.drawText(`Comprovante ${index + 1} de ${prepared.attachments.length}`, { x: MARGIN, y: 714, size: 17, font: bold, color: navy });
    attachmentPage.drawText(short(attachment.label, 76), { x: MARGIN, y: 692, size: 9, font: regular, color: muted });
    attachmentPage.drawRectangle({ x: MARGIN, y: 72, width: PAGE_WIDTH - MARGIN * 2, height: 608, color: mist });
    const dimensions = image.scaleToFit(PAGE_WIDTH - MARGIN * 2 - 20, 592);
    attachmentPage.drawImage(image, {
      x: (PAGE_WIDTH - dimensions.width) / 2,
      y: 82 + (592 - dimensions.height) / 2,
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  const pages = pdf.getPages();
  const generatedAt = new Date().toLocaleString('pt-BR');
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: MARGIN, y: FOOTER_TOP }, end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_TOP }, thickness: 0.6, color: rgb(0.851, 0.906, 0.973) });
    pdfPage.drawText('medrecebe.com.br', { x: MARGIN, y: 25, size: 8, font: bold, color: blue });
    pdfPage.drawText(`Gerado em ${generatedAt}`, { x: 212, y: 25, size: 7.5, font: regular, color: muted });
    pdfPage.drawText(`Página ${index + 1} de ${pages.length}`, { x: PAGE_WIDTH - MARGIN - 58, y: 25, size: 8, font: bold, color: navy });
    const link = pdf.context.register(pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [MARGIN, 17, 155, 38],
      Border: [0, 0, 0],
      A: { S: 'URI', URI: PDFString.of(SITE_URL) },
    }));
    pdfPage.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
  });

  const fileName = safeFileName(group);
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  target.create({ intermediates: true });
  target.write(await pdf.save());
  return { uri: target.uri, fileName, omittedAttachments: prepared.omitted };
}
