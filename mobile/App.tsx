import { useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Drawer } from './src/components/Drawer';
import { TopBar } from './src/components/ui';
import { clearAppData, loadAppData, saveAppData } from './src/data/store';
import { AccountScreen } from './src/screens/AccountScreen';
import { AttendanceFormScreen } from './src/screens/AttendanceFormScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ReconciliationScreen } from './src/screens/ReconciliationScreen';
import { WorkplaceFormScreen } from './src/screens/WorkplaceFormScreen';
import { WorkplacesScreen } from './src/screens/WorkplacesScreen';
import { DEMO_CPF, deleteLocalAccount } from './src/services/auth';
import { clearEvidence } from './src/services/evidence';
import { colors } from './src/theme';
import type { AppData, AppRoute, Attendance, UserProfile, Workplace } from './src/types';

SplashScreen.setOptions({ duration: 450, fade: true });

const TITLES: Record<AppRoute['name'], string> = {
  home: 'Início',
  dashboard: 'Dashboard',
  workplaces: 'Locais e repasses',
  workplace_form: 'Cadastro do local',
  attendance_form: 'Novo atendimento',
  reconciliation: 'Conciliação',
  account: 'Conta e segurança',
};

type DrawerRoute = Extract<AppRoute['name'], 'home' | 'dashboard' | 'workplaces' | 'reconciliation' | 'account'>;

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [route, setRoute] = useState<AppRoute>({ name: 'home' });
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const authenticate = async (authenticatedProfile: UserProfile) => {
    setLoadingData(true);
    try {
      const loaded = await loadAppData(authenticatedProfile.cpf, authenticatedProfile.cpf === DEMO_CPF);
      setData(loaded);
      setProfile(authenticatedProfile);
      setRoute({ name: 'home' });
    } catch {
      Alert.alert('Não foi possível abrir os dados', 'Feche o aplicativo e tente novamente.');
    } finally {
      setLoadingData(false);
    }
  };

  const commit = (next: AppData) => {
    if (!profile) return;
    setData(next);
    void saveAppData(profile.cpf, next).catch(() => {
      Alert.alert('Falha ao salvar', 'A alteração está na tela, mas não foi gravada neste iPhone. Tente novamente.');
    });
  };

  const upsertWorkplace = (workplace: Workplace) => {
    if (!data) return;
    const exists = data.workplaces.some((item) => item.id === workplace.id);
    commit({
      ...data,
      workplaces: exists
        ? data.workplaces.map((item) => (item.id === workplace.id ? workplace : item))
        : [...data.workplaces, workplace],
    });
  };

  const saveAttendance = (attendance: Attendance) => {
    if (!data) return;
    commit({ ...data, attendances: [attendance, ...data.attendances] });
    setRoute({ name: 'home' });
    Alert.alert('Atendimento salvo', 'O valor e a data prevista já foram adicionados ao Dashboard.');
  };

  const logout = () => {
    setDrawerVisible(false);
    setProfile(null);
    setData(null);
    setRoute({ name: 'home' });
  };

  const deleteAccount = async () => {
    if (!profile) return;
    try {
      await Promise.all([clearAppData(profile.cpf), deleteLocalAccount(), clearEvidence()]);
      logout();
      Alert.alert('Conta excluída', 'O acesso e os dados deste aplicativo foram removidos do iPhone.');
    } catch {
      Alert.alert('Não foi possível excluir tudo', 'Tente novamente. Se o problema continuar, entre em contato com o suporte.');
    }
  };

  const navigateFromDrawer = (name: DrawerRoute) => {
    setDrawerVisible(false);
    setRoute({ name } as AppRoute);
  };

  const back = () => {
    if (route.name === 'attendance_form') setRoute({ name: 'home' });
    else if (route.name === 'workplace_form') setRoute({ name: 'workplaces' });
  };

  const renderScreen = () => {
    if (!data || !profile) return null;

    switch (route.name) {
      case 'home':
        return (
          <HomeScreen
            data={data}
            onAddWorkplace={() => setRoute({ name: 'workplace_form' })}
            onSelectWorkplace={(workplace) => setRoute({ name: 'attendance_form', workplaceId: workplace.id })}
            profile={profile}
          />
        );
      case 'dashboard':
        return (
          <DashboardScreen
            data={data}
            onMarkPaid={(ids) =>
              commit({
                ...data,
                attendances: data.attendances.map((attendance) =>
                  ids.includes(attendance.id) ? { ...attendance, status: 'paid' } : attendance,
                ),
              })
            }
          />
        );
      case 'workplaces':
        return (
          <WorkplacesScreen
            onAdd={() => setRoute({ name: 'workplace_form' })}
            onDelete={(workplace) => upsertWorkplace({ ...workplace, active: false })}
            onEdit={(workplace) => setRoute({ name: 'workplace_form', workplaceId: workplace.id })}
            workplaces={data.workplaces}
          />
        );
      case 'workplace_form': {
        const workplace = data.workplaces.find((item) => item.id === route.workplaceId);
        return (
          <WorkplaceFormScreen
            onCancel={() => setRoute({ name: 'workplaces' })}
            onSave={(saved) => {
              upsertWorkplace(saved);
              setRoute({ name: 'workplaces' });
            }}
            workplace={workplace}
          />
        );
      }
      case 'attendance_form': {
        const workplace = data.workplaces.find((item) => item.id === route.workplaceId);
        if (!workplace) {
          setTimeout(() => setRoute({ name: 'home' }), 0);
          return null;
        }
        return <AttendanceFormScreen onCancel={back} onSave={saveAttendance} workplace={workplace} />;
      }
      case 'reconciliation':
        return (
          <ReconciliationScreen
            data={data}
            onMarkRequested={(ids) => {
              const requestedAt = new Date().toISOString();
              commit({
                ...data,
                attendances: data.attendances.map((attendance) =>
                  ids.includes(attendance.id)
                    ? { ...attendance, status: 'in_reconciliation', reconciliationRequestedAt: requestedAt }
                    : attendance,
                ),
              });
            }}
            onSaveSettings={(workplace, message) =>
              commit({
                ...data,
                workplaces: data.workplaces.map((item) => (item.id === workplace.id ? workplace : item)),
                reconciliation: { defaultMessage: message },
              })
            }
            profile={profile}
          />
        );
      case 'account':
        return <AccountScreen onDeleteAccount={() => void deleteAccount()} onLogout={logout} profile={profile} />;
    }
  };

  if (loadingData) {
    return (
      <SafeAreaProvider>
        <View style={styles.loading}>
          <Image source={require('./assets/icon.png')} style={styles.loadingLogo} />
          <ActivityIndicator color={colors.blue700} size="large" />
          <Text style={styles.loadingText}>Organizando seus recebíveis…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!profile || !data) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoginScreen onAuthenticated={(value) => void authenticate(value)} />
      </SafeAreaProvider>
    );
  }

  const childRoute = route.name === 'attendance_form' || route.name === 'workplace_form';

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.app}>
        <TopBar
          onBack={childRoute ? back : undefined}
          onMenu={childRoute ? undefined : () => setDrawerVisible(true)}
          title={TITLES[route.name]}
        />
        {renderScreen()}
      </View>
      <Drawer
        currentRoute={route.name}
        onClose={() => setDrawerVisible(false)}
        onLogout={logout}
        onNavigate={navigateFromDrawer}
        profile={profile}
        visible={drawerVisible}
      />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { backgroundColor: colors.mist, flex: 1 },
  loading: { alignItems: 'center', backgroundColor: colors.mist, flex: 1, gap: 18, justifyContent: 'center' },
  loadingLogo: { borderRadius: 28, height: 112, width: 112 },
  loadingText: { color: colors.muted, fontSize: 14 },
});
