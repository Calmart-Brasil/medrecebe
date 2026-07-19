export type PaymentRuleKind =
  | 'immediate'
  | 'calendar_days'
  | 'advance'
  | 'first_business_day_next_month'
  | 'last_business_day_next_month'
  | 'weekly'
  | 'custom';

export type CustomRuleBasis = 'service_date' | 'end_of_week' | 'end_of_month';
export type CustomRuleUnit = 'days' | 'weeks' | 'months';
export type BusinessDayAdjustment =
  | 'none'
  | 'next_business_day'
  | 'previous_business_day'
  | 'first_business_day'
  | 'last_business_day';

export interface PaymentRule {
  kind: PaymentRuleKind;
  days?: number;
  weekday?: number;
  weekOffset?: number;
  basis?: CustomRuleBasis;
  offset?: number;
  unit?: CustomRuleUnit;
  adjustment?: BusinessDayAdjustment;
  contractualText?: string;
}

export type ModalityType = 'plan' | 'private' | 'recurring' | 'custom';

export interface PaymentModality {
  id: string;
  name: string;
  type: ModalityType;
  customType?: string;
  amountCents: number;
  rule: PaymentRule;
  active: boolean;
}

export interface Workplace {
  id: string;
  name: string;
  address: string;
  payerCnpj: string;
  payerLegalName: string;
  directoryId?: string;
  directoryCategory?: string;
  directoryTypeName?: string;
  directoryTradeName?: string;
  directoryLegalName?: string;
  directoryUpdatedAt?: string;
  cnes?: string;
  payerCnpjSource?: 'establishment' | 'maintainer';
  establishmentCnpj?: string;
  maintainerCnpj?: string;
  reconciliationEmail: string;
  reconciliationCc: string;
  modalities: PaymentModality[];
  active: boolean;
}

export type InvoiceReconciliationStatus = 'matched' | 'divergent' | 'payer_not_matched' | 'group_not_found';

export interface InvoiceReconciliation {
  id: string;
  fileName: string;
  invoiceNumber: string;
  issuedAt: string;
  amountCents: number | null;
  cnpjs: string[];
  legalNames: string[];
  suggestedPayerCnpj: string;
  suggestedPayerLegalName: string;
  workplaceId: string;
  workplaceName: string;
  groupId: string;
  expectedCents: number | null;
  differenceCents: number | null;
  status: InvoiceReconciliationStatus;
  analyzedAt: string;
}

export type AttendanceStatus = 'pending' | 'in_reconciliation' | 'paid';

export interface Attendance {
  id: string;
  recordId?: string;
  workplaceId: string;
  modalityId: string;
  modalityName: string;
  modalityType?: ModalityType;
  occurredAt: string;
  dueAt: string;
  amountCents: number;
  quantity?: number;
  unitAmountCents?: number;
  baseAmountCents?: number;
  evidenceUri: string;
  notes: string;
  patientReference?: string;
  medication?: string;
  includeConsultation?: boolean;
  consultationModalityId?: string;
  consultationModalityName?: string;
  consultationAmountCents?: number;
  status: AttendanceStatus;
  createdAt: string;
  reconciliationRequestedAt?: string;
}

export interface ReconciliationSettings {
  defaultMessage: string;
}

export interface AppData {
  workplaces: Workplace[];
  attendances: Attendance[];
  invoices: InvoiceReconciliation[];
  reconciliation: ReconciliationSettings;
  isDemoData: boolean;
}

export interface UserProfile {
  name: string;
  cpf: string;
  email: string;
}

export type AppRoute =
  | { name: 'home' }
  | { name: 'dashboard' }
  | { name: 'workplaces' }
  | { name: 'workplace_form'; workplaceId?: string; invoiceId?: string }
  | { name: 'attendance_form'; workplaceId: string }
  | { name: 'reconciliation' }
  | { name: 'account' };
