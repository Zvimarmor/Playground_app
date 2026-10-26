import { Navigate, Route, Routes } from 'react-router-dom'
import CustomerView from './views/CustomerView'
import DoorView from './views/DoorView'
import AdminView from './views/AdminView'
import FindPhotosView from './views/FindPhotosView'
import PhotosAdminView from './views/PhotosAdminView'
import { isConfigured } from './lib/supabase'
import MissingConfig from './components/MissingConfig'

export default function App() {
  if (!isConfigured) return <MissingConfig />

  return (
    <Routes>
      <Route path="/" element={<CustomerView />} />
      <Route path="/door" element={<DoorView />} />
      <Route path="/admin" element={<AdminView />} />
      <Route path="/admin/photos" element={<PhotosAdminView />} />
      <Route path="/find-photos" element={<FindPhotosView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
