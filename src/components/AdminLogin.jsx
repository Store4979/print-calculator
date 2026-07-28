// ============================================================
//  ADMIN LOGIN — Supabase Auth gate for the Admin panel (Phase A)
//
//  Replaces the old client-side "store4979" password prompt. Signs in
//  with email/password (or a magic link), then verifies the account is
//  an owner/manager of this store before granting admin access. A
//  staff-only or non-member account is signed back out with a clear
//  message so it can never half-open the panel.
//
//  Reuses the emp-login-* modal styles for visual consistency.
// ============================================================

import { useEffect, useRef, useState } from "react";
import {
  signInWithPassword, sendMagicLink, getStoreRole, isAdminRole, signOut,
} from "../lib/storeConfig.js";
import { isSupabaseConfigured } from "../lib/supabase.js";

export default function AdminLogin({ onClose, onSuccess }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [info, setInfo]         = useState("");
  const [busy, setBusy]         = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!isSupabaseConfigured) { setError("Sign-in isn't configured."); return; }
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError(""); setInfo("");
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setError(err?.message || "Sign-in failed.");
      setBusy(false);
      return;
    }
    // Signed in — now verify the role. Separate try so a transient lookup
    // failure doesn't tear down a valid owner session with a wrong message.
    let role;
    try {
      role = await getStoreRole();
    } catch {
      setError("Signed in, but couldn't verify your access — please try again.");
      setBusy(false);
      return; // keep the session; a retry will re-check the role
    }
    if (isAdminRole(role)) {
      onSuccess?.();
    } else {
      await signOut();
      setError("That account isn't an owner or manager of this store.");
    }
    setBusy(false);
  };

  const magicLink = async () => {
    if (busy) return;
    if (!email.trim()) { setError("Enter your email first."); return; }
    setBusy(true); setError(""); setInfo("");
    try {
      await sendMagicLink(email);
      setInfo("Check your email for a sign-in link.");
    } catch (err) {
      setError(err?.message || "Couldn't send the link.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="emp-login-backdrop" role="dialog" aria-modal="true">
      <div className="emp-login-card" style={{ maxWidth: 380 }}>
        <div className="emp-login-title">Admin Sign-In</div>
        <div className="emp-login-sub">Owner / manager access</div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <input
            ref={emailRef}
            className="pc-input"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            disabled={busy}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
          />
          <input
            className="pc-input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            disabled={busy}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
          />

          <div className="emp-login-error" role="alert" aria-live="polite" style={{ minHeight: 18 }}>
            {error || info || " "}
          </div>

          <button type="submit" className="pc-btn pc-btn-primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <button
          type="button"
          className="pc-btn pc-btn-secondary pc-btn-sm"
          style={{ marginTop: 8 }}
          onClick={magicLink}
          disabled={busy}
        >
          Email me a sign-in link
        </button>

        <button
          type="button"
          className="pc-btn pc-btn-secondary emp-login-cancel"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
