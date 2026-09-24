import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { inputClass } from "./controls";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "new-password" | "current-password" | "off";
  hint?: ReactNode;
  invalid?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  invalid,
  onEnter,
  autoFocus,
}: Props) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className={cn(
            inputClass,
            "pr-10",
            invalid && "border-destructive focus-visible:ring-destructive",
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          aria-invalid={invalid || undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Rough strength estimate for guidance only (we never store or send the password). */
export function passwordStrength(pw: string): { label: string; tone: "weak" | "ok" | "strong" } {
  if (!pw) return { label: "", tone: "weak" };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const score = pw.length + classes * 3;
  if (pw.length < 8 || score < 16)
    return { label: "Weak — use at least 12 characters", tone: "weak" };
  if (score < 24) return { label: "OK — longer is stronger", tone: "ok" };
  return { label: "Strong", tone: "strong" };
}
