import type {
  AuthStatus,
  BackboneSummary,
  LoginProgress,
  OpenCheckoutRow,
} from "../vite-env";
import { BrandMark, Spinner } from "./BrandMark";
import { AuthGate } from "./AuthGate";

/**
 * No-project landing: auth + open project.
 */
export function WelcomeView({
  platformClass,
  isOpening,
  openingLabel,
  signedIn,
  auth,
  backbone,
  authBusy,
  authMessage,
  loginProgress,
  loginDeviceAuth,
  error,
  recentProjects,
  appVersion,
  grokBinary,
  onRefreshAuth,
  onLogin,
  onCancelLogin,
  onSubmitLoginCode,
  onLogout,
  onSetApiKey,
  onPickProject,
  onOpenProject,
  openCheckouts = [],
  onOpenSettingsSection,
  platform,
  inert: shellInert,
}: {
  platformClass: string;
  isOpening: boolean;
  openingLabel: string | null;
  signedIn: boolean;
  auth: AuthStatus | null;
  backbone: BackboneSummary | null;
  authBusy: boolean;
  authMessage: string | null;
  loginProgress?: LoginProgress | null;
  loginDeviceAuth?: boolean;
  error: string | null;
  recentProjects: string[];
  appVersion?: string;
  grokBinary?: string | null;
  onRefreshAuth: () => void;
  onLogin: (deviceAuth?: boolean) => void;
  onCancelLogin: () => void;
  onSubmitLoginCode?: (code: string) => void;
  onLogout: () => void;
  onSetApiKey: (key: string) => void;
  onPickProject: () => void;
  onOpenProject: (cwd: string) => void;
  openCheckouts?: OpenCheckoutRow[];
  onOpenSettingsSection?: (section: "mcp" | "plugins" | "skills") => void;
  platform?: string;
  inert?: boolean;
}) {
  return (
    <div
      className={`app no-project ${platformClass}`.trim()}
      inert={shellInert || undefined}
    >
      <div className="titlebar-drag welcome-drag" aria-hidden />
      <div className="welcome">
        <div className={`welcome-card ${isOpening ? "is-loading" : ""}`}>
          <div className="brand brand-welcome">
            <BrandMark size={40} />
            <div className="brand-text">
              <h1>Grok</h1>
              <p>登录后就可以开始说</p>
            </div>
          </div>
          <p className="welcome-lead">
            登录一次。然后直接开始说。要用文件夹时再选。
          </p>
          {!auth && !isOpening ? (
            <div className="loading-banner" role="status" aria-live="polite">
              <Spinner size={18} />
              <div>
                <strong>Starting…</strong>
                <span>Loading Grok login and backbone</span>
              </div>
            </div>
          ) : null}

          <AuthGate
            auth={auth}
            backbone={backbone}
            busy={authBusy || isOpening}
            message={authMessage}
            loginProgress={loginProgress}
            loginDeviceAuth={loginDeviceAuth}
            onRefresh={onRefreshAuth}
            onLogin={onLogin}
            onCancelLogin={onCancelLogin}
            onSubmitLoginCode={onSubmitLoginCode}
            onLogout={onLogout}
            onSetApiKey={onSetApiKey}
            onOpenInstallDocs={() => void window.grokDesktop.openInstallDocs()}
            onOpenSettingsSection={onOpenSettingsSection}
            platform={platform}
          />

          {signedIn ? (
            <p className="welcome-lead welcome-home-hint">
              正在打开…
            </p>
          ) : null}

          {isOpening && (
            <div className="loading-banner" role="status" aria-live="polite">
              <Spinner size={18} />
              <div>
                <strong>Starting Grok agent…</strong>
                <span>
                  Connecting to backbone
                  {openingLabel ? ` for ${openingLabel}` : ""}
                </span>
              </div>
            </div>
          )}

          {error && <p className="welcome-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
