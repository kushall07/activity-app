import { Redirect } from 'expo-router';
import { Text } from 'react-native';
import { useApp } from '../auth/AppContext';
import { Button, Loading, Screen, Title } from '../components/ui';
import { nextRoute, useMe } from '../lib/useMe';

/** Entry gate: sends members to login, the next onboarding step, or their profile. */
export default function Index() {
  const { status } = useApp();
  const me = useMe();

  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (me.data) return <Redirect href={nextRoute(me.data)} />;
  if (me.error) {
    return (
      <Screen>
        <Title sub={me.error.message}>Can't load your profile</Title>
        <Button label="Try again" onPress={() => void me.refetch()} loading={me.isFetching} />
        <Text />
      </Screen>
    );
  }
  return <Loading />;
}
