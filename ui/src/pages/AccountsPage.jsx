import { useState } from "react";
import { UserPlus, Lock, LogIn, Trash2, Check, KeyRound } from "lucide-react";
import { useApp } from "../App.jsx";
import { api, fmt } from "../api.js";
import { Avatar, Modal } from "../components/ui.jsx";

export default function AccountsPage() {
  const { state, account, switchAccount, refreshState, toast } = useApp();
  const [creating, setCreating] = useState(false);
  const [unlocking, setUnlocking] = useState(null);
  const [editing, setEditing] = useState(null);

  const doSwitch = async (acc, password) => {
    try {
      await switchAccount(acc, password);
      setUnlocking(null);
      await refreshState();
      window.location.reload();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 860 }}>
        <div className="page-head">
          <div>
            <h1>Accounts</h1>
            <p>Local profiles keep sessions and statistics separate. Optional — protect a profile with a password.</p>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => setCreating(true)}><UserPlus size={16} /> New account</button>
          </div>
        </div>

        <div className="card">
          {state.accounts.map((a) => {
            const current = a.id === account?.id;
            return (
              <div key={a.id} className="list-item">
                <Avatar account={a} size={42} />
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}>
                    <b>{a.name}</b>
                    {current && <span className="badge accent"><Check size={11} /> Signed in</span>}
                    {a.protected && <span className="badge"><Lock size={11} /> Protected</span>}
                  </div>
                  <div className="small muted">{a.email || "No email"} · created {fmt.ago(a.createdAt)}</div>
                </div>
                {current ? (
                  <button className="btn sm" onClick={() => setEditing(a)}>Edit</button>
                ) : (
                  <button className="btn sm" onClick={() => (a.protected ? setUnlocking(a) : doSwitch(a))}><LogIn size={14} /> Switch</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {creating && (
        <AccountModal
          title="New account"
          onClose={() => setCreating(false)}
          onSave={async (v) => {
            const acc = await api("/accounts", { method: "POST", body: v });
            await refreshState();
            setCreating(false);
            toast(`Account "${acc.name}" created`);
          }}
        />
      )}
      {editing && (
        <AccountModal
          title="Edit account"
          initial={editing}
          onClose={() => setEditing(null)}
          onDelete={
            state.accounts.length > 1
              ? async () => {
                  if (!confirm(`Delete "${editing.name}"? Sessions stay on disk.`)) return;
                  await api(`/accounts/${editing.id}`, { method: "DELETE" });
                  const next = state.accounts.find((a) => a.id !== editing.id && !a.protected);
                  if (next) await switchAccount(next);
                  window.location.reload();
                }
              : null
          }
          onSave={async (v) => {
            const patch = { name: v.name, email: v.email };
            if (v.password || v.clearPassword) patch.password = v.clearPassword ? "" : v.password;
            await api(`/accounts/${editing.id}`, { method: "PATCH", body: patch });
            await refreshState();
            setEditing(null);
            toast("Account updated");
          }}
        />
      )}
      {unlocking && <UnlockModal account={unlocking} onClose={() => setUnlocking(null)} onUnlock={(pw) => doSwitch(unlocking, pw)} />}
    </div>
  );
}

function AccountModal({ title, initial = {}, onClose, onSave, onDelete }) {
  const [v, setV] = useState({ name: initial.name || "", email: initial.email || "", password: "", clearPassword: false });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      title={title}
      icon={<Avatar account={{ name: v.name || "?", color: initial.color }} size={36} />}
      onClose={onClose}
      footer={
        <>
          {onDelete && <button className="btn danger" style={{ marginRight: "auto" }} onClick={onDelete}><Trash2 size={15} /> Delete</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!v.name.trim()} onClick={() => onSave(v)}>Save</button>
        </>
      }
    >
      <label className="field">Name<input className="input" autoFocus value={v.name} onChange={set("name")} placeholder="Your name" /></label>
      <label className="field">Email <span className="hint">Optional, shown on your profile only</span><input className="input" value={v.email} onChange={set("email")} placeholder="you@example.com" /></label>
      <label className="field">
        {initial.protected ? "New password" : "Password"} <span className="hint">Optional. Leave empty for no lock.</span>
        <input className="input" type="password" value={v.password} onChange={set("password")} placeholder="••••••••" />
      </label>
      {initial.protected && (
        <label className="row small muted" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={v.clearPassword} onChange={(e) => setV((x) => ({ ...x, clearPassword: e.target.checked }))} /> Remove password protection
        </label>
      )}
    </Modal>
  );
}

function UnlockModal({ account, onClose, onUnlock }) {
  const [pw, setPw] = useState("");
  return (
    <Modal
      title={`Sign in as ${account.name}`}
      icon={<KeyRound size={20} style={{ color: "var(--accent)" }} />}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onUnlock(pw)}>Sign in</button></>}
    >
      <input className="input" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onUnlock(pw)} />
    </Modal>
  );
}
