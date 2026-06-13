import { cookies } from 'next/headers';
import { ACCESS_COOKIE, decodeJwtRole } from '@/lib/session';
import LogoutButton from './LogoutButton';

export default async function AdminDashboard() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
  const role = decodeJwtRole(token);
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Admin dashboard</h1>
      <p>Signed in as role: <b>{role ?? 'unknown'}</b></p>
      <p>Merchant approval management arrives in the Admin Panel sub-project.</p>
      <LogoutButton />
    </main>
  );
}
