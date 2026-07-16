import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, shadow } from '../theme';

export function TopBar({
  title,
  onMenu,
  onBack,
}: {
  title: string;
  onMenu?: () => void;
  onBack?: () => void;
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.topSafeArea}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={onBack ? 'Voltar' : 'Abrir menu'}
          hitSlop={12}
          onPress={onBack ?? onMenu}
          style={({ pressed }) => [styles.topButton, pressed && styles.pressed]}
        >
          <Text style={styles.topButtonText}>{onBack ? '‹' : '☰'}</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.topTitle}>
          {title}
        </Text>
        <View style={styles.topButton} />
      </View>
    </SafeAreaView>
  );
}

export function Screen({
  children,
  contentStyle,
  keyboard = false,
}: {
  children: ReactNode;
  contentStyle?: ViewStyle;
  keyboard?: boolean;
}) {
  const content = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.screenContent, contentStyle]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  if (!keyboard) return <View style={styles.screen}>{content}</View>;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={8}
      style={styles.screen}
    >
      {content}
    </KeyboardAvoidingView>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <View style={styles.pageHeading}>
      <Text style={styles.pageTitle}>{children}</Text>
      {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  compact = false,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        compact && styles.buttonCompact,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.paper : colors.blue700} />
      ) : (
        <Text style={[styles.buttonLabel, styles[`buttonLabel_${variant}`]]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  multiline,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        selectionColor={colors.blue600}
        style={[styles.input, multiline && styles.multilineInput, error && styles.inputError]}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <Text style={styles.emptyIconText}>＋</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action}
    </Card>
  );
}

export function InlineNotice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'success';
}) {
  return (
    <View style={[styles.notice, styles[`notice_${tone}`]]}>
      <Text style={[styles.noticeText, styles[`noticeText_${tone}`]]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topSafeArea: { backgroundColor: colors.blue700 },
  topBar: {
    alignItems: 'center',
    backgroundColor: colors.blue700,
    flexDirection: 'row',
    height: 58,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  topButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  topButtonText: { color: colors.paper, fontSize: 34, fontWeight: '300', lineHeight: 38 },
  topTitle: { color: colors.paper, flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  screen: { backgroundColor: colors.mist, flex: 1 },
  screenContent: { gap: 18, padding: 20, paddingBottom: 44 },
  eyebrow: {
    color: colors.blue700,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  pageHeading: { gap: 7 },
  pageTitle: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34 },
  pageSubtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: colors.navy, fontSize: 18, fontWeight: '800' },
  card: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 17,
    ...shadow,
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: 14 },
  button_primary: { backgroundColor: colors.blue700, borderColor: colors.blue700 },
  button_secondary: { backgroundColor: colors.paper, borderColor: colors.blue700 },
  button_danger: { backgroundColor: colors.redSoft, borderColor: '#F2C6CB' },
  button_ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonLabel: { fontSize: 15, fontWeight: '800' },
  buttonLabel_primary: { color: colors.paper },
  buttonLabel_secondary: { color: colors.blue700 },
  buttonLabel_danger: { color: colors.red },
  buttonLabel_ghost: { color: colors.blue700 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  fieldGroup: { gap: 7 },
  fieldLabel: { color: colors.navy, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: { minHeight: 112 },
  inputError: { borderColor: colors.red },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.red, fontSize: 12, lineHeight: 17 },
  chip: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.blue100, borderColor: colors.blue600 },
  chipLabel: { color: colors.muted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  chipLabelSelected: { color: colors.blue700 },
  emptyCard: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.blue100,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  emptyIconText: { color: colors.blue700, fontSize: 27, fontWeight: '300' },
  emptyTitle: { color: colors.navy, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, maxWidth: 290, textAlign: 'center' },
  notice: { borderRadius: radius.sm, borderWidth: 1, padding: 13 },
  notice_info: { backgroundColor: colors.blue050, borderColor: '#BFE5FA' },
  notice_warning: { backgroundColor: colors.amberSoft, borderColor: '#EED893' },
  notice_success: { backgroundColor: colors.greenSoft, borderColor: '#BCE5CC' },
  noticeText: { fontSize: 13, lineHeight: 19 },
  noticeText_info: { color: colors.navy },
  noticeText_warning: { color: colors.amber },
  noticeText_success: { color: colors.green },
});

export const uiStyles = styles;
