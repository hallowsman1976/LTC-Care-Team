import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`} {...props} />;
}

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-2 font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60 ${className}`} {...props} />;
}

export function Status({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode }) {
  const style = {
    success: 'bg-green-100 text-green-900', warning: 'bg-amber-100 text-amber-900',
    danger: 'bg-red-100 text-red-900', neutral: 'bg-slate-100 text-slate-800'
  }[tone];
  return <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${style}`}>{children}</span>;
}

export function Loading() { return <p role="status" className="p-6 text-center text-slate-600">กำลังโหลดข้อมูล…</p>; }
export function ErrorState({ message }: { message: string }) { return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">เกิดข้อผิดพลาด: {message}</p>; }

