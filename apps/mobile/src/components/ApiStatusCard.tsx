import type { HealthResponse } from '@activity/shared';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  apiUrl: string;
  data?: HealthResponse;
  error?: Error | null;
  loading: boolean;
  onRetry: () => void;
};

export function ApiStatusCard({ apiUrl, data, error, loading, onRetry }: Props) {
  const ok = data?.status === 'ok' && !error;
  return (
    <View style={styles.card} accessibilityLabel="API status">
      <View style={styles.row}>
        <View
          style={[styles.dot, { backgroundColor: loading ? '#999' : ok ? '#1a9e55' : '#d64545' }]}
        />
        <Text style={styles.title}>
          {loading ? 'Checking API…' : ok ? 'Connected to API' : 'API unavailable'}
        </Text>
        {loading && <ActivityIndicator style={styles.spinner} />}
      </View>
      <Text style={styles.muted}>{apiUrl}</Text>

      {error && <Text style={styles.error}>{error.message}</Text>}

      {data && (
        <View style={styles.checks}>
          <Text style={styles.muted}>
            {data.service} v{data.version} · up {data.uptimeSeconds}s
          </Text>
          {Object.entries(data.checks ?? {}).map(([name, check]) => (
            <Text key={name} style={styles.check}>
              {check.status === 'up' ? '✓' : '✗'} {name}
              {check.latencyMs !== undefined ? ` · ${check.latencyMs} ms` : ''}
              {check.detail ? ` · ${check.detail}` : ''}
            </Text>
          ))}
        </View>
      )}

      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
        <Text style={styles.buttonText}>Check again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 20, backgroundColor: '#fff', gap: 8, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  title: { fontSize: 18, fontWeight: '600', color: '#111' },
  spinner: { marginLeft: 'auto' },
  muted: { color: '#666', fontSize: 13 },
  error: { color: '#d64545' },
  checks: { gap: 4, marginTop: 4 },
  check: { fontSize: 15, color: '#222' },
  button: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#111',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
});
