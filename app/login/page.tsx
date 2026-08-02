import type { Metadata } from "next";
import { BarChart3, BellRing, Building2, ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Edmonton Infill Tracker workspace.",
};

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-story-inner">
          <div className="login-brand">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div>
              <strong>Edmonton</strong>
              <span>Infill Tracker</span>
            </div>
          </div>
          <div className="login-copy">
            <div className="login-eyebrow">Property intelligence from public records</div>
            <h1>See infill signals before the listing appears.</h1>
            <p>
              Permit timelines and neighbourhood alerts turn scattered civic records into a focused
              opportunity list.
            </p>
          </div>
          <div className="login-preview" aria-hidden="true">
            <div className="preview-head">
              <span>Latest high-confidence signal</span>
              <span>92 / 100</span>
            </div>
            <div className="preview-address">
              <Building2 size={20} />
              <div>
                <strong>10524 75 Avenue NW</strong>
                <span>Queen Alexandra · 4 units</span>
              </div>
            </div>
            <div className="preview-events">
              <div>
                <span className="event-dot" />
                <div>
                  <strong>Building permit issued</strong>
                  <span>Today · $1.18M</span>
                </div>
              </div>
              <div>
                <span className="event-dot" />
                <div>
                  <strong>Development permit approved</strong>
                  <span>18 days earlier</span>
                </div>
              </div>
              <div>
                <span className="event-dot" />
                <div>
                  <strong>Demolition permit issued</strong>
                  <span>43 days earlier</span>
                </div>
              </div>
            </div>
          </div>
          <div className="login-benefits">
            <div>
              <BarChart3 size={17} />
              <span>Evidence-ranked projects</span>
            </div>
            <div>
              <BellRing size={17} />
              <span>Daily watchlist alerts</span>
            </div>
            <div>
              <ShieldCheck size={17} />
              <span>Private, self-hosted data</span>
            </div>
          </div>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-form-wrap">
          <div className="mobile-login-brand">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <strong>Edmonton Infill Tracker</strong>
          </div>
          <div className="login-form-heading">
            <h2>Welcome back</h2>
            <p>Sign in with the email connected to your workspace.</p>
          </div>
          <LoginForm />
          <p className="login-help">
            Your initial administrator is configured privately when the app is first installed.
          </p>
        </div>
        <footer>Permit data provided by the City of Edmonton Open Data Portal.</footer>
      </section>
    </main>
  );
}
