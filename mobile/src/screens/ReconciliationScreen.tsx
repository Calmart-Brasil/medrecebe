import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import { Button, Card, Chip, EmptyState, Eyebrow, Field, InlineNotice, PageTitle, Screen, SectionTitle } from '../components/ui';
import { formatCurrency, formatDate, isPastOrToday } from '../services/paymentRules';
import { createReconciliationPdf } from '../services/reconciliationPdf';
import type { InvoiceSource } from '../services/invoice';
import { colors, radius } from '../theme';
import type { AppData, Attendance, InvoiceReconciliation, UserProfile, Workplace } from '../types';

interface ReconciliationGroup {
  id: string;
  workplace: Workplace;
  month: string;
  attendances: Attendance[];
  totalCents: number;
  quantity: number;
}

const quantityOf = (attendance: Attendance) => Math.max(1, attendance.quantity ?? 1);

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const value = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(year!, monthNumber! - 1, 1, 12),
  );
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildGroups(data: AppData): ReconciliationGroup[] {
  const map = new Map<string, ReconciliationGroup>();
  const overdue = data.attendances.filter(
    (attendance) => attendance.status === 'pending' && isPastOrToday(attendance.dueAt),
  );

  overdue.forEach((attendance) => {
    const workplace = data.workplaces.find((item) => item.id === attendance.workplaceId);
    if (!workplace) return;
    const month = attendance.dueAt.slice(0, 7);
    const key = `${workplace.id}:${month}`;
    const group = map.get(key) ?? {
      id: key,
      workplace,
      month,
      attendances: [],
      totalCents: 0,
      quantity: 0,
    };
    group.attendances.push(attendance);
    group.totalCents += attendance.amountCents;
    group.quantity += quantityOf(attendance);
    map.set(key, group);
  });

  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function ReconciliationScreen({
  data,
  profile,
  onSaveSettings,
  onMarkRequested,
  onImportInvoice,
  onCreateWorkplace,
  onDeleteInvoice,
}: {
  data: AppData;
  profile: UserProfile;
  onSaveSettings: (workplace: Workplace, message: string) => void;
  onMarkRequested: (attendanceIds: string[]) => void;
  onImportInvoice: (source: InvoiceSource) => Promise<void>;
  onCreateWorkplace: (invoice: InvoiceReconciliation) => void;
  onDeleteInvoice: (invoiceId: string) => void;
}) {
  const groups = useMemo(() => buildGroups(data), [data]);
  const [channelWorkplaceId, setChannelWorkplaceId] = useState(data.workplaces[0]?.id ?? '');
  const channelWorkplace = data.workplaces.find((workplace) => workplace.id === channelWorkplaceId);
  const [recipient, setRecipient] = useState(channelWorkplace?.reconciliationEmail ?? '');
  const [cc, setCc] = useState(channelWorkplace?.reconciliationCc ?? '');
  const [message, setMessage] = useState(data.reconciliation.defaultMessage);
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? '');
  const [sharing, setSharing] = useState(false);
  const [importingInvoice, setImportingInvoice] = useState(false);
  const latestInvoice = data.invoices[0];

  useEffect(() => {
    setRecipient(channelWorkplace?.reconciliationEmail ?? '');
    setCc(channelWorkplace?.reconciliationCc ?? '');
  }, [channelWorkplace]);

  useEffect(() => {
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? '');
    }
  }, [groups, selectedGroupId]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);

  const saveChannel = () => {
    if (!channelWorkplace) return;
    if (recipient.trim() && !/^\S+@\S+\.\S+$/.test(recipient.trim())) {
      Alert.alert('E-mail inválido', 'Confira o endereço do canal oficial de conciliação.');
      return;
    }
    onSaveSettings(
      {
        ...channelWorkplace,
        reconciliationEmail: recipient.trim().toLowerCase(),
        reconciliationCc: cc.trim().toLowerCase(),
      },
      message.trim(),
    );
    Alert.alert('Configuração salva', 'O canal e a mensagem padrão foram atualizados.');
  };

  const pickInvoice = async () => {
    setImportingInvoice(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/pdf', 'application/xml', 'text/xml'],
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      await onImportInvoice({ uri: asset.uri, fileName: asset.name, mimeType: asset.mimeType });
    } catch (error) {
      Alert.alert('Não foi possível ler a Nota Fiscal', error instanceof Error ? error.message : 'Tente novamente com o PDF ou XML original.');
    } finally {
      setImportingInvoice(false);
    }
  };

  const shareReconciliation = async () => {
    if (!selectedGroup) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Compartilhamento indisponível', 'Não foi possível abrir o compartilhamento deste aparelho.');
        return;
      }
      const result = await createReconciliationPdf(selectedGroup, profile, data.reconciliation.defaultMessage);
      await Sharing.shareAsync(result.uri, {
        UTI: 'com.adobe.pdf',
        mimeType: 'application/pdf',
        dialogTitle: 'Compartilhar conciliação',
      });
      const attachmentNotice = result.omittedAttachments
        ? ` ${result.omittedAttachments} comprovante(s) não puderam entrar no PDF e estão sinalizados no documento.`
        : '';
      Alert.alert(
        'Envio concluído?',
        `O aparelho retornou ao MedRecebe.${attachmentNotice} Você concluiu o envio da conciliação?`,
        [
          { text: 'Ainda não', style: 'cancel' },
          {
            text: 'Sim, marcar como enviada',
            onPress: () => {
              onMarkRequested(selectedGroup.attendances.map((attendance) => attendance.id));
              Alert.alert('Conciliação registrada', 'Os atendimentos foram marcados como “em conciliação”.');
            },
          },
        ],
      );
    } catch (error) {
      Alert.alert('Não foi possível preparar o PDF', error instanceof Error ? error.message : 'Tente novamente em alguns instantes.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen keyboard>
      <View style={styles.heading}>
        <Eyebrow>Conferência de pagamentos</Eyebrow>
        <PageTitle subtitle="Selecione um grupo vencido e envie a conferência com os valores e comprovantes consolidados.">
          Conciliação
        </PageTitle>
      </View>

      <SectionTitle>Conferir Nota Fiscal</SectionTitle>
      <Card style={styles.invoiceCard}>
        <Text style={styles.invoiceTitle}>Envie o PDF ou XML recebido</Text>
        <Text style={styles.invoiceDescription}>
          O MedRecebe identifica CNPJ e Razão Social do pagador e compara o valor da nota com os atendimentos contabilizados.
        </Text>
        <Button compact loading={importingInvoice} onPress={() => void pickInvoice()} title="Selecionar Nota Fiscal" />
        <Text style={styles.invoiceHint}>No iPhone, você também pode abrir o arquivo pelo e-mail e escolher MedRecebe no menu Compartilhar.</Text>
      </Card>

      {latestInvoice ? (
        <Card style={latestInvoice.status === 'matched' ? [styles.invoiceResult, styles.invoiceResultMatched] : styles.invoiceResult}>
          <View style={styles.summaryRow}>
            <Text style={styles.invoiceResultTitle}>
              {latestInvoice.status === 'matched' ? 'Valores coincidem' : latestInvoice.status === 'divergent' ? 'Divergência encontrada' : latestInvoice.status === 'group_not_found' ? 'Pagador identificado' : 'Pagador não identificado'}
            </Text>
            <View style={styles.invoiceHeaderActions}>
              <Text style={styles.invoiceBadge}>{latestInvoice.status === 'matched' ? 'CONCILIADO' : 'REVISAR'}</Text>
              <Pressable
                accessibilityLabel="Apagar Nota Fiscal anexada"
                onPress={() => Alert.alert(
                  'Apagar Nota Fiscal?',
                  'O documento será removido da conciliação.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Apagar', style: 'destructive', onPress: () => onDeleteInvoice(latestInvoice.id) },
                  ],
                )}
                style={({ pressed }) => [styles.invoiceTrash, pressed && styles.pressed]}
              >
                <Text style={styles.invoiceTrashIcon}>🗑</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.invoiceFile}>{latestInvoice.fileName}{latestInvoice.workplaceName ? ` • ${latestInvoice.workplaceName}` : ''}</Text>
          <View style={styles.invoiceValues}>
            <View><Text style={styles.invoiceValueLabel}>VALOR DA NOTA</Text><Text style={styles.invoiceValue}>{latestInvoice.amountCents === null ? 'Não identificado' : formatCurrency(latestInvoice.amountCents)}</Text></View>
            <View><Text style={styles.invoiceValueLabel}>CONTABILIZADO</Text><Text style={styles.invoiceValue}>{latestInvoice.expectedCents === null ? '—' : formatCurrency(latestInvoice.expectedCents)}</Text></View>
          </View>
          <Text style={styles.invoiceHint}>
            {latestInvoice.status === 'divergent'
              ? `Diferença de ${formatCurrency(Math.abs(latestInvoice.differenceCents ?? 0))}. Revise antes de solicitar a conferência.`
              : latestInvoice.status === 'payer_not_matched'
                ? 'Confira se CNPJ e Razão Social estão iguais ao documento.'
                : latestInvoice.status === 'group_not_found'
                  ? 'Não há grupo vencido deste local para comparar.'
                  : 'A Nota Fiscal corresponde ao total contabilizado do grupo.'}
          </Text>
          {latestInvoice.status === 'payer_not_matched' ? (
            <Button compact onPress={() => onCreateWorkplace(latestInvoice)} title="Cadastrar local pela Nota Fiscal" />
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>Canal oficial</SectionTitle>
      {data.workplaces.length === 0 ? (
        <InlineNotice tone="warning">Cadastre um local de trabalho antes de configurar a conciliação.</InlineNotice>
      ) : (
        <Card style={styles.settingsCard}>
          <View style={styles.chips}>
            {data.workplaces.map((workplace) => (
              <Chip
                key={workplace.id}
                label={workplace.name}
                onPress={() => setChannelWorkplaceId(workplace.id)}
                selected={channelWorkplaceId === workplace.id}
              />
            ))}
          </View>
          <Field
            autoCapitalize="none"
            keyboardType="email-address"
            label="E-mail oficial do local"
            onChangeText={setRecipient}
            placeholder="repasses@local.com.br"
            value={recipient}
          />
          <Field
            autoCapitalize="none"
            hint="Separe vários endereços com vírgula."
            keyboardType="email-address"
            label="Cópia (opcional)"
            onChangeText={setCc}
            placeholder="gestor@local.com.br"
            value={cc}
          />
          <Field
            hint="Tokens disponíveis: {{local}}, {{periodo}}, {{quantidade}}, {{valor}}, {{detalhes}} e {{medico}}."
            label="Mensagem padrão"
            multiline
            onChangeText={setMessage}
            value={message}
          />
          <Button compact onPress={saveChannel} title="Salvar canal e mensagem" variant="secondary" />
        </Card>
      )}

      <SectionTitle>Grupos prontos para conciliar</SectionTitle>
      {groups.length === 0 ? (
        <EmptyState
          description="Quando um grupo ultrapassar a data prevista sem baixa, ele aparecerá aqui."
          title="Nenhum repasse vencido"
        />
      ) : (
        <View style={styles.groups}>
          {groups.map((group) => {
            const selected = selectedGroupId === group.id;
            const attachmentCount = new Set(group.attendances.map((attendance) => attendance.evidenceUri).filter(Boolean)).size;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={group.id}
                onPress={() => setSelectedGroupId(group.id)}
                style={({ pressed }) => [styles.groupCard, selected && styles.groupCardSelected, pressed && styles.pressed]}
              >
                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                  <Text style={styles.checkmark}>{selected ? '✓' : ''}</Text>
                </View>
                <View style={styles.groupCopy}>
                  <Text style={styles.groupName}>{group.workplace.name}</Text>
                  <Text style={styles.groupPeriod}>{monthLabel(group.month)}</Text>
                  <Text style={styles.groupMeta}>
                    {group.quantity} atend. • {attachmentCount} comprov. • {formatCurrency(group.totalCents)}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {selectedGroup ? (
        <Card style={styles.selectedSummary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Selecionado</Text>
            <Text style={styles.summaryValue}>{formatCurrency(selectedGroup.totalCents)}</Text>
          </View>
          <Text style={styles.summaryCaption}>
            {selectedGroup.quantity} atendimentos • {monthLabel(selectedGroup.month)}
          </Text>
          {selectedGroup.attendances.some((attendance) => !attendance.evidenceUri) ? (
            <InlineNotice tone="warning">Alguns registros não possuem anexo e serão sinalizados no relatório.</InlineNotice>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.sendActions}>
        <Button disabled={!selectedGroup} loading={sharing} onPress={() => void shareReconciliation()} title="Enviar conciliação" />
      </View>

    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 7 },
  invoiceCard: { gap: 12 },
  invoiceTitle: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  invoiceDescription: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  invoiceHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  invoiceResult: { backgroundColor: '#FFF8E9', borderColor: '#F2C979', gap: 10 },
  invoiceResultMatched: { backgroundColor: colors.greenSoft, borderColor: '#8ED8B1' },
  invoiceResultTitle: { color: colors.navy, flex: 1, fontSize: 17, fontWeight: '900' },
  invoiceHeaderActions: { alignItems: 'flex-end', gap: 8 },
  invoiceBadge: { color: colors.blue700, fontSize: 10, fontWeight: '900' },
  invoiceTrash: { alignItems: 'center', backgroundColor: '#FFF0F1', borderColor: '#F0BCC2', borderRadius: 10, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  invoiceTrashIcon: { color: '#C83D4B', fontSize: 17 },
  invoiceFile: { color: colors.muted, fontSize: 12 },
  invoiceValues: { flexDirection: 'row', justifyContent: 'space-between' },
  invoiceValueLabel: { color: colors.muted, fontSize: 9, fontWeight: '800' },
  invoiceValue: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  settingsCard: { gap: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groups: { gap: 10 },
  groupCard: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 15,
  },
  groupCardSelected: { backgroundColor: colors.blue050, borderColor: colors.blue600, borderWidth: 1.5 },
  checkbox: { alignItems: 'center', borderColor: colors.line, borderRadius: 7, borderWidth: 2, height: 25, justifyContent: 'center', width: 25 },
  checkboxSelected: { backgroundColor: colors.blue700, borderColor: colors.blue700 },
  checkmark: { color: colors.paper, fontSize: 16, fontWeight: '900' },
  groupCopy: { flex: 1, gap: 2 },
  groupName: { color: colors.navy, fontSize: 15, fontWeight: '800' },
  groupPeriod: { color: colors.blue700, fontSize: 12, fontWeight: '700' },
  groupMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  chevron: { color: colors.blue700, fontSize: 25 },
  selectedSummary: { backgroundColor: colors.navy, borderColor: colors.navy, gap: 8 },
  sendActions: { gap: 8 },
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: '#B9E4FB', fontSize: 12, fontWeight: '700' },
  summaryValue: { color: colors.paper, fontSize: 23, fontWeight: '900' },
  summaryCaption: { color: '#B9E4FB', fontSize: 12 },
  disclaimer: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, textAlign: 'center' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});
