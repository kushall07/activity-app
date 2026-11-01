import { normalizePhone } from '@activity/shared';
import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../auth/AppContext';
import { Button, ErrorText, Field, Screen, Title } from '../components/ui';
import { colors } from '../theme';

export default function LoginScreen() {
  const { api } = useApp();
  const [input, setInput] = useState('');
  const phone = normalizePhone(input);

  const start = useMutation({
    mutationFn: (p: string) => api.startOtp(p),
    onSuccess: (res, p) =>
      router.push({
        pathname: '/verify',
        params: { phone: p, challengeId: res.challengeId, resendAfter: String(res.resendAfter) },
      }),
  });

  return (
    <Screen>
      <Title sub="Find company for anything you love: badminton, comedy nights, workshops, dinners.">
        What's your number?
      </Title>
      <View style={styles.row}>
        <Text style={styles.prefix}>+91</Text>
        <View style={styles.flex}>
          <Field
            label="Mobile number"
            value={input}
            onChangeText={setInput}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder="98765 43210"
            maxLength={16}
            autoFocus
          />
        </View>
      </View>
      <Text style={styles.small}>We'll text you a 6-digit code. Standard SMS rates may apply.</Text>
      <ErrorText>{start.error?.message}</ErrorText>
      <Button
        label="Send code"
        onPress={() => phone && start.mutate(phone)}
        disabled={!phone}
        loading={start.isPending}
      />
      <Link href="/status" style={styles.link}>
        Server status
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  flex: { flex: 1 },
  prefix: { fontSize: 17, fontWeight: '600', paddingBottom: 14, color: colors.text },
  small: { fontSize: 13, color: colors.muted },
  link: { color: colors.muted, textAlign: 'center', marginTop: 'auto', paddingTop: 24 },
});
