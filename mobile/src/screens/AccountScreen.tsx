import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Eyebrow, InlineNotice, PageTitle, Screen, SectionTitle } from '../components/ui';
import {
  biometricAvailability,
  disableBiometricLogin,
  enableBiometricLogin,
  formatCpf,
  isBiometricLoginEnabled,
} from '../services/auth';
import { colors, radius } from '../theme';
import type { UserProfile } from '../types';

const PRIVACY_URL = 'https://calmart.github.io/medrecebe/privacidade.html';
const SUPPORT_URL = 'https://calmart.github.io/medrecebe/suporte.html';

export function AccountScreen({
  profile,
  onLogout,
  onDeleteAccount,
}: {
  profile: UserProfile;
  onLogout: () => void;
  onDeleteAccount: () => void;
}) {
  const [biometrics, setBiometrics] = useState({ available: false, enabled: false, label: 'Biometria' });
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([biometricAvailability(), isBiometricLoginEnabled()])
      .then(([availability, enabled]) =>
        setBiometrics({ available: availability.available, enabled, label: availability.label }),
      )
      .catch(() => setBiometrics({ available: false, enabled: false, label: 'biometria' }));
  }, []);

  const toggleBiometrics = async () => {
    setUpdating(true);
    setMessage('');
    try {
      if (biometrics.enabled) {
        await disableBiometricLogin();
        setBiometrics((current) => ({ ...current, enabled: false }));
        setMessage('A entrada por biometria foi desativada.');
      } else {
        await enableBiometricLogin();
        setBiometrics((current) => ({ ...current, enabled: true }));
        setMessage(`A entrada por ${biometrics.label} foi ativada.`);
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível alterar a biometria.');
    } finally {
      setUpdating(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Excluir conta e dados?',
      'Esta ação remove deste iPhone o acesso, os locais, atendimentos, comprovantes e configurações. Não é possível desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir tudo', style: 'destructive', onPress: onDeleteAccount },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <Eyebrow>Perfil</Eyebrow>
        <PageTitle subtitle="Gerencie seu acesso e os dados guardados neste aparelho.">Conta e segurança</PageTitle>
      </View>

      <Card style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile.name.trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.detail}>{formatCpf(profile.cpf)}</Text>
          <Text style={styles.detail}>{profile.email}</Text>
        </View>
      </Card>

      <SectionTitle>Entrada no aplicativo</SectionTitle>
      <Card style={styles.securityCard}>
        <View style={styles.securityRow}>
          <View style={styles.securityIcon}>
            <Text style={styles.securityIconText}>◎</Text>
          </View>
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>Entrar com {biometrics.label}</Text>
            <Text style={styles.securityDescription}>
              {biometrics.available
                ? 'Use a biometria do iPhone após o primeiro acesso com CPF e senha.'
                : 'Configure Face ID ou Touch ID nos Ajustes do iPhone para usar esta opção.'}
            </Text>
          </View>
        </View>
        <Button
          disabled={!biometrics.available}
          loading={updating}
          onPress={() => void toggleBiometrics()}
          title={biometrics.enabled ? 'Desativar biometria' : 'Ativar biometria'}
          variant={biometrics.enabled ? 'secondary' : 'primary'}
        />
        {message ? <InlineNotice tone={biometrics.enabled ? 'success' : 'info'}>{message}</InlineNotice> : null}
      </Card>

      <SectionTitle>Privacidade e suporte</SectionTitle>
      <Card style={styles.linksCard}>
        <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <Text style={styles.linkText}>Política de Privacidade</Text>
          <Text style={styles.linkArrow}>›</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable onPress={() => void Linking.openURL(SUPPORT_URL)} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
          <Text style={styles.linkText}>Ajuda e suporte</Text>
          <Text style={styles.linkArrow}>›</Text>
        </Pressable>
      </Card>

      <Button onPress={onLogout} title="Sair da conta" variant="secondary" />
      <Button onPress={confirmDelete} title="Excluir conta e todos os dados" variant="danger" />

      <Text style={styles.version}>MedRecebe • versão 1.0.0 (MVP)</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 7 },
  profileCard: { alignItems: 'center', flexDirection: 'row', gap: 14 },
  avatar: { alignItems: 'center', backgroundColor: colors.navy, borderRadius: 30, height: 60, justifyContent: 'center', width: 60 },
  avatarText: { color: colors.paper, fontSize: 23, fontWeight: '900' },
  profileCopy: { flex: 1, gap: 3 },
  name: { color: colors.navy, fontSize: 18, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 13 },
  securityCard: { gap: 15 },
  securityRow: { flexDirection: 'row', gap: 12 },
  securityIcon: { alignItems: 'center', backgroundColor: colors.blue100, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  securityIconText: { color: colors.blue700, fontSize: 25 },
  securityCopy: { flex: 1, gap: 4 },
  securityTitle: { color: colors.navy, fontSize: 15, fontWeight: '800' },
  securityDescription: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  linksCard: { paddingVertical: 5 },
  linkRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 51, paddingHorizontal: 7 },
  linkText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  linkArrow: { color: colors.blue700, fontSize: 25 },
  divider: { backgroundColor: colors.line, height: 1 },
  version: { color: colors.muted, fontSize: 11, paddingTop: 4, textAlign: 'center' },
  pressed: { opacity: 0.65 },
});
