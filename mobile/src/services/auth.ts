import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import type { UserProfile } from '../types';

const ACCOUNT_KEY = 'cc.account.v1';
const BIOMETRICS_KEY = 'cc.biometrics.v1';

export const DEMO_CPF = '52998224725';
export const DEMO_PASSWORD = 'Teste@123';

interface StoredAccount {
  profile: UserProfile;
  salt: string;
  passwordHash: string;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

export function formatCpf(value: string): string {
  const digits = onlyDigits(value);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

async function getStoredAccount(): Promise<StoredAccount | null> {
  const stored = await SecureStore.getItemAsync(ACCOUNT_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as StoredAccount;
  } catch {
    return null;
  }
}

async function writeAccount(profile: UserProfile, password: string): Promise<UserProfile> {
  const salt = Crypto.randomUUID();
  const passwordHash = await hashPassword(password, salt);
  await SecureStore.setItemAsync(
    ACCOUNT_KEY,
    JSON.stringify({ profile, salt, passwordHash } satisfies StoredAccount),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  return profile;
}

export async function registerLocalAccount(
  name: string,
  cpfValue: string,
  email: string,
  password: string,
): Promise<UserProfile> {
  const cpf = onlyDigits(cpfValue);
  if (name.trim().length < 3) throw new Error('Informe seu nome completo.');
  if (!isValidCpf(cpf)) throw new Error('Informe um CPF válido.');
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('Informe um e-mail válido.');
  if (password.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');

  const profile = { name: name.trim(), cpf, email: email.trim().toLowerCase() };
  await SecureStore.deleteItemAsync(BIOMETRICS_KEY);
  return writeAccount(profile, password);
}

export async function signIn(cpfValue: string, password: string): Promise<UserProfile> {
  const cpf = onlyDigits(cpfValue);
  let account = await getStoredAccount();

  if (!account && cpf === DEMO_CPF && password === DEMO_PASSWORD) {
    const profile: UserProfile = {
      name: 'Dra. Ana Martins',
      cpf: DEMO_CPF,
      email: 'ana.martins@exemplo.com',
    };
    await writeAccount(profile, DEMO_PASSWORD);
    account = await getStoredAccount();
  }

  if (!account) throw new Error('Acesso não encontrado. Use “Criar meu acesso” no primeiro uso.');
  const receivedHash = await hashPassword(password, account.salt);
  if (cpf !== account.profile.cpf || receivedHash !== account.passwordHash) {
    throw new Error('CPF ou senha incorretos.');
  }
  return account.profile;
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRICS_KEY)) === 'enabled';
}

export async function biometricAvailability(): Promise<{ available: boolean; label: string }> {
  const [hardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const faceId = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  return { available: hardware && enrolled, label: faceId ? 'Face ID' : 'biometria' };
}

export async function enableBiometricLogin(): Promise<void> {
  const availability = await biometricAvailability();
  if (!availability.available) throw new Error('Nenhuma biometria está configurada neste iPhone.');
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Ativar acesso por biometria',
    cancelLabel: 'Cancelar',
    fallbackLabel: 'Usar código do iPhone',
  });
  if (!result.success) throw new Error('Não foi possível confirmar sua biometria.');
  await SecureStore.setItemAsync(BIOMETRICS_KEY, 'enabled');
}

export async function disableBiometricLogin(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRICS_KEY);
}

export async function signInWithBiometrics(): Promise<UserProfile> {
  if (!(await isBiometricLoginEnabled())) throw new Error('O acesso por biometria ainda não foi ativado.');
  const account = await getStoredAccount();
  if (!account) throw new Error('Faça o primeiro acesso com CPF e senha.');

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Entrar no MedRecebe',
    cancelLabel: 'Cancelar',
    fallbackLabel: 'Usar código do iPhone',
  });
  if (!result.success) throw new Error('Biometria não confirmada.');
  return account.profile;
}

export async function deleteLocalAccount(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCOUNT_KEY),
    SecureStore.deleteItemAsync(BIOMETRICS_KEY),
  ]);
}
