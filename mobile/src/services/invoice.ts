import { File } from 'expo-file-system';
import { extractText, getDocumentProxy } from 'unpdf';

import type { AppData, InvoiceReconciliation, Workplace } from '../types';
import { isPastOrToday } from './paymentRules';

export interface InvoiceAnalysis {
  isInvoice: true;
  documentKind: 'nfse' | 'nfe' | 'unknown';
  fileName: string;
  cnpjs: string[];
  legalNames: string[];
  suggestedPayerCnpj: string;
  suggestedPayerLegalName: string;
  amountCents: number | null;
  invoiceNumber: string;
  issuedAt: string;
  rawNormalizedText: string;
}

export interface InvoiceSource {
  uri: string;
  fileName: string;
  mimeType?: string | null;
}

export function cnpjDigits(value = ''): string {
  return String(value).replace(/\D/g, '').slice(0, 14);
}

export function formatCnpj(value = ''): string {
  return cnpjDigits(value)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function isValidCnpj(value: string): boolean {
  const cnpj = cnpjDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calculate = (length: 12 | 13): number => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

function normalize(value = ''): string {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractCnpjs(text: string): string[] {
  const formatted = text.match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}\b/g) ?? [];
  const continuous = text.match(/\b\d{14}\b/g) ?? [];
  return unique([...formatted, ...continuous].map(cnpjDigits).filter(isValidCnpj));
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function parseMoney(value: string): number | null {
  const clean = value.replace(/\s/g, '').replace(/R\$/gi, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const amount = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function extractAmount(text: string): number | null {
  const value = firstMatch(text, [
    /(?:Valor\s+(?:L[ií]quido|Total|da\s+Nota|dos\s+Servi[cç]os)|Valor\s+NFS-?e)\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /<(?:[^:>]+:)?(?:ValorLiquidoNfse|ValorServicos|vLiq|vNF)\b[^>]*>([\d.]+)<\//i,
  ]);
  return value ? parseMoney(value) : null;
}

function extractLegalNames(text: string): string[] {
  const xml = [...text.matchAll(/<(?:[^:>]+:)?(?:xNome|RazaoSocial|NomeRazaoSocial)\b[^>]*>([^<]{3,160})<\//gi)].map((match) => match[1]?.trim() ?? '');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeled = lines.flatMap((line, index) => {
    const inline = /(?:Raz[aã]o Social|Nome\/Raz[aã]o Social)\s*:?\s*(.{3,140})$/i.exec(line)?.[1]?.trim();
    if (inline) return [inline];
    if (/^(?:Raz[aã]o Social|Nome\/Raz[aã]o Social)\s*:?$/i.test(line)) return [lines[index + 1] ?? ''];
    return [];
  });
  return unique([...xml, ...labeled].filter((name) => name.length >= 3)).slice(0, 12);
}

function extractIssuedAt(text: string): string {
  const raw = firstMatch(text, [
    /(?:Data\s+de\s+Emiss[aã]o|Emitida\s+em)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i,
    /<(?:[^:>]+:)?(?:DataEmissao|dhEmi)\b[^>]*>(\d{4}-\d{2}-\d{2})/i,
  ]);
  if (!raw) return '';
  if (/^\d{4}-/.test(raw)) return raw.slice(0, 10);
  const [day, month, year] = raw.split('/');
  return `${year}-${month}-${day}`;
}

function isRecognizedInvoice(text: string, isXml: boolean, evidence: {
  cnpjs: string[];
  amountCents: number | null;
  invoiceNumber: string;
  issuedAt: string;
}): boolean {
  const hasFiscalXmlStructure = /<(?:[^:>]+:)?(?:NFe|infNFe|nfeProc|CompNfse|Nfse|InfNfse|ListaNfse)\b/i.test(text);
  const hasFiscalLabel = /NOTA\s+FISCAL|NFS-?E|DANFE|DOCUMENTO\s+AUXILIAR\s+DA\s+NOTA\s+FISCAL/i.test(text);
  const hasVerification = /(?:CHAVE\s+DE\s+ACESSO|C[ÓO]DIGO\s+DE\s+VERIFICA[CÇ][ÃA]O)|\b\d{44}\b|<(?:[^:>]+:)?Signature\b/i.test(text);
  const fiscalSignals = [evidence.amountCents !== null, Boolean(evidence.invoiceNumber), Boolean(evidence.issuedAt), hasVerification].filter(Boolean).length;
  if (!evidence.cnpjs.length) return false;
  return isXml ? hasFiscalXmlStructure && fiscalSignals >= 1 : hasFiscalLabel && (Boolean(evidence.invoiceNumber) || hasVerification) && fiscalSignals >= 2;
}

function extractSuggestedPayer(text: string, cnpjs: string[], legalNames: string[]): { cnpj: string; legalName: string } {
  const partyText = firstMatch(text, [
    /<(?:[^:>]+:)?(?:emit|PrestadorServico|Prestador)\b[^>]*>([\s\S]{1,12000}?)<\/(?:[^:>]+:)?(?:emit|PrestadorServico|Prestador)>/i,
    /(?:PRESTADOR\s+(?:DE|DO)\s+SERVI[CÇ]O(?:S)?|EMITENTE)([\s\S]{1,1800})/i,
  ]);
  return {
    cnpj: extractCnpjs(partyText)[0] ?? cnpjs[0] ?? '',
    legalName: firstMatch(partyText, [
      /<(?:[^:>]+:)?(?:xNome|RazaoSocial|NomeRazaoSocial)\b[^>]*>([^<]{3,160})<\//i,
      /(?:Raz[aã]o\s+Social|Nome\/Raz[aã]o\s+Social)\s*:?\s*(.{3,140})$/im,
    ]) || legalNames[0] || '',
  };
}

export async function analyzeInvoiceSource(source: InvoiceSource): Promise<InvoiceAnalysis> {
  const extension = source.fileName.split('.').pop()?.toLowerCase();
  const isPdf = source.mimeType === 'application/pdf' || extension === 'pdf';
  const isXml = ['application/xml', 'text/xml'].includes(source.mimeType ?? '') || extension === 'xml';
  if (!isPdf && !isXml) throw new Error('Escolha uma Nota Fiscal em PDF ou XML.');
  const file = new File(source.uri);
  if (file.size > 5 * 1024 * 1024) throw new Error('Escolha um arquivo de até 5 MB.');
  let text = '';
  if (isPdf) {
    const bytes = await file.bytes();
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('O arquivo selecionado não é um PDF válido.');
    const pdf = await getDocumentProxy(bytes);
    text = (await extractText(pdf, { mergePages: true })).text;
  } else {
    text = await file.text();
    if (!text.replace(/^\uFEFF/, '').trimStart().startsWith('<')) throw new Error('O arquivo selecionado não é um XML válido.');
  }
  text = text.slice(0, 1_000_000);
  const normalized = normalize(text);
  if (normalized.length < 20) throw new Error('O arquivo não contém texto legível. Tente o XML ou o PDF digital da Nota Fiscal.');
  const cnpjs = extractCnpjs(text);
  const legalNames = extractLegalNames(text);
  const amountCents = extractAmount(text);
  const invoiceNumber = firstMatch(text, [
    /(?:N[uú]mero\s+da\s+Nota|N[uú]mero\s+da\s+NFS-?e|NFS-?e\s*(?:n[ºo.]|n[uú]mero))\s*:?\s*([A-Z0-9./-]{1,40})/i,
    /<(?:[^:>]+:)?(?:Numero|NumeroNfse|nNF)\b[^>]*>([^<]{1,40})<\//i,
  ]);
  const issuedAt = extractIssuedAt(text);
  if (!isRecognizedInvoice(text, isXml, { cnpjs, amountCents, invoiceNumber, issuedAt })) {
    throw new Error('O documento não foi reconhecido como Nota Fiscal. Selecione o PDF ou XML fiscal original.');
  }
  const suggestedPayer = extractSuggestedPayer(text, cnpjs, legalNames);
  return {
    isInvoice: true,
    documentKind: /<(?:[^:>]+:)?(?:CompNfse|Nfse|InfNfse|ListaNfse|DPS)\b|NFS-?E|NOTA\s+FISCAL\s+DE\s+SERVI[CÇ]OS/i.test(text) ? 'nfse' : /<(?:[^:>]+:)?(?:NFe|infNFe|nfeProc)\b|DANFE/i.test(text) ? 'nfe' : 'unknown',
    fileName: source.fileName,
    cnpjs,
    legalNames,
    suggestedPayerCnpj: suggestedPayer.cnpj,
    suggestedPayerLegalName: suggestedPayer.legalName.replace(/\s+/g, ' ').trim(),
    amountCents,
    invoiceNumber,
    issuedAt,
    rawNormalizedText: normalized,
  };
}

function payerMatches(workplace: Workplace, analysis: InvoiceAnalysis): boolean {
  const cnpj = cnpjDigits(workplace.payerCnpj);
  const legalName = normalize(workplace.payerLegalName);
  return isValidCnpj(cnpj) && legalName.length >= 6 && analysis.cnpjs.includes(cnpj) && analysis.rawNormalizedText.includes(legalName);
}

export function reconcileInvoice(analysis: InvoiceAnalysis, data: AppData): InvoiceReconciliation {
  const workplace = data.workplaces.find((item) => payerMatches(item, analysis));
  const groups = new Map<string, { id: string; totalCents: number }>();
  if (workplace) {
    data.attendances
      .filter((attendance) => attendance.workplaceId === workplace.id && attendance.status === 'pending' && isPastOrToday(attendance.dueAt))
      .forEach((attendance) => {
        const month = attendance.dueAt.slice(0, 7);
        const id = `${workplace.id}:${month}`;
        const current = groups.get(id) ?? { id, totalCents: 0 };
        current.totalCents += attendance.amountCents;
        groups.set(id, current);
      });
  }
  const candidates = [...groups.values()];
  const group = analysis.amountCents === null
    ? candidates[0]
    : candidates.sort((a, b) => Math.abs(a.totalCents - analysis.amountCents!) - Math.abs(b.totalCents - analysis.amountCents!))[0];
  const differenceCents = group && analysis.amountCents !== null ? analysis.amountCents - group.totalCents : null;
  const status = !workplace ? 'payer_not_matched' : !group ? 'group_not_found' : differenceCents === 0 ? 'matched' : 'divergent';
  return {
    id: `invoice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: analysis.fileName,
    invoiceNumber: analysis.invoiceNumber,
    issuedAt: analysis.issuedAt,
    amountCents: analysis.amountCents,
    cnpjs: analysis.cnpjs,
    legalNames: analysis.legalNames,
    suggestedPayerCnpj: analysis.suggestedPayerCnpj,
    suggestedPayerLegalName: analysis.suggestedPayerLegalName,
    workplaceId: workplace?.id ?? '',
    workplaceName: workplace?.name ?? '',
    groupId: group?.id ?? '',
    expectedCents: group?.totalCents ?? null,
    differenceCents,
    status,
    analyzedAt: new Date().toISOString(),
  };
}

export function reconcileStoredInvoiceWithWorkplace(
  invoice: InvoiceReconciliation,
  data: AppData,
  workplace: Workplace,
): InvoiceReconciliation {
  const groups = new Map<string, { id: string; totalCents: number }>();
  data.attendances
    .filter((attendance) => attendance.workplaceId === workplace.id && attendance.status === 'pending' && isPastOrToday(attendance.dueAt))
    .forEach((attendance) => {
      const month = attendance.dueAt.slice(0, 7);
      const id = `${workplace.id}:${month}`;
      const current = groups.get(id) ?? { id, totalCents: 0 };
      current.totalCents += attendance.amountCents;
      groups.set(id, current);
    });
  const candidates = [...groups.values()];
  const group = invoice.amountCents === null
    ? candidates[0]
    : candidates.sort((a, b) => Math.abs(a.totalCents - invoice.amountCents!) - Math.abs(b.totalCents - invoice.amountCents!))[0];
  const differenceCents = group && invoice.amountCents !== null ? invoice.amountCents - group.totalCents : null;
  return {
    ...invoice,
    workplaceId: workplace.id,
    workplaceName: workplace.name,
    groupId: group?.id ?? '',
    expectedCents: group?.totalCents ?? null,
    differenceCents,
    status: !group ? 'group_not_found' : differenceCents === 0 ? 'matched' : 'divergent',
    analyzedAt: new Date().toISOString(),
  };
}
