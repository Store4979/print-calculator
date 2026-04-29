// ============================================================
//  EMPLOYEE PIN LOGIN
//  Large, iPad-friendly numeric keypad. The PIN auto-submits when
//  the 4th digit is entered. On a successful match the employee is
//  pushed to localStorage and the onLogin callback is fired.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { findEmployeeByPin, isSupabaseConfigured, setStoredEmployee } from "../lib/supabase.js";

const KEY_GRID = ["1","2","3","4","5","6","7","8","9","clear","0","ok"];

export default function EmployeeLogin({ onLogin, onCancel, title = "Employee Sign-In" }) {
  const [pin, setPin]     = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);
  // Submit guard so the auto-submit effect doesn't fire twice when
  // StrictMode double-invokes effects in dev.
  const submittedRef = useRef(false);

  const submit = async (currentPin) => {
    const value = currentPin ?? pin;
    if (value.length !== 4 || submittedRef.current) return;
    if (!isSupabaseConfigured) {
      setError("Database isn't configured.");
      return;
    }
    submittedRef.current = true;
    setBusy(true);
    setError("");
    try {
      const emp = await findEmployeeByPin(value);
      if (!emp) {
        setError("PIN not recognized.");
        setPin("");
        submittedRef.current = false;
      } else {
        setStoredEmployee(emp);
        onLogin?.(emp);
      }
    } catch (e) {
      setError(e?.message || String(e));
      setPin("");
      submittedRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  const press = (k) => {
    if (busy) return;
    if (k === "clear") { setPin(""); setError(""); submittedRef.current = false; return; }
    if (k === "ok")    { submit(); return; }
    if (pin.length >= 4) return;
    setPin(p => (p + k).slice(0, 4));
    setError("");
  };

  // Auto-submit when the PIN reaches 4 digits.
  useEffect(() => {
    if (pin.length === 4) submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Keyboard support — handy on a regular desktop test.
  useEffect(() => {
    const onKey = (e) => {
      if (busy) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin(p => p.slice(0, -1));
      else if (e.key === "Enter")     submit();
      else if (e.key === "Escape" && onCancel) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pin]);

  return (
    <div className="emp-login-backdrop" role="dialog" aria-modal="true">
      <div className="emp-login-card">
        <div className="emp-login-title">{title}</div>
        <div className="emp-login-sub">Enter your 4-digit PIN</div>

        <div className="emp-login-dots" aria-hidden="true">
          {[0,1,2,3].map(i => (
            <span key={i} className={`emp-login-dot ${pin.length > i ? "is-filled" : ""}`} />
          ))}
        </div>

        <div className="emp-login-error" role="alert" aria-live="polite">
          {error || " "}
        </div>

        <div className="emp-login-keypad">
          {KEY_GRID.map(k => (
            <button
              key={k}
              type="button"
              disabled={busy}
              onClick={() => press(k)}
              className={`emp-login-key ${k === "clear" ? "is-clear" : ""} ${k === "ok" ? "is-ok" : ""}`}
              aria-label={k === "clear" ? "Clear" : k === "ok" ? "Submit" : `Digit ${k}`}
            >
              {k === "clear" ? "⌫" : k === "ok" ? "OK" : k}
            </button>
          ))}
        </div>

        {onCancel && (
          <button
            type="button"
            className="pc-btn pc-btn-secondary emp-login-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
