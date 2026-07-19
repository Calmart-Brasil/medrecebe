(function setupMedRecebePdf(global) {
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 42;
  const HEADER_BOTTOM = 752;
  const FOOTER_TOP = 42;

  const CP1252 = new Map([
    [0x2013, 0x96], [0x2014, 0x97], [0x2018, 0x91], [0x2019, 0x92],
    [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2026, 0x85],
    [0x20ac, 0x80], [0x2122, 0x99],
  ]);

  function bytesFromBinary(value) {
    const result = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) result[index] = value.charCodeAt(index) & 0xff;
    return result;
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  function pdfText(value) {
    let result = '';
    for (const character of String(value ?? '')) {
      const point = character.codePointAt(0);
      let code = CP1252.get(point);
      if (code === undefined) code = point <= 255 ? point : 0x3f;
      if (code < 32 && code !== 9) code = 0x20;
      const encoded = String.fromCharCode(code);
      result += encoded === '\\' || encoded === '(' || encoded === ')' ? `\\${encoded}` : encoded;
    }
    return result;
  }

  function streamObject(dictionary, stream) {
    return concatBytes([
      bytesFromBinary(`${dictionary} /Length ${stream.length} >>\nstream\n`),
      stream,
      bytesFromBinary('\nendstream'),
    ]);
  }

  function createDocument() {
    const objects = [null];
    const reserve = () => {
      objects.push(null);
      return objects.length - 1;
    };
    const add = (body) => {
      const id = reserve();
      objects[id] = typeof body === 'string' ? bytesFromBinary(body) : body;
      return id;
    };
    const set = (id, body) => {
      objects[id] = typeof body === 'string' ? bytesFromBinary(body) : body;
    };
    const build = (rootId) => {
      const parts = [bytesFromBinary('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
      const offsets = [0];
      let length = parts[0].length;
      for (let id = 1; id < objects.length; id += 1) {
        if (!objects[id]) throw new Error(`Objeto PDF ${id} ausente.`);
        offsets[id] = length;
        const object = concatBytes([
          bytesFromBinary(`${id} 0 obj\n`),
          objects[id],
          bytesFromBinary('\nendobj\n'),
        ]);
        parts.push(object);
        length += object.length;
      }
      const xrefOffset = length;
      const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n'];
      for (let id = 1; id < objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
      xref.push(`trailer\n<< /Size ${objects.length} /Root ${rootId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
      parts.push(bytesFromBinary(xref.join('')));
      return concatBytes(parts);
    };
    return { add, reserve, set, build };
  }

  function textCommand(value, x, y, size = 10, bold = false, color = '0.067 0.102 0.169') {
    return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(value)}) Tj ET\n`;
  }

  function wrapText(value, maxCharacters) {
    const paragraphs = String(value ?? '').replace(/\r/g, '').split('\n');
    const result = [];
    paragraphs.forEach((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        result.push('');
        return;
      }
      let line = '';
      words.forEach((word) => {
        if (word.length > maxCharacters) {
          if (line) result.push(line);
          for (let offset = 0; offset < word.length; offset += maxCharacters) result.push(word.slice(offset, offset + maxCharacters));
          line = '';
        } else if (!line || `${line} ${word}`.length <= maxCharacters) line = line ? `${line} ${word}` : word;
        else {
          result.push(line);
          line = word;
        }
      });
      if (line) result.push(line);
    });
    return result;
  }

  function headerCommands(subtitle) {
    return [
      'q 0.039 0.122 0.267 rg 0 752 595.28 89.89 re f Q\n',
      'q 0.169 0.714 0.451 rg 0 752 8 89.89 re f Q\n',
      textCommand('MedRecebe', MARGIN, 807, 19, true, '1 1 1'),
      textCommand(subtitle, MARGIN, 781, 10, false, '0.851 0.906 0.973'),
    ];
  }

  function footerCommands(page, total) {
    return [
      'q 0.851 0.906 0.973 RG 42 42 m 553.28 42 l S Q\n',
      textCommand('Documento de conferência financeira gerado pelo MedRecebe', MARGIN, 25, 8, false, '0.353 0.392 0.447'),
      textCommand(`${page}/${total}`, PAGE_WIDTH - MARGIN - 20, 25, 8, true, '0.039 0.122 0.267'),
    ];
  }

  function jpegDimensions(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('O comprovante precisa estar em JPEG para entrar no PDF.');
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0x01) continue;
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if (startOfFrame.has(marker)) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += length;
    }
    throw new Error('Não foi possível identificar as dimensões do comprovante.');
  }

  function build(input) {
    const pages = [];
    let commands = headerCommands('Solicitação de conciliação de repasses');
    let y = 724;

    const flushTextPage = () => {
      pages.push({ commands });
      commands = headerCommands('Solicitação de conciliação de repasses — continuação');
      y = 724;
    };
    const ensureSpace = (height) => {
      if (y - height < FOOTER_TOP + 18) flushTextPage();
    };
    const addLine = (value, options = {}) => {
      const size = options.size || 10;
      const lineHeight = options.lineHeight || size * 1.45;
      const lines = wrapText(value, options.maxCharacters || Math.max(24, Math.floor(94 * (10 / size))));
      ensureSpace(lines.length * lineHeight + (options.after || 0));
      lines.forEach((line) => {
        commands.push(textCommand(line, options.x || MARGIN, y, size, Boolean(options.bold), options.color));
        y -= lineHeight;
      });
      y -= options.after || 0;
    };
    const addSection = (value) => {
      ensureSpace(31);
      y -= 5;
      commands.push(textCommand(value.toUpperCase(), MARGIN, y, 9, true, '0 0.302 0.714'));
      y -= 19;
    };

    addSection('Resumo da solicitação');
    addLine(`Local: ${input.workplaceName || 'Não informado'}`, { bold: true, size: 12, after: 3 });
    if (input.payerLegalName) addLine(`Razão Social do pagador: ${input.payerLegalName}`);
    if (input.payerCnpj) addLine(`CNPJ do pagador: ${input.payerCnpj}`);
    addLine(`Período: ${input.period || 'Não informado'}`);
    addLine(`Médico solicitante: ${input.doctorName || 'Não informado'}`);
    addLine(`Gerado em: ${input.generatedAt || ''}`, { after: 8 });
    addLine('VALOR CONTABILIZADO', { size: 8, bold: true, color: '0.353 0.392 0.447' });
    addLine(input.total || 'R$ 0,00', { size: 24, bold: true, color: '0 0.302 0.714', lineHeight: 31 });
    addLine(`${input.quantity || 0} atendimentos • ${input.attachmentCount || 0} comprovantes incluídos`, { after: 8 });

    addSection('Mensagem de conferência');
    addLine(input.message || 'Solicito a conferência dos repasses relacionados abaixo.', { lineHeight: 15, after: 8 });

    addSection('Atendimentos consolidados');
    (input.details || []).forEach((detail, index) => {
      addLine(`${index + 1}. ${detail}`, { size: 9, lineHeight: 13, after: 3 });
    });
    if (!(input.details || []).length) addLine('Nenhum atendimento detalhado.', { size: 9 });
    if (input.omittedAttachments) {
      addLine(`${input.omittedAttachments} comprovante(s) não puderam ser incluídos. Confira os registros no MedRecebe.`, {
        size: 9,
        bold: true,
        color: '0.722 0.165 0.204',
        after: 4,
      });
    }
    pages.push({ commands });

    (input.attachments || []).forEach((attachment, index) => {
      const dimensions = attachment.width && attachment.height
        ? { width: attachment.width, height: attachment.height }
        : jpegDimensions(attachment.bytes);
      const maxWidth = PAGE_WIDTH - MARGIN * 2;
      const maxHeight = HEADER_BOTTOM - FOOTER_TOP - 88;
      const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1);
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      const x = (PAGE_WIDTH - width) / 2;
      const imageY = FOOTER_TOP + 34 + (maxHeight - height) / 2;
      pages.push({
        commands: [
          ...headerCommands(`Comprovante ${index + 1} de ${input.attachments.length}`),
          textCommand(attachment.label || `Comprovante ${index + 1}`, MARGIN, 724, 10, true, '0.039 0.122 0.267'),
          `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${imageY.toFixed(2)} cm /Im1 Do Q\n`,
        ],
        image: { bytes: attachment.bytes, ...dimensions },
      });
    });

    pages.forEach((page, index) => page.commands.push(...footerCommands(index + 1, pages.length)));

    const pdf = createDocument();
    const catalogId = pdf.reserve();
    const pagesId = pdf.reserve();
    const regularFontId = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const boldFontId = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds = pages.map(() => pdf.reserve());

    pages.forEach((page, index) => {
      let imageId = 0;
      if (page.image) {
        imageId = pdf.add(streamObject(
          `<< /Type /XObject /Subtype /Image /Width ${page.image.width} /Height ${page.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
          page.image.bytes,
        ));
      }
      const content = bytesFromBinary(page.commands.join(''));
      const contentId = pdf.add(streamObject('<<', content));
      const resources = `/Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : ''}`;
      pdf.set(pageIds[index], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`);
    });

    pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
    pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    return pdf.build(catalogId);
  }

  global.MedRecebePdf = Object.freeze({ build, jpegDimensions });
})(typeof window === 'undefined' ? globalThis : window);
