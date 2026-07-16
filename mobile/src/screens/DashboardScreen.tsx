import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, Eyebrow, PageTitle, Screen, SectionTitle } from '../components/ui';
import { formatCurrency, formatDate, isPastOrToday } from '../services/paymentRules';
import { colors, radius } from '../theme';
import type { AppData } from '../types';

export function DashboardScreen({ data, onMarkPaid }: { data: AppData; onMarkPaid: (attendanceIds: string[]) => void }) {
  const receivables = data.attendances.filter((attendance) => attendance.status !== 'paid');
  const total = receivables.reduce((sum, attendance) => sum + attendance.amountCents, 0);
  const overdue = receivables.filter((attendance) => isPastOrToday(attendance.dueAt));
  const reconciliation = receivables.filter((attendance) => attendance.status === 'in_reconciliation');
  const dueGroups = [...receivables]
    .filter((attendance) => isPastOrToday(attendance.dueAt))
    .reduce<Array<{ id: string; workplaceName: string; dueAt: string; totalCents: number; ids: string[] }>>((groups, attendance) => {
      const workplace = data.workplaces.find((item) => item.id === attendance.workplaceId);
      const id = `${attendance.workplaceId}:${attendance.dueAt}`;
      const existing = groups.find((group) => group.id === id);
      if (existing) {
        existing.totalCents += attendance.amountCents;
        existing.ids.push(attendance.id);
      } else {
        groups.push({
          id,
          workplaceName: workplace?.name ?? 'Local não disponível',
          dueAt: attendance.dueAt,
          totalCents: attendance.amountCents,
          ids: [attendance.id],
        });
      }
      return groups;
    }, [])
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const confirmPaid = (group: (typeof dueGroups)[number]) => {
    Alert.alert(
      'Confirmar recebimento?',
      `${formatCurrency(group.totalCents)} de ${group.workplaceName} será retirado do valor a receber.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Marcar recebido', onPress: () => onMarkPaid(group.ids) },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <Eyebrow>Visão geral</Eyebrow>
        <PageTitle subtitle="Valores calculados a partir das regras cadastradas em cada modalidade.">Dashboard</PageTitle>
      </View>

      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Total a receber</Text>
        <Text style={styles.heroValue}>{formatCurrency(total)}</Text>
        <View style={styles.heroMetrics}>
          <View style={styles.heroMetric}>
            <Text style={styles.heroMetricValue}>{receivables.length}</Text>
            <Text style={styles.heroMetricLabel}>pendentes</Text>
          </View>
          <View style={styles.heroMetric}>
            <Text style={[styles.heroMetricValue, overdue.length > 0 && styles.overdueText]}>{overdue.length}</Text>
            <Text style={styles.heroMetricLabel}>vencidos</Text>
          </View>
          <View style={styles.heroMetric}>
            <Text style={styles.heroMetricValue}>{reconciliation.length}</Text>
            <Text style={styles.heroMetricLabel}>em conciliação</Text>
          </View>
        </View>
      </Card>

      <SectionTitle>Por local de trabalho</SectionTitle>
      {data.workplaces.length === 0 ? (
        <EmptyState description="Cadastre um local e comece a registrar atendimentos." title="Ainda não há dados" />
      ) : (
        <View style={styles.list}>
          {data.workplaces.map((workplace) => {
            const entries = receivables.filter((attendance) => attendance.workplaceId === workplace.id);
            const workplaceTotal = entries.reduce((sum, attendance) => sum + attendance.amountCents, 0);
            const nextDue = [...entries].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]?.dueAt;
            const overdueCount = entries.filter((attendance) => isPastOrToday(attendance.dueAt)).length;

            return (
              <Card key={workplace.id} style={styles.workplaceCard}>
                <View style={styles.workplaceHeading}>
                  <View style={styles.locationIcon}>
                    <Text style={styles.locationIconText}>⌂</Text>
                  </View>
                  <View style={styles.workplaceCopy}>
                    <Text style={styles.workplaceName}>{workplace.name}</Text>
                    <Text style={styles.workplaceCount}>
                      {entries.length} {entries.length === 1 ? 'atendimento' : 'atendimentos'} a receber
                    </Text>
                  </View>
                  {overdueCount > 0 ? (
                    <View style={styles.overdueBadge}>
                      <Text style={styles.overdueBadgeText}>{overdueCount} venc.</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.workplaceValues}>
                  <View>
                    <Text style={styles.valueLabel}>Valor a receber</Text>
                    <Text style={styles.value}>{formatCurrency(workplaceTotal)}</Text>
                  </View>
                  <View style={styles.dueBlock}>
                    <Text style={styles.valueLabel}>Próximo crédito</Text>
                    <Text style={styles.due}>{nextDue ? formatDate(nextDue) : '—'}</Text>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {dueGroups.length > 0 ? (
        <>
          <SectionTitle>Confirmar créditos</SectionTitle>
          <View style={styles.dueGroups}>
            {dueGroups.map((group) => (
              <Card key={group.id} style={styles.dueGroupCard}>
                <View style={styles.dueGroupCopy}>
                  <Text style={styles.dueGroupName}>{group.workplaceName}</Text>
                  <Text style={styles.dueGroupMeta}>
                    Previsto em {formatDate(group.dueAt)} • {group.ids.length} {group.ids.length === 1 ? 'atendimento' : 'atendimentos'}
                  </Text>
                </View>
                <View style={styles.dueGroupAction}>
                  <Text style={styles.dueGroupValue}>{formatCurrency(group.totalCents)}</Text>
                  <Button compact onPress={() => confirmPaid(group)} title="Recebido" variant="secondary" />
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.disclaimer}>
        Dias úteis consideram fins de semana. Feriados bancários entrarão na etapa de sincronização com o backend.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 7 },
  heroCard: { backgroundColor: colors.navy, borderColor: colors.navy, gap: 5, padding: 20 },
  heroLabel: { color: '#B9E4FB', fontSize: 13, fontWeight: '700' },
  heroValue: { color: colors.paper, fontSize: 34, fontWeight: '900', letterSpacing: -0.8 },
  heroMetrics: { borderTopColor: 'rgba(255,255,255,0.18)', borderTopWidth: 1, flexDirection: 'row', marginTop: 13, paddingTop: 14 },
  heroMetric: { alignItems: 'center', flex: 1, gap: 2 },
  heroMetricValue: { color: colors.paper, fontSize: 20, fontWeight: '900' },
  heroMetricLabel: { color: '#B9E4FB', fontSize: 10, textAlign: 'center' },
  overdueText: { color: '#FFB7BD' },
  list: { gap: 12 },
  workplaceCard: { gap: 16 },
  workplaceHeading: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  locationIcon: { alignItems: 'center', backgroundColor: colors.blue100, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  locationIconText: { color: colors.blue700, fontSize: 19 },
  workplaceCopy: { flex: 1, gap: 2 },
  workplaceName: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  workplaceCount: { color: colors.muted, fontSize: 12 },
  overdueBadge: { backgroundColor: colors.redSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  overdueBadgeText: { color: colors.red, fontSize: 10, fontWeight: '800' },
  workplaceValues: { alignItems: 'flex-end', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 14 },
  valueLabel: { color: colors.muted, fontSize: 11, marginBottom: 3 },
  value: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  dueBlock: { alignItems: 'flex-end' },
  due: { color: colors.blue700, fontSize: 15, fontWeight: '800' },
  dueGroups: { gap: 10 },
  dueGroupCard: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 13 },
  dueGroupCopy: { flex: 1, gap: 3 },
  dueGroupName: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  dueGroupMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  dueGroupAction: { alignItems: 'flex-end', gap: 7 },
  dueGroupValue: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  disclaimer: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 6, textAlign: 'center' },
});
