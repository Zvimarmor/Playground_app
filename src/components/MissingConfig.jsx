import { AlertTriangle } from 'lucide-react'

export default function MissingConfig() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-400" />
        <h1 className="text-xl font-bold">חסרה הגדרת Supabase</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          העתיקו את <code className="rounded bg-slate-800 px-1">.env.example</code> לקובץ{' '}
          <code className="rounded bg-slate-800 px-1">.env</code> ומלאו את{' '}
          <code className="rounded bg-slate-800 px-1">VITE_SUPABASE_URL</code> ואת{' '}
          <code className="rounded bg-slate-800 px-1">VITE_SUPABASE_ANON_KEY</code>, ואז הפעילו מחדש את השרת.
        </p>
      </div>
    </div>
  )
}
