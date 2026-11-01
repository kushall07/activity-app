import { useQuery } from '@tanstack/react-query';
import { ApiStatusCard } from '../components/ApiStatusCard';
import { Screen, Title } from '../components/ui';
import { useApp } from '../auth/AppContext';

/** Diagnostics: which API the build points at and whether its dependencies are up. */
export default function StatusScreen() {
  const { api } = useApp();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  return (
    <Screen>
      <Title>Server status</Title>
      <ApiStatusCard
        apiUrl={api.baseUrl}
        data={health.data}
        error={health.error}
        loading={health.isFetching}
        onRetry={() => void health.refetch()}
      />
    </Screen>
  );
}
