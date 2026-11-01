import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const content = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title} accessibilityRole="header">
        {children}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        inactive && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant !== 'primary' && styles.buttonTextSecondary,
            variant === 'danger' && { color: colors.danger },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#999"
        accessibilityLabel={label}
        {...input}
        style={[styles.input, input.multiline && styles.multiline, error && styles.inputError]}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Chips where several can be on, e.g. "who can join". */
export function MultiChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const selected = value.includes(o.value);
          return (
            <Pressable
              key={o.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() =>
                onChange(selected ? value.filter((v) => v !== o.value) : [...value, o.value])
              }
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A number with − and + buttons, e.g. seats or an age bound. */
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.label, styles.flex]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        disabled={value - step < min}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepperButton, value - step < min && styles.buttonDisabled]}
      >
        <Text style={styles.stepperSymbol}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue} accessibilityLabel={`${label}: ${format(value)}`}>
        {format(value)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        disabled={value + step > max}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepperButton, value + step > max && styles.buttonDisabled]}
      >
        <Text style={styles.stepperSymbol}>+</Text>
      </Pressable>
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

export function Loading() {
  return (
    <View style={[styles.safe, styles.center]}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1 },
  content: { flex: 1, padding: 24, gap: 16 },
  titleBlock: { gap: 6, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  sub: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  button: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
  buttonTextSecondary: { color: colors.text },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
  hint: { fontSize: 13, color: colors.muted },
  error: { fontSize: 14, color: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 15 },
  chipTextSelected: { color: colors.surface, fontWeight: '600' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSymbol: { fontSize: 22, color: colors.text, lineHeight: 24 },
  stepperValue: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
});
