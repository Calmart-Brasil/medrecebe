import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, Eyebrow, PageTitle, Screen, SectionTitle } from '../components/ui';
import { describePaymentRule, formatCurrency } from '../services/paymentRules';
import { colors, radius } from '../theme';
import type { Workplace } from '../types';

export function WorkplacesScreen({
  workplaces,
  onAdd,
  onEdit,
  onDelete,
}: {
  workplaces: Workplace[];
  onAdd: () => void;
  onEdit: (workplace: Workplace) => void;
  onDelete: (workplace: Workplace) => void;
}) {
  const confirmDelete = (workplace: Workplace) => {
    Alert.alert(
      'Desativar local?',
      `“${workplace.name}” deixará de aparecer para novos atendimentos. O cadastro e o histórico financeiro serão preservados.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Desativar', style: 'destructive', onPress: () => onDelete(workplace) },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <Eyebrow>Cadastros</Eyebrow>
        <PageTitle subtitle="Configure locais, modalidades, valores de repasse e regras de crédito.">Locais e repasses</PageTitle>
      </View>

      <Button onPress={onAdd} title="Adicionar local de trabalho" />

      <SectionTitle>Locais cadastrados</SectionTitle>
      {workplaces.length === 0 ? (
        <EmptyState
          action={<Button compact onPress={onAdd} title="Adicionar local" />}
          description="Cada local pode ter várias modalidades, valores e prazos diferentes."
          title="Comece pelo primeiro local"
        />
      ) : (
        <View style={styles.list}>
          {workplaces.map((workplace) => (
            <Card key={workplace.id} style={styles.card}>
              <View style={styles.cardHeading}>
                <View style={styles.icon}>
                  <Text style={styles.iconText}>⌂</Text>
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.name}>{workplace.name}</Text>
                  <Text numberOfLines={1} style={styles.address}>
                    {workplace.address || 'Endereço não informado'}
                  </Text>
                </View>
                <View style={[styles.status, !workplace.active && styles.statusInactive]}>
                  <Text style={[styles.statusText, !workplace.active && styles.statusTextInactive]}>
                    {workplace.active ? 'Ativo' : 'Inativo'}
                  </Text>
                </View>
              </View>

              <View style={styles.modalities}>
                {workplace.modalities.length === 0 ? (
                  <Text style={styles.noModes}>Nenhuma modalidade cadastrada.</Text>
                ) : (
                  workplace.modalities.slice(0, 3).map((modality) => (
                    <View key={modality.id} style={styles.modalityRow}>
                      <View style={styles.modalityCopy}>
                        <Text style={styles.modalityName}>{modality.name}</Text>
                        <Text numberOfLines={1} style={styles.modalityRule}>
                          {describePaymentRule(modality.rule)}
                        </Text>
                      </View>
                      <Text style={styles.modalityValue}>{formatCurrency(modality.amountCents)}</Text>
                    </View>
                  ))
                )}
                {workplace.modalities.length > 3 ? (
                  <Text style={styles.moreModes}>+ {workplace.modalities.length - 3} modalidades</Text>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable onPress={() => confirmDelete(workplace)} style={({ pressed }) => pressed && styles.pressed}>
                  <Text style={styles.deleteText}>Desativar</Text>
                </Pressable>
                <Button compact onPress={() => onEdit(workplace)} title="Editar cadastro" variant="secondary" />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 7 },
  list: { gap: 14 },
  card: { gap: 15 },
  cardHeading: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  icon: { alignItems: 'center', backgroundColor: colors.blue100, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  iconText: { color: colors.blue700, fontSize: 18 },
  cardCopy: { flex: 1, gap: 2 },
  name: { color: colors.navy, fontSize: 17, fontWeight: '800' },
  address: { color: colors.muted, fontSize: 12 },
  status: { backgroundColor: colors.greenSoft, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  statusInactive: { backgroundColor: colors.mist },
  statusText: { color: colors.green, fontSize: 10, fontWeight: '800' },
  statusTextInactive: { color: colors.muted },
  modalities: { borderTopColor: colors.line, borderTopWidth: 1, gap: 10, paddingTop: 13 },
  modalityRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  modalityCopy: { flex: 1, gap: 2 },
  modalityName: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  modalityRule: { color: colors.muted, fontSize: 11 },
  modalityValue: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  noModes: { color: colors.amber, fontSize: 12 },
  moreModes: { color: colors.blue700, fontSize: 11, fontWeight: '700' },
  actions: { alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 13 },
  deleteText: { color: colors.red, fontSize: 13, fontWeight: '800', padding: 8 },
  pressed: { opacity: 0.65 },
});
