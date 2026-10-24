import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Badge } from "../src/components/ui/Badge";
import { Chip } from "../src/components/ui/Chip";
import { Button } from "../src/components/ui/Button";
import { Logo } from "../src/components/layout/Logo";

describe("Frontend Component Design Tokens & Primitives", () => {
  it("renders Badge variants matching design tokens", () => {
    // Scheduled badge
    const date = new Date("2026-11-03T09:15:12Z");
    const { unmount } = render(
      <Badge variant="scheduled" timestamp={date} />
    );
    expect(screen.getByText(/:12/)).toBeInTheDocument();
    unmount();

    // Sent badge
    const { unmount: unmountSent } = render(<Badge variant="sent" />);
    expect(screen.getByText("Sent")).toBeInTheDocument();
    unmountSent();

    // Failed badge
    render(<Badge variant="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders Chip with outline and triggers onRemove callback", () => {
    const handleRemove = vi.fn();
    render(
      <Chip label="oliver@domain.io" isValid={true} onRemove={handleRemove} />
    );

    expect(screen.getByText("oliver@domain.io")).toBeInTheDocument();
    const removeBtn = screen.getByRole("button");
    fireEvent.click(removeBtn);
    expect(handleRemove).toHaveBeenCalledTimes(1);
  });

  it("renders Logo with Silkscreen pixel styling 'ONB'", () => {
    render(<Logo />);
    const logoText = screen.getByText("ONB");
    expect(logoText).toBeInTheDocument();
    expect(logoText).toHaveClass("font-pixel");
  });

  it("renders primary and outline button variants", () => {
    const { rerender } = render(<Button variant="primary">Send</Button>);
    expect(screen.getByText("Send")).toHaveClass("bg-[#00A63E]");

    rerender(<Button variant="outline">Compose</Button>);
    expect(screen.getByText("Compose")).toHaveClass("border-[#00A63E]");
  });
});
