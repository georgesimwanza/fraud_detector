"use client";

import { KeyRound, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createUser, fetchUsers, updateUser } from "@/lib/live";
import type { Role, UserRow } from "@/lib/schemas";
import { fmtDateTime } from "./format";
import { Button, Card, EmptyState, Field, PageHeader, inputClass, tableHeadRow } from "./ui";

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

function NewUserForm({ onDone, onCancel }: { onDone: (msg: string) => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("analyst");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createUser(email, role, password);
      onDone(`Created ${role} ${email.trim().toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the user.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="New user" className="mb-5" action={<Button variant="ghost" size="sm" onClick={onCancel} aria-label="Close"><X size={16} /></Button>}>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_180px_1fr_auto] md:items-end">
        <Field label="Email address">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="analyst@example.com" className={inputClass} />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Temporary password">
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-2">At least 8 characters. Stored only as a bcrypt hash; share it with the user out of band.</p>
    </Card>
  );
}

function ResetPassword({ user, onDone }: { user: UserRow; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <KeyRound size={14} /> Reset password
      </Button>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await updateUser(user.id, { password });
          setOpen(false);
          setPassword("");
          onDone(`Password reset for ${user.email}.`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not reset the password.");
        }
      }}
    >
      <input
        type="password"
        required
        minLength={8}
        autoFocus
        autoComplete="new-password"
        placeholder="New password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={`${inputClass} w-40! py-1.5!`}
        aria-label={`New password for ${user.email}`}
      />
      <Button size="sm" type="submit">
        Set
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)} aria-label="Cancel">
        <X size={14} />
      </Button>
      {error && <span className="text-xs text-critical">{error}</span>}
    </form>
  );
}

/** FR11: an admin manages accounts and roles. Every change is audit-logged and applies on the user's next request. */
export function UsersAdmin({ selfEmail }: { selfEmail: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    fetchUsers()
      .then(setUsers)
      .catch((e) => setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not load users." }));
  }, []);
  useEffect(load, [load]);

  const done = (text: string) => {
    setMessage({ kind: "ok", text });
    setAdding(false);
    load();
  };
  async function change(user: UserRow, changes: { role?: Role; active?: boolean }, text: string) {
    setMessage(null);
    try {
      await updateUser(user.id, changes);
      done(text);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not update the user." });
    }
  }

  const active = users?.filter((u) => u.active).length ?? 0;
  const admins = users?.filter((u) => u.active && u.role === "admin").length ?? 0;

  return (
    <>
      <PageHeader title="Users" subtitle={users ? `${active} active · ${admins} admin${admins === 1 ? "" : "s"} · changes are audit-logged` : "Accounts and roles"}>
        <Button onClick={() => setAdding(true)} disabled={adding}>
          <UserPlus size={16} /> New user
        </Button>
      </PageHeader>

      {adding && <NewUserForm onDone={done} onCancel={() => setAdding(false)} />}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mb-5 rounded-lg px-4 py-3 text-sm ${message.kind === "error" ? "bg-banner text-critical" : "bg-brand-50 text-ink"}`}>
          {message.kind === "ok" ? "✓ " : ""}
          {message.text}
        </p>
      )}

      <Card flush>
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className={tableHeadRow}>
                <th className="px-5 py-3 font-bold">User</th>
                <th className="px-3 py-3 font-bold">Role</th>
                <th className="px-3 py-3 font-bold">Status</th>
                <th className="px-3 py-3 font-bold">Last sign-in</th>
                <th className="px-5 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => {
                const self = u.email === selfEmail;
                return (
                  <tr key={u.id} className={`border-b border-line last:border-0 ${u.active ? "" : "text-muted"}`}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${u.active ? "btn-primary text-white" : "bg-track text-ink-2"}`}>
                          {initials(u.email)}
                        </span>
                        <span>
                          <span className="block font-bold text-ink">
                            {u.email} {self && <span className="font-semibold text-ink-2">(you)</span>}
                          </span>
                          <span className="block text-xs text-ink-2">added {fmtDateTime(u.createdAt)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={u.role}
                        disabled={self}
                        title={self ? "You can't change your own role" : undefined}
                        onChange={(e) => change(u, { role: e.target.value as Role }, `${u.email} is now ${e.target.value === "admin" ? "an admin" : "an analyst"}.`)}
                        className={`${inputClass} w-32! py-1.5! font-semibold`}
                        aria-label={`Role for ${u.email}`}
                      >
                        <option value="analyst">Analyst</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${u.active ? "bg-[var(--tile-green-bg)] text-ink" : "bg-track text-ink-2"}`}>
                        <span aria-hidden className="text-[10px]" style={{ color: u.active ? "var(--good)" : "var(--muted)" }}>
                          {u.active ? "●" : "○"}
                        </span>
                        {u.active ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-ink-2 tabular-nums">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center justify-end gap-1">
                        <ResetPassword user={u} onDone={done} />
                        {!self && (
                          <Button
                            variant={u.active ? "ghost" : "secondary"}
                            size="sm"
                            onClick={() => change(u, { active: !u.active }, `${u.email} ${u.active ? "deactivated — signed out on their next request" : "reactivated"}.`)}
                          >
                            {u.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users?.length === 0 && <EmptyState>No users.</EmptyState>}
        </div>
      </Card>
      <p className="mt-3 text-xs text-ink-2">The last active admin can&apos;t be demoted or deactivated, and no admin can remove their own access.</p>
    </>
  );
}
