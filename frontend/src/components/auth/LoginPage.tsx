import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Input } from "../ui/Input";
import { toast } from "sonner";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const loginMutation = useMutation({
    mutationFn: api.auth.login,
    onSuccess: (res) => {
      queryClient.setQueryData(["auth", "me"], { user: res.user });
      toast.success(`Welcome back, ${res.user.name}!`);
      navigate("/scheduled");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Invalid credentials");
    }
  });

  const registerMutation = useMutation({
    mutationFn: api.auth.register,
    onSuccess: (res) => {
      queryClient.setQueryData(["auth", "me"], { user: res.user });
      toast.success(`Account created! Welcome, ${res.user.name}`);
      navigate("/scheduled");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Registration failed");
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in email and password");
      return;
    }

    if (isRegister) {
      registerMutation.mutate({ email, password, name: name || undefined });
    } else {
      loginMutation.mutate({ email, password });
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white px-4">
      {/* Centered White Card matching 01-login.png */}
      <div className="w-full max-w-[420px] rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[#111827] text-left mb-6">
          {isRegister ? "Create Account" : "Login"}
        </h1>

        {/* Google OAuth Button */}
        <a
          href={api.auth.googleUrl}
          className="w-full h-11 px-4 rounded-xl bg-[#EAF6EE] hover:bg-[#D9EFE0] transition-colors flex items-center justify-center gap-3 text-sm font-semibold text-[#111827] select-none"
        >
          {/* Official Google G Logo */}
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Login with Google</span>
        </a>

        {/* Divider matching 01-login.png */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#E5E7EB]" />
          </div>
          <span className="relative bg-white px-3 text-xs text-[#9CA3AF]">
            {isRegister ? "or register through email" : "or sign up through email"}
          </span>
        </div>

        {/* Email / Password Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {isRegister && (
            <div>
              <Input
                type="text"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 rounded-xl bg-[#F4F5F6]"
              />
            </div>
          )}

          <div>
            <Input
              type="email"
              placeholder="Email ID"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl bg-[#F4F5F6]"
            />
          </div>

          <div>
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl bg-[#F4F5F6]"
            />
          </div>

          {/* Solid Green Login Button */}
          <button
            type="submit"
            disabled={isPending}
            className="w-full h-11 mt-2 rounded-xl bg-[#00A63E] hover:bg-[#009236] active:scale-[0.99] text-white text-sm font-semibold transition-all flex items-center justify-center disabled:opacity-50"
          >
            {isPending ? "Please wait..." : isRegister ? "Create Account" : "Login"}
          </button>
        </form>

        {/* Toggle between Login and Register */}
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            className="text-xs text-[#6B7280] hover:text-[#00A63E] transition-colors"
          >
            {isRegister
              ? "Already have an account? Sign in"
              : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
};
