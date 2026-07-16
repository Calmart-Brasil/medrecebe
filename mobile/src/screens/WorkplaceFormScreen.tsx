import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, Field, InlineNotice, PageTitle, Screen, SectionTitle } from '../components/ui';
import { createId } from '../data/store';
import { cnpjDigits, formatCnpj, isValidCnpj } from '../services/invoice';
import {
  calculateDueDate,
  describePaymentRule,
  formatCurrency,
  formatDate,
  parseCurrencyToCents,
} from '../services/paymentRules';
import { colors, radius } from '../theme';
import type {
  BusinessDayAdjustment,
  CustomRuleBasis,
  CustomRuleUnit,
  PaymentModality,
  PaymentRule,
  PaymentRuleKind,
  Workplace,
} from '../types';

const RULE_OPTIONS: Array<{ kind: PaymentRuleKind; label: string }> = [
  { kind: 'calendar_days', label: 'Dias corridos' },
  { kind: 'immediate', label: 'À vista' },
  { kind: 'advance', label: 'Antecipado' },
  { kind: 'first_business_day_next_month', label: '1º dia útil do mês seguinte' },
  { kind: 'last_business_day_next_month', label: 'Último dia útil do mês seguinte' },
];

const BASIS_OPTIONS: Array<{ value: CustomRuleBasis; label: string }> = [
  { value: 'service_date', label: 'Data do atendimento' },
  { value: 'end_of_week', label: 'Fim da semana' },
  { value: 'end_of_month', label: 'Fim do mês' },
];

const UNIT_OPTIONS: Array<{ value: CustomRuleUnit; label: string }> = [
  { value: 'days', label: 'Dias' },
  { value: 'weeks', label: 'Semanas' },
  { value: 'months', label: 'Meses' },
];

const ADJUSTMENT_OPTIONS: Array<{ value: BusinessDayAdjustment; label: string }> = [
  { value: 'none', label: 'Sem ajuste' },
  { value: 'next_business_day', label: 'Próximo dia útil' },
  { value: 'previous_business_day', label: 'Dia útil anterior' },
  { value: 'first_business_day', label: '1º dia útil do mês' },
  { value: 'last_business_day', label: 'Último dia útil do mês' },
];

function defaultModality(): PaymentModality {
  return {
    id: createId('mod'),
    name: '',
    type: 'plan',
    amountCents: 0,
    rule: { kind: 'calendar_days', days: 30 },
    active: true,
  };
}

