import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import type { DashboardResponse, SessionUser } from '@shared/contracts'
import { AppShell } from '@/components/AppShell'
import { ErrorPanel, LoadingScreen } from '@/components/ui'
import { ApiError, api } from '@/lib/api'

const overviewPagePromise = import('@/pages/OverviewPage')
const OverviewPage = lazy(async () => {
  const page = await overviewPagePromise
  return { default: page.OverviewPage }
})

const AccountsPage = lazy(() => import('@/pages/AccountsPage').then((page) => ({ default: page.AccountsPage })))
const InputHealthPage = lazy(() =>
  import('@/pages/InputHealthPage').then((page) => ({ default: page.InputHealthPage })),
)
const ActivityPage = lazy(() => import('@/pages/ActivityPage').then((page) => ({ default: page.ActivityPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((page) => ({ default: page.SettingsPage })))
const LoginPage = lazy(() => import('@/pages/LoginPage').then((page) => ({ default: page.LoginPage })))

function Console({
  user,
  initialDashboard,
  onLogout,
  logoutBusy,
  logoutError,
}: {
  user: SessionUser
  initialDashboard?: DashboardResponse
  onLogout: () => void
  logoutBusy: boolean
  logoutError: string | undefined
}) {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
    ...(initialDashboard ? { initialData: initialDashboard, initialDataUpdatedAt: Date.now() } : {}),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
  if (dashboard.isPending) return <LoadingScreen />
  if (dashboard.error && !dashboard.data)
    return (
      <div className="fatal-wrap">
        <ErrorPanel message={dashboard.error.message} onRetry={() => void dashboard.refetch()} />
      </div>
    )
  return (
    <AppShell user={user} onLogout={onLogout} logoutBusy={logoutBusy}>
      {logoutError && (
        <div className="form-error" role="alert">
          退出失败：{logoutError}，请重试。
        </div>
      )}
      {dashboard.error && (
        <div className="stale-data-notice" role="alert">
          自动刷新失败，当前展示上次成功获取的数据。
          <button type="button" onClick={() => void dashboard.refetch()}>
            重试
          </button>
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<LoadingScreen />}>
              <OverviewPage dashboard={dashboard.data} />
            </Suspense>
          }
        />
        <Route
          path="/accounts"
          element={
            <Suspense fallback={<LoadingScreen />}>
              <AccountsPage dashboard={dashboard.data} />
            </Suspense>
          }
        />
        <Route
          path="/input-health"
          element={
            <Suspense fallback={<LoadingScreen />}>
              <InputHealthPage retention={dashboard.data.config.promptAudit} />
            </Suspense>
          }
        />
        <Route
          path="/activity"
          element={
            <Suspense fallback={<LoadingScreen />}>
              <ActivityPage dashboard={dashboard.data} />
            </Suspense>
          }
        />
        <Route
          path="/settings"
          element={
            <Suspense fallback={<LoadingScreen />}>
              <SettingsPage dashboard={dashboard.data} />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const bootstrap = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap, retry: false, staleTime: Infinity })
  const user = sessionUser ?? bootstrap.data?.user ?? null
  useEffect(() => {
    const handleUnauthorized = () => {
      setSessionUser(null)
      queryClient.setQueryData(['bootstrap'], null)
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'bootstrap' })
    }
    window.addEventListener('sub2api-ops:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('sub2api-ops:unauthorized', handleUnauthorized)
  }, [queryClient])
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      setSessionUser(null)
      queryClient.setQueryData(['bootstrap'], null)
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'bootstrap' })
    },
  })
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'
  return (
    <BrowserRouter basename={basename}>
      {bootstrap.isPending && !sessionUser ? (
        <LoadingScreen />
      ) : user ? (
        <Console
          user={user}
          {...(bootstrap.data ? { initialDashboard: bootstrap.data.dashboard } : {})}
          onLogout={() => logout.mutate()}
          logoutBusy={logout.isPending}
          logoutError={logout.error?.message}
        />
      ) : (
        <Suspense fallback={<LoadingScreen />}>
          <LoginPage onAuthenticated={(authenticated) => setSessionUser(authenticated)} />
        </Suspense>
      )}
      {bootstrap.error && !(bootstrap.error instanceof ApiError && bootstrap.error.status === 401) && !user && (
        <div className="session-warning" role="alert">
          {bootstrap.error.message}
        </div>
      )}
    </BrowserRouter>
  )
}
