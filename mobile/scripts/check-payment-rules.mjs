import assert from 'node:assert/strict';

import {
  calculateDueDate,
  describePaymentRule,
  parseCurrencyToCents,
  parseDateInput,
} from '../src/services/paymentRules.ts';

const scenarios = [
  ['à vista', '2026-07-15', { kind: 'immediate' }, '2026-07-15'],
  ['30 dias corridos', '2026-07-15', { kind: 'calendar_days', days: 30 }, '2026-08-14'],
  ['antecipado', '2026-07-15', { kind: 'advance', days: 5 }, '2026-07-10'],
  ['primeiro dia útil', '2026-10-20', { kind: 'first_business_day_next_month' }, '2026-11-02'],
  ['último dia útil', '2026-05-15', { kind: 'last_business_day_next_month' }, '2026-06-30'],
  ['sexta seguinte', '2026-07-15', { kind: 'weekly', weekday: 5, weekOffset: 1 }, '2026-07-24'],
  [
    'regra personalizada',
    '2026-07-15',
    {
      kind: 'custom',
      basis: 'end_of_month',
      offset: 1,
      unit: 'months',
      adjustment: 'first_business_day',
      contractualText: 'Primeiro dia útil do mês posterior ao mês subsequente.',
    },
    '2026-08-03',
  ],
];

for (const [label, serviceDate, rule, expected] of scenarios) {
  assert.equal(calculateDueDate(serviceDate, rule), expected, label);
  assert.ok(describePaymentRule(rule).length > 5, `${label}: descrição vazia`);
}

assert.equal(parseCurrencyToCents('R$ 1.234,56'), 123456);
assert.equal(parseDateInput('29/02/2028'), '2028-02-29');
assert.equal(parseDateInput('29/02/2027'), null);

console.log(`OK: ${scenarios.length} regras de pagamento e 3 validações auxiliares.`);
