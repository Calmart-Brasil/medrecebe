import Storage from 'expo-sqlite/kv-store';

import type { AppData, Attendance, PaymentModality, Workplace } from '../types';
import { addDays, calculateDueDate, toDateOnly } from '../services/paymentRules';

const DATA_KEY_PREFIX = 'cc.app-data.v1';

function dataKey(cpf: string): string {
  return `${DATA_KEY_PREFIX}.${cpf.replace(/\D/g, '')}`;
}

export const DEFAULT_RECONCILIATION_MESSAGE = `Olá,

Solicito, por gentileza, a conferência dos atendimentos relacionados abaixo, cujo pagamento estava previsto para o período informado e ainda não foi identificado.

Local: {{local}}
Período de crédito: {{periodo}}
Quantidade de atendimentos: {{quantidade}}
Valor total contabilizado: {{valor}}

{{detalhes}}

Os comprovantes disponíveis seguem anexos. Peço a confirmação do recebimento e a previsão de regularização.

Atenciosamente,
{{medico}}`;

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

export function createId(prefix: string): string {
  return id(prefix);
}

export function emptyData(): AppData {
  return {
    workplaces: [],
    attendances: [],
    invoices: [],
    reconciliation: { defaultMessage: DEFAULT_RECONCILIATION_MESSAGE },
    isDemoData: false,
  };
}

function createDemoData(): AppData {
  const clinicModalities: PaymentModality[] = [
    {
      id: 'mod-unimed-demo',
      name: 'Plano Saúde Mais',
      type: 'plan',
      amountCents: 18500,
      rule: { kind: 'calendar_days', days: 30 },
      active: true,
    },
    {
      id: 'mod-particular-demo',
      name: 'Consulta particular',
      type: 'private',
      amountCents: 42000,
      rule: { kind: 'immediate' },
      active: true,
    },
  ];
  const hospitalModalities: PaymentModality[] = [
    {
      id: 'mod-plantao-demo',
      name: 'Plantão clínico',
      type: 'private',
      amountCents: 98000,
      rule: { kind: 'first_business_day_next_month' },
      active: true,
    },
    {
      id: 'mod-procedimento-demo',
      name: 'Procedimento ambulatorial',
      type: 'plan',
      amountCents: 31500,
      rule: { kind: 'weekly', weekday: 5, weekOffset: 1 },
      active: true,
    },
  ];

  const workplaces: Workplace[] = [
    {
      id: 'work-clinica-demo',
      name: 'Clínica Horizonte',
      address: 'Av. Paulista, 1000 — São Paulo/SP',
      payerCnpj: '12345678000195',
      payerLegalName: 'Clínica Horizonte Serviços Médicos Ltda.',
      reconciliationEmail: 'financeiro@clinicahorizonte.exemplo',
      reconciliationCc: '',
      modalities: clinicModalities,
      active: true,
    },
    {
      id: 'work-hospital-demo',
      name: 'Hospital São Lucas',
      address: 'Rua das Flores, 240 — São Paulo/SP',
      payerCnpj: '11222333000181',
      payerLegalName: 'Hospital São Lucas S.A.',
      reconciliationEmail: 'repasses@saolucas.exemplo',
      reconciliationCc: '',
      modalities: hospitalModalities,
      active: true,
    },
  ];

  const today = new Date();
  const makeAttendance = (
    attendanceId: string,
    workplaceId: string,
    modality: PaymentModality,
    daysAgo: number,
  ): Attendance => {
    const occurredAt = toDateOnly(addDays(today, -daysAgo));
    return {
      id: attendanceId,
      workplaceId,
      modalityId: modality.id,
      modalityName: modality.name,
      occurredAt,
      dueAt: calculateDueDate(occurredAt, modality.rule),
      amountCents: modality.amountCents,
      evidenceUri: '',
      notes: 'Registro demonstrativo para o TestFlight.',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  };

  return {
    workplaces,
    attendances: [
      makeAttendance('att-demo-1', workplaces[0]!.id, clinicModalities[0]!, 42),
      makeAttendance('att-demo-2', workplaces[0]!.id, clinicModalities[0]!, 35),
      makeAttendance('att-demo-3', workplaces[1]!.id, hospitalModalities[0]!, 12),
      makeAttendance('att-demo-4', workplaces[1]!.id, hospitalModalities[1]!, 8),
    ],
    invoices: [],
    reconciliation: { defaultMessage: DEFAULT_RECONCILIATION_MESSAGE },
    isDemoData: true,
  };
}

export async function loadAppData(cpf: string, useDemoData: boolean): Promise<AppData> {
  const stored = await Storage.getItem(dataKey(cpf));
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as AppData;
      if (Array.isArray(parsed.workplaces) && Array.isArray(parsed.attendances)) {
        return {
          ...emptyData(),
          ...parsed,
          invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
          workplaces: parsed.workplaces.map((workplace) => ({
            ...workplace,
            payerCnpj: workplace.payerCnpj || '',
            payerLegalName: workplace.payerLegalName || '',
          })),
        };
      }
    } catch {
      // A base inválida é substituída por uma estrutura íntegra abaixo.
    }
  }
  const initial = useDemoData ? createDemoData() : emptyData();
  await saveAppData(cpf, initial);
  return initial;
}

export async function saveAppData(cpf: string, data: AppData): Promise<void> {
  await Storage.setItem(dataKey(cpf), JSON.stringify(data));
}

export async function clearAppData(cpf: string): Promise<void> {
  await Storage.removeItem(dataKey(cpf));
}
