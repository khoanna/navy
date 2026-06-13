'use client';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/admin/login'); }}>
      Sign out
    </button>
  );
}
