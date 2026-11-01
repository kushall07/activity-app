import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiStatusCard } from '../components/ApiStatusCard';
import { api } from '../lib/api';

export default function HomeScreen() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.heading}>Find company for anything you love</Text>
        <Text style={styles.sub}>Foundation build · Bengaluru</Text>
        <ApiStatusCard
          apiUrl={api.baseUrl}
          data={health.data}
          error={health.error}
          loading={health.isFetching}
          onRetry={() => void health.refetch()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f1ec' },
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  heading: { fontSize: 28, fontWeight: '700', color: '#111' },
  sub: { fontSize: 15, color: '#555' },
});
