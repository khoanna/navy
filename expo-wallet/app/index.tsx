import { Redirect } from 'expo-router';
import { useNavySession } from '@/lib/auth/SessionContext';
import { Splash } from '@/ui/Splash';

export default function Index() {
  const { session, initializing } = useNavySession();
  if (initializing) return <Splash />;
  return <Redirect href={session ? '/home' : '/login'} />;
}
