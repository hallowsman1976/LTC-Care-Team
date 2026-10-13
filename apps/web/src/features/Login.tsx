import { useEffect, useRef, useState } from 'react';
import type { Actor } from '@smart-ltc/shared';
import { api } from '../lib/api';
import { Card, ErrorState } from '../components/ui';

interface GoogleAccounts {
  id: {
    initialize(options: { client_id: string; callback: (response: { credential: string }) => void; auto_select: boolean }): void;
    renderButton(element: HTMLElement, options: Record<string, unknown>): void;
  };
}

declare global { interface Window { google?: { accounts: GoogleAccounts } } }

export function Login() {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId || !container.current) return;
    const render = () => {
      if (!window.google || !container.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        callback: async ({ credential }) => {
          try {
            await api<Actor>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken: credential }) });
            window.location.assign('/');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'เข้าสู่ระบบไม่สำเร็จ');
          }
        }
      });
      window.google.accounts.id.renderButton(container.current, { theme: 'outline', size: 'large', text: 'signin_with', width: 320 });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) { existing.addEventListener('load', render, { once: true }); render(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.addEventListener('load', render, { once: true });
    script.addEventListener('error', () => setError('ไม่สามารถโหลดบริการเข้าสู่ระบบได้'), { once: true });
    document.head.appendChild(script);
  }, [clientId]);

  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
    <Card className="w-full max-w-md p-7">
      <p className="text-sm font-bold text-primary">SMART LTC CARE</p>
      <h1 className="mt-2 text-2xl font-bold">เข้าสู่ระบบหน่วยบริการ</h1>
      <p className="mt-2 text-sm text-slate-600">ใช้บัญชี Google Workspace ของหน่วยงานเท่านั้น ระบบจะไม่รับบัญชีภายนอกโดเมน</p>
      <div className="mt-6 flex justify-center" ref={container}/>
      {!clientId && <ErrorState message="ยังไม่ได้กำหนด Google Client ID สำหรับระบบจริง"/>}
      {error && <div className="mt-4"><ErrorState message={error}/></div>}
      <p className="mt-6 text-xs text-slate-500">การเข้าใช้งานและการเปลี่ยนแปลงข้อมูลจะถูกบันทึกเพื่อการตรวจสอบ</p>
    </Card>
  </main>;
}