function ModalityEditor({
  modality,
  onClose,
  onSave,
}: {
  modality: PaymentModality;
  onClose: () => void;
  onSave: (modality: PaymentModality) => void;
}) {
  const [draft, setDraft] = useState<PaymentModality>({ ...modality, rule: { ...modality.rule } });
  const [amount, setAmount] = useState(
    modality.amountCents ? (modality.amountCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [error, setError] = useState('');

  const updateRule = (partial: Partial<PaymentRule>) => {
    setDraft((current) => ({ ...current, rule: { ...current.rule, ...partial } }));
  };

  const preview = useMemo(() => calculateDueDate(new Date(), draft.rule), [draft.rule]);

  const save = () => {
    const amountCents = parseCurrencyToCents(amount);
    if (!draft.name.trim()) {
      setError('Informe o nome da modalidade.');
      return;
    }
    if (amountCents <= 0) {
      setError('Informe um valor de repasse maior que zero.');
      return;
    }
    if (draft.type === 'custom' && !draft.customType?.trim()) {
      setError('Informe o nome do tipo personalizado.');
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), amountCents });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <SafeAreaView edges={['top', 'bottom']} style={styles.modalSafeArea}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.modalCancel}>Cancelar</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Modalidade de repasse</Text>
          <Pressable onPress={save} style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.modalSave}>Salvar</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Field
              autoCapitalize="sentences"
              label="Nome da modalidade"
              onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
              placeholder="Ex.: Unimed, particular, plantão"
              value={draft.name}
            />

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Tipo</Text>
              <View style={styles.chips}>
                <Chip label="Plano" onPress={() => setDraft((current) => ({ ...current, type: 'plan' }))} selected={draft.type === 'plan'} />
                <Chip label="Particular" onPress={() => setDraft((current) => ({ ...current, type: 'private' }))} selected={draft.type === 'private'} />
                <Chip label="Receita recorrente" onPress={() => setDraft((current) => ({ ...current, type: 'recurring' }))} selected={draft.type === 'recurring'} />
                <Chip label="Personalizado" onPress={() => setDraft((current) => ({ ...current, type: 'custom' }))} selected={draft.type === 'custom'} />
              </View>
            </View>

            {draft.type === 'custom' ? (
              <Field
                label="Nome do tipo personalizado"
                onChangeText={(customType) => setDraft((current) => ({ ...current, customType }))}
                placeholder="Ex.: Teleinterconsulta"
                value={draft.customType ?? ''}
              />
            ) : null}

            <Field
              keyboardType="decimal-pad"
              label="Repasse por atendimento (R$)"
              onChangeText={setAmount}
              placeholder="0,00"
              value={amount}
            />

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Regra de pagamento</Text>
              <View style={styles.chips}>
                {RULE_OPTIONS.map((option) => (
                  <Chip
                    key={option.kind}
                    label={option.label}
                    onPress={() => updateRule({ kind: option.kind })}
                    selected={draft.rule.kind === option.kind}
                  />
                ))}
              </View>
            </View>

            {draft.rule.kind === 'calendar_days' || draft.rule.kind === 'advance' ? (
              <Field
                keyboardType="number-pad"
                label={draft.rule.kind === 'advance' ? 'Dias antes do atendimento' : 'Prazo em dias corridos'}
                onChangeText={(value) => updateRule({ days: Number(value.replace(/\D/g, '')) || 0 })}
                value={String(draft.rule.days ?? 0)}
              />
            ) : null}

            {draft.rule.kind === 'weekly' ? (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Dia da semana seguinte</Text>
                <View style={styles.chips}>
                  {[
                    [1, 'Segunda'],
                    [2, 'Terça'],
                    [3, 'Quarta'],
                    [4, 'Quinta'],
                    [5, 'Sexta'],
                  ].map(([value, label]) => (
                    <Chip
                      key={value}
                      label={String(label)}
                      onPress={() => updateRule({ weekday: Number(value), weekOffset: 1 })}
                      selected={(draft.rule.weekday ?? 5) === value}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {draft.rule.kind === 'custom' ? (
              <Card style={styles.customCard}>
                <Text style={styles.customTitle}>Construtor de regra</Text>
                <Text style={styles.customHelp}>
                  Registre a regra em campos calculáveis e guarde o texto contratual como evidência. Esta combinação é mais segura que usar somente uma descrição livre.
                </Text>

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>1. Data-base</Text>
                  <View style={styles.chips}>
                    {BASIS_OPTIONS.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        onPress={() => updateRule({ basis: option.value })}
                        selected={(draft.rule.basis ?? 'service_date') === option.value}
                      />
                    ))}
                  </View>
                </View>

                <Field
                  keyboardType="number-pad"
                  label="2. Deslocamento"
                  onChangeText={(value) => updateRule({ offset: Number(value.replace(/\D/g, '')) || 0 })}
                  value={String(draft.rule.offset ?? 0)}
                />

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>3. Unidade</Text>
                  <View style={styles.chips}>
                    {UNIT_OPTIONS.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        onPress={() => updateRule({ unit: option.value })}
                        selected={(draft.rule.unit ?? 'days') === option.value}
                      />
                    ))}
                  </View>
                </View>

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>4. Ajuste</Text>
                  <View style={styles.chips}>
                    {ADJUSTMENT_OPTIONS.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        onPress={() => updateRule({ adjustment: option.value })}
                        selected={(draft.rule.adjustment ?? 'none') === option.value}
                      />
                    ))}
                  </View>
                </View>

                <Field
                  label="Texto acordado"
                  multiline
                  onChangeText={(contractualText) => updateRule({ contractualText })}
                  placeholder="Copie a cláusula ou descreva fielmente o acordo."
                  value={draft.rule.contractualText ?? ''}
                />
              </Card>
            ) : null}

            <InlineNotice tone="success">
              Exemplo com um atendimento hoje: crédito previsto em {formatDate(preview)}. Regra: {describePaymentRule(draft.rule)}.
            </InlineNotice>

            {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
            <Button onPress={save} title="Salvar modalidade" />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export function WorkplaceFormScreen({
  workplace,
  onCancel,
  onSave,
}: {
  workplace?: Workplace;
  onCancel: () => void;
  onSave: (workplace: Workplace) => void;
}) {
  const [name, setName] = useState(workplace?.name ?? '');
  const [address, setAddress] = useState(workplace?.address ?? '');
  const [payerLegalName, setPayerLegalName] = useState(workplace?.payerLegalName ?? '');
  const [payerCnpj, setPayerCnpj] = useState(formatCnpj(workplace?.payerCnpj ?? ''));
  const [email, setEmail] = useState(workplace?.reconciliationEmail ?? '');
  const [cc, setCc] = useState(workplace?.reconciliationCc ?? '');
  const [active, setActive] = useState(workplace?.active ?? true);
  const [modalities, setModalities] = useState<PaymentModality[]>(workplace?.modalities ?? []);
  const [editingModality, setEditingModality] = useState<PaymentModality | null>(null);
  const [error, setError] = useState('');

  const save = () => {
    if (!name.trim()) {
      setError('Informe o nome do local de trabalho.');
      return;
    }
    if (payerLegalName.trim().length < 3) {
      setError('Informe a Razão Social do pagador.');
      return;
    }
    if (!isValidCnpj(payerCnpj)) {
      setError('Informe um CNPJ válido do pagador.');
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Informe um e-mail de conciliação válido.');
      return;
    }
    if (modalities.length === 0) {
      setError('Cadastre pelo menos uma modalidade de repasse.');
      return;
    }

    onSave({
      id: workplace?.id ?? createId('work'),
      name: name.trim(),
      address: address.trim(),
      payerCnpj: cnpjDigits(payerCnpj),
      payerLegalName: payerLegalName.trim(),
      reconciliationEmail: email.trim().toLowerCase(),
      reconciliationCc: cc.trim().toLowerCase(),
      modalities,
      active,
    });
  };

  const saveModality = (modality: PaymentModality) => {
    setModalities((current) => {
      const exists = current.some((item) => item.id === modality.id);
      return exists ? current.map((item) => (item.id === modality.id ? modality : item)) : [...current, modality];
    });
    setEditingModality(null);
  };

  const removeModality = (modality: PaymentModality) => {
    Alert.alert('Excluir modalidade?', `“${modality.name}” deixará de aparecer em novos atendimentos.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => setModalities((current) => current.filter((item) => item.id !== modality.id)),
      },
    ]);
  };

  return (
    <>
      <Screen keyboard>
        <PageTitle subtitle="Os dados financeiros ficam vinculados ao local e à modalidade selecionada.">
          {workplace ? 'Editar local' : 'Novo local'}
        </PageTitle>

        <Card style={styles.formCard}>
          <Field label="Nome do local" onChangeText={setName} placeholder="Ex.: Clínica Horizonte" value={name} />
          <Field
            label="Razão Social do pagador"
            onChangeText={setPayerLegalName}
            placeholder="Razão Social exibida na Nota Fiscal"
            value={payerLegalName}
          />
          <Field
            hint="O CNPJ e a Razão Social identificam automaticamente o pagador na Nota Fiscal."
            keyboardType="number-pad"
            label="CNPJ do pagador"
            onChangeText={(value) => setPayerCnpj(formatCnpj(value))}
            placeholder="00.000.000/0000-00"
            value={payerCnpj}
          />
          <Field label="Endereço (opcional)" onChangeText={setAddress} placeholder="Rua, número e cidade" value={address} />
          <Field
            autoCapitalize="none"
            keyboardType="email-address"
            label="E-mail oficial para conciliação"
            onChangeText={setEmail}
            placeholder="financeiro@clinica.com.br"
            value={email}
          />
          <Field
            autoCapitalize="none"
            hint="Separe mais de um e-mail com vírgula."
            keyboardType="email-address"
            label="E-mail(s) em cópia (opcional)"
            onChangeText={setCc}
            placeholder="gestor@clinica.com.br"
            value={cc}
          />
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Status do local</Text>
            <View style={styles.chips}>
              <Chip label="Ativo" onPress={() => setActive(true)} selected={active} />
              <Chip label="Inativo" onPress={() => setActive(false)} selected={!active} />
            </View>
          </View>
        </Card>

        <SectionTitle action={<Button compact onPress={() => setEditingModality(defaultModality())} title="Adicionar" variant="secondary" />}>
          Modalidades
        </SectionTitle>

        {modalities.length === 0 ? (
          <InlineNotice tone="warning">Cadastre uma modalidade para que este local possa receber novos atendimentos.</InlineNotice>
        ) : (
          <View style={styles.modalityList}>
            {modalities.map((modality) => (
              <Card key={modality.id} style={styles.modalityCard}>
                <View style={styles.modalityHeading}>
                  <View style={styles.modalityCopy}>
                    <Text style={styles.modalityName}>{modality.name}</Text>
                    <Text style={styles.modalityType}>{modality.type === 'plan' ? 'Plano' : 'Particular'}</Text>
                  </View>
                  <Text style={styles.modalityValue}>{formatCurrency(modality.amountCents)}</Text>
                </View>
                <Text style={styles.ruleText}>{describePaymentRule(modality.rule)}</Text>
                <View style={styles.modalityActions}>
                  <Pressable onPress={() => removeModality(modality)} style={({ pressed }) => pressed && styles.pressed}>
                    <Text style={styles.removeText}>Excluir</Text>
                  </Pressable>
                  <Pressable onPress={() => setEditingModality(modality)} style={({ pressed }) => pressed && styles.pressed}>
                    <Text style={styles.editText}>Editar modalidade</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}

        {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}

        <View style={styles.footerActions}>
          <View style={styles.footerButton}>
            <Button onPress={onCancel} title="Cancelar" variant="secondary" />
          </View>
          <View style={styles.footerButton}>
            <Button onPress={save} title="Salvar local" />
          </View>
        </View>
      </Screen>

      {editingModality ? (
        <ModalityEditor modality={editingModality} onClose={() => setEditingModality(null)} onSave={saveModality} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  formCard: { gap: 15 },
  fieldBlock: { gap: 8 },
  fieldLabel: { color: colors.navy, fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalityList: { gap: 11 },
  modalityCard: { gap: 10 },
  modalityHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  modalityCopy: { flex: 1, gap: 3 },
  modalityName: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  modalityType: { color: colors.blue700, fontSize: 11, fontWeight: '700' },
  modalityValue: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  ruleText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  modalityActions: { borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 },
  removeText: { color: colors.red, fontSize: 12, fontWeight: '800', paddingVertical: 5 },
  editText: { color: colors.blue700, fontSize: 12, fontWeight: '800', paddingVertical: 5 },
  footerActions: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  modalSafeArea: { backgroundColor: colors.paper, flex: 1 },
  modalHeader: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 16 },
  modalCancel: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  modalTitle: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  modalSave: { color: colors.blue700, fontSize: 14, fontWeight: '800' },
  modalContent: { gap: 18, padding: 20, paddingBottom: 46 },
  customCard: { backgroundColor: colors.blue050, borderColor: '#BFE5FA', gap: 15, shadowOpacity: 0 },
  customTitle: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  customHelp: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.65 },
});
