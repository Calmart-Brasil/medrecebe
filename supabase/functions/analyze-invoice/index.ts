import { extractText, getDocumentProxy } from 'npm:unpdf@1.6.2';

import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function digits(value = ''): string {
  return String(value).replace(/\D/g, '');
}

function isValidCnpj(value: string): boolean {
  const cnpj = digits(value);
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
  const formatted = text.match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}\b/g) || [];
  const continuous = text.match(/\b\d{14}\b/g) || [];
  return unique([...formatted, ...continuous].map(digits).filter(isValidCnpj));
}

function parseMoney(value: string): number | null {
  const clean = value.replace(/\s/g, '').replace(/R\$/gi, '');
  let normalized = clean;
  if (clean.includes(',')) normalized = clean.replace(/\./g, '').replace(',', '.');
  const amount = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function extractLegalNames(text: string): string[] {
  const xmlNames = [...text.matchAll(/<(?:[^:>]+:)?(?:xNome|RazaoSocial|NomeRazaoSocial)\b[^>]*>([^<]{3,160})<\//gi)].map((match) => match[1].trim());
  const lineNames = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index, lines) => {
      const inline = /(?:Raz[aã]o Social|Nome\/Raz[aã]o Social)\s*:?\s*(.{3,140})$/i.exec(line)?.[1]?.trim();
      if (inline) return [inline];
      if (/^(?:Raz[aã]o Social|Nome\/Raz[aã]o Social)\s*:?$/i.test(line)) return [lines[index + 1] || ''];
      return [];
    });
  return unique([...xmlNames, ...lineNames].map((name) => name.replace(/\s+/g, ' ').trim()).filter((name) => name.length >= 3)).slice(0, 12);
}

function extractAmountCents(text: string): number | null {
  const value = firstMatch(text, [
    /(?:Valor\s+(?:L[ií]quido|Total|da\s+Nota|dos\s+Servi[cç]os)|Valor\s+NFS-?e)\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /<(?:[^:>]+:)?(?:ValorLiquidoNfse|ValorServicos|vLiq|vNF)\b[^>]*>([\d.]+)<\//i,
  ]);
  return value ? parseMoney(value) : null;
}

function extractInvoiceNumber(text: string): string {
  return firstMatch(text, [
    /(?:N[uú]mero\s+da\s+Nota|N[uú]mero\s+da\s+NFS-?e|NFS-?e\s*(?:n[ºo.]|n[uú]mero))\s*:?\s*([A-Z0-9./-]{1,40})/i,
    /<(?:[^:>]+:)?(?:Numero|NumeroNfse|nNF)\b[^>]*>([^<]{1,40})<\//i,
  ]);
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

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
}

function hasXmlSignature(text: string): boolean {
  return text.replace(/^\uFEFF/, '').trimStart().startsWith('<');
}

function invoiceDocumentKind(text: string, isXml: boolean): 'nfse' | 'nfe' | 'unknown' {
  if (/<(?:[^:>]+:)?(?:CompNfse|Nfse|InfNfse|ListaNfse|DPS)\b/i.test(text) || /NFS-?E|NOTA\s+FISCAL\s+DE\s+SERVI[CÇ]OS/i.test(text)) return 'nfse';
  if (/<(?:[^:>]+:)?(?:NFe|infNFe|nfeProc)\b/i.test(text) || /DANFE|DOCUMENTO\s+AUXILIAR\s+DA\s+NOTA\s+FISCAL/i.test(text)) return 'nfe';
  return isXml ? 'unknown' : 'unknown';
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
  if (isXml) return hasFiscalXmlStructure && fiscalSignals >= 1;
  return hasFiscalLabel && (Boolean(evidence.invoiceNumber) || hasVerification) && fiscalSignals >= 2;
}

function extractSuggestedPayer(text: string, cnpjs: string[], legalNames: string[]): { cnpj: string; legalName: string } {
  const xmlParty = firstMatch(text, [
    /<(?:[^:>]+:)?(?:emit|PrestadorServico|Prestador)\b[^>]*>([\s\S]{1,12000}?)<\/(?:[^:>]+:)?(?:emit|PrestadorServico|Prestador)>/i,
  ]);
  const pdfParty = firstMatch(text, [
    /(?:PRESTADOR\s+(?:DE|DO)\s+SERVI[CÇ]O(?:S)?|EMITENTE)([\s\S]{1,1800})/i,
  ]);
  const partyText = xmlParty || pdfParty;
  const partyCnpj = extractCnpjs(partyText)[0] || cnpjs[0] || '';
  const partyName = firstMatch(partyText, [
    /<(?:[^:>]+:)?(?:xNome|RazaoSocial|NomeRazaoSocial)\b[^>]*>([^<]{3,160})<\//i,
    /(?:Raz[aã]o\s+Social|Nome\/Raz[aã]o\s+Social)\s*:?\s*(.{3,140})$/im,
  ]) || legalNames[0] || '';
  return { cnpj: partyCnpj, legalName: partyName.replace(/\s+/g, ' ').trim() };
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const admin = adminClient();
    const { data: profile } = await admin.from('profiles').select('role, access_status').eq('id', user.id).single();
    if (!profile || (profile.role !== 'admin' && profile.access_status !== 'active')) {
      return publicError(request, 'Conclua a contratação para usar a conciliação automática.', 403);
    }

    const body = await request.json();
    const fileName = String(body.fileName || 'nota-fiscal').slice(0, 180);
    const mimeType = String(body.mimeType || '').toLowerCase();
    const dataBase64 = String(body.dataBase64 || '');
    const estimatedBytes = Math.floor(dataBase64.length * 0.75);
    if (!dataBase64 || estimatedBytes > MAX_FILE_BYTES) return publicError(request, 'Escolha um arquivo de até 5 MB.');

    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    const isXml = ['text/xml', 'application/xml'].includes(mimeType) || fileName.toLowerCase().endsWith('.xml');
    if (!isPdf && !isXml) return publicError(request, 'Envie uma Nota Fiscal em PDF ou XML.');

    const bytes = decodeBase64(dataBase64);
    let text = '';
    if (isPdf) {
      if (!hasPdfSignature(bytes)) return publicError(request, 'O arquivo selecionado não é um PDF válido.', 422);
      const pdf = await getDocumentProxy(bytes);
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text;
    } else {
      text = new TextDecoder('utf-8').decode(bytes);
      if (!hasXmlSignature(text)) return publicError(request, 'O arquivo selecionado não é um XML válido.', 422);
    }
    text = text.slice(0, 1_000_000);
    if (normalize(text).length < 20) return publicError(request, 'O arquivo não contém texto legível. Tente o XML ou o PDF digital da Nota Fiscal.', 422);

    const cnpjs = extractCnpjs(text);
    const legalNames = extractLegalNames(text);
    const amountCents = extractAmountCents(text);
    const invoiceNumber = extractInvoiceNumber(text);
    const issuedAt = extractIssuedAt(text);
    if (!isRecognizedInvoice(text, isXml, { cnpjs, amountCents, invoiceNumber, issuedAt })) {
      return publicError(request, 'O documento não foi reconhecido como Nota Fiscal. Selecione o PDF ou XML fiscal original.', 422);
    }
    const suggestedPayer = extractSuggestedPayer(text, cnpjs, legalNames);
    const normalizedText = normalize(text);
    const payers = Array.isArray(body.payers) ? body.payers.slice(0, 100) : [];
    const matchedPayerIds = payers
      .filter((payer: Record<string, unknown>) => {
        const payerCnpj = digits(String(payer.cnpj || ''));
        const payerName = normalize(String(payer.legalName || ''));
        return isValidCnpj(payerCnpj) && payerName.length >= 6 && cnpjs.includes(payerCnpj) && normalizedText.includes(payerName);
      })
      .map((payer: Record<string, unknown>) => String(payer.id || ''))
      .filter(Boolean);

    return json(request, {
      isInvoice: true,
      documentKind: invoiceDocumentKind(text, isXml),
      fileName,
      mimeType: isPdf ? 'application/pdf' : 'application/xml',
      cnpjs,
      legalNames,
      suggestedPayerCnpj: suggestedPayer.cnpj,
      suggestedPayerLegalName: suggestedPayer.legalName,
      matchedPayerIds,
      amountCents,
      invoiceNumber,
      issuedAt,
    });
  } catch (error) {
    console.error('analyze-invoice', error);
    return publicError(request, 'Não foi possível ler esta Nota Fiscal. Tente novamente com o PDF ou XML original.', authenticationStatus(error, 500));
  }
});
