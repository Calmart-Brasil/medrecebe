import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
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

export function AttendanceFormScreen({
  workplace,
  onCancel,
  onSave,
}: {
  workplace: Workplace;
  onCancel: () => void;
  onSave: (attendance: Attendance) => void;
}) {
  const activeModalities = workplace.modalities.filter((modality) => modality.active);
  const [selectedId, setSelectedId] = useState(activeModalities[0]?.id ?? '');
  const [occurredAt, setOccurredAt] = useState(formatDateInput(new Date()));
  const [photoUri, setPhotoUri] = useState('');
  const [notes, setNotes] = useState('');
  const [patientReference, setPatientReference] = useState('');
  const [medication, setMedication] = useState('');
  const [includeConsultation, setIncludeConsultation] = useState(false);
  const [consultationModalityId, setConsultationModalityId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const modality = activeModalities.find((item) => item.id === selectedId);
  const consultationModalities = activeModalities.filter((item) => item.id !== selectedId && item.type !== 'recurring');
  const consultationModality = consultationModalities.find((item) => item.id === consultationModalityId) ?? consultationModalities[0];
  const totalCents = (modality?.amountCents ?? 0) + (includeConsultation ? consultationModality?.amountCents ?? 0 : 0);
  const parsedDate = parseDateInput(occurredAt);
  const dueAt = useMemo(
    () => (modality && parsedDate ? calculateDueDate(parsedDate, modality.rule) : null),
    [modality, parsedDate],
  );

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
    if (!modality) {
      setError('Selecione uma modalidade de repasse.');
      return;
    }
    if (!parsedDate || !dueAt) {
      setError('Informe uma data válida no formato DD/MM/AAAA.');
      return;
    }
    if (modality.type === 'recurring' && !patientReference.trim()) {
      setError('Informe uma identificação mínima do paciente, como iniciais ou código interno.');
      return;
    }
    if (modality.type === 'recurring' && !medication.trim()) {
      setError('Informe o medicamento ou tratamento.');
      return;
    }
    if (includeConsultation && !consultationModality) {
      setError('Cadastre e selecione uma modalidade de consulta.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const evidenceUri = await persistEvidence(photoUri);
      onSave({
        id: createId('att'),
        workplaceId: workplace.id,
        modalityId: modality.id,
        modalityName: modality.name,
        modalityType: modality.type,
        occurredAt: parsedDate,
        dueAt,
        amountCents: totalCents,
        baseAmountCents: modality.amountCents,
        evidenceUri,
        notes: notes.trim(),
        patientReference: modality.type === 'recurring' ? patientReference.trim() : '',
        medication: modality.type === 'recurring' ? medication.trim() : '',
        includeConsultation: includeConsultation && Boolean(consultationModality),
        consultationModalityId: includeConsultation ? consultationModality?.id : undefined,
        consultationModalityName: includeConsultation ? consultationModality?.name : undefined,
        consultationAmountCents: includeConsultation ? consultationModality?.amountCents : 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    } catch {
      setError('Não foi possível guardar o comprovante. Tente fotografá-lo novamente.');
      setSaving(false);
    }
  };

  const modalityCard = (item: PaymentModality) => {
    const selected = selectedId === item.id;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        key={item.id}
        onPress={() => {
          setSelectedId(item.id);
          setIncludeConsultation(false);
          setConsultationModalityId('');
        }}
        style={({ pressed }) => [styles.modality, selected && styles.modalitySelected, pressed && styles.pressed]}
      >
        <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
        <View style={styles.modalityCopy}>
          <Text style={[styles.modalityName, selected && styles.modalityNameSelected]}>{item.name}</Text>
          <Text style={styles.modalityRule}>{describePaymentRule(item.rule)}</Text>
        </View>
        <Text style={styles.modalityValue}>{formatCurrency(item.amountCents)}</Text>
      </Pressable>
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
            <Button compact onPress={() => void takePhoto()} title="Refazer foto" variant="secondary" />
            <Button compact onPress={() => setPhotoUri('')} title="Remover" variant="ghost" />
          </View>
        </Card>
      ) : (
        <View style={styles.photoPlaceholder}>
          <View style={styles.cameraIcon}>
            <Text style={styles.cameraIconText}>▣</Text>
          </View>
          <Text style={styles.photoTitle}>Fotografe a prova do atendimento</Text>
          <Text style={styles.photoHelp}>Evite incluir dados clínicos desnecessários. O arquivo ficará na área privada do aplicativo.</Text>
          <View style={styles.photoButtons}>
            <View style={styles.photoButton}>
              <Button onPress={() => void takePhoto()} title="Abrir câmera" />
            </View>
            <View style={styles.photoButton}>
              <Button onPress={() => void choosePhoto()} title="Escolher foto" variant="secondary" />
            </View>
          </View>
        </View>
      )}

      <SectionTitle>Modalidade de repasse</SectionTitle>
      <View style={styles.modalities}>{activeModalities.map(modalityCard)}</View>

      {modality?.type === 'recurring' ? (
        <Card style={styles.recurringCard}>
          <SectionTitle>Receita recorrente</SectionTitle>
          <Field
            label="Identificação do paciente"
            onChangeText={setPatientReference}
            placeholder="Use iniciais ou um código interno"
            value={patientReference}
          />
          <Field
            label="Medicamento ou tratamento"
            onChangeText={setMedication}
            placeholder="Ex.: imunobiológico ou medicamento oncológico"
            value={medication}
          />
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Consulta associada</Text>
            <Chip
              label={includeConsultation ? 'Consulta contabilizada' : 'Contabilizar também uma consulta'}
              onPress={() => setIncludeConsultation((current) => !current)}
              selected={includeConsultation}
            />
          </View>
          {includeConsultation ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Modalidade da consulta</Text>
              <View style={styles.modalities}>
                {consultationModalities.map((item) => (
                  <Chip
                    key={item.id}
                    label={`${item.name} • ${formatCurrency(item.amountCents)}`}
                    onPress={() => setConsultationModalityId(item.id)}
                    selected={(consultationModality?.id ?? '') === item.id}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Field
        label="Observação (opcional)"
        multiline
        onChangeText={setNotes}
        placeholder="Inclua somente informações necessárias para identificar ou conciliar o atendimento."
        value={notes}
      />

      {modality && dueAt ? (
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Valor contabilizado</Text>
            <Text style={styles.summaryValue}>{formatCurrency(totalCents)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Crédito previsto</Text>
            <Text style={styles.summaryDue}>{formatDate(dueAt)}</Text>
          </View>
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
  photoActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  modalities: { gap: 9 },
  modality: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 76,
    padding: 13,
  },
  modalitySelected: { backgroundColor: colors.blue050, borderColor: colors.blue600, borderWidth: 1.5 },
  radio: { alignItems: 'center', borderColor: colors.line, borderRadius: 10, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 },
  radioSelected: { borderColor: colors.blue700 },
  radioDot: { backgroundColor: colors.blue700, borderRadius: 5, height: 10, width: 10 },
  modalityCopy: { flex: 1, gap: 3 },
  modalityName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  modalityNameSelected: { color: colors.blue700 },
  modalityRule: { color: colors.muted, fontSize: 11 },
  modalityValue: { color: colors.navy, fontSize: 14, fontWeight: '900' },
  summaryCard: { backgroundColor: colors.navy, borderColor: colors.navy, gap: 13 },
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: '#B9E4FB', fontSize: 12, fontWeight: '700' },
  summaryValue: { color: colors.paper, fontSize: 20, fontWeight: '900' },
  summaryDue: { color: colors.paper, fontSize: 17, fontWeight: '800' },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.18)', height: 1 },
  footerActions: { flexDirection: 'row', gap: 10 },
  footerButton: { flex: 1 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
