import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { SiGithub, SiGoogle } from '@icons-pack/react-simple-icons'
import { ArrowRight, LoaderCircle, LockKeyhole } from 'lucide-react'

import type { LoginResponse, OAuthTokenInput, SessionUser } from '@shared/contracts'
import { api } from '@/lib/api'
import { beginOAuth, consumeOAuthCallback } from '@/lib/oauth'
import { AppearanceControl, useAppearance } from '@/components/Appearance'
import { VisualHero } from '@/components/VisualHero'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui'

export function LoginPage({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const { resolvedTheme } = useAppearance()
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, staleTime: 300_000 })
  const [challenge, setChallenge] = useState<{ tempToken: string; maskedEmail: string } | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [error, setError] = useState('')
  const [oauthCallbackActive, setOAuthCallbackActive] = useState(() =>
    window.location.pathname.endsWith('/auth/callback'),
  )
  const turnstile = useRef<TurnstileInstance>(null)
  const oauthHandled = useRef(false)

  const settle = (result: LoginResponse) => {
    if (result.status === 'authenticated') onAuthenticated(result.user)
    else setChallenge({ tempToken: result.tempToken, maskedEmail: result.maskedEmail })
  }
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: settle,
    onError: (value: Error) => {
      setError(value.message)
      setTurnstileToken('')
      turnstile.current?.reset()
    },
  })
  const verify = useMutation({
    mutationFn: api.login2fa,
    onSuccess: settle,
    onError: (value: Error) => setError(value.message),
  })
  const oauthLogin = useMutation({
    mutationFn: api.loginOAuth,
    onSuccess: settle,
    onError: (value: Error) => {
      setError(value.message)
      setOAuthCallbackActive(false)
    },
  })

  useEffect(() => {
    if (oauthHandled.current) return
    oauthHandled.current = true
    const callback = consumeOAuthCallback()
    if (callback.kind === 'tokens') oauthLogin.mutate(callback.input)
    if (callback.kind === 'error') {
      setError(callback.message)
      setOAuthCallbackActive(false)
    }
  }, [oauthLogin])

  const startOAuth = (provider: OAuthTokenInput['provider']) => {
    setError('')
    beginOAuth(provider)
    window.location.assign(api.oauthStartUrl(provider))
  }

  const submitLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    login.mutate({
      email: String(form.get('email')),
      password: String(form.get('password')),
      ...(turnstileToken ? { turnstileToken } : {}),
    })
  }
  const submitTwoFactor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    verify.mutate({ tempToken: challenge!.tempToken, totpCode: String(form.get('totp')) })
  }

  return (
    <main className="login-layout">
      <VisualHero />
      <section className="login-context" aria-label="产品介绍">
        <div className="login-context__top">
          <div className="brand-lockup brand-lockup--large">
            <BrandMark />
            <div>
              <strong>Sub2API</strong>
              <span>运维工作空间</span>
            </div>
          </div>
          <div className="login-context__actions">
            <AppearanceControl placement="login" compact />
          </div>
        </div>
        <div className="login-context__statement">
          <h1>
            让每次运行，
            <br />
            <em>都有引力。</em>
          </h1>
          <div className="login-capabilities">
            <span>周期与容量</span>
            <span>用量与审计</span>
            <span>自动化策略</span>
          </div>
          <div className="login-diagram" aria-hidden="true">
            <div className="login-diagram__core">
              <BrandMark />
            </div>
            <div className="login-diagram__line" />
            <div className="login-diagram__nodes">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
        <footer className="login-context__footer">
          <span>Sub2API 运维控制台</span>
          <span>管理员安全访问</span>
        </footer>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-card__icon">
            <LockKeyhole size={20} aria-hidden="true" />
          </div>
          {oauthCallbackActive ? (
            <>
              <div className="login-card__heading">
                <h2>正在确认管理员身份</h2>
              </div>
              <div className="oauth-progress" role="status">
                <LoaderCircle className="spin" size={20} aria-hidden="true" />
                <span>建立加密运维会话</span>
              </div>
            </>
          ) : !challenge ? (
            <>
              <div className="login-card__heading">
                <h2>登录控制台</h2>
              </div>
              {(config.data?.githubOAuthEnabled || config.data?.googleOAuthEnabled) && (
                <div className="oauth-section">
                  <div className="oauth-actions">
                    {config.data.githubOAuthEnabled && (
                      <Button variant="secondary" type="button" onClick={() => startOAuth('github')}>
                        <SiGithub
                          className="oauth-brand-icon oauth-brand-icon--github"
                          size={18}
                          title=""
                          aria-hidden="true"
                        />
                        GitHub 登录
                      </Button>
                    )}
                    {config.data.googleOAuthEnabled && (
                      <Button variant="secondary" type="button" onClick={() => startOAuth('google')}>
                        <SiGoogle
                          className="oauth-brand-icon oauth-brand-icon--google"
                          size={18}
                          title=""
                          aria-hidden="true"
                        />
                        Google 登录
                      </Button>
                    )}
                  </div>
                  <div className="auth-divider">
                    <span>或使用管理员账密</span>
                  </div>
                </div>
              )}
              <form onSubmit={submitLogin} className="auth-form">
                <label>
                  <span>管理员邮箱</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="admin@example.com"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="输入管理员密码"
                    required
                  />
                </label>
                {config.data?.turnstileEnabled && config.data.turnstileSiteKey && (
                  <Turnstile
                    ref={turnstile}
                    siteKey={config.data.turnstileSiteKey}
                    onSuccess={setTurnstileToken}
                    onExpire={() => setTurnstileToken('')}
                    options={{ theme: resolvedTheme, size: 'flexible' }}
                  />
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <Button
                  busy={login.isPending}
                  disabled={config.data?.turnstileEnabled && !turnstileToken}
                  type="submit"
                >
                  继续登录 <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="login-card__heading">
                <h2>确认是你本人</h2>
                <p>请输入 {challenge.maskedEmail} 对应验证器生成的 6 位代码。</p>
              </div>
              <form onSubmit={submitTwoFactor} className="auth-form">
                <label>
                  <span>验证代码</span>
                  <input
                    className="totp-input"
                    name="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    required
                    autoFocus
                  />
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <Button busy={verify.isPending} type="submit">
                  完成验证 <ArrowRight size={16} aria-hidden="true" />
                </Button>
                <Button
                  variant="quiet"
                  type="button"
                  onClick={() => {
                    setChallenge(null)
                    setError('')
                  }}
                >
                  返回账号登录
                </Button>
              </form>
            </>
          )}
        </div>
        <p className="login-footnote">登录会话默认保持 12 小时，OAuth 凭据只在回调时一次性交换，不写入浏览器存储。</p>
      </section>
    </main>
  )
}
