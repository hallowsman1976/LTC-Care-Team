import type { ReactNode } from 'react';

export const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2';
export const labelClass = 'block text-sm font-semibold text-slate-700';

export function AdminPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="space-y-5"><div><h2 className="text-2xl font-bold">{title}</h2><p className="text-slate-600">{description}</p></div>{children}</div>;
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ');
