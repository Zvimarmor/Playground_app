import { AlertTriangle } from 'lucide-react'
import { Sky } from './ui'

export default function MissingConfig() {
  const code = 'rounded-lg border-2 border-brand-black bg-brand-yellow px-1.5 font-black'
  return (
    <Sky>
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-3xl border-[3px] border-brand-black bg-brand-white p-6 text-center shadow-brutal">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border-2 border-brand-black bg-brand-coral shadow-brutal-xs">
            <AlertTriangle className="h-9 w-9 text-brand-white" />
          </div>
          <h1 className="text-2xl font-black">חסרה הגדרת Supabase</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed text-brand-black/70">
            העתיקו את <code className={code}>.env.example</code> לקובץ{' '}
            <code className={code}>.env</code> ומלאו את{' '}
            <code className={code}>VITE_SUPABASE_URL</code> ואת{' '}
            <code className={code}>VITE_SUPABASE_ANON_KEY</code>, ואז הפעילו מחדש את השרת.
          </p>
        </div>
      </div>
    </Sky>
  )
}
