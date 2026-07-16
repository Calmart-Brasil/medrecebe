import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field, InlineNotice } from '../components/ui';
import {
  DEMO_CPF,
  DEMO_PASSWORD,
  biometricAvailability,
  formatCpf,
  isBiometricLoginEnabled,
  registerLocalAccount,
  signIn,
  signInWithBiometrics,
} from '../services/auth';
import { colors, radius, shadow } from '../theme';
import type { UserProfile } from '../types';

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (profile: UserProfile) => void }) {
  const [registerMode, setRegisterMode] = useState(false);
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [biometrics, setBiometrics] = useState<{ enabled: boolean; label: string }>({
    enabled: false,
    label: 'biometria',
  });

  useEffect(() => {
    Promise.all([isBiometricLoginEnabled(), biometricAvailability()])
      .then(([enabled, availability]) => setBiometrics({ enabled: enabled && availability.available, label: availability.label }))
      .catch(() => setBiometrics({ enabled: false, label: 'biometria' }));
  }, []);

  const authenticate = async (action: () => Promise<UserProfile>) => {
    setLoading(true);
    setError('');
    try {
      onAuthenticated(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir o acesso.');
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    if (registerMode) {
      if (password !== confirmation) {
        setError('As senhas não conferem.');
        return;
      }
      void authenticate(() => registerLocalAccount(name, cpf, email, password));
      return;
    }
    void authenticate(() => signIn(cpf, password));
  };

  const useDemo = () => {
    setCpf(formatCpf(DEMO_CPF));
    setPassword(DEMO_PASSWORD);
    void authenticate(() => signIn(DEMO_CPF, DEMO_PASSWORD));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandBlock}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} />
            <Text style={styles.brand}>MedRecebe</Text>
            <Text style={styles.tagline}>Seus atendimentos. Seus repasses. Tudo conferido.</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.title}>{registerMode ? 'Criar meu acesso' : 'Boas-vindas'}</Text>
            <Text style={styles.subtitle}>
              {registerMode
                ? 'No MVP, sua conta e seus dados ficam somente neste aparelho.'
                : 'Entre para registrar atendimentos e acompanhar seus recebíveis.'}
            </Text>

            {registerMode ? (
              <>
                <Field
                  autoCapitalize="words"
                  autoComplete="name"
                  label="Nome completo"
                  onChangeText={setName}
                  placeholder="Dra. Maria Silva"
                  value={name}
                />
                <Field
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  label="E-mail"
                  onChangeText={setEmail}
                  placeholder="voce@exemplo.com"
                  value={email}
                />
              </>
            ) : null}

            <Field
              autoComplete="off"
              keyboardType="number-pad"
              label="CPF"
              maxLength={14}
              onChangeText={(value) => setCpf(formatCpf(value))}
              placeholder="000.000.000-00"
              value={cpf}
            />
            <Field
              autoCapitalize="none"
              autoComplete={registerMode ? 'new-password' : 'current-password'}
              label="Senha"
              onChangeText={setPassword}
              placeholder="Mínimo de 8 caracteres"
              secureTextEntry
              value={password}
            />
            {registerMode ? (
              <Field
                autoCapitalize="none"
                autoComplete="new-password"
                label="Confirmar senha"
                onChangeText={setConfirmation}
                placeholder="Digite a senha novamente"
                secureTextEntry
                value={confirmation}
              />
            ) : null}

            {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}

            <Button loading={loading} onPress={submit} title={registerMode ? 'Criar acesso' : 'Entrar'} />

            {!registerMode && biometrics.enabled ? (
              <Button
                disabled={loading}
                onPress={() => void authenticate(signInWithBiometrics)}
                title={`Entrar com ${biometrics.label}`}
                variant="secondary"
              />
            ) : null}

            <Pressable
              onPress={() => {
                setRegisterMode((value) => !value);
                setError('');
              }}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.switchText}>
                {registerMode ? 'Já tenho acesso' : 'Primeiro uso? Criar meu acesso'}
              </Text>
            </Pressable>
          </View>

          {!registerMode ? (
            <View style={styles.demoCard}>
              <View style={styles.demoCopy}>
                <Text style={styles.demoTitle}>Avaliar o MVP</Text>
                <Text style={styles.demoText}>Entre com dados fictícios e alguns recebíveis de exemplo.</Text>
              </View>
              <Button compact disabled={loading} onPress={useDemo} title="Usar demo" variant="ghost" />
            </View>
          ) : null}

          <Text style={styles.privacy}>Ao continuar, você concorda com o tratamento local dos dados para operar o aplicativo.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.blue700, flex: 1 },
  content: { backgroundColor: colors.mist, flexGrow: 1, gap: 18, padding: 22, paddingBottom: 34 },
  brandBlock: { alignItems: 'center', paddingBottom: 6, paddingTop: 18 },
  logo: { borderRadius: 24, height: 96, width: 96, ...shadow },
  brand: { color: colors.navy, fontSize: 28, fontWeight: '900', letterSpacing: -0.7, marginTop: 12 },
  tagline: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4, maxWidth: 310, textAlign: 'center' },
  formCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 14,
    padding: 20,
    ...shadow,
  },
  title: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 2 },
  switchText: { color: colors.blue700, fontSize: 14, fontWeight: '800', paddingVertical: 4, textAlign: 'center' },
  demoCard: {
    alignItems: 'center',
    backgroundColor: colors.blue050,
    borderColor: '#BFE5FA',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 14,
  },
  demoCopy: { flex: 1, gap: 3 },
  demoTitle: { color: colors.navy, fontSize: 14, fontWeight: '800' },
  demoText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  privacy: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingHorizontal: 12, textAlign: 'center' },
  pressed: { opacity: 0.65 },
});
