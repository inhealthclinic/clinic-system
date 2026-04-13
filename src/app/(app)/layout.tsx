import { ToastProvider } from '@/components/Toast'
import Sidebar from '@/components/Sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100vh', fontFamily: "'Inter', sans-serif", background: '#F5F5F5' }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </ToastProvider>
  )
}
