import { Bell, CalendarDays, ClipboardCheck, ClipboardList, Home, LogOut, Users } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Actor, Role } from '@smart-ltc/shared';
import { appHref, appMode, canSwitchDemoRole, getDemoRole, isDemoMode, isStaticPreview, logout, setDemoRole } from '../lib/api';

const allNav = [
  { to: '/', label: 'หน้าหลัก', icon: Home },
  { to: '/patients', label: 'ผู้รับบริการ', icon: Users },
  { to: '/visits', label: 'งานเยี่ยม', icon: ClipboardList },
  { to: '/reviews', label: 'ตรวจทาน', icon: ClipboardCheck, capability: 'encounter:review' },
  { to: '/calendar', label: 'ปฏิทิน', icon: CalendarDays },
  { to: '/alerts', label: 'แจ้งเตือน', icon: Bell }
] as const;

export function Layout({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const nav = allNav.filter((item) => !('capability' in item) || actor.capabilities.includes(item.capability));
  const switchRole = (role: Lowercase<Role>) => { setDemoRole(role); navigate(0); };
  const signOut = async () => { await logout(); window.location.assign(appHref('/')); };
  return (
    <div className="min-h-screen bg-slate-50 pb-24 pt-12 md:pb-0 md:pl-64">
      <div data-testid="environment-banner" className={`fixed inset-x-0 top-0 z-50 flex h-12 items-center justify-center overflow-hidden px-2 text-center text-xs font-bold leading-tight text-white sm:text-sm ${isDemoMode ? 'bg-red-700' : 'bg-amber-700'}`}>
        {isStaticPreview ? <span>หน้าตัวอย่าง — ข้อมูลจำลอง ไม่มีการบันทึกจริง</span> : isDemoMode ? <><span className="sm:hidden">DEMO ONLY — ข้อมูลจำลอง ห้ามใช้กับผู้ป่วยจริง</span><span className="hidden sm:inline">DEMO ONLY — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้กับผู้ป่วยจริง</span></> : <span>PILOT — ข้อมูลจริงที่ได้รับอนุญาต · ห้ามคัดลอกหรือเผยแพร่นอกระบบ</span>}
      </div>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white pt-16 md:block">
        <div className="p-5"><h1 className="text-xl font-bold text-primary">Smart LTC Care</h1><p className="text-sm text-slate-500">{isDemoMode ? 'รพ.สต. ตัวอย่าง' : (import.meta.env.VITE_FACILITY_NAME || 'หน่วยบริการ')}</p></div>
        <nav aria-label="เมนูหลัก" className="space-y-1 px-3">
          {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-3 ${isActive ? 'bg-sky-50 font-bold text-primary' : 'text-slate-700 hover:bg-slate-50'}`}><Icon aria-hidden size={20}/>{label}</NavLink>)}
        </nav>
      </aside>
      <header className="sticky top-12 z-40 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-8">
        <div><p className="font-bold">{actor.role === 'CM' ? 'ผู้จัดการการดูแล' : actor.role === 'CG' ? 'ผู้ดูแล' : 'ผู้ดูแลระบบ'}</p><p className="text-xs text-slate-500">Asia/Bangkok</p></div>
        <div className="flex items-center gap-2">
          {canSwitchDemoRole && <><label htmlFor="demo-role" className="sr-only">สลับบทบาทจำลอง</label>
          <select id="demo-role" value={getDemoRole()} onChange={(event) => switchRole(event.target.value as Lowercase<Role>)} className="rounded-lg border border-slate-300 px-2" aria-label="สลับบทบาทจำลอง">
            <option value="admin">Admin</option><option value="cm">CM</option><option value="cg">CG</option>
          </select></>}
          <span className="sr-only">{appMode}</span>
          <button onClick={signOut} aria-label="ออกจากระบบ" className="rounded-lg p-2 text-slate-600"><LogOut aria-hidden size={20}/></button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-8"><Outlet /></main>
      <nav aria-label="เมนูมือถือ" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-slate-200 bg-white md:hidden">
        {nav.slice(0, 4).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${isActive ? 'font-bold text-primary' : 'text-slate-600'}`}><Icon aria-hidden size={21}/>{label}</NavLink>)}
      </nav>
    </div>
  );
}

