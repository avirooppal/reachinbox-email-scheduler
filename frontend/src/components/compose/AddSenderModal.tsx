import React, { useState } from "react";
import { X, Check, Server, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";

interface AddSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newSenderId: string) => void;
}

type ProviderPreset = "gmail" | "resend" | "brevo" | "custom";

export const AddSenderModal: React.FC<AddSenderModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [preset, setPreset] = useState<ProviderPreset>("gmail");
  const [name, setName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [minDelayMs, setMinDelayMs] = useState(2000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPreset = (p: ProviderPreset) => {
    setPreset(p);
    setErrorMsg(null);
    if (p === "gmail") {
      setSmtpHost("smtp.gmail.com");
      setSmtpPort(587);
      if (fromEmail && !smtpUser) setSmtpUser(fromEmail);
    } else if (p === "resend") {
      setSmtpHost("smtp.resend.com");
      setSmtpPort(465);
      setSmtpUser("resend");
    } else if (p === "brevo") {
      setSmtpHost("smtp-relay.brevo.com");
      setSmtpPort(587);
    } else {
      setSmtpHost("");
      setSmtpPort(587);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setErrorMsg("Please enter a sender display name");
      return;
    }
    if (!fromEmail.trim() || !fromEmail.includes("@")) {
      setErrorMsg("Please enter a valid From Email address");
      return;
    }
    if (!smtpHost.trim()) {
      setErrorMsg("SMTP host is required");
      return;
    }
    if (!smtpUser.trim()) {
      setErrorMsg("SMTP username is required");
      return;
    }
    if (!smtpPass.trim()) {
      setErrorMsg("SMTP password / app password is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.senders.createCustom({
        name: name.trim(),
        fromEmail: fromEmail.trim(),
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort),
        smtpUser: smtpUser.trim(),
        smtpPass: smtpPass.trim(),
        hourlyLimit: Number(hourlyLimit) || undefined,
        minDelayMs: Number(minDelayMs) || undefined
      });

      toast.success("Real SMTP sender connected and verified!");
      onSuccess(res.sender.id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to verify and save SMTP sender");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in-50">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[#E5E7EB] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F1F2]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#EAF6EE] text-[#00A63E] flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#111827]">Connect Real SMTP Sender</h2>
              <p className="text-[11px] text-[#6B7280]">Deliver real emails to real recipient inboxes</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F3F4F6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 text-xs">
          {/* Preset Buttons */}
          <div>
            <label className="block text-[11px] font-semibold text-[#4B5563] mb-1.5">
              Provider Preset
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { id: "gmail", label: "Gmail" },
                  { id: "resend", label: "Resend" },
                  { id: "brevo", label: "Brevo" },
                  { id: "custom", label: "Custom" }
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p.id)}
                  className={`py-1.5 px-3 rounded-lg border text-center font-medium transition-all ${
                    preset === p.id
                      ? "border-[#00A63E] bg-[#EAF6EE] text-[#00A63E] shadow-sm"
                      : "border-[#E5E7EB] text-[#4B5563] hover:bg-[#F9FAFB]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === "gmail" && (
              <p className="mt-1.5 text-[10px] text-[#6B7280] leading-normal">
                Use your Gmail address and a 16-character <b>Google App Password</b> (generated in your Google Account Security settings).
              </p>
            )}
            {preset === "resend" && (
              <p className="mt-1.5 text-[10px] text-[#6B7280] leading-normal">
                Use <b>resend</b> as username and your Resend API Key (<code>re_...</code>) as password.
              </p>
            )}
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] mb-1">
                Display Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Acme Sales Team"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:outline-none focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] mb-1">
                From Email *
              </label>
              <input
                type="email"
                required
                placeholder="sales@yourdomain.com"
                value={fromEmail}
                onChange={(e) => {
                  setFromEmail(e.target.value);
                  if (preset === "gmail" && !smtpUser) setSmtpUser(e.target.value);
                }}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:outline-none focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-[#4B5563] mb-1">
                SMTP Host *
              </label>
              <input
                type="text"
                required
                placeholder="smtp.example.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:outline-none focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] mb-1">
                Port *
              </label>
              <input
                type="number"
                required
                placeholder="587"
                value={smtpPort}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:outline-none focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] mb-1">
                SMTP Username *
              </label>
              <input
                type="text"
                required
                placeholder="username or email"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:outline-none focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#4B5563] mb-1">
                SMTP Password / Key *
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••••••"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D1D5DB] focus:outline-none focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#F0F1F2]">
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-0.5">
                Hourly Limit (emails/hr)
              </label>
              <input
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#D1D5DB] text-xs focus:outline-none focus:border-[#00A63E]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-0.5">
                Min Gap (ms)
              </label>
              <input
                type="number"
                min={0}
                value={minDelayMs}
                onChange={(e) => setMinDelayMs(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#D1D5DB] text-xs focus:outline-none focus:border-[#00A63E]"
              />
            </div>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold">Connection Check Failed: </span>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-[#F0F1F2]">
            <div className="flex items-center gap-1.5 text-[11px] text-[#059669]">
              <ShieldCheck className="w-4 h-4" />
              <span>Credentials encrypted with AES-256-GCM at rest</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6] transition-colors"
              >
                Cancel
              </button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isSubmitting}
                className="gap-1.5"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Test & Save Sender</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
