'use client';
import { useRouter } from 'next/navigation';
import { space } from '@/ui/theme';
import { Button } from '@/ui/Button';
import { AuthCard } from '@/ui/AuthCard';

export default function Home() {
  const router = useRouter();
  return (
    <AuthCard title="Navy" subtitle="Payments back-office">
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <Button label="Admin" onPress={() => router.push('/admin/login')} />
        <Button label="Merchant" variant="secondary" onPress={() => router.push('/merchant/login')} />
      </div>
    </AuthCard>
  );
}
