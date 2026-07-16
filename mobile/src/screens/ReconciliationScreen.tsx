import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as MailComposer from 'expo-mail-composer';

import { Button, Card, Chip, EmptyState, Eyebrow, Field, InlineNotice, PageTitle, Screen, SectionTitle } from '../components/ui';
import { formatCurrency, formatDate, isPastOrToday } from '../services/paymentRules';
import { colors, radius } from '../theme';
import type { AppData, Attendance, UserProfile, Workplace } from '../types';

interface ReconciliationGroup {
  id: string;
  workplace: Workplace;
  month: string;
  attendances: Attendance[];
  totalCents: number;
}

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
    };
    group.attendances.push(attendance);
    group.totalCents += attendance.amountCents;
    map.set(key, group);
  });

  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function replaceAll(source: string, token: string, value: string): string {
  return source.split(token).join(value);
}

export function ReconciliationScreen({
  data,
  profile,
  onSaveSettings,
  onMarkRequested,
}: {
  data: AppData;
  profile: UserProfile;
  onSaveSettings: (workplace: Workplace, message: string) => void;
  onMarkRequested: (attendanceIds: string[]) => void;
}) {
  const groups = useMemo(() => buildGroups(data), [data]);
  const [channelWorkplaceId, setChannelWorkplaceId] = useState(data.workplaces[0]?.id ?? '');
  const channelWorkplace = data.workplaces.find((workplace) => workplace.id === channelWorkplaceId);
  const [recipient, setRecipient] = useState(channelWorkplace?.reconciliationEmail ?? '');
  const [cc, setCc] = useState(channelWorkplace?.reconciliationCc ?? '');
  const [message, setMessage] = useState(data.reconciliation.defaultMessage);
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? '');
  const [sending, setSending] = useState(false);

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

  const send = async () => {
    if (!selectedGroup) return;
    const recipientEmail = selectedGroup.workplace.reconciliationEmail.trim();
    if (!recipientEmail) {
      setChannelWorkplaceId(selectedGroup.workplace.id);
      Alert.alert('Canal não configurado', 'Cadastre o e-mail oficial deste local antes de solicitar a conciliação.');
      return;
    }

    setSending(true);
    try {
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        Alert.alert('E-mail indisponível', 'Configure uma conta no app Mail deste iPhone e tente novamente.');
        return;
      }

      const detail = selectedGroup.attendances
        .map(
          (attendance, index) =>
            `${index + 1}. ${formatDate(attendance.occurredAt)} — ${attendance.modalityName} — ${formatCurrency(attendance.amountCents)}`,
        )
        .join('\n');
      let body = data.reconciliation.defaultMessage;
      body = replaceAll(body, '{{local}}', selectedGroup.workplace.name);
      body = replaceAll(body, '{{periodo}}', monthLabel(selectedGroup.month));
      body = replaceAll(body, '{{quantidade}}', String(selectedGroup.attendances.length));
      body = replaceAll(body, '{{valor}}', formatCurrency(selectedGroup.totalCents));
      body = replaceAll(body, '{{detalhes}}', detail);
      body = replaceAll(body, '{{medico}}', profile.name);

      const result = await MailComposer.composeAsync({
        recipients: [recipientEmail],
        ccRecipients: selectedGroup.workplace.reconciliationCc
          .split(',')
          .map((address) => address.trim())
          .filter(Boolean),
        subject: `Conciliação de repasses — ${selectedGroup.workplace.name} — ${monthLabel(selectedGroup.month)}`,
        body,
        attachments: selectedGroup.attendances.map((attendance) => attendance.evidenceUri).filter(Boolean),
      });

      if (result.status === MailComposer.MailComposerStatus.SENT) {
        onMarkRequested(selectedGroup.attendances.map((attendance) => attendance.id));
        Alert.alert('Solicitação enviada', 'Os atendimentos foram marcados como “em conciliação”.');
      } else if (result.status === MailComposer.MailComposerStatus.SAVED) {
        Alert.alert('Rascunho salvo', 'Os atendimentos só serão marcados após o envio da mensagem.');
      }
    } catch {
      Alert.alert('Não foi possível abrir o e-mail', 'Tente novamente após conferir a conta configurada no app Mail.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen keyboard>
      <View style={styles.heading}>
        <Eyebrow>Conferência de pagamentos</Eyebrow>
        <PageTitle subtitle="Selecione um grupo vencido e abra o e-mail do iPhone com mensagem, valores e comprovantes preenchidos.">
          Conciliação
        </PageTitle>
      </View>

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
            const attachmentCount = group.attendances.filter((attendance) => attendance.evidenceUri).length;
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
                    {group.attendances.length} atend. • {attachmentCount} comprov. • {formatCurrency(group.totalCents)}
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
            {selectedGroup.attendances.length} atendimentos • {monthLabel(selectedGroup.month)}
          </Text>
          {selectedGroup.attendances.some((attendance) => !attendance.evidenceUri) ? (
            <InlineNotice tone="warning">Alguns registros demonstrativos não possuem anexo; eles serão listados no texto do e-mail.</InlineNotice>
          ) : null}
        </Card>
      ) : null}

      <Button disabled={!selectedGroup} loading={sending} onPress={() => void send()} title="Solicitar conferência por e-mail" />

      <Text style={styles.disclaimer}>
        No MVP, o aplicativo nunca envia sozinho: ele abre o compositor nativo para o médico revisar e confirmar o envio.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 7 },
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
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: '#B9E4FB', fontSize: 12, fontWeight: '700' },
  summaryValue: { color: colors.paper, fontSize: 23, fontWeight: '900' },
  summaryCaption: { color: '#B9E4FB', fontSize: 12 },
  disclaimer: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, textAlign: 'center' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});
