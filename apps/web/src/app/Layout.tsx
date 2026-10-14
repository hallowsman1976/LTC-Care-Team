import { Bell, CalendarDays, ChevronDown, ClipboardCheck, ClipboardList, FileUp, Home, IdCard, LogOut, Menu, Settings, UserCheck, UserPlus, Users, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Actor, Capability, Role } from '@smart-ltc/shared';
import { appHref, appMode, canSwitchDemoRole, getDemoRole, isDemoMode, isStaticPreview, logout, setDemoRole } from '../lib/api';

interface NavItem { to: string; label: string; icon: LucideIcon; capability?: Capability }

const mainNav: NavItem[] = [
  { to: '/', label: 'หน้าหลัก', icon: Home },
  { to: '/patients', label: 'ผู้รับบริการ', icon: Users, capability: 'patients:read' },
  { to: '/assignments', label: 'มอบหมายงาน CG', icon: UserCheck, capability: 'assignments:manage' },
  { to: '/visits', label: 'งานเยี่ยม', icon: ClipboardList, capability: 'patients:read' },
  { to: '/reviews', label: 'ตรวจทาน', icon: ClipboardCheck, capability: 'encounter:review' },
  { to: '/calendar', label: 'ปฏิทิน', icon: CalendarDays, capability: 'patients:read' },
  { to: '/alerts', label: 'การแจ้งเตือน', icon: Bell, capability: 'patients:read' }
];

export const settingsNav: NavItem[] = [
  { to: '/settings/import', label: 'นำเข้าข้อมูลผู้ป่วย', icon: FileUp, capability: 'patients:import' },
  { to: '/settings/caregivers', label: 'เพิ่ม CG', icon: UserPlus, capability: 'users:manage' },
  { to: '/settings/users', label: 'ข้อมูลผู้ใช้งาน', icon: IdCard, capability: 'users:manage' }
];

export const allowedFor = (actor: Actor) => (item: NavItem) => !item.capability || actor.capabilities.includes(item.capability);

const sideLink = ({ isActive }: { isActive: boolean }) => `flex items-center gap-3 rounded-xl px-3 py-3 ${isActive ? 'bg-sky-50 font-bold text-primary' : 'text-slate-700 hover:bg-slate-50'}`;

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: (() => void) | undefined }) {
  return <>{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={onNavigate} className={sideLink}><Icon aria-hidden size={20}/>{label}</NavLink>)}</>;
}

/** Main items, then a collapsible การตั้งค่า group (open while one of its pages is showing). */
function SideNav({ main, settings, onNavigate }: { main: NavItem[]; settings: NavItem[]; onNavigate?: (() => void) | undefined }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(pathname.startsWith('/settings'));
  return <>
    <NavLinks items={main} onNavigate={onNavigate}/>
    {settings.length > 0 && <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${pathname.startsWith('/settings') ? 'font-bold text-primary' : 'text-slate-700'} hover:bg-slate-50`}>
        <Settings aria-hidden size={20}/><span className="flex-1">การตั้งค่า</span><ChevronDown aria-hidden size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`}/>
      </button>
      {open && <div className="ml-5 space-y-1 border-l border-slate-200 pl-2"><NavLinks items={settings} onNavigate={onNavigate}/></div>}
    </div>}
  </>;
}

export function Layout({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const main = mainNav.filter(allowedFor(actor));
  const settings = settingsNav.filter(allowedFor(actor));
  const [moreOpen, setMoreOpen] = useState(false);
  // The phone bar holds five slots: all items when they fit, otherwise four and a เมนู button.
  const fitsBar = main.length <= 5 && settings.length === 0;
  const barItems = fitsBar ? main : main.slice(0, 4);
  const switchRole = (role: Lowercase<Role>) => { setDemoRole(role); navigate(0); };
  const signOut = async () => { await logout(); window.location.assign(appHref('/')); };
  return (
    <div className="min-h-screen bg-slate-50 pb-24 pt-12 md:pb-0 md:pl-64">
      <div data-testid="environment-banner" className={`fixed inset-x-0 top-0 z-50 flex h-12 items-center justify-center overflow-hidden px-2 text-center text-xs font-bold leading-tight text-white sm:text-sm ${isDemoMode ? 'bg-red-700' : 'bg-amber-700'}`}>
        {isStaticPreview ? <span>หน้าตัวอย่าง — ข้อมูลจำลอง ไม่มีการบันทึกจริง</span> : isDemoMode ? <><span className="sm:hidden">DEMO ONLY — ข้อมูลจำลอง ห้ามใช้กับผู้ป่วยจริง</span><span className="hidden sm:inline">DEMO ONLY — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้กับผู้ป่วยจริง</span></> : <span>PILOT — ข้อมูลจริงที่ได้รับอนุญาต · ห้ามคัดลอกหรือเผยแพร่นอกระบบ</span>}
      </div>
      <aside className="fixed inset-y-0 left-0 hidden w-64 overflow-y-auto border-r border-slate-200 bg-white pb-6 pt-16 md:block">
        <div className="p-5"><h1 className="text-xl font-bold text-primary">Smart LTC Care</h1><p className="text-sm text-slate-500">{isDemoMode ? 'รพ.สต. ตัวอย่าง' : (import.meta.env.VITE_FACILITY_NAME || 'หน่วยบริการ')}</p></div>
        <nav aria-label="เมนูหลัก" className="space-y-1 px-3">
          <SideNav main={main} settings={settings}/>
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
      {moreOpen && <div className="fixed inset-0 z-[60] bg-slate-900/40 md:hidden" onClick={() => setMoreOpen(false)}>
        <div role="dialog" aria-modal="true" aria-label="เมนูทั้งหมด" className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6" onClick={(event) => event.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between px-2"><p className="font-bold">เมนู</p><button type="button" onClick={() => setMoreOpen(false)} aria-label="ปิดเมนู" className="rounded-lg p-2 text-slate-600"><X aria-hidden size={20}/></button></div>
          <nav aria-label="เมนูทั้งหมด" className="space-y-1"><SideNav main={main.slice(4)} settings={settings} onNavigate={() => setMoreOpen(false)}/></nav>
        </div>
      </div>}
      <nav aria-label="เมนูมือถือ" className={`fixed inset-x-0 bottom-0 z-50 grid border-t border-slate-200 bg-white md:hidden ${['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5'][(fitsBar ? barItems.length : 5) - 1]}`}>
        {barItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs ${isActive ? 'font-bold text-primary' : 'text-slate-600'}`}><Icon aria-hidden size={21}/>{label}</NavLink>)}
        {!fitsBar && <button type="button" onClick={() => setMoreOpen(true)} className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs text-slate-600"><Menu aria-hidden size={21}/>เมนู</button>}
      </nav>
    </div>
  );
}

