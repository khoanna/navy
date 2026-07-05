'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useNavySession } from '@/lib/auth/SessionContext';
import { Splash } from '@/ui/Splash';

export default function Index() {
  const { ready } = usePrivy();
  const { session, initializing } = useNavySession();
  const router = useRouter();

  const loading = !ready || initializing;

  useEffect(() => {
    if (!loading) router.replace(session ? '/home' : '/login');
  }, [loading, session, router]);

  return <Splash />;
}
