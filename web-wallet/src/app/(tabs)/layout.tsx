'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useNavySession } from '@/lib/auth/SessionContext';
import { TabBar } from '@/ui/TabBar';
import { Splash } from '@/ui/Splash';

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { ready } = usePrivy();
  const { session, initializing } = useNavySession();

  // Wait for both Privy and the persisted Navy session to settle before deciding.
  const loading = !ready || initializing;

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  // Never flash a protected screen: hold the splash until we have a session.
  if (loading || !session) return <Splash />;

  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
