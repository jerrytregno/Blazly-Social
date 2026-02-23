import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoadingScreen from './components/LoadingScreen';
import Landing from './pages/Landing';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Profile from './pages/Profile';
import Posts from './pages/Posts';
import Planner from './pages/Planner';
import Ideas from './pages/Ideas';
import Inbox from './pages/Inbox';
import Competitors from './pages/Competitors';
import Integrations from './pages/Integrations';
import FacebookPageSelection from './pages/FacebookPageSelection';
import InstagramAccountSelection from './pages/InstagramAccountSelection';
import AppLayout from './components/AppLayout';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <Onboarding />
          </ProtectedRoute>
        }
      />
      <Route
        path="/home"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Home />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Profile />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile/competitors"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Competitors />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/posts"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Posts />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/ideas"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Ideas />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/planner"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Planner />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inbox"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Inbox />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/integrations"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Integrations />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/integrations/facebook/select-page"
        element={
          <ProtectedRoute>
            <FacebookPageSelection />
          </ProtectedRoute>
        }
      />
      <Route
        path="/integrations/instagram/select-account"
        element={
          <ProtectedRoute>
            <InstagramAccountSelection />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
