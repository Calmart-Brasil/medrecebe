import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, Eyebrow, PageTitle, Screen, SectionTitle } from '../components/ui';
import { formatCurrency } from '../services/paymentRules';
import { colors, radius } from '../theme';
import type { AppData, UserProfile, Workplace } from '../types';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function HomeScreen({
  data,
  profile,
  onSelectWorkplace,
  onAddWorkplace,
}: {
  data: AppData;
  profile: UserProfile;
  onSelectWorkplace: (workplace: Workplace) => void;
  onAddWorkplace: () => void;
}) {
  const pending = data.attendances.filter((attendance) => attendance.status !== 'paid');
  const pendingTotal = pending.reduce((sum, attendance) => sum + attendance.amountCents, 0);
  const activeWorkplaces = data.workplaces.filter((workplace) => workplace.active);

  return (
    <Screen>
      <View style={styles.heading}>
        <Eyebrow>Olá, {firstName(profile.name)}</Eyebrow>
        <PageTitle subtitle="Escolha onde você atendeu para fazer um novo registro.">Registrar atendimento</PageTitle>
      </View>

      <Card style={styles.summary}>
        <View style={styles.summaryMain}>
          <Text style={styles.summaryLabel}>A receber</Text>
          <Text style={styles.summaryValue}>{formatCurrency(pendingTotal)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryCount}>{pending.length}</Text>
          <Text style={styles.summaryCaption}>atendimentos</Text>
        </View>
      </Card>

      <SectionTitle>Onde foi o atendimento?</SectionTitle>

      {activeWorkplaces.length === 0 ? (
        <EmptyState
          action={<Button compact onPress={onAddWorkplace} title="Cadastrar primeiro local" />}
          description="Adicione o local, as modalidades, os valores e as regras de pagamento."
          title="Nenhum local cadastrado"
        />
      ) : (
        <View style={styles.workplaces}>
          {activeWorkplaces.map((workplace) => {
            const activeModalities = workplace.modalities.filter((modality) => modality.active);
            const disabled = activeModalities.length === 0;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                key={workplace.id}
                onPress={() => onSelectWorkplace(workplace)}
                style={({ pressed }) => [
                  styles.workplaceCard,
                  disabled && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.workplaceIcon}>
                  <Text style={styles.workplaceIconText}>+</Text>
                </View>
                <View style={styles.workplaceCopy}>
                  <Text style={styles.workplaceName}>{workplace.name}</Text>
                  <Text numberOfLines={1} style={styles.workplaceAddress}>
                    {workplace.address || 'Endereço não informado'}
                  </Text>
                  <Text style={styles.workplaceModes}>
                    {activeModalities.length} {activeModalities.length === 1 ? 'modalidade ativa' : 'modalidades ativas'}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {data.isDemoData ? (
        <View style={styles.demoNotice}>
          <Text style={styles.demoText}>Você está vendo dados fictícios de demonstração. Eles podem ser editados ou excluídos.</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 7 },
  summary: { alignItems: 'center', backgroundColor: colors.navy, borderColor: colors.navy, flexDirection: 'row' },
  summaryMain: { flex: 1, gap: 4 },
  summaryLabel: { color: '#B9E4FB', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  summaryValue: { color: colors.paper, fontSize: 26, fontWeight: '900' },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.18)', height: 44, width: 1 },
  summaryMetric: { alignItems: 'center', minWidth: 92 },
  summaryCount: { color: colors.paper, fontSize: 22, fontWeight: '900' },
  summaryCaption: { color: '#B9E4FB', fontSize: 11 },
  workplaces: { gap: 12 },
  workplaceCard: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    minHeight: 104,
    padding: 16,
  },
  workplaceIcon: { alignItems: 'center', backgroundColor: colors.blue100, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  workplaceIconText: { color: colors.blue700, fontSize: 28, fontWeight: '300', marginTop: -2 },
  workplaceCopy: { flex: 1, gap: 3 },
  workplaceName: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  workplaceAddress: { color: colors.muted, fontSize: 12 },
  workplaceModes: { color: colors.blue700, fontSize: 12, fontWeight: '700', marginTop: 4 },
  chevron: { color: colors.blue700, fontSize: 28, fontWeight: '300' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  demoNotice: { backgroundColor: colors.amberSoft, borderRadius: radius.sm, padding: 12 },
  demoText: { color: colors.amber, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
