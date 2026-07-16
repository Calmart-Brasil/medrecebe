import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius } from '../theme';
import type { AppRoute, UserProfile } from '../types';

type DrawerRoute = Extract<AppRoute['name'], 'home' | 'dashboard' | 'workplaces' | 'reconciliation' | 'account'>;

const PRIMARY_ITEMS: Array<{ route: DrawerRoute; icon: string; label: string }> = [
  { route: 'dashboard', icon: '▦', label: 'Dashboard' },
  { route: 'workplaces', icon: '⌂', label: 'Locais e repasses' },
  { route: 'reconciliation', icon: '⇄', label: 'Conciliação' },
];

export function Drawer({
  visible,
  currentRoute,
  profile,
  onClose,
  onNavigate,
  onLogout,
}: {
  visible: boolean;
  currentRoute: AppRoute['name'];
  profile: UserProfile;
  onClose: () => void;
  onNavigate: (route: DrawerRoute) => void;
  onLogout: () => void;
}) {
  const item = (route: DrawerRoute, icon: string, label: string) => {
    const active = currentRoute === route;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={route}
        onPress={() => onNavigate(route)}
        style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && styles.pressed]}
      >
        <Text style={[styles.itemIcon, active && styles.itemTextActive]}>{icon}</Text>
        <Text style={[styles.itemText, active && styles.itemTextActive]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.panel}>
          <View style={styles.brandRow}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} />
            <View style={styles.brandCopy}>
              <Text style={styles.brand}>MedRecebe</Text>
              <Text style={styles.brandCaption}>Recebíveis médicos</Text>
            </View>
            <Pressable accessibilityLabel="Fechar menu" hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <View style={styles.menu}>{PRIMARY_ITEMS.map(({ route, icon, label }) => item(route, icon, label))}</View>

          <View style={styles.secondaryMenu}>
            {item('home', '＋', 'Registrar atendimento')}
            {item('account', '○', 'Conta e segurança')}
          </View>

          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{profile.name.trim().charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.profileCopy}>
              <Text numberOfLines={1} style={styles.profileName}>
                {profile.name}
              </Text>
              <Text numberOfLines={1} style={styles.profileEmail}>
                {profile.email}
              </Text>
            </View>
            <Pressable accessibilityLabel="Sair" hitSlop={10} onPress={onLogout}>
              <Text style={styles.logout}>Sair</Text>
            </Pressable>
          </View>
        </SafeAreaView>
        <Pressable accessibilityLabel="Fechar menu" onPress={onClose} style={styles.dismiss} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: colors.overlay, flex: 1, flexDirection: 'row' },
  panel: { backgroundColor: colors.paper, flex: 0, width: '84%' },
  dismiss: { flex: 1 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 20 },
  logo: { borderRadius: 12, height: 48, width: 48 },
  brandCopy: { flex: 1 },
  brand: { color: colors.navy, fontSize: 19, fontWeight: '800' },
  brandCaption: { color: colors.muted, fontSize: 12, marginTop: 2 },
  close: { color: colors.muted, fontSize: 31, fontWeight: '300' },
  menu: { borderTopColor: colors.line, borderTopWidth: 1, gap: 5, padding: 14 },
  secondaryMenu: { borderTopColor: colors.line, borderTopWidth: 1, gap: 5, padding: 14 },
  item: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 14, minHeight: 50, paddingHorizontal: 14 },
  itemActive: { backgroundColor: colors.blue100 },
  itemIcon: { color: colors.muted, fontSize: 21, textAlign: 'center', width: 24 },
  itemText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  itemTextActive: { color: colors.blue700 },
  pressed: { opacity: 0.7 },
  profile: {
    alignItems: 'center',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
    padding: 18,
  },
  avatar: { alignItems: 'center', backgroundColor: colors.navy, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  avatarText: { color: colors.paper, fontSize: 16, fontWeight: '800' },
  profileCopy: { flex: 1 },
  profileName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  profileEmail: { color: colors.muted, fontSize: 11, marginTop: 2 },
  logout: { color: colors.red, fontSize: 13, fontWeight: '800' },
});
