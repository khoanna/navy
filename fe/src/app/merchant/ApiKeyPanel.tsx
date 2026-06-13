'use client';
import { useState } from 'react';

export default function ApiKeyPanel() {
  const [issued, setIssued] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const [error, setError] = useState('');

  async function create() {
    setError('');
    const res = await fetch('/api/merchant/api-keys', { method: 'POST' });
    const body = await res.json();
    if (res.ok) setIssued({ apiKey: body.apiKey, apiSecret: body.apiSecret });
    else setError(body.error ?? 'Failed (is your merchant account approved?)');
  }

  return (
    <div>
      <button onClick={create}>Generate API key</button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {issued && (
        <div style={{ marginTop: 8 }}>
          <p><b>API key:</b> <code>{issued.apiKey}</code></p>
          <p><b>API secret (shown once):</b> <code>{issued.apiSecret}</code></p>
        </div>
      )}
    </div>
  );
}
