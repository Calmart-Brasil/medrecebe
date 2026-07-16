import type {
  BusinessDayAdjustment,
  CustomRuleBasis,
  CustomRuleUnit,
  PaymentRule,
} from '../types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function localDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  }

  const datePart = value.slice(0, 10);
  if (DATE_ONLY.test(datePart)) {
    const [year, month, day] = datePart.split('-').map(Number);
    return new Date(year!, month! - 1, day, 12);
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12);
}

export function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const result = localDate(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const originalDay = date.getDate();
  const result = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0, 12).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function isBusinessDay(date: Date): boolean {
  return date.getDay() !== 0 && date.getDay() !== 6;
}

function nextBusinessDay(date: Date): Date {
  let result = localDate(date);
  while (!isBusinessDay(result)) result = addDays(result, 1);
  return result;
}

function previousBusinessDay(date: Date): Date {
  let result = localDate(date);
  while (!isBusinessDay(result)) result = addDays(result, -1);
  return result;
}

function firstBusinessDayOfMonth(date: Date): Date {
  return nextBusinessDay(new Date(date.getFullYear(), date.getMonth(), 1, 12));
}

function lastBusinessDayOfMonth(date: Date): Date {
  return previousBusinessDay(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
}

function applyAdjustment(date: Date, adjustment: BusinessDayAdjustment): Date {
  switch (adjustment) {
    case 'next_business_day':
      return nextBusinessDay(date);
    case 'previous_business_day':
      return previousBusinessDay(date);
    case 'first_business_day':
      return firstBusinessDayOfMonth(date);
    case 'last_business_day':
      return lastBusinessDayOfMonth(date);
    case 'none':
    default:
      return date;
  }
}

function customBase(date: Date, basis: CustomRuleBasis): Date {
  if (basis === 'end_of_week') {
    return addDays(date, (7 - date.getDay()) % 7);
  }
  if (basis === 'end_of_month') {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  }
  return date;
}

function applyOffset(date: Date, offset: number, unit: CustomRuleUnit): Date {
  if (unit === 'weeks') return addDays(date, offset * 7);
  if (unit === 'months') return addMonths(date, offset);
  return addDays(date, offset);
}

export function calculateDueDate(serviceDate: Date | string, rule: PaymentRule): string {
  const date = localDate(serviceDate);
  let due: Date;

  switch (rule.kind) {
    case 'immediate':
      due = date;
      break;
    case 'calendar_days':
      due = addDays(date, Math.max(0, rule.days ?? 0));
      break;
    case 'advance':
      due = addDays(date, -Math.max(0, rule.days ?? 0));
      break;
    case 'first_business_day_next_month': {
      const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
      due = firstBusinessDayOfMonth(nextMonth);
      break;
    }
    case 'last_business_day_next_month': {
      const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
      due = lastBusinessDayOfMonth(nextMonth);
      break;
    }
    case 'weekly': {
      const weekOffset = Math.max(1, rule.weekOffset ?? 1);
      const weekday = Math.min(5, Math.max(1, rule.weekday ?? 5));
      const daysToNextMonday = date.getDay() === 0 ? 1 : 8 - date.getDay();
      due = addDays(date, daysToNextMonday + (weekOffset - 1) * 7 + weekday - 1);
      break;
    }
    case 'custom': {
      const base = customBase(date, rule.basis ?? 'service_date');
      const shifted = applyOffset(base, rule.offset ?? 0, rule.unit ?? 'days');
      due = applyAdjustment(shifted, rule.adjustment ?? 'none');
      break;
    }
    default:
      due = date;
  }

  return toDateOnly(due);
}

const WEEKDAYS: Record<number, string> = {
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
};

const BASIS_LABELS: Record<CustomRuleBasis, string> = {
  service_date: 'data do atendimento',
  end_of_week: 'fim da semana do atendimento',
  end_of_month: 'fim do mês do atendimento',
};

const UNIT_LABELS: Record<CustomRuleUnit, [string, string]> = {
  days: ['dia', 'dias'],
  weeks: ['semana', 'semanas'],
  months: ['mês', 'meses'],
};

const ADJUSTMENT_LABELS: Record<BusinessDayAdjustment, string> = {
  none: 'sem ajuste de dia útil',
  next_business_day: 'ajustado para o próximo dia útil',
  previous_business_day: 'ajustado para o dia útil anterior',
  first_business_day: 'no primeiro dia útil do mês resultante',
  last_business_day: 'no último dia útil do mês resultante',
};

export function describePaymentRule(rule: PaymentRule): string {
  switch (rule.kind) {
    case 'immediate':
      return 'À vista, na data do atendimento';
    case 'calendar_days':
      return `${rule.days ?? 0} dias corridos após o atendimento`;
    case 'advance':
      return `${rule.days ?? 0} dias antes do atendimento`;
    case 'first_business_day_next_month':
      return 'Primeiro dia útil do mês seguinte';
    case 'last_business_day_next_month':
      return 'Último dia útil do mês seguinte';
    case 'weekly':
      return `${WEEKDAYS[rule.weekday ?? 5]} da semana seguinte`;
    case 'custom': {
      const offset = rule.offset ?? 0;
      const unit = UNIT_LABELS[rule.unit ?? 'days'][offset === 1 ? 0 : 1];
      const base = BASIS_LABELS[rule.basis ?? 'service_date'];
      const adjustment = ADJUSTMENT_LABELS[rule.adjustment ?? 'none'];
      return `A partir da ${base}, somar ${offset} ${unit}, ${adjustment}`;
    }
  }
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

export function parseCurrencyToCents(value: string): number {
  const normalized = value.replace(/\s/g, '').replace(/R\$/gi, '').replace(/\./g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR').format(localDate(value));
}

export function formatDateInput(value: Date | string): string {
  const date = localDate(value);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

export function parseDateInput(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
    return null;
  }
  return toDateOnly(date);
}

export function isPastOrToday(value: string, today = new Date()): boolean {
  return localDate(value).getTime() <= localDate(today).getTime();
}
