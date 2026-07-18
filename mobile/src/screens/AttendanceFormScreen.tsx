import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Button, Card, Chip, Field, InlineNotice, PageTitle, Screen, SectionTitle } from '../components/ui';
import { createId } from '../data/store';
import { persistEvidence } from '../services/evidence';
import {
  calculateDueDate,
  describePaymentRule,
  formatCurrency,
  formatDate,
  formatDateInput,
  parseDateInput,
} from '../services/paymentRules';
import { colors, radius } from '../theme';
import type { Attendance, PaymentModality, Workplace } from '../types';

type RecurringDraft = {
  patientReference: string;
  medication: string;
  includeConsultation: boolean;
  consultationModalityId: string;
};

export function AttendanceFormScreen({
  workplace,
  onCancel,
  onSave,
}: {
  workplace: Workplace;
  onCancel: () => void;
  onSave: (attendances: Attendance[]) => void;
}) {
  const activeModalities = workplace.modalities.filter((modality) => modality.active);
  const [quantities, setQuantities] = useState<Record<string, number>>(
    activeModalities[0] ? { [activeModalities[0].id]: 1 } : {},
  );
  const [recurringDrafts, setRecurringDrafts] = useState<Record<string, RecurringDraft>>({});
  const [occurredAt, setOccurredAt] = useState(formatDateInput(new Date()));
  const [photoUri, setPhotoUri] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const parsedDate = parseDateInput(occurredAt);
  const selectedModalities = activeModalities.filter((item) => (quantities[item.id] ?? 0) > 0);
  const draftFor = (modalityId: string): RecurringDraft => recurringDrafts[modalityId] ?? {
    patientReference: '',
    medication: '',
    includeConsultation: false,
    consultationModalityId: '',
  };
  const summaries = useMemo(
    () => selectedModalities.map((modality) => {
      const quantity = Math.max(1, quantities[modality.id] ?? 1);
      const recurring = recurringDrafts[modality.id];
      const consultation = recurring?.includeConsultation
        ? activeModalities.find((item) => item.id === recurring.consultationModalityId)
          ?? activeModalities.find((item) => item.id !== modality.id && item.type !== 'recurring')
        : undefined;
      const unitAmountCents = modality.amountCents + (consultation?.amountCents ?? 0);
      return {
        modality,
        quantity,
        recurring,
        consultation,
        unitAmountCents,
        amountCents: unitAmountCents * quantity,
        dueAt: parsedDate ? calculateDueDate(parsedDate, modality.rule) : null,
      };
    }),
    [activeModalities, parsedDate, quantities, recurringDrafts, selectedModalities],
  );
  const totalCents = summaries.reduce((sum, item) => sum + item.amountCents, 0);
  const totalQuantity = summaries.reduce((sum, item) => sum + item.quantity, 0);

  const setQuantity = (modalityId: string, quantity: number) => {
    setQuantities((current) => ({ ...current, [modalityId]: Math.min(999, Math.max(1, quantity)) }));
  };

  const toggleModality = (modalityId: string) => {
    setQuantities((current) => {
      if ((current[modalityId] ?? 0) > 0) {
        const next = { ...current };
        delete next[modalityId];
        return next;
      }
      return { ...current, [modalityId]: 1 };
    });
  };

  const updateRecurring = (modalityId: string, update: Partial<RecurringDraft>) => {
    setRecurringDrafts((current) => ({ ...current, [modalityId]: { ...draftFor(modalityId), ...update } }));
  };

  const takePhoto = async () => {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Câmera não autorizada', 'Libere a câmera nos Ajustes do iPhone para fotografar o comprovante.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled) setPhotoUri(result.assets[0]?.uri ?? '');
  };

  const choosePhoto = async () => {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Fotos não autorizadas', 'Libere o acesso às fotos nos Ajustes do iPhone para escolher um comprovante.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled) setPhotoUri(result.assets[0]?.uri ?? '');
  };

  const save = async () => {
    if (!photoUri) {
      setError('Adicione uma foto do comprovante do atendimento.');
      return;
    }
    if (!selectedModalities.length) {
      setError('Selecione pelo menos uma modalidade de repasse.');
      return;
    }
    if (!parsedDate) {
      setError('Informe uma data válida no formato DD/MM/AAAA.');
      return;
    }
    for (const item of summaries) {
      if (item.modality.type === 'recurring' && !item.recurring?.patientReference.trim()) {
        setError(`Informe uma identificação mínima do paciente em ${item.modality.name}.`);
        return;
      }
      if (item.modality.type === 'recurring' && !item.recurring?.medication.trim()) {
        setError(`Informe o medicamento ou tratamento em ${item.modality.name}.`);
        return;
      }
      if (item.recurring?.includeConsultation && !item.consultation) {
        setError(`Cadastre e selecione uma modalidade de consulta em ${item.modality.name}.`);
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      const evidenceUri = await persistEvidence(photoUri);
      const recordId = createId('record');
      const createdAt = new Date().toISOString();
      onSave(summaries.map((item) => ({
          id: createId('att'),
          recordId,
          workplaceId: workplace.id,
          modalityId: item.modality.id,
          modalityName: item.modality.name,
          modalityType: item.modality.type,
          quantity: item.quantity,
          occurredAt: parsedDate,
          dueAt: item.dueAt!,
          amountCents: item.amountCents,
          unitAmountCents: item.unitAmountCents,
          baseAmountCents: item.modality.amountCents,
          evidenceUri,
          notes: notes.trim(),
          patientReference: item.modality.type === 'recurring' ? item.recurring?.patientReference.trim() : '',
          medication: item.modality.type === 'recurring' ? item.recurring?.medication.trim() : '',
          includeConsultation: Boolean(item.consultation),
          consultationModalityId: item.consultation?.id,
          consultationModalityName: item.consultation?.name,
          consultationAmountCents: item.consultation?.amountCents ?? 0,
          status: 'pending',
          createdAt,
        })));
    } catch {
      setError('Não foi possível guardar o comprovante. Tente fotografá-lo novamente.');
      setSaving(false);
    }
  };

  const modalityCard = (item: PaymentModality) => {
    const quantity = quantities[item.id] ?? 0;
    const selected = quantity > 0;
    return (
      <View key={item.id} style={[styles.modality, selected && styles.modalitySelected]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          onPress={() => toggleModality(item.id)}
          style={({ pressed }) => [styles.modalityHeader, pressed && styles.pressed]}
        >
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>{selected ? <Text style={styles.checkmark}>✓</Text> : null}</View>
          <View style={styles.modalityCopy}>
            <Text style={[styles.modalityName, selected && styles.modalityNameSelected]}>{item.name}</Text>
            <Text style={styles.modalityRule}>{describePaymentRule(item.rule)}</Text>
          </View>
          <View style={styles.modalityPrice}>
            <Text style={styles.modalityValue}>{formatCurrency(item.amountCents)}</Text>
            <Text style={styles.modalityUnit}>por atendimento</Text>
          </View>
        </Pressable>
        {selected ? (
          <View style={styles.quantityRow}>
            <Text style={styles.quantityLabel}>Quantidade realizada</Text>
            <View style={styles.stepper}>
              <Pressable accessibilityLabel={`Diminuir quantidade de ${item.name}`} onPress={() => setQuantity(item.id, quantity - 1)} style={styles.stepperButton}><Text style={styles.stepperButtonText}>−</Text></Pressable>
              <TextInput
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={(value) => setQuantity(item.id, Number(value) || 1)}
                selectTextOnFocus
                style={styles.quantityInput}
                value={String(quantity)}
              />
              <Pressable accessibilityLabel={`Aumentar quantidade de ${item.name}`} onPress={() => setQuantity(item.id, quantity + 1)} style={styles.stepperButton}><Text style={styles.stepperButtonText}>+</Text></Pressable>
            </View>
            <Text style={styles.quantityTotal}>{formatCurrency(item.amountCents * quantity)}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen keyboard>
      <PageTitle subtitle={workplace.name}>Novo atendimento</PageTitle>

      <Field
        keyboardType="number-pad"
        label="Data do atendimento"
        maxLength={10}
        onChangeText={setOccurredAt}
        placeholder="DD/MM/AAAA"
        value={occurredAt}
      />

      <SectionTitle>Comprovante do atendimento</SectionTitle>
      {photoUri ? (
        <Card style={styles.photoCard}>
          <Image source={{ uri: photoUri }} style={styles.photo} />
          <View style={styles.photoActions}>
            <Button compact onPress={() => void takePhoto()} title="Tirar outra foto" variant="secondary" />
            <Button compact onPress={() => void choosePhoto()} title="Galeria" variant="secondary" />
            <Button compact onPress={() => setPhotoUri('')} title="Remover" variant="ghost" />
          </View>
        </Card>
      ) : (
        <View style={styles.photoPlaceholder}>
          <View style={styles.cameraIcon}>
            <Text style={styles.cameraIconText}>▣</Text>
          </View>
          <Text style={styles.photoTitle}>Adicione a prova dos atendimentos</Text>
          <Text style={styles.photoHelp}>Uma única imagem pode comprovar todas as modalidades e quantidades deste registro.</Text>
          <View style={styles.photoButtons}>
            <View style={styles.photoButton}>
              <Button onPress={() => void takePhoto()} title="Tirar foto" />
            </View>
            <View style={styles.photoButton}>
              <Button onPress={() => void choosePhoto()} title="Galeria" variant="secondary" />
            </View>
          </View>
        </View>
      )}

      <SectionTitle>Modalidade de repasse</SectionTitle>
      <Text style={styles.sectionHelp}>Selecione uma ou mais modalidades e informe a quantidade realizada em cada uma.</Text>
      <View style={styles.modalities}>{activeModalities.map(modalityCard)}</View>

      {summaries.filter((item) => item.modality.type === 'recurring').map(({ modality }) => {
        const recurring = draftFor(modality.id);
        const consultationModalities = activeModalities.filter((item) => item.id !== modality.id && item.type !== 'recurring');
        const consultationModality = consultationModalities.find((item) => item.id === recurring.consultationModalityId) ?? consultationModalities[0];
        return (
          <Card key={modality.id} style={styles.recurringCard}>
            <SectionTitle>Receita recorrente • {modality.name}</SectionTitle>
            <Field
              label="Identificação do paciente"
              onChangeText={(value) => updateRecurring(modality.id, { patientReference: value })}
              placeholder="Use iniciais ou um código interno"
              value={recurring.patientReference}
            />
            <Field
              label="Medicamento ou tratamento"
              onChangeText={(value) => updateRecurring(modality.id, { medication: value })}
              placeholder="Ex.: imunobiológico ou medicamento oncológico"
              value={recurring.medication}
            />
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Consulta associada</Text>
              <Chip
                label={recurring.includeConsultation ? 'Consulta contabilizada por atendimento' : 'Contabilizar também uma consulta por atendimento'}
                onPress={() => updateRecurring(modality.id, {
                  includeConsultation: !recurring.includeConsultation,
                  consultationModalityId: recurring.consultationModalityId || consultationModality?.id || '',
                })}
                selected={recurring.includeConsultation}
              />
            </View>
            {recurring.includeConsultation ? (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Modalidade da consulta</Text>
                <View style={styles.modalities}>
                  {consultationModalities.map((item) => (
                    <Chip
                      key={item.id}
                      label={`${item.name} • ${formatCurrency(item.amountCents)}`}
                      onPress={() => updateRecurring(modality.id, { consultationModalityId: item.id })}
                      selected={(consultationModality?.id ?? '') === item.id}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}

      <Field
        label="Observação (opcional)"
        multiline
        onChangeText={setNotes}
        placeholder="Inclua somente informações necessárias para identificar ou conciliar o atendimento."
        value={notes}
      />

      {summaries.length > 0 && parsedDate ? (
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.summaryLabel}>Valor contabilizado</Text>
              <Text style={styles.summaryCaption}>{totalQuantity} {totalQuantity === 1 ? 'atendimento' : 'atendimentos'}</Text>
            </View>
            <Text style={styles.summaryValue}>{formatCurrency(totalCents)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          {summaries.map((item) => (
            <View key={item.modality.id} style={styles.summaryRow}>
              <Text style={styles.summaryLine}>{item.quantity} × {item.modality.name}</Text>
              <View style={styles.summaryLineRight}>
                <Text style={styles.summaryLineValue}>{formatCurrency(item.amountCents)}</Text>
                <Text style={styles.summaryLineDue}>{item.dueAt ? formatDate(item.dueAt) : '—'}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}

      <View style={styles.footerActions}>
        <View style={styles.footerButton}>
          <Button disabled={saving} onPress={onCancel} title="Cancelar" variant="secondary" />
        </View>
        <View style={styles.footerButton}>
          <Button loading={saving} onPress={() => void save()} title="Salvar" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  recurringCard: { backgroundColor: '#F2FFFB', borderColor: '#BDE8DF', gap: 12 },
  fieldBlock: { gap: 9 },
  fieldLabel: { color: colors.navy, fontSize: 13, fontWeight: '800' },
  photoPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.blue600,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    gap: 9,
    padding: 22,
  },
  cameraIcon: { alignItems: 'center', backgroundColor: colors.blue100, borderRadius: 27, height: 54, justifyContent: 'center', width: 54 },
  cameraIconText: { color: colors.blue700, fontSize: 26 },
  photoTitle: { color: colors.navy, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  photoHelp: { color: colors.muted, fontSize: 12, lineHeight: 18, maxWidth: 310, textAlign: 'center' },
  photoButtons: { flexDirection: 'row', gap: 9, marginTop: 6, width: '100%' },
  photoButton: { flex: 1 },
  photoCard: { gap: 12, padding: 10 },
  photo: { aspectRatio: 4 / 3, backgroundColor: colors.mist, borderRadius: radius.sm, width: '100%' },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingHorizontal: 4 },
  sectionHelp: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: -7 },
  modalities: { gap: 9 },
  modality: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalitySelected: { backgroundColor: colors.blue050, borderColor: colors.blue600, borderWidth: 1.5 },
  modalityHeader: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 76, padding: 13 },
  checkbox: { alignItems: 'center', borderColor: colors.line, borderRadius: 6, borderWidth: 2, height: 22, justifyContent: 'center', width: 22 },
  checkboxSelected: { backgroundColor: colors.blue700, borderColor: colors.blue700 },
  checkmark: { color: colors.paper, fontSize: 14, fontWeight: '900' },
  modalityCopy: { flex: 1, gap: 3 },
  modalityName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  modalityNameSelected: { color: colors.blue700 },
  modalityRule: { color: colors.muted, fontSize: 11 },
  modalityPrice: { alignItems: 'flex-end', gap: 2 },
  modalityValue: { color: colors.navy, fontSize: 14, fontWeight: '900' },
  modalityUnit: { color: colors.muted, fontSize: 9 },
  quantityRow: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', gap: 9, padding: 11 },
  quantityLabel: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: '700' },
  stepper: { alignItems: 'center', backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 9, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  stepperButton: { alignItems: 'center', backgroundColor: colors.blue050, height: 36, justifyContent: 'center', width: 34 },
  stepperButtonText: { color: colors.blue700, fontSize: 19, fontWeight: '900' },
  quantityInput: { borderColor: colors.line, borderLeftWidth: 1, borderRightWidth: 1, color: colors.ink, fontSize: 13, fontWeight: '900', height: 36, padding: 0, textAlign: 'center', width: 44 },
  quantityTotal: { color: colors.blue700, fontSize: 12, fontWeight: '900', minWidth: 68, textAlign: 'right' },
  summaryCard: { backgroundColor: colors.navy, borderColor: colors.navy, gap: 13 },
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: '#B9E4FB', fontSize: 12, fontWeight: '700' },
  summaryCaption: { color: colors.blue100, fontSize: 10, marginTop: 3 },
  summaryValue: { color: colors.paper, fontSize: 20, fontWeight: '900' },
  summaryLine: { color: colors.blue100, flex: 1, fontSize: 11, fontWeight: '700' },
  summaryLineRight: { alignItems: 'flex-end', gap: 2 },
  summaryLineValue: { color: colors.paper, fontSize: 12, fontWeight: '800' },
  summaryLineDue: { color: '#B9E4FB', fontSize: 10 },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.18)', height: 1 },
  footerActions: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
