export const MEDICAL_SPECIALTIES = [
  ['acupuntura', 'Acupuntura'], ['alergia-imunologia', 'Alergia e imunologia'], ['anestesiologia', 'Anestesiologia'],
  ['angiologia', 'Angiologia'], ['cardiologia', 'Cardiologia'], ['cirurgia-cardiovascular', 'Cirurgia cardiovascular'],
  ['cirurgia-mao', 'Cirurgia da mão'], ['cirurgia-cabeca-pescoco', 'Cirurgia de cabeça e pescoço'],
  ['cirurgia-aparelho-digestivo', 'Cirurgia do aparelho digestivo'], ['cirurgia-geral', 'Cirurgia geral'],
  ['cirurgia-oncologica', 'Cirurgia oncológica'], ['cirurgia-pediatrica', 'Cirurgia pediátrica'],
  ['cirurgia-plastica', 'Cirurgia plástica'], ['cirurgia-toracica', 'Cirurgia torácica'],
  ['cirurgia-vascular', 'Cirurgia vascular'], ['clinica-medica', 'Clínica médica'], ['coloproctologia', 'Coloproctologia'],
  ['dermatologia', 'Dermatologia'], ['endocrinologia-metabologia', 'Endocrinologia e metabologia'],
  ['endoscopia', 'Endoscopia'], ['gastroenterologia', 'Gastroenterologia'], ['genetica-medica', 'Genética médica'],
  ['geriatria', 'Geriatria'], ['ginecologia-obstetricia', 'Ginecologia e obstetrícia'],
  ['hematologia-hemoterapia', 'Hematologia e hemoterapia'], ['homeopatia', 'Homeopatia'],
  ['infectologia', 'Infectologia'], ['mastologia', 'Mastologia'], ['medicina-emergencia', 'Medicina de emergência'],
  ['medicina-familia-comunidade', 'Medicina de família e comunidade'], ['medicina-trabalho', 'Medicina do trabalho'],
  ['medicina-trafego', 'Medicina do tráfego'], ['medicina-esportiva', 'Medicina esportiva'],
  ['medicina-fisica-reabilitacao', 'Medicina física e reabilitação'], ['medicina-intensiva', 'Medicina intensiva'],
  ['medicina-legal-pericia', 'Medicina legal e perícia médica'], ['medicina-nuclear', 'Medicina nuclear'],
  ['medicina-preventiva-social', 'Medicina preventiva e social'], ['nefrologia', 'Nefrologia'],
  ['neurocirurgia', 'Neurocirurgia'], ['neurologia', 'Neurologia'], ['nutrologia', 'Nutrologia'],
  ['oftalmologia', 'Oftalmologia'], ['oncologia-clinica', 'Oncologia clínica'],
  ['ortopedia-traumatologia', 'Ortopedia e traumatologia'], ['otorrinolaringologia', 'Otorrinolaringologia'],
  ['patologia', 'Patologia'], ['patologia-clinica-medicina-laboratorial', 'Patologia clínica/medicina laboratorial'],
  ['pediatria', 'Pediatria'], ['pneumologia', 'Pneumologia'], ['psiquiatria', 'Psiquiatria'],
  ['radiologia-diagnostico-imagem', 'Radiologia e diagnóstico por imagem'], ['radioterapia', 'Radioterapia'],
  ['reumatologia', 'Reumatologia'], ['urologia', 'Urologia'],
] as const;

export const SPECIALTY_BY_CODE = new Map<string, string>(MEDICAL_SPECIALTIES);

export function normalizeSpecialties(input: unknown): Array<{ code: string; name: string; rqeNumber: string }> {
  if (!Array.isArray(input)) return [];
  const unique = new Map<string, { code: string; name: string; rqeNumber: string }>();
  input.slice(0, 12).forEach((item) => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const code = String(source.code || '').trim().toLowerCase();
    const name = SPECIALTY_BY_CODE.get(code);
    const rqeNumber = String(source.rqeNumber || '').replace(/\D/g, '').slice(0, 12);
    if (name && !unique.has(code)) unique.set(code, { code, name, rqeNumber });
  });
  return [...unique.values()];
}
