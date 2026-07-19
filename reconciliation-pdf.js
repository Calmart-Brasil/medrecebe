(function setupMedRecebePdf(global) {
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 42;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const HEADER_BOTTOM = 746;
  const FOOTER_TOP = 45;
  const SITE_URL = 'https://medrecebe.com.br';

  const COLORS = Object.freeze({
    navy: '0.039 0.122 0.267',
    blue: '0 0.302 0.714',
    sky: '0.337 0.627 0.910',
    green: '0.169 0.714 0.451',
    ice: '0.851 0.906 0.973',
    mist: '0.937 0.957 0.984',
    ink: '0.067 0.102 0.169',
    muted: '0.353 0.392 0.447',
    white: '1 1 1',
    danger: '0.722 0.165 0.204',
  });

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
          bytesFromBinary(`${id} 0 obj\n`), objects[id], bytesFromBinary('\nendobj\n'),
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

  function textCommand(value, x, y, size = 10, bold = false, color = COLORS.ink) {
    return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(value)}) Tj ET\n`;
  }

  function fillRect(x, y, width, height, color) {
    return `q ${color} rg ${x} ${y} ${width} ${height} re f Q\n`;
  }

  function wrapText(value, maxCharacters) {
    const result = [];
    String(value ?? '').replace(/\r/g, '').split('\n').forEach((paragraph) => {
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

  function truncate(value, maxCharacters) {
    const text = String(value ?? '');
    return text.length > maxCharacters ? `${text.slice(0, Math.max(1, maxCharacters - 1))}…` : text;
  }

  function headerCommands(label) {
    return [
      fillRect(0, HEADER_BOTTOM, PAGE_WIDTH, PAGE_HEIGHT - HEADER_BOTTOM, COLORS.navy),
      fillRect(0, HEADER_BOTTOM, 8, PAGE_HEIGHT - HEADER_BOTTOM, COLORS.green),
      textCommand('MedRecebe', MARGIN, 807, 20, true, COLORS.white),
      textCommand('Gestão de recebíveis médicos', MARGIN, 786, 9, false, COLORS.ice),
      textCommand(label.toUpperCase(), 344, 807, 8, true, COLORS.sky),
      textCommand('medrecebe.com.br', 419, 786, 9, true, COLORS.white),
    ];
  }

  function footerCommands(page, total, generatedAt) {
    return [
      `q ${COLORS.ice} RG ${MARGIN} ${FOOTER_TOP} m ${PAGE_WIDTH - MARGIN} ${FOOTER_TOP} l S Q\n`,
      textCommand('medrecebe.com.br', MARGIN, 26, 8, true, COLORS.blue),
      textCommand(`Gerado em ${generatedAt || ''}`, 212, 26, 7.5, false, COLORS.muted),
      textCommand(`Página ${page} de ${total}`, PAGE_WIDTH - MARGIN - 58, 26, 8, true, COLORS.navy),
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
        return { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
      }
      offset += length;
    }
    throw new Error('Não foi possível identificar as dimensões do comprovante.');
  }

  function build(input) {
    const pages = [];
    let commands = headerCommands('Conciliação de repasses');
    let y = 714;

    const flushTextPage = (continuationLabel = 'Conciliação de repasses • continuação') => {
      pages.push({ commands });
      commands = headerCommands(continuationLabel);
      y = 714;
    };
    const ensureSpace = (height, continuationSection) => {
      if (y - height < FOOTER_TOP + 20) {
        flushTextPage();
        if (continuationSection) {
          commands.push(textCommand(continuationSection.toUpperCase(), MARGIN, y, 9, true, COLORS.blue));
          y -= 22;
        }
      }
    };
    const addWrapped = (value, options = {}) => {
      const size = options.size || 10;
      const lineHeight = options.lineHeight || size * 1.45;
      const lines = wrapText(value, options.maxCharacters || Math.max(25, Math.floor(96 * (10 / size))));
      ensureSpace(lines.length * lineHeight + (options.after || 0), options.continuationSection);
      lines.forEach((line) => {
        commands.push(textCommand(line, options.x ?? MARGIN, y, size, Boolean(options.bold), options.color || COLORS.ink));
        y -= lineHeight;
      });
      y -= options.after || 0;
    };
    const addSection = (title, subtitle = '') => {
      ensureSpace(subtitle ? 43 : 29);
      y -= 4;
      commands.push(textCommand(title.toUpperCase(), MARGIN, y, 9, true, COLORS.blue));
      y -= 18;
      if (subtitle) {
        commands.push(textCommand(subtitle, MARGIN, y, 8.5, false, COLORS.muted));
        y -= 18;
      }
    };

    commands.push(textCommand('Solicitação de conferência financeira', MARGIN, y, 22, true, COLORS.navy));
    y -= 27;
    commands.push(textCommand('Documento consolidado para validação dos repasses médicos contabilizados.', MARGIN, y, 9.5, false, COLORS.muted));
    y -= 24;

    const payerBoxHeight = 104;
    commands.push(fillRect(MARGIN, y - payerBoxHeight, CONTENT_WIDTH, payerBoxHeight, COLORS.mist));
    commands.push(textCommand('PAGADOR E PERÍODO', MARGIN + 16, y - 20, 8, true, COLORS.blue));
    commands.push(textCommand(truncate(input.workplaceName || 'Local não informado', 52), MARGIN + 16, y - 41, 13, true, COLORS.navy));
    commands.push(textCommand(truncate(input.payerLegalName || 'Razão Social não informada', 66), MARGIN + 16, y - 59, 9, false, COLORS.ink));
    commands.push(textCommand(`CNPJ: ${input.payerCnpj || 'não informado'}`, MARGIN + 16, y - 79, 8.5, false, COLORS.muted));
    commands.push(textCommand(`Período: ${input.period || 'não informado'}`, MARGIN + 274, y - 79, 8.5, true, COLORS.navy));
    commands.push(textCommand(`Solicitante: ${truncate(input.doctorName || 'não informado', 34)}`, MARGIN + 274, y - 59, 8.5, false, COLORS.ink));
    y -= payerBoxHeight + 13;

    const totalBoxHeight = 70;
    commands.push(fillRect(MARGIN, y - totalBoxHeight, CONTENT_WIDTH, totalBoxHeight, COLORS.navy));
    commands.push(textCommand('VALOR CONTABILIZADO', MARGIN + 16, y - 19, 8, true, COLORS.sky));
    commands.push(textCommand(input.total || 'R$ 0,00', MARGIN + 16, y - 49, 24, true, COLORS.white));
    commands.push(textCommand('VOLUME DO PERÍODO', MARGIN + 322, y - 19, 8, true, COLORS.sky));
    commands.push(textCommand(`${input.quantity || 0} atendimentos`, MARGIN + 322, y - 43, 14, true, COLORS.white));
    commands.push(textCommand(`${input.attachmentCount || 0} comprovantes anexados`, MARGIN + 322, y - 58, 8, false, COLORS.ice));
    y -= totalBoxHeight + 13;

    addSection('Objetivo da solicitação');
    addWrapped(input.message || 'Solicito a conferência dos repasses descritos neste documento.', { size: 9.5, lineHeight: 14, after: 10 });

    addSection('Resumo financeiro por modalidade');
    const summaryRows = input.modalitySummaries || [];
    ensureSpace(25 + Math.max(1, summaryRows.length) * 22, 'Resumo financeiro por modalidade');
    commands.push(fillRect(MARGIN, y - 20, CONTENT_WIDTH, 20, COLORS.ice));
    commands.push(textCommand('MODALIDADE', MARGIN + 9, y - 14, 7.5, true, COLORS.navy));
    commands.push(textCommand('QTD.', 410, y - 14, 7.5, true, COLORS.navy));
    commands.push(textCommand('VALOR', 480, y - 14, 7.5, true, COLORS.navy));
    y -= 25;
    (summaryRows.length ? summaryRows : [{ modality: 'Sem detalhamento', quantity: 0, amount: 'R$ 0,00' }]).forEach((row) => {
      ensureSpace(23, 'Resumo financeiro por modalidade');
      commands.push(textCommand(truncate(row.modality, 52), MARGIN + 9, y - 13, 8.5, true, COLORS.ink));
      commands.push(textCommand(String(row.quantity), 410, y - 13, 8.5, false, COLORS.ink));
      commands.push(textCommand(row.amount, 480, y - 13, 8.5, true, COLORS.blue));
      commands.push(`q ${COLORS.ice} RG ${MARGIN} ${y - 20} m ${PAGE_WIDTH - MARGIN} ${y - 20} l S Q\n`);
      y -= 23;
    });
    y -= 8;

    addSection('Detalhamento dos registros', 'Datas, modalidades, vencimentos previstos e valores registrados no MedRecebe.');
    const rows = input.detailRows || [];
    const drawDetailHeader = () => {
      commands.push(fillRect(MARGIN, y - 21, CONTENT_WIDTH, 21, COLORS.ice));
      commands.push(textCommand('DATA', MARGIN + 8, y - 14, 7, true, COLORS.navy));
      commands.push(textCommand('MODALIDADE', 108, y - 14, 7, true, COLORS.navy));
      commands.push(textCommand('QTD.', 340, y - 14, 7, true, COLORS.navy));
      commands.push(textCommand('VENCIMENTO', 387, y - 14, 7, true, COLORS.navy));
      commands.push(textCommand('VALOR', 492, y - 14, 7, true, COLORS.navy));
      y -= 26;
    };
    ensureSpace(48, 'Detalhamento dos registros');
    drawDetailHeader();
    (rows.length ? rows : [{ date: '-', modality: 'Nenhum registro detalhado', quantity: '-', dueDate: '-', amount: '-' }]).forEach((row) => {
      if (y - 24 < FOOTER_TOP + 20) {
        flushTextPage();
        commands.push(textCommand('DETALHAMENTO DOS REGISTROS • CONTINUAÇÃO', MARGIN, y, 9, true, COLORS.blue));
        y -= 22;
        drawDetailHeader();
      }
      commands.push(textCommand(row.date || '-', MARGIN + 8, y - 14, 8, false, COLORS.ink));
      commands.push(textCommand(truncate(row.modality || '-', 38), 108, y - 14, 8, false, COLORS.ink));
      commands.push(textCommand(String(row.quantity ?? '-'), 340, y - 14, 8, false, COLORS.ink));
      commands.push(textCommand(row.dueDate || '-', 387, y - 14, 8, false, COLORS.ink));
      commands.push(textCommand(row.amount || '-', 492, y - 14, 8, true, COLORS.navy));
      commands.push(`q ${COLORS.ice} RG ${MARGIN} ${y - 21} m ${PAGE_WIDTH - MARGIN} ${y - 21} l S Q\n`);
      y -= 24;
    });

    if (input.omittedAttachments) {
      addWrapped(`${input.omittedAttachments} comprovante(s) não puderam ser incluídos. Revise os anexos no MedRecebe.`, {
        size: 8.5, bold: true, color: COLORS.danger, after: 3,
      });
    }
    pages.push({ commands });

    (input.attachments || []).forEach((attachment, index) => {
      const dimensions = attachment.width && attachment.height
        ? { width: attachment.width, height: attachment.height }
        : jpegDimensions(attachment.bytes);
      const maxWidth = CONTENT_WIDTH - 20;
      const maxHeight = 592;
      const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1);
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      const x = (PAGE_WIDTH - width) / 2;
      const imageY = 82 + (maxHeight - height) / 2;
      pages.push({
        commands: [
          ...headerCommands('Documento comprobatório'),
          textCommand(`Comprovante ${index + 1} de ${input.attachments.length}`, MARGIN, 714, 17, true, COLORS.navy),
          textCommand(truncate(attachment.label || `Comprovante ${index + 1}`, 76), MARGIN, 692, 9, false, COLORS.muted),
          fillRect(MARGIN, 72, CONTENT_WIDTH, 608, COLORS.mist),
          `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${imageY.toFixed(2)} cm /Im1 Do Q\n`,
        ],
        image: { bytes: attachment.bytes, ...dimensions },
      });
    });

    pages.forEach((page, index) => page.commands.push(...footerCommands(index + 1, pages.length, input.generatedAt)));

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
      const contentId = pdf.add(streamObject('<<', bytesFromBinary(page.commands.join(''))));
      const linkId = pdf.add(`<< /Type /Annot /Subtype /Link /Rect [${MARGIN} 17 155 38] /Border [0 0 0] /A << /S /URI /URI (${SITE_URL}) >> >>`);
      const resources = `/Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : ''}`;
      pdf.set(pageIds[index], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << ${resources} >> /Contents ${contentId} 0 R /Annots [${linkId} 0 R] >>`);
    });

    pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
    pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    return pdf.build(catalogId);
  }

  global.MedRecebePdf = Object.freeze({ build, jpegDimensions });
})(typeof window === 'undefined' ? globalThis : window);
