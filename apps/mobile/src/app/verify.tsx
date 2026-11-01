import { formatPhone } from '@activity/shared';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useApp } from '../auth/AppContext';
import { Button, ErrorText, Field, Screen, Title } from '../components/ui';
import { colors } from '../theme';

export default function VerifyScreen() {
  const params = useLocalSearchParams<{
    phone: string;
    challengeId: string;
    resendAfter?: string;
  }>();
  const { api, session } = useApp();
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [wait, setWait] = useState(Number(params.resendAfter ?? 30));

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const verify = useMutation({
    mutationFn: (c: string) => api.verifyOtp(challengeId, c),
    onSuccess: async (res) => {
      await session.signIn(res);
      router.replace('/');
    },
    onError: () => setCode(''),
  });

  const resend = useMutation({
    mutationFn: () => api.startOtp(params.phone),
    onSuccess: (res) => {
      setChallengeId(res.challengeId);
      setWait(res.resendAfter);
      verify.reset();
    },
  });

  const onChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !verify.isPending) verify.mutate(digits);
  };

  return (
    <Screen>
      <Title sub={`Sent to ${formatPhone(params.phone)}`}>Enter your code</Title>
      <Field
        label="6-digit code"
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
        style={styles.code}
      />
      <ErrorText>{verify.error?.message ?? resend.error?.message}</ErrorText>
      <Button
        label="Verify"
        onPress={() => verify.mutate(code)}
        disabled={code.length !== 6}
        loading={verify.isPending}
      />
      <Button
        label={wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        variant="secondary"
        onPress={() => resend.mutate()}
        disabled={wait > 0}
        loading={resend.isPending}
      />
      <Text style={styles.change} onPress={() => router.back()}>
        Wrong number? Change it
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { letterSpacing: 8, fontSize: 24, textAlign: 'center' },
  change: { color: colors.muted, textAlign: 'center', padding: 8 },
});
