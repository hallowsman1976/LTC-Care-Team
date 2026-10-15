import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import type { Actor } from '@smart-ltc/shared';
import { api, ApiError, appHref, isDemoMode, post } from '../lib/api';
import { Button, Card, ErrorState, Loading } from '../components/ui';

interface GoogleAccounts {
  id: {
    initialize(options: { client_id: string; callback: (response: { credential: string }) => void; auto_select: boolean }): void;
    renderButton(element: HTMLElement, options: Record<string, unknown>): void;
  };
}

declare global { interface Window { google?: { accounts: GoogleAccounts } } }

export function Login() {
  return isDemoMode ? <PasswordLogin/> : <PilotLogin/>;
}

interface Health { mode: 'DEMO' | 'PILOT'; passwordAuth: boolean; googleAuth: boolean }

/** PILOT signs in with whatever the server has enabled: password + TOTP without Google Workspace. */
function PilotLogin() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), staleTime: Infinity });
  if (health.isLoading) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><Loading/></main>;
  if (health.data?.googleAuth && !health.data.passwordAuth) return <GoogleLogin/>;
  return <PasswordLogin/>;
}

function GoogleLogin() {
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
            window.location.assign(appHref('/'));
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

const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2';

interface EnrollmentChallenge { status: 'MFA_ENROLLMENT_REQUIRED'; enrollmentToken: string; secret: string; otpauthUri: string; accountLabel: string }

/**
 * Password plus a 6-digit authenticator code (in the DEMO only CM/ADMIN need the code). A user
 * without an authenticator yet is taken through setting one up instead of being signed in.
 */
function PasswordLogin() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<EnrollmentChallenge | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await post<Actor | EnrollmentChallenge>('/auth/password/login', { identifier: form.get('identifier'), password: form.get('password'), totpCode: form.get('totpCode') });
      if ('status' in result && result.status === 'MFA_ENROLLMENT_REQUIRED') setChallenge(result);
      else window.location.assign(appHref('/'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };
  if (challenge) return <TotpEnrollment challenge={challenge} onRestart={() => setChallenge(null)}/>;
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
    <Card className="w-full max-w-md p-7">
      {isDemoMode ? <p className="text-sm font-bold text-danger">DEMO ONLY — ข้อมูลจำลอง</p> : <p className="text-sm font-bold text-primary">SMART LTC CARE</p>}
      <h1 className="mt-2 text-2xl font-bold">{isDemoMode ? 'เข้าสู่ระบบทดลอง' : 'เข้าสู่ระบบหน่วยบริการ'}</h1>
      <p className="mt-2 text-sm text-slate-600">{isDemoMode
        ? 'บัญชีทดลองสร้างโดยผู้ดูแลระบบ CM และผู้ดูแลระบบต้องกรอกรหัสยืนยัน 6 หลักจากแอป Authenticator'
        : 'กรอกชื่อผู้ใช้ รหัสผ่าน และรหัสยืนยัน 6 หลักจากแอป Authenticator ในโทรศัพท์ของท่าน ครั้งแรกที่เข้าสู่ระบบ ระบบจะพาตั้งค่าแอปให้ก่อน'}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm font-semibold text-slate-700">ชื่อผู้ใช้<input name="identifier" autoComplete="username" autoCapitalize="none" required className={fieldClass}/></label>
        <label className="block text-sm font-semibold text-slate-700">รหัสผ่าน<input name="password" type="password" autoComplete="current-password" required minLength={12} className={fieldClass}/></label>
        <label className="block text-sm font-semibold text-slate-700">รหัสยืนยัน 6 หลัก{isDemoMode ? ' (CM/ผู้ดูแลระบบ)' : ''}
          <span className="block text-xs font-normal text-slate-500">เว้นว่างได้ถ้ายังไม่เคยตั้งค่าแอป</span>
          <input name="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" className={fieldClass}/></label>
        <Button type="submit" disabled={busy} className="w-full">เข้าสู่ระบบ</Button>
      </form>
      {error && <div className="mt-4"><ErrorState message={error}/></div>}
      {!isDemoMode && <p className="mt-6 text-xs text-slate-500">ลืมรหัสผ่านหรือเปลี่ยนโทรศัพท์ ติดต่อผู้จัดการการดูแล (CM) · การเข้าใช้งานและการเปลี่ยนแปลงข้อมูลจะถูกบันทึกเพื่อการตรวจสอบ</p>}
    </Card>
  </main>;
}

/** Shows the new secret as a QR code (for a computer) and as a link that opens the authenticator (on the phone). */
function TotpEnrollment({ challenge, onRestart }: { challenge: EnrollmentChallenge; onRestart: () => void }) {
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(challenge.otpauthUri, { margin: 1, width: 220 }).then((url) => { if (active) setQr(url); }).catch(() => setQr(''));
    return () => { active = false; };
  }, [challenge.otpauthUri]);
  const grouped = challenge.secret.match(/.{1,4}/g)?.join(' ') ?? challenge.secret;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await post<Actor>('/auth/mfa/enroll', { enrollmentToken: challenge.enrollmentToken, totpCode: form.get('totpCode') });
      window.location.assign(appHref('/'));
    } catch (reason) {
      if (reason instanceof ApiError && ['MFA_ENROLLMENT_EXPIRED', 'MFA_ALREADY_ENROLLED'].includes(reason.code)) { onRestart(); return; }
      setError(reason instanceof Error ? reason.message : 'ยืนยันไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
    <Card className="w-full max-w-md p-7">
      <p className="text-sm font-bold text-primary">ตั้งค่าการยืนยันตัวตนสองชั้น</p>
      <h1 className="mt-2 text-2xl font-bold">ผูกแอป Authenticator</h1>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>ติดตั้งแอป Google Authenticator หรือ Microsoft Authenticator ในโทรศัพท์</li>
        <li>สแกน QR ด้านล่าง หรือถ้าเปิดหน้านี้บนโทรศัพท์เครื่องเดียวกัน กดปุ่ม "เปิดในแอป Authenticator"</li>
        <li>กรอกรหัส 6 หลักที่แอปแสดง เพื่อยืนยันและเข้าสู่ระบบ</li>
      </ol>
      <div className="mt-4 flex justify-center">{qr ? <img src={qr} alt="QR สำหรับเพิ่มบัญชีในแอป Authenticator" width={220} height={220} className="rounded-xl border border-slate-200"/> : <Loading/>}</div>
      <a href={challenge.otpauthUri} className="mt-3 block rounded-xl border border-primary px-4 py-3 text-center font-semibold text-primary">เปิดในแอป Authenticator</a>
      <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">กรอกรหัสลับเองแทนการสแกน</summary>
        <p className="mt-2">บัญชี: <span className="font-semibold">{challenge.accountLabel}</span></p>
        <p className="mt-1 select-all break-all font-mono text-base tracking-wider text-slate-900">{grouped}</p>
        <p className="mt-1 text-xs">ประเภท: ตามเวลา (Time-based) · 6 หลัก</p>
      </details>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold text-slate-700">รหัส 6 หลักจากแอป<input name="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus className={fieldClass}/></label>
        <Button type="submit" disabled={busy} className="w-full">ยืนยันและเข้าสู่ระบบ</Button>
      </form>
      {error && <div className="mt-4"><ErrorState message={error}/></div>}
      <p className="mt-4 text-xs text-slate-500">ห้ามถ่ายภาพหรือส่ง QR นี้ให้ผู้อื่น ต้องยืนยันภายใน 10 นาที</p>
    </Card>
  </main>;
}
